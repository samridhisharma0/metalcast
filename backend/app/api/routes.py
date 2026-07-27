"""HTTP surface. One module — the API is small enough that splitting it into
six files would cost more in navigation than it saves in line count."""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from ..config import settings
from ..db import db_stats, fetch_all, get_sessionmaker, ping
from ..services.forecast_service import forecast_service
from ..services.news_service import news_service
from ..services.price_service import METALS, RANGE_TO_DAYS, price_service
from ..services.scheduler import job_schedule, recent_jobs, run_job_now

log = logging.getLogger("metalcast.api")
router = APIRouter()

VALID_METALS = set(METALS)


def validate_metal(metal: str) -> str:
    code = metal.strip().lower()
    aliases = {"al": "aluminium", "aluminum": "aluminium", "xal": "aluminium",
               "cu": "copper", "xcu": "copper"}
    code = aliases.get(code, code)
    if code not in VALID_METALS:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown metal '{metal}'. Supported: {', '.join(sorted(VALID_METALS))}.",
        )
    return code


def require_admin(x_admin_token: Optional[str] = Header(default=None)) -> None:
    if not x_admin_token or x_admin_token != settings.admin_token:
        raise HTTPException(status_code=401, detail="Send a valid X-Admin-Token header.")


# --------------------------------------------------------------------------- #
# Meta / health
# --------------------------------------------------------------------------- #
@router.get("/health", tags=["system"])
async def health() -> Dict[str, Any]:
    db_ok = await ping()
    stats = await db_stats() if db_ok else {}
    fresh = True
    last_tick = stats.get("last_tick_at")
    if last_tick:
        age = (datetime.now(timezone.utc) - last_tick).total_seconds()
        fresh = age < max(900, settings.price_poll_seconds * 8)
    else:
        fresh = False
    status = "ok" if db_ok and fresh else "degraded" if db_ok else "down"
    return {
        "status": status,
        "version": settings.app_version,
        "environment": settings.environment,
        "database": "up" if db_ok else "down",
        "data_fresh": fresh,
        "counts": stats,
        "server_time": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/meta/metals", tags=["system"])
async def list_metals() -> Dict[str, Any]:
    maker = get_sessionmaker()
    async with maker() as s:
        rows = await fetch_all(
            s,
            "SELECT code, symbol, display_name, exchange, currency, unit, hex_color "
            "FROM metals ORDER BY code",
        )
    return {
        "metals": rows,
        "ranges": [k for k in RANGE_TO_DAYS],
        "short_horizons": settings.short_horizon_list,
        "long_horizons": settings.long_horizon_list,
    }


@router.get("/system/status", tags=["system"])
async def system_status() -> Dict[str, Any]:
    db_ok = await ping()
    counts = await db_stats() if db_ok else {}
    return {
        "price_providers": price_service.provider_status(),
        "news_providers": news_service.provider_status(),
        "schedule": job_schedule(),
        "recent_jobs": await recent_jobs(30),
        "config": {
            "price_poll_seconds": settings.price_poll_seconds,
            "news_poll_minutes": settings.news_poll_minutes,
            "forecast_interval_minutes": settings.forecast_interval_minutes,
            "model_version": settings.model_version,
            "synthetic_allowed": settings.allow_synthetic,
            "scheduler_enabled": settings.enable_scheduler,
        },
        "db": {
            "ok": db_ok,
            "version": settings.app_version,
            "stats": {
                "ticks": counts.get("ticks", 0),
                "daily": counts.get("daily_bars", 0),
                "runs": counts.get("prediction_runs", 0),
                "predictions": counts.get("predictions", 0),
                "articles": counts.get("news", 0),
                "jobs": counts.get("job_runs", 0),
            },
        },
        "counts": counts,
    }


# --------------------------------------------------------------------------- #
# Prices
# --------------------------------------------------------------------------- #
@router.get("/prices/latest", tags=["prices"])
async def latest_prices() -> Dict[str, Any]:
    data = await price_service.latest()
    return {"as_of": datetime.now(timezone.utc).isoformat(), "prices": data}


@router.get("/prices/{metal}/ticks", tags=["prices"])
async def price_ticks(
    metal: str,
    hours: int = Query(24, ge=1, le=720),
    limit: int = Query(2000, ge=10, le=10000),
) -> Dict[str, Any]:
    code = validate_metal(metal)
    ticks = await price_service.ticks(code, hours=hours, limit=limit)
    return {"metal": code, "hours": hours, "count": len(ticks), "ticks": ticks}


@router.get("/prices/{metal}/history", tags=["prices"])
async def price_history(
    metal: str,
    range: str = Query("1Y", description="1D 1W 1M 3M 6M 1Y 2Y 5Y MAX"),
) -> Dict[str, Any]:
    code = validate_metal(metal)
    key = range.upper()
    if key not in RANGE_TO_DAYS:
        raise HTTPException(400, f"Unsupported range '{range}'. Use one of {list(RANGE_TO_DAYS)}.")
    if key == "1D":
        ticks = await price_service.ticks(code, hours=24)
        return {"metal": code, "range": key, "granularity": "tick",
                "count": len(ticks),
                "series": [{"date": t["ts"], "close": t["price"]} for t in ticks]}
    bars = await price_service.daily(code, key)
    return {"metal": code, "range": key, "granularity": "daily",
            "count": len(bars), "series": bars}


@router.get("/prices/{metal}/stats", tags=["prices"])
async def price_stats(metal: str) -> Dict[str, Any]:
    return await price_service.stats(validate_metal(metal))


@router.get("/prices/correlation", tags=["prices"])
async def price_correlation(window: int = Query(90, ge=20, le=500)) -> Dict[str, Any]:
    return await price_service.correlation(window)


# --------------------------------------------------------------------------- #
# Predictions
# --------------------------------------------------------------------------- #
@router.get("/predictions/{metal}", tags=["predictions"])
async def predictions(
    metal: str,
    horizon: str = Query("all", pattern="^(all|short|long)$"),
) -> Dict[str, Any]:
    code = validate_metal(metal)
    return await forecast_service.latest(code, None if horizon == "all" else horizon)


@router.get("/predictions/{metal}/track", tags=["predictions"])
async def prediction_track(
    metal: str,
    horizon_days: int = Query(1, ge=1, le=400),
    limit: int = Query(120, ge=5, le=500),
) -> Dict[str, Any]:
    code = validate_metal(metal)
    rows = await forecast_service.run_history(code, horizon_days, limit)
    return {"metal": code, "horizon_days": horizon_days, "count": len(rows), "runs": rows}


@router.get("/predictions/{metal}/accuracy", tags=["predictions"])
async def prediction_accuracy(metal: str) -> Dict[str, Any]:
    return await forecast_service.accuracy(validate_metal(metal))


@router.get("/predictions/accuracy/all", tags=["predictions"])
async def prediction_accuracy_all() -> Dict[str, Any]:
    return await forecast_service.accuracy(None)


@router.post("/predictions/{metal}/run", tags=["predictions"])
async def run_prediction(metal: str, _: None = Depends(require_admin)) -> Dict[str, Any]:
    code = validate_metal(metal)
    return await forecast_service.run_for_metal(code)


# --------------------------------------------------------------------------- #
# News
# --------------------------------------------------------------------------- #
@router.get("/news", tags=["news"])
async def news(
    metal: Optional[str] = Query(None),
    q: Optional[str] = Query(None, max_length=200),
    sentiment: Optional[str] = Query(None, pattern="^(bullish|bearish|neutral)$"),
    page: int = Query(1, ge=1, le=500),
    page_size: int = Query(20, ge=1, le=100),
) -> Dict[str, Any]:
    code = validate_metal(metal) if metal else None
    return await news_service.list_articles(code, q, sentiment, page, page_size)


@router.get("/news/sentiment", tags=["news"])
async def news_sentiment(hours: int = Query(72, ge=6, le=720)) -> Dict[str, Any]:
    return await news_service.sentiment_summary(hours)


# --------------------------------------------------------------------------- #
# Live stream (Server-Sent Events)
# --------------------------------------------------------------------------- #
@router.get("/stream/prices", tags=["prices"])
async def stream_prices(request: Request) -> StreamingResponse:
    queue = price_service.subscribe()

    async def generator():
        try:
            snapshot = await price_service.latest()
            yield f"event: snapshot\ndata: {json.dumps({'prices': snapshot}, default=str)}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=20.0)
                    yield f"event: tick\ndata: {json.dumps(payload, default=str)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        except asyncio.CancelledError:  # client vanished
            raise
        finally:
            price_service.unsubscribe(queue)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# --------------------------------------------------------------------------- #
# Admin
# --------------------------------------------------------------------------- #
@router.post("/admin/jobs/{name}/run", tags=["admin"])
async def admin_run_job(name: str, _: None = Depends(require_admin)) -> Dict[str, Any]:
    try:
        return await run_job_now(name)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/admin/backfill", tags=["admin"])
async def admin_backfill(
    days: int = Query(900, ge=30, le=4000),
    force: bool = Query(False),
    _: None = Depends(require_admin),
) -> Dict[str, Any]:
    result = await price_service.backfill(days=days, force=force)
    return result
