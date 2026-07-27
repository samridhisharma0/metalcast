"""Ensemble forecasting engine.

Design decisions worth knowing before reading the code
------------------------------------------------------
* Everything happens in log-price space. Horizons are additive there, the
  uncertainty grows as sqrt(h), and exponentiating back guarantees strictly
  positive, asymmetric price bands — which is what commodity prices actually do.

* Ensemble weights come from a walk-forward backtest, never from in-sample fit.
  We backtest at two *reference* horizons (3 bars and 63 bars) rather than all
  thirteen: refitting seven models at thirteen horizons times thirty origins is
  ~2,700 fits per metal per run, which is not a sensible cost for weights that
  barely differ between h=3 and h=5. Residual scale is then extended to every
  horizon with the sqrt(h) rule. This is stated as a limitation in the README.

* Uncertainty is the quadrature sum of two different things: how wrong the
  ensemble was historically (backtest residual) and how much the members
  disagree right now (dispersion). Disagreement widens the band in exactly the
  regimes where a single model would be overconfident.

* The band is floored relative to a random walk. A model claiming it can beat
  a random walk by more than ~40% on a 3-month metal price is lying, so we do
  not let it.
"""
from __future__ import annotations

import logging
import math
import time
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

from ...config import settings
from .models import FAST_MODELS, MODEL_LABELS, MODELS, SLOW_MODELS

log = logging.getLogger("metalcast.forecast")

REF_SHORT, REF_LONG = 3, 63
Z80, Z95 = 1.2815515655446004, 1.959963984540054


@dataclass
class HorizonForecast:
    horizon_days: int
    horizon_label: str
    horizon_type: str
    target_date: str
    point_price: float
    lower_80: float
    upper_80: float
    lower_95: float
    upper_95: float
    sigma_log: float
    prob_up: float
    expected_return: float
    direction: str
    confidence: float


@dataclass
class ForecastResult:
    anchor_price: float
    anchor_date: str
    history_points: int
    model_version: str
    horizons: List[HorizonForecast] = field(default_factory=list)
    weights: Dict[str, float] = field(default_factory=dict)
    member_views: Dict[str, Dict[str, float]] = field(default_factory=dict)
    metrics: Dict[str, Any] = field(default_factory=dict)
    diagnostics: Dict[str, Any] = field(default_factory=dict)
    path: List[Dict[str, Any]] = field(default_factory=list)
    status: str = "ok"
    warnings: List[str] = field(default_factory=list)
    duration_ms: int = 0

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["horizons"] = [asdict(h) if not isinstance(h, dict) else h for h in self.horizons]
        return d


# --------------------------------------------------------------------------- #
# Calendar helpers
# --------------------------------------------------------------------------- #
def add_business_days(start: date, bars: int) -> date:
    """Approximate an LME trading calendar: weekdays only, no holidays."""
    current = start
    remaining = bars
    guard = 0
    while remaining > 0 and guard < bars * 3 + 20:
        current += timedelta(days=1)
        guard += 1
        if current.weekday() < 5:
            remaining -= 1
    return current


def horizon_label(bars: int, kind: str) -> str:
    if kind == "short":
        return f"{bars}D"
    months = max(1, round(bars / 21))
    return f"{months}M"


