"""Async PostgreSQL access layer (SQLAlchemy Core + asyncpg).

We deliberately use hand-written SQL against the schema in db/schema.sql rather
than an ORM: the queries are analytical (window functions, DISTINCT ON, GIN
text search) and stay readable and tunable that way.
"""
from __future__ import annotations

import logging
import pathlib
from typing import Any, AsyncIterator, Dict, List, Optional, Sequence

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncEngine,
    async_sessionmaker,
    AsyncSession,
    create_async_engine,
)

from .config import settings

log = logging.getLogger("metalcast.db")

SCHEMA_PATH = pathlib.Path(__file__).resolve().parent.parent / "db" / "schema.sql"

_engine: Optional[AsyncEngine] = None
_sessionmaker: Optional[async_sessionmaker[AsyncSession]] = None


def get_engine() -> AsyncEngine:
    global _engine, _sessionmaker
    if _engine is None:
        _engine = create_async_engine(
            settings.async_database_url,
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            pool_recycle=settings.db_pool_recycle,
            pool_pre_ping=True,
            echo=settings.db_echo,
        )
        _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    get_engine()
    assert _sessionmaker is not None
    return _sessionmaker


async def dispose_engine() -> None:
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _sessionmaker = None


# --------------------------------------------------------------------------- #
# FastAPI dependency
# --------------------------------------------------------------------------- #
async def get_session() -> AsyncIterator[AsyncSession]:
    maker = get_sessionmaker()
    async with maker() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


# --------------------------------------------------------------------------- #
# Small helpers used all over the services layer
# --------------------------------------------------------------------------- #
async def fetch_all(session: AsyncSession, sql: str, params: Dict[str, Any] | None = None) -> List[Dict[str, Any]]:
    res = await session.execute(text(sql), params or {})
    return [dict(r) for r in res.mappings().all()]


async def fetch_one(session: AsyncSession, sql: str, params: Dict[str, Any] | None = None) -> Optional[Dict[str, Any]]:
    res = await session.execute(text(sql), params or {})
    row = res.mappings().first()
    return dict(row) if row else None


async def fetch_val(session: AsyncSession, sql: str, params: Dict[str, Any] | None = None) -> Any:
    res = await session.execute(text(sql), params or {})
    return res.scalar()


async def execute(session: AsyncSession, sql: str, params: Dict[str, Any] | Sequence[Dict[str, Any]] | None = None):
    return await session.execute(text(sql), params or {})


# --------------------------------------------------------------------------- #
# Bootstrap
# --------------------------------------------------------------------------- #
def _split_sql_statements(ddl: str) -> List[str]:
    """Split a SQL script into executable statements.

    The schema file contains multiple statements plus dollar-quoted function
    bodies, so ordinary string splitting on semicolons is not sufficient.
    """
    statements: List[str] = []
    buffer: List[str] = []
    in_single_quote = False
    in_double_quote = False
    dollar_quote: Optional[str] = None
    index = 0

    while index < len(ddl):
        char = ddl[index]
        next_char = ddl[index + 1] if index + 1 < len(ddl) else ""

        if dollar_quote is not None:
            if ddl.startswith(dollar_quote, index):
                buffer.append(dollar_quote)
                index += len(dollar_quote)
                dollar_quote = None
            else:
                buffer.append(char)
                index += 1
            continue

        if in_single_quote:
            buffer.append(char)
            if char == "'" and next_char == "'":
                buffer.append(next_char)
                index += 2
                continue
            if char == "'":
                in_single_quote = False
            index += 1
            continue

        if in_double_quote:
            buffer.append(char)
            if char == '"':
                in_double_quote = False
            index += 1
            continue

        if char == "'":
            in_single_quote = True
            buffer.append(char)
            index += 1
            continue

        if char == '"':
            in_double_quote = True
            buffer.append(char)
            index += 1
            continue

        if char == "$":
            end = index + 1
            while end < len(ddl) and (ddl[end].isalnum() or ddl[end] == "_"):
                end += 1
            if end < len(ddl) and ddl[end] == "$":
                delimiter = ddl[index:end + 1]
                buffer.append(delimiter)
                dollar_quote = delimiter
                index = end + 1
                continue

        if char == ";":
            statement = "".join(buffer).strip()
            if statement:
                statements.append(statement)
            buffer = []
            index += 1
            continue

        buffer.append(char)
        index += 1

    tail = "".join(buffer).strip()
    if tail:
        statements.append(tail)

    return statements


async def _split_and_run(conn: AsyncConnection, ddl: str) -> None:
    """Execute schema.sql statement by statement."""
    for statement in _split_sql_statements(ddl):
        normalized = " ".join(statement.split())
        if not normalized:
            continue
        if normalized.upper() in {"BEGIN", "COMMIT"}:
            continue
        await conn.exec_driver_sql(statement)


async def init_db() -> None:
    """Create schema if missing. Idempotent."""
    engine = get_engine()
    if not settings.auto_migrate:
        log.info("auto_migrate disabled — skipping schema bootstrap")
        return
    if not SCHEMA_PATH.exists():
        log.warning("schema.sql not found at %s — skipping bootstrap", SCHEMA_PATH)
        return

    ddl = SCHEMA_PATH.read_text(encoding="utf-8")
    async with engine.begin() as conn:
        await _split_and_run(conn, ddl)
    log.info("database schema ready")


async def ping() -> bool:
    try:
        engine = get_engine()
        async with engine.connect() as conn:
            await conn.exec_driver_sql("SELECT 1")
        return True
    except Exception as exc:  # pragma: no cover
        log.error("database ping failed: %s", exc)
        return False


async def db_stats() -> Dict[str, Any]:
    """Row counts + freshness, used by /api/health and the System page."""
    sql = """
        SELECT
          (SELECT count(*) FROM price_ticks)                       AS ticks,
          (SELECT count(*) FROM price_daily)                       AS daily_bars,
          (SELECT count(*) FROM predictions)                       AS predictions,
          (SELECT count(*) FROM prediction_runs)                   AS prediction_runs,
          (SELECT count(*) FROM news_articles)                     AS news,
          (SELECT count(*) FROM prediction_accuracy)               AS scored,
          (SELECT count(*) FROM job_runs)                          AS job_runs,
          (SELECT max(ts) FROM price_ticks)                        AS last_tick_at,
          (SELECT max(published_at) FROM news_articles)            AS last_news_at,
          (SELECT max(run_ts) FROM prediction_runs)                AS last_forecast_at
    """
    maker = get_sessionmaker()
    async with maker() as s:
        row = await fetch_one(s, sql)
    return row or {}
