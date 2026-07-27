"""
Command-line backfill helper.

Usage:
    python -m scripts.backfill              # 900 days for both metals
    python -m scripts.backfill --days 1500  # further back
    python -m scripts.backfill --metal copper --days 365
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

# Allow "python scripts/backfill.py" to work regardless of cwd
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.db import init_db  # noqa: E402
from app.services.price_service import METALS, price_service  # noqa: E402


async def _run(metal: str | None, days: int) -> None:
    logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    log = logging.getLogger("backfill")
    log.info("Initialising database schema (idempotent)")
    await init_db()

    targets = [metal] if metal else list(METALS)
    for m in targets:
        log.info("Backfilling %s (%d days)", m, days)
        try:
            inserted = await price_service.backfill(m, days=days)
            log.info("%s: %d daily bars inserted", m, inserted)
        except Exception as exc:  # noqa: BLE001
            log.exception("%s: backfill failed: %s", m, exc)


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill MetalCast daily price history from Yahoo Finance futures.")
    parser.add_argument("--metal", choices=list(METALS), default=None, help="Restrict to one metal")
    parser.add_argument("--days", type=int, default=900, help="How many calendar days of history to fetch")
    args = parser.parse_args()
    asyncio.run(_run(args.metal, args.days))


if __name__ == "__main__":
    main()
