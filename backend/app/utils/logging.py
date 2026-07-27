"""Console logging setup."""
from __future__ import annotations

import logging
import sys

from ..config import settings

_FMT = "%(asctime)s  %(levelname)-7s  %(name)-26s  %(message)s"


def setup_logging() -> None:
    level = logging.DEBUG if settings.debug else logging.INFO
    root = logging.getLogger()
    if root.handlers:
        root.setLevel(level)
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(_FMT, datefmt="%H:%M:%S"))
    root.addHandler(handler)
    root.setLevel(level)

    for noisy in ("apscheduler.executors.default", "httpx", "httpcore",
                  "sqlalchemy.engine.Engine", "asyncio"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
