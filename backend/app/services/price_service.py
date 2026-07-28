"""Price ingestion + query service."""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx

from ..config import settings
from ..db import execute, fetch_all, fetch_one, get_sessionmaker
from .providers import REGISTRY, DailyBar, PriceProvider, ProviderError, Quote

log = logging.getLogger("metalcast.prices")

METALS = ("aluminium", "copper")

RANGE_TO_DAYS: Dict[str, Optional[int]] = {
    "1D": 1, "1W": 7, "1M": 31, "3M": 93, "6M": 186,
    "1Y": 366, "2Y": 731, "5Y": 1827, "MAX": None,
}


class PriceService:
    def __init__(self) -> None:
        self._client: Optional[httpx.AsyncClient] = None
        self._providers: List[PriceProvider] = []
        self._metal_ids: Dict[str, int] = {}
        self._last_error: Dict[str, str] = {}
        self._active_source: Optional[str] = None
        self._lock = asyncio.Lock()
        self._subscribers: List[asyncio.Queue] = []

    
    async def start(self) -> None:
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(12.0, connect=6.0),
            follow_redirects=True,
            headers={"User-Agent": "MetalCast/1.0 (+https://github.com/)"},
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
        seen: set[str] = set()
        for pid in settings.price_provider_list:
            cls = REGISTRY.get(pid)
            if cls is None:
                log.warning("unknown price provider %r — skipped", pid)
                continue
            if cls.id in seen:
                continue
            seen.add(cls.id)
            self._providers.append(cls(self._client))
        if settings.allow_synthetic and "synthetic" not in seen:
            self._providers.append(REGISTRY["synthetic"](self._client))
        await self._load_metal_ids()
        log.info("price providers: %s", [p.id for p in self._providers])

    async def stop(self) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None

    async def _load_metal_ids(self) -> None:
        maker = get_sessionmaker()
        async with maker() as s:
            rows = await fetch_all(s, "SELECT id, code FROM metals")
        self._metal_ids = {r["code"]: r["id"] for r in rows}

    async def metal_id(self, code: str) -> int:
        if code not in self._metal_ids:
            await self._load_metal_ids()
        if code not in self._metal_ids:
            raise KeyError(f"unknown metal {code!r}")
        return self._metal_ids[code]

    # ---------------- SSE fan-out ----------------
    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=32)
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        if q in self._subscribers:
            self._subscribers.remove(q)

    def _broadcast(self, payload: Dict[str, Any]) -> None:
        dead = []
        for q in self._subscribers:
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            self.unsubscribe(q)

    # ---------------- ingestion ----------------
    async def poll_once(self) -> Dict[str, Any]:
        """Try providers in priority order until every metal has a quote."""
        async with self._lock:
            collected: Dict[str, Quote] = {}
            attempts: List[Dict[str, Any]] = []

            for provider in self._providers:
                missing = [m for m in METALS if m not in collected]
                if not missing:
                    break
                if not provider.configured:
                    attempts.append({"provider": provider.id, "status": "unconfigured"})
                    continue
                try:
                    quotes = await provider.fetch_latest(missing)
                    for q in quotes:
                        collected.setdefault(q.metal, q)
                    attempts.append({
                        "provider": provider.id,
                        "status": "ok",
                        "metals": [q.metal for q in quotes],
                    })
                    self._last_error.pop(provider.id, None)
                except (ProviderError, httpx.HTTPError, ValueError, KeyError) as exc:
                    msg = f"{type(exc).__name__}: {exc}"
                    self._last_error[provider.id] = msg
                    attempts.append({"provider": provider.id, "status": "error", "error": msg})
                    log.warning("provider %s failed: %s", provider.id, msg)
                except Exception as exc:  # never let one feed kill the poll
                    msg = f"unexpected {type(exc).__name__}: {exc}"
                    self._last_error[provider.id] = msg
                    attempts.append({"provider": provider.id, "status": "error", "error": msg})
                    log.exception("provider %s crashed", provider.id)

            written = 0
            if collected:
                written = await self.persist_quotes(list(collected.values()))
                self._active_source = next(iter(collected.values())).source
                self._broadcast({
                    "type": "prices",
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "data": [
                        {
                            "metal": q.metal,
                            "price": q.price,
                            "ts": q.ts.isoformat(),
                            "source": q.source,
                            "source_kind": q.source_kind,
                        }
                        for q in collected.values()
                    ],
                })

            return {
                "written": written,
                "metals": sorted(collected.keys()),
                "attempts": attempts,
                "ok": len(collected) == len(METALS),
            }

    async def persist_quotes(self, quotes: List[Quote]) -> int:
        if not quotes:
            return 0
        maker = get_sessionmaker()
        written = 0
        async with maker() as s:
            for q in quotes:
                try:
                    mid = await self.metal_id(q.metal)
                except KeyError:
                    continue
                res = await execute(
                    s,
                    """
                    INSERT INTO price_ticks
                        (metal_id, ts, price, currency, unit, source, source_kind, latency_ms, raw)
                    VALUES
                        (:mid, :ts, :price, :cur, :unit, :src, :kind, :lat, CAST(:raw AS jsonb))
                    ON CONFLICT (metal_id, ts, source) DO UPDATE
                        SET price = EXCLUDED.price, raw = EXCLUDED.raw
                    RETURNING id
                    """,
                    {
                        "mid": mid, "ts": q.ts, "price": q.price, "cur": q.currency,
                        "unit": q.unit, "src": q.source, "kind": q.source_kind,
                        "lat": q.latency_ms, "raw": json.dumps(q.raw or {}),
                    },
                )
                if res.first():
                    written += 1
            # keep the daily surface in sync with today's ticks
            today = datetime.now(timezone.utc).date()
            await execute(s, "SELECT refresh_price_daily(:a, :b)",
                          {"a": today - timedelta(days=2), "b": today})
            await s.commit()
        return written

    async def persist_daily_bars(self, bars: List[DailyBar]) -> int:
        if not bars:
            return 0
        maker = get_sessionmaker()
        written = 0
        async with maker() as s:
            for b in bars:
                try:
                    mid = await self.metal_id(b.metal)
                except KeyError:
                    continue
                
                # Coerce string dates or datetimes to a standard datetime.date object
                trade_date = b.date
                if isinstance(trade_date, str):
                    trade_date = datetime.strptime(trade_date, "%Y-%m-%d").date()
                elif isinstance(trade_date, datetime):
                    trade_date = trade_date.date()

                await execute(
                    s,
                    """
                    INSERT INTO price_daily
                        (metal_id, trade_date, open, high, low, close, avg_price,
                         sample_count, source, updated_at)
                    VALUES
                        (:mid, :d, :o, :h, :l, :c, :avg, 1, :src, now())
                    ON CONFLICT (metal_id, trade_date) DO UPDATE SET
                        open = EXCLUDED.open, high = EXCLUDED.high,
                        low = EXCLUDED.low, close = EXCLUDED.close,
                        avg_price = EXCLUDED.avg_price, updated_at = now()
                    """,
                    {
                        "mid": mid, "d": trade_date, "o": b.open, "h": b.high,
                        "l": b.low, "c": b.close,
                        "avg": round((b.open + b.high + b.low + b.close) / 4, 4),
                        "src": b.source,
                    },
                )
                written += 1
            await s.commit()
        return written

    async def backfill(self, days: Optional[int] = None, force: bool = False) -> Dict[str, Any]:
        """Load multi-year daily history so the models have something to learn."""
        days = days or settings.backfill_days_on_boot
        maker = get_sessionmaker()
        result: Dict[str, Any] = {"days": days, "metals": {}}

        for metal in METALS:
            if not force:
                async with maker() as s:
                    row = await fetch_one(
                        s,
                        """SELECT count(*) AS n FROM price_daily pd
                           JOIN metals m ON m.id = pd.metal_id WHERE m.code = :c""",
                        {"c": metal},
                    )
                if row and (row["n"] or 0) >= settings.min_history_points:
                    result["metals"][metal] = {"skipped": True, "existing": row["n"]}
                    continue

            bars: List[DailyBar] = []
            for provider in self._providers:
                if not provider.configured:
                    continue
                try:
                    bars = await provider.fetch_history(metal, days)
                except Exception as exc:
                    log.warning("history via %s failed: %s", provider.id, exc)
                    bars = []
                if bars:
                    break
            written = await self.persist_daily_bars(bars)
            result["metals"][metal] = {"fetched": len(bars), "written": written}
            log.info("backfill %s: %d bars", metal, written)
        return result

    # ---------------- queries ----------------
    async def latest(self) -> List[Dict[str, Any]]:
        maker = get_sessionmaker()
        async with maker() as s:
            rows = await fetch_all(
                s,
                """
                WITH latest AS (
                  SELECT DISTINCT ON (t.metal_id)
                         t.metal_id, t.ts, t.price, t.source, t.source_kind
                  FROM price_ticks t
                  ORDER BY t.metal_id, t.ts DESC
                ),
                prev_close AS (
                  SELECT DISTINCT ON (metal_id) metal_id, close, trade_date
                  FROM price_daily
                  WHERE trade_date < (now() AT TIME ZONE 'UTC')::date
                  ORDER BY metal_id, trade_date DESC
                ),
                week AS (
                  SELECT metal_id,
                         min(close) AS w_low, max(close) AS w_high
                  FROM price_daily
                  WHERE trade_date >= (now() AT TIME ZONE 'UTC')::date - 7
                  GROUP BY metal_id
                ),
                yr AS (
                  SELECT metal_id,
                         min(close) AS y_low, max(close) AS y_high,
                         avg(close) AS y_avg
                  FROM price_daily
                  WHERE trade_date >= (now() AT TIME ZONE 'UTC')::date - 365
                  GROUP BY metal_id
                )
                SELECT m.code, m.display_name, m.symbol, m.unit, m.currency,
                       m.hex_color, m.exchange,
                       l.price, l.ts, l.source, l.source_kind,
                       p.close AS prev_close, p.trade_date AS prev_date,
                       w.w_low, w.w_high, y.y_low, y.y_high, y.y_avg
                FROM metals m
                LEFT JOIN latest l ON l.metal_id = m.id
                LEFT JOIN prev_close p ON p.metal_id = m.id
                LEFT JOIN week w ON w.metal_id = m.id
                LEFT JOIN yr y ON y.metal_id = m.id
                ORDER BY m.code
                """,
            )

        out: List[Dict[str, Any]] = []
        for r in rows:
            price = _f(r.get("price"))
            prev = _f(r.get("prev_close"))
            change = (price - prev) if (price is not None and prev) else None
            out.append({
                "metal": r["code"],
                "name": r["display_name"],
                "symbol": r["symbol"],
                "exchange": r["exchange"],
                "unit": r["unit"],
                "currency": r["currency"],
                "color": r["hex_color"],
                "price": price,
                "ts": r.get("ts"),
                "source": r.get("source"),
                "source_kind": r.get("source_kind"),
                "prev_close": prev,
                "change": round(change, 2) if change is not None else None,
                "change_pct": round(change / prev * 100, 4) if (change is not None and prev) else None,
                "week_low": _f(r.get("w_low")),
                "week_high": _f(r.get("w_high")),
                "year_low": _f(r.get("y_low")),
                "year_high": _f(r.get("y_high")),
                "year_avg": _f(r.get("y_avg")),
                "stale": _is_stale(r.get("ts")),
            })
        return out

    async def ticks(self, metal: str, hours: int = 24, limit: int = 2000) -> List[Dict[str, Any]]:
        maker = get_sessionmaker()
        async with maker() as s:
            rows = await fetch_all(
                s,
                """
                SELECT t.ts, t.price, t.source
                FROM price_ticks t JOIN metals m ON m.id = t.metal_id
                WHERE m.code = :c AND t.ts >= now() - make_interval(hours => :h)
                ORDER BY t.ts ASC
                LIMIT :lim
                """,
                {"c": metal, "h": hours, "lim": limit},
            )
        return [{"ts": r["ts"], "price": _f(r["price"]), "source": r["source"]} for r in rows]

    async def daily(self, metal: str, range_key: str = "1Y") -> List[Dict[str, Any]]:
        days = RANGE_TO_DAYS.get(range_key.upper(), 366)
        maker = get_sessionmaker()
        clause = "" if days is None else "AND pd.trade_date >= (now() AT TIME ZONE 'UTC')::date - make_interval(days => :days)"
        async with maker() as s:
            rows = await fetch_all(
                s,
                f"""
                SELECT pd.trade_date, pd.open, pd.high, pd.low, pd.close,
                       pd.avg_price, pd.source
                FROM price_daily pd JOIN metals m ON m.id = pd.metal_id
                WHERE m.code = :c {clause}
                ORDER BY pd.trade_date ASC
                """,
                {"c": metal, "days": days} if days is not None else {"c": metal},
            )
        return [
            {
                "date": r["trade_date"].isoformat(),
                "open": _f(r["open"]), "high": _f(r["high"]),
                "low": _f(r["low"]), "close": _f(r["close"]),
                "avg": _f(r["avg_price"]), "source": r["source"],
            }
            for r in rows
        ]

    async def closes(self, metal: str, limit: int = 1200) -> Tuple[List[date], List[float]]:
        """Ordered close series for the models."""
        maker = get_sessionmaker()
        async with maker() as s:
            rows = await fetch_all(
                s,
                """
                SELECT trade_date, close FROM (
                    SELECT pd.trade_date, pd.close
                    FROM price_daily pd JOIN metals m ON m.id = pd.metal_id
                    WHERE m.code = :c
                    ORDER BY pd.trade_date DESC
                    LIMIT :lim
                ) x ORDER BY trade_date ASC
                """,
                {"c": metal, "lim": limit},
            )
        return [r["trade_date"] for r in rows], [float(r["close"]) for r in rows]

    async def stats(self, metal: str) -> Dict[str, Any]:
        maker = get_sessionmaker()
        async with maker() as s:
            row = await fetch_one(
                s,
                """
                WITH d AS (
                  SELECT pd.trade_date, pd.close
                  FROM price_daily pd JOIN metals m ON m.id = pd.metal_id
                  WHERE m.code = :c
                  ORDER BY pd.trade_date DESC LIMIT 400
                ),
                r AS (
                  SELECT trade_date,
                         ln(close / lag(close) OVER (ORDER BY trade_date)) AS lr
                  FROM d
                )
                SELECT
                  (SELECT count(*) FROM d)                                        AS bars,
                  (SELECT min(trade_date) FROM d)                                 AS first_date,
                  (SELECT max(trade_date) FROM d)                                 AS last_date,
                  (SELECT stddev_samp(lr) FROM r WHERE lr IS NOT NULL)            AS vol_d,
                  (SELECT stddev_samp(lr) FROM (
                       SELECT lr FROM r WHERE lr IS NOT NULL
                       ORDER BY trade_date DESC LIMIT 21) x)                      AS vol_21,
                  (SELECT avg(lr) FROM (
                       SELECT lr FROM r WHERE lr IS NOT NULL
                       ORDER BY trade_date DESC LIMIT 21) y)                      AS drift_21
                """,
                {"c": metal},
            )
        row = row or {}
        vol_d = _f(row.get("vol_d")) or 0.0
        vol_21 = _f(row.get("vol_21")) or vol_d
        return {
            "metal": metal,
            "bars": row.get("bars") or 0,
            "first_date": row.get("first_date"),
            "last_date": row.get("last_date"),
            "daily_vol": round(vol_d, 6),
            "annualised_vol": round(vol_d * (252 ** 0.5), 6),
            "vol_21d": round(vol_21, 6),
            "annualised_vol_21d": round(vol_21 * (252 ** 0.5), 6),
            "drift_21d": round(_f(row.get("drift_21")) or 0.0, 8),
            "regime": _regime(vol_21, vol_d),
        }

    async def correlation(self, window: int = 90) -> Dict[str, Any]:
        maker = get_sessionmaker()
        async with maker() as s:
            rows = await fetch_all(
                s,
                """
                SELECT a.trade_date,
                       a.close AS al, c.close AS cu
                FROM price_daily a
                JOIN metals ma ON ma.id = a.metal_id AND ma.code = 'aluminium'
                JOIN price_daily c ON c.trade_date = a.trade_date
                JOIN metals mc ON mc.id = c.metal_id AND mc.code = 'copper'
                ORDER BY a.trade_date DESC
                LIMIT :w
                """,
                {"w": window + 1},
            )
        if len(rows) < 10:
            return {"window": window, "correlation": None, "points": len(rows), "series": []}

        rows = list(reversed(rows))
        al = [float(r["al"]) for r in rows]
        cu = [float(r["cu"]) for r in rows]
        ra = [al[i] / al[i - 1] - 1 for i in range(1, len(al))]
        rc = [cu[i] / cu[i - 1] - 1 for i in range(1, len(cu))]
        corr = _pearson(ra, rc)
        base_al, base_cu = al[0], cu[0]
        series = [
            {
                "date": r["trade_date"].isoformat(),
                "aluminium": round(float(r["al"]) / base_al * 100, 3),
                "copper": round(float(r["cu"]) / base_cu * 100, 3),
            }
            for r in rows
        ]
        return {"window": window, "correlation": round(corr, 4), "points": len(rows), "series": series}

    def provider_status(self) -> List[Dict[str, Any]]:
        out = []
        for p in self._providers:
            d = p.describe()
            d["last_error"] = self._last_error.get(p.id)
            d["active"] = p.id == self._active_source
            out.append(d)
        return out



def _f(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _is_stale(ts: Any) -> bool:
    if ts is None:
        return True
    if isinstance(ts, str):
        try:
            ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except ValueError:
            return True
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - ts).total_seconds() > max(600, settings.price_poll_seconds * 6)


def _regime(vol_21: float, vol_long: float) -> str:
    if not vol_long:
        return "unknown"
    ratio = vol_21 / vol_long
    if ratio > 1.35:
        return "elevated volatility"
    if ratio < 0.7:
        return "compressed volatility"
    return "normal"


def _pearson(a: List[float], b: List[float]) -> float:
    n = min(len(a), len(b))
    if n < 3:
        return 0.0
    a, b = a[:n], b[:n]
    ma, mb = sum(a) / n, sum(b) / n
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    da = sum((x - ma) ** 2 for x in a) ** 0.5
    db = sum((y - mb) ** 2 for y in b) ** 0.5
    return num / (da * db) if da and db else 0.0


price_service = PriceService()