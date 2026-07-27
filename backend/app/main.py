"""MetalCast API entrypoint."""
from __future__ import annotations

import asyncio
import logging
import pathlib
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from typing import Deque, Dict

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from .api.routes import router as api_router
from .config import settings
from .db import dispose_engine, init_db, ping
from .services.forecast_service import forecast_service
from .services.news_service import news_service
from .services.price_service import price_service
from .services.scheduler import start_scheduler, stop_scheduler
from .utils.logging import setup_logging

setup_logging()
log = logging.getLogger("metalcast")


async def _bootstrap() -> None:
    """First-boot data warm-up, in the background so /health answers instantly."""
    try:
        result = await price_service.poll_once()
        log.info("initial price poll: %s", {k: v for k, v in result.items() if k != "attempts"})
    except Exception:
        log.exception("initial price poll failed")

    try:
        bf = await price_service.backfill()
        log.info("history backfill: %s", bf.get("metals"))
    except Exception:
        log.exception("history backfill failed")

    try:
        await news_service.refresh()
    except Exception:
        log.exception("initial news refresh failed")

    try:
        await forecast_service.run_all()
        await forecast_service.evaluate_due()
    except Exception:
        log.exception("initial forecast run failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("starting %s v%s (%s)", settings.app_name, settings.app_version, settings.environment)

    # Wait for Postgres — in Docker the DB container may still be starting.
    for attempt in range(1, 31):
        if await ping():
            break
        log.warning("waiting for PostgreSQL (attempt %d/30)…", attempt)
        await asyncio.sleep(2)
    else:
        log.error("PostgreSQL unreachable — the API will run but every data route will 503")

    try:
        await init_db()
    except Exception:
        log.exception("schema bootstrap failed — check DATABASE_URL and privileges")

    await price_service.start()
    await news_service.start()

    task = asyncio.create_task(_bootstrap())
    app.state.bootstrap_task = task

    if settings.enable_scheduler:
        start_scheduler()

    try:
        yield
    finally:
        log.info("shutting down")
        stop_scheduler()
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
        await price_service.stop()
        await news_service.stop()
        await dispose_engine()


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description=(
        "Near-real-time Aluminium & Copper prices, ensemble price-movement "
        "forecasts with uncertainty bands, and tagged commodity news."
    ),
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(GZipMiddleware, minimum_size=800)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-Request-Duration-Ms"],
)

# ---------------------------------------------------------------------------
# Lightweight in-process rate limiter. Good enough for a single instance; put
# a real limiter (Redis/NGINX) in front when you scale horizontally.
# ---------------------------------------------------------------------------
_hits: Dict[str, Deque[float]] = defaultdict(deque)
_EXEMPT = ("/api/health", "/api/stream/prices")


@app.middleware("http")
async def guard(request: Request, call_next):
    started = time.perf_counter()
    path = request.url.path

    if path.startswith("/api") and not path.startswith(_EXEMPT):
        client = request.client.host if request.client else "unknown"
        window = _hits[client]
        now = time.time()
        while window and now - window[0] > 60:
            window.popleft()
        if len(window) >= settings.rate_limit_per_minute:
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={"error": "rate_limited",
                         "detail": "Too many requests. Try again in a minute."},
            )
        window.append(now)

    try:
        response = await call_next(request)
    except Exception:
        log.exception("unhandled error on %s %s", request.method, path)
        return JSONResponse(
            status_code=500,
            content={"error": "internal_error",
                     "detail": "The server hit an unexpected error. Check the API logs."},
        )
    response.headers["X-Request-Duration-Ms"] = f"{(time.perf_counter() - started) * 1000:.1f}"
    return response


@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, exc: StarletteHTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": "http_error", "status": exc.status_code, "detail": exc.detail},
    )


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"error": "validation_error",
                 "detail": "One or more query parameters are invalid.",
                 "fields": exc.errors()},
    )


app.include_router(api_router, prefix=settings.api_prefix)


@app.get("/api", include_in_schema=False)
async def api_root():
    return {
        "name": settings.app_name,
        "version": settings.app_version,
        "docs": "/api/docs",
        "endpoints": [
            "/api/health", "/api/meta/metals", "/api/prices/latest",
            "/api/prices/{metal}/history", "/api/prices/{metal}/ticks",
            "/api/prices/{metal}/stats", "/api/prices/correlation",
            "/api/predictions/{metal}", "/api/predictions/{metal}/track",
            "/api/predictions/{metal}/accuracy", "/api/news",
            "/api/news/sentiment", "/api/stream/prices", "/api/system/status",
        ],
    }


# ---------------------------------------------------------------------------
# Optional single-container deployment: if the built frontend is present, serve
# it and hand every unknown path to index.html so client-side routing works on
# a hard refresh or a deep link.
# ---------------------------------------------------------------------------
STATIC_DIR = pathlib.Path(__file__).resolve().parent.parent / "static"
if STATIC_DIR.is_dir() and (STATIC_DIR / "index.html").exists():
    assets = STATIC_DIR / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        if full_path.startswith(("api/", "assets/")):
            return JSONResponse(status_code=404, content={"error": "not_found", "path": full_path})
        candidate = STATIC_DIR / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(STATIC_DIR / "index.html")

    log.info("serving built frontend from %s", STATIC_DIR)
else:
    @app.get("/", include_in_schema=False)
    async def root():
        return {
            "name": settings.app_name,
            "message": "API is running. The React dashboard is served separately in dev.",
            "docs": "/api/docs",
        }
