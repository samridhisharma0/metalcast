"""Price provider contract + unit normalisation.

Commodity APIs are notoriously inconsistent: the same metal comes back per
troy-ounce, per pound, per metric tonne, sometimes inverted (metal-per-USD).
Rather than trusting each vendor's docs we normalise defensively:

  1. take the raw number and the vendor's claimed unit,
  2. try the plausible conversions,
  3. accept the first result that lands inside a hard sanity band for that
     metal, otherwise reject the quote entirely.

A wrong-by-1000x price silently poisons the model training set, so rejecting is
always better than guessing.
"""
from __future__ import annotations

import abc
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

log = logging.getLogger("metalcast.providers")

# Hard plausibility bands in USD per metric tonne.
# Wide enough to survive a decade of volatility, tight enough to catch a
# unit-conversion bug immediately.
SANITY_BANDS: Dict[str, tuple[float, float]] = {
    "aluminium": (800.0, 8_000.0),
    "copper": (2_500.0, 30_000.0),
}

# Multipliers that turn "USD per X" into "USD per metric tonne".
UNIT_MULTIPLIERS: Dict[str, float] = {
    "tonne": 1.0,
    "mt": 1.0,
    "metric_tonne": 1.0,
    "t": 1.0,
    "lb": 2204.62262185,
    "pound": 2204.62262185,
    "kg": 1000.0,
    "g": 1_000_000.0,
    "toz": 32150.7466,
    "troy_ounce": 32150.7466,
    "oz": 35273.9619,
}

CANDIDATE_MULTIPLIERS: List[float] = [
    1.0,                # already per tonne
    2204.62262185,      # per pound  (COMEX copper)
    1000.0,             # per kg
    32150.7466,         # per troy ounce
]


class ProviderError(RuntimeError):
    """Raised when a provider cannot produce a usable quote."""


@dataclass(slots=True)
class Quote:
    metal: str                 # 'aluminium' | 'copper'
    price: float               # USD per metric tonne, normalised
    ts: datetime               # timezone-aware UTC
    source: str                # provider id
    source_kind: str = "live"  # live | backfill | synthetic
    currency: str = "USD"
    unit: str = "tonne"
    latency_ms: Optional[int] = None
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class DailyBar:
    metal: str
    date: str            # YYYY-MM-DD
    open: float
    high: float
    low: float
    close: float
    source: str


def normalise_to_tonne(metal: str, value: float, claimed_unit: Optional[str] = None) -> float:
    """Return USD/tonne or raise ProviderError."""
    if value is None:
        raise ProviderError(f"{metal}: null price")
    try:
        value = float(value)
    except (TypeError, ValueError) as exc:
        raise ProviderError(f"{metal}: non-numeric price {value!r}") from exc
    if value <= 0 or value != value:  # NaN check
        raise ProviderError(f"{metal}: non-positive price {value}")

    lo, hi = SANITY_BANDS.get(metal, (0.0, float("inf")))

    ordered: List[float] = []
    if claimed_unit:
        key = claimed_unit.strip().lower().replace("/", "").replace("usd", "")
        if key in UNIT_MULTIPLIERS:
            ordered.append(UNIT_MULTIPLIERS[key])
    ordered.extend(m for m in CANDIDATE_MULTIPLIERS if m not in ordered)

    # Some vendors invert the rate (metal units per 1 USD).
    inverted = 1.0 / value if value != 0 else 0.0

    for mult in ordered:
        for candidate in (value * mult, inverted * mult):
            if lo <= candidate <= hi:
                return round(candidate, 4)

    raise ProviderError(
        f"{metal}: price {value} (unit={claimed_unit}) cannot be normalised into "
        f"the sanity band {lo}-{hi} USD/t"
    )


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class PriceProvider(abc.ABC):
    """One upstream price feed."""

    id: str = "abstract"
    display_name: str = "Abstract provider"
    #: is this a true spot/official feed or a delayed futures proxy?
    kind: str = "spot"
    docs_url: str = ""
    requires_key: bool = True

    def __init__(self, client):
        self.client = client

    @property
    def configured(self) -> bool:
        return True

    @abc.abstractmethod
    async def fetch_latest(self, metals: List[str]) -> List[Quote]:
        """Return one quote per requested metal (may be partial)."""

    async def fetch_history(self, metal: str, days: int) -> List[DailyBar]:
        """Optional: daily OHLC backfill. Default = unsupported."""
        return []

    def describe(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.display_name,
            "kind": self.kind,
            "configured": self.configured,
            "requires_key": self.requires_key,
            "docs": self.docs_url,
        }