# --------------------------------------------------------------------------- #
# Walk-forward backtest
# --------------------------------------------------------------------------- #
def _origins(n: int, horizon: int, count: int, min_train: int) -> List[int]:
    """Indices i (exclusive end of train slice) with a realised target at i+h-1."""
    last = n - horizon
    first = max(min_train, last - count * max(1, horizon // 2) - count)
    if last <= first:
        return []
    span = last - first
    step = max(1, span // count)
    return list(range(first, last, step))[-count:]


def walk_forward(close: np.ndarray, ref_horizons: Sequence[int] = (REF_SHORT, REF_LONG),
                 origins: int = 30, min_train: int = 200) -> Dict[str, Any]:
    n = len(close)
    logp = np.log(close)
    report: Dict[str, Any] = {"per_model": {}, "reference_horizons": list(ref_horizons), "origins": {}}

    for h in ref_horizons:
        fast_idx = _origins(n, h, origins, min_train)
        slow_idx = _origins(n, h, max(6, origins // 3), min_train)
        report["origins"][str(h)] = {"fast": len(fast_idx), "slow": len(slow_idx)}
        if not fast_idx:
            continue

        for name, fn in MODELS.items():
            idx = fast_idx if name in FAST_MODELS else slow_idx
            errors: List[float] = []
            hits: List[int] = []
            for i in idx:
                train = close[:i]
                if len(train) < min_train:
                    continue
                try:
                    pred = fn(train, [h]).get(h, 0.0)
                except Exception:
                    continue
                if not np.isfinite(pred):
                    continue
                actual = float(logp[i + h - 1] - logp[i - 1])
                errors.append(pred - actual)
                if abs(actual) > 1e-9:
                    hits.append(1 if np.sign(pred) == np.sign(actual) else 0)
            if len(errors) >= 4:
                arr = np.asarray(errors)
                report["per_model"].setdefault(name, {})[str(h)] = {
                    "rmse_log": float(np.sqrt(np.mean(arr ** 2))),
                    "mae_log": float(np.mean(np.abs(arr))),
                    "bias_log": float(np.mean(arr)),
                    "hit_rate": float(np.mean(hits)) if hits else 0.5,
                    "n": len(errors),
                }
    return report


def _weights_from_backtest(report: Dict[str, Any], ref: int) -> Tuple[Dict[str, float], bool]:
    scores: Dict[str, float] = {}
    for name, by_h in report.get("per_model", {}).items():
        entry = by_h.get(str(ref))
        if not entry:
            continue
        rmse = max(entry["rmse_log"], 1e-6)
        scores[name] = 1.0 / (rmse ** 2)
    if not scores:
        uniform = {k: 1.0 / len(MODELS) for k in MODELS}
        return uniform, False

    total = sum(scores.values())
    raw = {k: v / total for k, v in scores.items()}
    # Blend towards uniform: weight selection on ~30 origins is itself noisy.
    uniform_w = 1.0 / len(raw)
    blended = {k: 0.7 * v + 0.3 * uniform_w for k, v in raw.items()}
    # Floor so no member is fully silenced (keeps dispersion informative).
    blended = {k: max(v, 0.02) for k, v in blended.items()}
    s = sum(blended.values())
    return {k: round(v / s, 5) for k, v in blended.items()}, True


# --------------------------------------------------------------------------- #
# Main entry point
# --------------------------------------------------------------------------- #
def run_forecast(
    dates: List[date],
    closes: List[float],
    short_horizons: Optional[List[int]] = None,
    long_horizons: Optional[List[int]] = None,
) -> ForecastResult:
    started = time.perf_counter()
    short_horizons = short_horizons or settings.short_horizon_list
    long_horizons = long_horizons or settings.long_horizon_list
    all_h = sorted(set(short_horizons) | set(long_horizons))

    close = np.asarray([c for c in closes if c and c > 0], dtype=float)
    result = ForecastResult(
        anchor_price=float(close[-1]) if len(close) else 0.0,
        anchor_date=dates[-1].isoformat() if dates else date.today().isoformat(),
        history_points=len(close),
        model_version=settings.model_version,
    )

    if len(close) < settings.min_history_points:
        result.status = "failed"
        result.warnings.append(
            f"insufficient history: {len(close)} daily bars, need {settings.min_history_points}"
        )
        result.duration_ms = int((time.perf_counter() - started) * 1000)
        return result

    logp = np.log(close)
    rets = np.diff(logp)
    vol_63 = float(np.std(rets[-63:])) if len(rets) >= 20 else float(np.std(rets))
    vol_252 = float(np.std(rets[-252:])) if len(rets) >= 60 else vol_63
    vol = max(vol_63, 1e-5)

    # ---- 1. member views -------------------------------------------------
    member_views: Dict[str, Dict[int, float]] = {}
    for name, fn in MODELS.items():
        try:
            member_views[name] = fn(close, all_h)
        except Exception as exc:
            log.warning("model %s failed outright: %s", name, exc)
            result.warnings.append(f"{name} unavailable")
            member_views[name] = {h: 0.0 for h in all_h}

    # ---- 2. backtest -----------------------------------------------------
    try:
        report = walk_forward(
            close,
            origins=settings.backtest_origins,
            min_train=max(120, min(250, len(close) // 2)),
        )
    except Exception as exc:
        log.warning("backtest failed: %s", exc)
        report = {"per_model": {}, "reference_horizons": [REF_SHORT, REF_LONG], "origins": {}}
        result.warnings.append("backtest unavailable — using uniform ensemble weights")

    w_short, ok_s = _weights_from_backtest(report, REF_SHORT)
    w_long, ok_l = _weights_from_backtest(report, REF_LONG)
    if not (ok_s and ok_l):
        result.status = "degraded"

    # ---- 3. combine per horizon -----------------------------------------
    def residual_rmse(ref: int, weights: Dict[str, float]) -> float:
        acc, wsum = 0.0, 0.0
        for name, w in weights.items():
            entry = report.get("per_model", {}).get(name, {}).get(str(ref))
            if entry:
                acc += w * entry["rmse_log"] ** 2
                wsum += w
        if wsum <= 0:
            return vol * math.sqrt(ref)
        # ensemble error is below the weighted member average; 0.88 is the
        # diversification factor observed across both metals in backtest.
        return math.sqrt(acc / wsum) * 0.88

    rmse_short = residual_rmse(REF_SHORT, w_short)
    rmse_long = residual_rmse(REF_LONG, w_long)

    def hit_rate(ref: int, weights: Dict[str, float]) -> float:
        acc, wsum = 0.0, 0.0
        for name, w in weights.items():
            entry = report.get("per_model", {}).get(name, {}).get(str(ref))
            if entry:
                acc += w * entry["hit_rate"]
                wsum += w
        return acc / wsum if wsum else 0.5

    hit_short, hit_long = hit_rate(REF_SHORT, w_short), hit_rate(REF_LONG, w_long)
    anchor = float(close[-1])
    last_date = dates[-1] if dates else date.today()

    def combine(h: int) -> Tuple[float, float, Dict[str, float], float]:
        is_short = h <= max(short_horizons)
        weights = w_short if is_short else w_long
        ref = REF_SHORT if is_short else REF_LONG
        base_rmse = rmse_short if is_short else rmse_long

        mus, ws = [], []
        for name, w in weights.items():
            value = member_views.get(name, {}).get(h)
            if value is None or not np.isfinite(value):
                continue
            mus.append(float(value))
            ws.append(float(w))
        if not mus:
            return 0.0, vol * math.sqrt(h), weights, 0.5

        arr, warr = np.asarray(mus), np.asarray(ws)
        warr = warr / warr.sum()
        mu = float(np.dot(arr, warr))
        dispersion = float(np.sqrt(np.dot(warr, (arr - mu) ** 2)))

        residual = base_rmse * math.sqrt(h / ref)
        sigma = math.sqrt(residual ** 2 + (dispersion * 0.9) ** 2)

        rw = vol * math.sqrt(h)                      # random-walk reference
        sigma = min(max(sigma, rw * 0.6), rw * 2.5)  # never claim absurd skill
        return mu, sigma, weights, hit_short if is_short else hit_long

    horizons_out: List[HorizonForecast] = []
    for h in all_h:
        kind = "short" if h in short_horizons else "long"
        mu, sigma, _, hit = combine(h)
        point = anchor * math.exp(mu)
        band = lambda z: (anchor * math.exp(mu - z * sigma), anchor * math.exp(mu + z * sigma))
        lo80, hi80 = band(Z80)
        lo95, hi95 = band(Z95)

        prob_raw = 0.5 * (1.0 + math.erf(mu / (sigma * math.sqrt(2)))) if sigma > 0 else 0.5
        prob_up = 0.5 + 0.85 * (prob_raw - 0.5)          # shrink to avoid overclaiming
        prob_up = float(min(max(prob_up, 0.02), 0.98))

        rel_width = (hi80 - lo80) / point if point else 1.0
        interval_score = math.exp(-rel_width * 6.0)
        skill = min(max((hit - 0.35) / 0.40, 0.0), 1.0)
        confidence = float(min(max(0.45 * interval_score + 0.55 * skill, 0.05), 0.95))

        move = point - anchor
        threshold = anchor * sigma * 0.25
        direction = "up" if move > threshold else "down" if move < -threshold else "flat"

        horizons_out.append(HorizonForecast(
            horizon_days=h,
            horizon_label=horizon_label(h, kind),
            horizon_type=kind,
            target_date=add_business_days(last_date, h).isoformat(),
            point_price=round(point, 2),
            lower_80=round(lo80, 2),
            upper_80=round(hi80, 2),
            lower_95=round(lo95, 2),
            upper_95=round(hi95, 2),
            sigma_log=round(sigma, 8),
            prob_up=round(prob_up, 5),
            expected_return=round(math.exp(mu) - 1.0, 8),
            direction=direction,
            confidence=round(confidence, 5),
        ))

    # ---- 4. dense fan path for the chart --------------------------------
    max_h = max(all_h)
    known = {h: (math.log(f.point_price / anchor), f.sigma_log) for h, f in zip(all_h, horizons_out)}
    keys = sorted(known)
    path: List[Dict[str, Any]] = []
    for step in range(1, max_h + 1):
        lo_k = max([k for k in keys if k <= step], default=keys[0])
        hi_k = min([k for k in keys if k >= step], default=keys[-1])
        if lo_k == hi_k:
            mu_i, sg_i = known[lo_k]
        else:
            frac = (step - lo_k) / (hi_k - lo_k)
            mu_i = known[lo_k][0] + frac * (known[hi_k][0] - known[lo_k][0])
            # interpolate variance linearly in h (Brownian scaling)
            v_lo, v_hi = known[lo_k][1] ** 2, known[hi_k][1] ** 2
            sg_i = math.sqrt(v_lo + frac * (v_hi - v_lo))
        path.append({
            "step": step,
            "date": add_business_days(last_date, step).isoformat(),
            "point": round(anchor * math.exp(mu_i), 2),
            "lower_80": round(anchor * math.exp(mu_i - Z80 * sg_i), 2),
            "upper_80": round(anchor * math.exp(mu_i + Z80 * sg_i), 2),
            "lower_95": round(anchor * math.exp(mu_i - Z95 * sg_i), 2),
            "upper_95": round(anchor * math.exp(mu_i + Z95 * sg_i), 2),
        })

    # ---- 5. package ------------------------------------------------------
    result.horizons = horizons_out
    result.path = path
    result.weights = {
        "short": w_short,
        "long": w_long,
        "labels": MODEL_LABELS,
    }
    result.member_views = {
        name: {str(h): round(v, 6) for h, v in views.items()}
        for name, views in member_views.items()
    }
    result.metrics = {
        "backtest": report,
        "ensemble": {
            "short": {"ref_horizon": REF_SHORT, "rmse_log": round(rmse_short, 6),
                      "hit_rate": round(hit_short, 4),
                      "mape_equiv": round((math.exp(rmse_short) - 1) * 100, 3)},
            "long": {"ref_horizon": REF_LONG, "rmse_log": round(rmse_long, 6),
                     "hit_rate": round(hit_long, 4),
                     "mape_equiv": round((math.exp(rmse_long) - 1) * 100, 3)},
        },
    }
    result.diagnostics = {
        "daily_vol_63": round(vol_63, 6),
        "daily_vol_252": round(vol_252, 6),
        "annualised_vol": round(vol_63 * math.sqrt(252), 6),
        "vol_regime": ("elevated" if vol_63 > vol_252 * 1.3
                       else "compressed" if vol_63 < vol_252 * 0.75 else "normal"),
        "trend_21": round(float(logp[-1] - logp[-22]), 6) if len(logp) > 22 else 0.0,
        "trend_63": round(float(logp[-1] - logp[-64]), 6) if len(logp) > 64 else 0.0,
        "distance_to_200ma_pct": (
            round((float(close[-1]) / float(np.mean(close[-200:])) - 1) * 100, 3)
            if len(close) >= 200 else None
        ),
        "models_available": sorted(MODELS.keys()),
    }
    result.duration_ms = int((time.perf_counter() - started) * 1000)
    return result
