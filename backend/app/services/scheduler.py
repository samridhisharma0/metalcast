"""Background jobs.

Every job writes a row to job_runs so the System page can show what the backend
has actually been doing — including failures. Jobs use max_instances=1 and
coalesce=True: a slow forecast run must never stack up behind itself.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from ..config import settings
from ..db import execute, fetch_all, fetch_one, get_sessionmaker
from .forecast_service import forecast_service
from .news_service import news_service
from .price_service import price_service

log = logging.getLogger("metalcast.scheduler")

scheduler: Optional[AsyncIOScheduler] = None


async def _log_job(job_name: str, fn: Callable[[], Any]) -> Dict[str, Any]:
    started = datetime.now(timezone.utc)
    maker = get_sessionmaker()
    async with maker() as s:
        row = await fetch_one(
            s,
            "INSERT INTO job_runs (job_name, started_at) VALUES (:n, :t) RETURNING id",
            {"n": job_name, "t": started},
        )
        await s.commit()
    job_id = row["id"] if row else None

    status, message, records, detail = "ok", None, 0, {}
    try:
        detail = await fn() or {}
        records = int(detail.get("written") or detail.get("stored")
                      or detail.get("scored") or detail.get("records") or 0)
        if detail.get("ok") is False:
            status = "partial"
            message = "some providers failed"
    except Exception as exc:
        status, message = "failed", f"{type(exc).__name__}: {exc}"
        log.exception("job %s failed", job_name)

    finished = datetime.now(timezone.utc)
    duration = int((finished - started).total_seconds() * 1000)
    if job_id is not None:
        import json
        async with maker() as s:
            await execute(
                s,
                """UPDATE job_runs
                   SET finished_at = :f, duration_ms = :d, status = :s,
                       records = :r, detail = CAST(:det AS jsonb), message = :m
                   WHERE id = :id""",
                {"f": finished, "d": duration, "s": status, "r": records,
                 "det": json.dumps(detail, default=str)[:20000], "m": message, "id": job_id},
            )
            await s.commit()
    return {"job": job_name, "status": status, "duration_ms": duration, "detail": detail}


# --------------------------------------------------------------------------- #
async def job_prices() -> Dict[str, Any]:
    return await price_service.poll_once()


async def job_news() -> Dict[str, Any]:
    return await news_service.refresh()


async def job_forecast() -> Dict[str, Any]:
    out = await forecast_service.run_all()
    return {"records": len(out), **out}


async def job_accuracy() -> Dict[str, Any]:
    return await forecast_service.evaluate_due()


async def job_maintenance() -> Dict[str, Any]:
    maker = get_sessionmaker()
    async with maker() as s:
        pruned = await fetch_one(s, "SELECT prune_ticks(:d) AS n",
                                 {"d": settings.tick_retention_days})
        await s.commit()
    return {"pruned_ticks": (pruned or {}).get("n", 0)}


JOBS = {
    "prices": (job_prices, {"seconds": settings.price_poll_seconds}),
    "news": (job_news, {"minutes": settings.news_poll_minutes}),
    "forecast": (job_forecast, {"minutes": settings.forecast_interval_minutes}),
    "accuracy": (job_accuracy, {"minutes": settings.accuracy_eval_minutes}),
    "maintenance": (job_maintenance, {"hours": 12}),
}


def start_scheduler() -> AsyncIOScheduler:
    global scheduler
    if scheduler is not None:
        return scheduler
    scheduler = AsyncIOScheduler(timezone="UTC")
    for name, (fn, interval) in JOBS.items():
        scheduler.add_job(
            _log_job,
            trigger=IntervalTrigger(**interval),
            args=[name, fn],
            id=name,
            name=name,
            max_instances=1,
            coalesce=True,
            misfire_grace_time=120,
            replace_existing=True,
        )
    scheduler.start()
    log.info("scheduler started: %s", list(JOBS))
    return scheduler


def stop_scheduler() -> None:
    global scheduler
    if scheduler is not None:
        scheduler.shutdown(wait=False)
        scheduler = None


async def run_job_now(name: str) -> Dict[str, Any]:
    entry = JOBS.get(name)
    if entry is None:
        raise KeyError(f"unknown job {name!r}")
    return await _log_job(name, entry[0])


def job_schedule() -> list[Dict[str, Any]]:
    if scheduler is None:
        return []
    out = []
    for job in scheduler.get_jobs():
        out.append({
            "id": job.id,
            "next_run": job.next_run_time.isoformat() if job.next_run_time else None,
            "trigger": str(job.trigger),
        })
    return out


async def recent_jobs(limit: int = 40) -> list[Dict[str, Any]]:
    maker = get_sessionmaker()
    async with maker() as s:
        rows = await fetch_all(
            s,
            """SELECT id, job_name, started_at, finished_at, duration_ms,
                      status, records, message
               FROM job_runs ORDER BY started_at DESC LIMIT :lim""",
            {"lim": limit},
        )
    return rows
