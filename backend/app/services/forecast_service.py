"""Runs the forecasting engine, persists results, scores past predictions."""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from ..config import settings
from ..db import execute, fetch_all, fetch_one, get_sessionmaker
from .forecast.engine import ForecastResult, run_forecast
from .price_service import METALS, price_service

log = logging.getLogger("metalcast.forecast_service")


def _coerce_date(v: Any) -> date:
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, str):
        return datetime.strptime(v, "%Y-%m-%d").date()
    return date.today()


class ForecastService:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._running: set[str] = set()

    # ------------------------------------------------------------------ #
    async def run_for_metal(self, metal: str, persist: bool = True) -> Dict[str, Any]:
        if metal in self._running:
            return {"metal": metal, "status": "already_running"}
        self._running.add(metal)
        try:
            dates, closes = await price_service.closes(metal, limit=1400)
            if len(closes) < settings.min_history_points:
                msg = (f"{metal}: only {len(closes)} daily bars — need "
                       f"{settings.min_history_points}. Run a backfill first.")
                log.warning(msg)
                if persist:
                    await self._persist_failure(metal, msg, closes[-1] if closes else 0.0)
                return {"metal": metal, "status": "failed", "error": msg}

            # CPU-bound: never block the event loop.
            result: ForecastResult = await asyncio.to_thread(run_forecast, dates, closes)

            if persist and result.status != "failed":
                run_id = await self._persist(metal, result)
                payload = result.to_dict()
                payload["run_id"] = run_id
            else:
                payload = result.to_dict()
            payload["metal"] = metal
            log.info("forecast %s: status=%s in %dms", metal, result.status, result.duration_ms)
            return payload
        finally:
            self._running.discard(metal)

    async def run_all(self) -> Dict[str, Any]:
        async with self._lock:
            out: Dict[str, Any] = {}
            for metal in METALS:
                try:
                    r = await self.run_for_metal(metal)
                    out[metal] = {"status": r.get("status", "ok"),
                                  "horizons": len(r.get("horizons") or []),
                                  "duration_ms": r.get("duration_ms")}
                except Exception as exc:
                    log.exception("forecast run failed for %s", metal)
                    out[metal] = {"status": "failed", "error": str(exc)}
            return out

    # ------------------------------------------------------------------ #
    async def _persist(self, metal: str, r: ForecastResult) -> int:
        mid = await price_service.metal_id(metal)
        maker = get_sessionmaker()
        async with maker() as s:
            row = await fetch_one(
                s,
                """
                INSERT INTO prediction_runs
                    (metal_id, model_version, anchor_price, anchor_date, history_points,
                     ensemble, metrics, diagnostics, duration_ms, status, error)
                VALUES
                    (:mid, :mv, :ap, :ad, :hp,
                     CAST(:ens AS jsonb), CAST(:met AS jsonb), CAST(:diag AS jsonb),
                     :dur, :st, :err)
                RETURNING id
                """,
                {
                    "mid": mid, "mv": r.model_version, "ap": r.anchor_price,
                    "ad": _coerce_date(r.anchor_date), "hp": r.history_points,
                    "ens": json.dumps({"weights": r.weights, "member_views": r.member_views}),
                    "met": json.dumps(r.metrics, default=str),
                    "diag": json.dumps(r.diagnostics, default=str),
                    "dur": r.duration_ms, "st": r.status,
                    "err": "; ".join(r.warnings) if r.warnings else None,
                },
            )
            run_id = int(row["id"])

            for h in r.horizons:
                await execute(
                    s,
                    """
                    INSERT INTO predictions
                        (run_id, metal_id, horizon_type, horizon_label, horizon_days,
                         target_date, point_price, lower_80, upper_80, lower_95, upper_95,
                         sigma_log, prob_up, expected_return, direction, confidence)
                    VALUES
                        (:run, :mid, :ht, :hl, :hd, :td, :pp, :l80, :u80, :l95, :u95,
                         :sig, :pu, :er, :dir, :conf)
                    ON CONFLICT (run_id, horizon_days) DO NOTHING
                    """,
                    {
                        "run": run_id, "mid": mid, "ht": h.horizon_type,
                        "hl": h.horizon_label, "hd": h.horizon_days,
                        "td": _coerce_date(h.target_date), "pp": h.point_price,
                        "l80": h.lower_80, "u80": h.upper_80,
                        "l95": h.lower_95, "u95": h.upper_95,
                        "sig": h.sigma_log, "pu": h.prob_up,
                        "er": h.expected_return, "dir": h.direction,
                        "conf": h.confidence,
                    },
                )
            await s.commit()
        return run_id

    async def _persist_failure(self, metal: str, message: str, anchor: float) -> None:
        try:
            mid = await price_service.metal_id(metal)
        except KeyError:
            return
        maker = get_sessionmaker()
        async with maker() as s:
            await execute(
                s,
                """
                INSERT INTO prediction_runs
                    (metal_id, model_version, anchor_price, anchor_date,
                     history_points, status, error)
                VALUES (:mid, :mv, :ap, (now() AT TIME ZONE 'UTC')::date, 0, 'failed', :err)
                """,
                {"mid": mid, "mv": settings.model_version, "ap": max(anchor, 0.01), "err": message[:500]},
            )
            await s.commit()

    # ------------------------------------------------------------------ #
    async def latest(self, metal: str, horizon_type: Optional[str] = None) -> Dict[str, Any]:
        maker = get_sessionmaker()
        async with maker() as s:
            run = await fetch_one(
                s,
                """
                SELECT r.*, m.code, m.display_name, m.hex_color, m.unit
                FROM prediction_runs r JOIN metals m ON m.id = r.metal_id
                WHERE m.code = :c AND r.status <> 'failed'
                ORDER BY r.run_ts DESC LIMIT 1
                """,
                {"c": metal},
            )
            if not run:
                return {"metal": metal, "available": False,
                        "reason": "no successful forecast run yet"}

            clause = "AND horizon_type = :ht" if horizon_type in ("short", "long") else ""
            preds = await fetch_all(
                s,
                f"""
                SELECT horizon_type, horizon_label, horizon_days, target_date,
                       point_price, lower_80, upper_80, lower_95, upper_95,
                       sigma_log, prob_up, expected_return, direction, confidence
                FROM predictions
                WHERE run_id = :run {clause}
                ORDER BY horizon_days ASC
                """,
                {"run": run["id"], "ht": horizon_type},
            )

        ensemble = run.get("ensemble") or {}
        if isinstance(ensemble, str):
            ensemble = json.loads(ensemble)
        metrics = run.get("metrics") or {}
        if isinstance(metrics, str):
            metrics = json.loads(metrics)
        diagnostics = run.get("diagnostics") or {}
        if isinstance(diagnostics, str):
            diagnostics = json.loads(diagnostics)

        return {
            "metal": metal,
            "available": True,
            "run_id": run["id"],
            "run_uid": str(run["run_uid"]),
            "run_ts": run["run_ts"],
            "model_version": run["model_version"],
            "anchor_price": float(run["anchor_price"]),
            "anchor_date": run["anchor_date"].isoformat(),
            "history_points": run["history_points"],
            "status": run["status"],
            "warnings": run.get("error"),
            "duration_ms": run.get("duration_ms"),
            "weights": ensemble.get("weights", {}),
            "member_views": ensemble.get("member_views", {}),
            "metrics": metrics,
            "diagnostics": diagnostics,
            "predictions": [
                {
                    "horizon_type": p["horizon_type"],
                    "horizon_label": p["horizon_label"],
                    "horizon_days": p["horizon_days"],
                    "target_date": p["target_date"].isoformat(),
                    "point_price": float(p["point_price"]),
                    "lower_80": float(p["lower_80"]),
                    "upper_80": float(p["upper_80"]),
                    "lower_95": float(p["lower_95"]),
                    "upper_95": float(p["upper_95"]),
                    "sigma_log": float(p["sigma_log"]),
                    "prob_up": float(p["prob_up"]),
                    "expected_return": float(p["expected_return"]),
                    "direction": p["direction"],
                    "confidence": float(p["confidence"]),
                }
                for p in preds
            ],
        }

    async def fan_path(self, metal: str, horizon_type: str = "short") -> List[Dict[str, Any]]:
        """Rebuild a dense fan by interpolating the stored horizon points."""
        latest = await self.latest(metal, horizon_type)
        if not latest.get("available"):
            return []
        preds = latest["predictions"]
        if not preds:
            return []
        return preds

    async def run_history(self, metal: str, horizon_days: int, limit: int = 120) -> List[Dict[str, Any]]:
        maker = get_sessionmaker()
        async with maker() as s:
            rows = await fetch_all(
                s,
                """
                SELECT r.run_ts, p.target_date, p.point_price, p.lower_80, p.upper_80,
                       p.prob_up, p.confidence, p.direction, r.anchor_price,
                       a.actual_price, a.pct_error, a.direction_correct
                FROM predictions p
                JOIN prediction_runs r ON r.id = p.run_id
                JOIN metals m ON m.id = p.metal_id
                LEFT JOIN prediction_accuracy a ON a.prediction_id = p.id
                WHERE m.code = :c AND p.horizon_days = :h
                ORDER BY r.run_ts DESC
                LIMIT :lim
                """,
                {"c": metal, "h": horizon_days, "lim": limit},
            )
        return [
            {
                "run_ts": r["run_ts"],
                "target_date": r["target_date"].isoformat(),
                "anchor_price": float(r["anchor_price"]),
                "point_price": float(r["point_price"]),
                "lower_80": float(r["lower_80"]),
                "upper_80": float(r["upper_80"]),
                "prob_up": float(r["prob_up"]),
                "confidence": float(r["confidence"]),
                "direction": r["direction"],
                "actual_price": float(r["actual_price"]) if r["actual_price"] is not None else None,
                "pct_error": float(r["pct_error"]) if r["pct_error"] is not None else None,
                "direction_correct": r["direction_correct"],
            }
            for r in reversed(rows)
        ]

    async def accuracy(self, metal: Optional[str] = None) -> Dict[str, Any]:
        maker = get_sessionmaker()
        clause = "WHERE code = :c" if metal else ""
        async with maker() as s:
            rows = await fetch_all(
                s, f"SELECT * FROM v_accuracy_summary {clause} ORDER BY code, horizon_days",
                {"c": metal} if metal else {},
            )
            overall = await fetch_one(
                s,
                """
                SELECT count(*) AS n,
                       round(avg(abs(pct_error)), 4) AS mape,
                       round(avg(CASE WHEN direction_correct THEN 1 ELSE 0 END), 4) AS hit_rate,
                       round(avg(CASE WHEN within_80 THEN 1 ELSE 0 END), 4) AS coverage_80,
                       round(avg(CASE WHEN within_95 THEN 1 ELSE 0 END), 4) AS coverage_95
                FROM prediction_accuracy a
                JOIN metals m ON m.id = a.metal_id
                """ + (" WHERE m.code = :c" if metal else ""),
                {"c": metal} if metal else {},
            )
        return {
            "metal": metal,
            "by_horizon": [{k: (float(v) if isinstance(v, (int, float)) or
                                (hasattr(v, "__float__") and not isinstance(v, str)) else v)
                            for k, v in r.items()} for r in rows],
            "overall": {k: (float(v) if v is not None and not isinstance(v, str) else v)
                        for k, v in (overall or {}).items()},
        }

    # ------------------------------------------------------------------ #
    async def evaluate_due(self) -> Dict[str, Any]:
        """Score every prediction whose target date has a realised close."""
        maker = get_sessionmaker()
        async with maker() as s:
            due = await fetch_all(
                s,
                """
                SELECT p.id, p.metal_id, p.horizon_days, p.point_price,
                       p.lower_80, p.upper_80, p.lower_95, p.upper_95,
                       p.direction, r.anchor_price, pd.close AS actual
                FROM predictions p
                JOIN prediction_runs r ON r.id = p.run_id
                JOIN price_daily pd
                     ON pd.metal_id = p.metal_id AND pd.trade_date = p.target_date
                LEFT JOIN prediction_accuracy a ON a.prediction_id = p.id
                WHERE a.id IS NULL
                LIMIT 5000
                """,
            )
            scored = 0
            for d in due:
                actual = float(d["actual"])
                predicted = float(d["point_price"])
                anchor = float(d["anchor_price"])
                abs_err = abs(actual - predicted)
                pct_err = (predicted - actual) / actual * 100 if actual else 0.0
                actual_dir = ("up" if actual > anchor * 1.0005
                              else "down" if actual < anchor * 0.9995 else "flat")
                await execute(
                    s,
                    """
                    INSERT INTO prediction_accuracy
                        (prediction_id, metal_id, horizon_days, actual_price,
                         predicted_price, abs_error, pct_error, direction_correct,
                         within_80, within_95)
                    VALUES (:pid, :mid, :hd, :act, :pred, :ae, :pe, :dc, :w80, :w95)
                    ON CONFLICT (prediction_id) DO NOTHING
                    """,
                    {
                        "pid": d["id"], "mid": d["metal_id"], "hd": d["horizon_days"],
                        "act": actual, "pred": predicted, "ae": round(abs_err, 4),
                        "pe": round(pct_err, 6),
                        "dc": d["direction"] == actual_dir,
                        "w80": float(d["lower_80"]) <= actual <= float(d["upper_80"]),
                        "w95": float(d["lower_95"]) <= actual <= float(d["upper_95"]),
                    },
                )
                scored += 1
            await s.commit()
        if scored:
            log.info("scored %d matured predictions", scored)
        return {"scored": scored, "evaluated_at": datetime.now(timezone.utc).isoformat()}


forecast_service = ForecastService()
