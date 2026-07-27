"""Concrete price providers."""
from __future__ import annotations

import logging
import math
import random
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from ...config import settings
from .base import (
    DailyBar,
    PriceProvider,
    ProviderError,
    Quote,
    normalise_to_tonne,
    utcnow,
)

log = logging.getLogger("metalcast.providers")

ALIASES: Dict[str, tuple[str, ...]] = {
    "aluminium": ("aluminium", "aluminum", "lme_aluminum", "lme_aluminium", "xal", "alu", "ali"),
    "copper": ("copper", "lme_copper", "xcu", "cu", "hg"),
}


def _find_metal_value(payload: Dict[str, Any], metal: str) -> Optional[float]:
    """Case/naming-insensitive lookup inside a vendor payload."""
    wanted = ALIASES[metal]
    flat: Dict[str, Any] = {}

    def walk(node: Any, prefix: str = "") -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                key = str(k).lower()
                if isinstance(v, (dict, list)):
                    walk(v, key)
                else:
                    flat.setdefault(key, v)
                    flat.setdefault(f"{prefix}.{key}" if prefix else key, v)
        elif isinstance(node, list):
            for item in node:
                walk(item, prefix)

    walk(payload)

    for key, value in flat.items():
        tail = key.split(".")[-1]
        norm = tail.replace("usd", "").strip("_-")
        if norm in wanted or tail in wanted:
            if isinstance(value, (int, float)):
                return float(value)
    # second pass: substring match (e.g. "lme_aluminum_cash")
    for key, value in flat.items():
        if isinstance(value, (int, float)):
            for alias in wanted:
                if alias in key and len(alias) > 3:
                    return float(value)
    return None


# --------------------------------------------------------------------------- #
# 1. metals.dev  — LME base-metal spot, keyed
# --------------------------------------------------------------------------- #
class MetalsDevProvider(PriceProvider):
    id = "metals_dev"
    display_name = "metals.dev (LME base metals)"
    kind = "spot"
    docs_url = "https://metals.dev/"
    BASE = "https://api.metals.dev/v1/latest"

    @property
    def configured(self) -> bool:
        return bool(settings.metals_dev_api_key)

    async def fetch_latest(self, metals: List[str]) -> List[Quote]:
        if not self.configured:
            raise ProviderError("metals.dev API key not configured")
        started = time.perf_counter()
        r = await self.client.get(
            self.BASE,
            params={
                "api_key": settings.metals_dev_api_key,
                "currency": "USD",
                "unit": "mt",
            },
        )
        r.raise_for_status()
        payload = r.json()
        if str(payload.get("status", "success")).lower() not in ("success", "ok", ""):
            raise ProviderError(f"metals.dev error: {payload.get('error_message') or payload}")

        latency = int((time.perf_counter() - started) * 1000)
        ts = _parse_ts(payload.get("timestamp")) or utcnow()

        out: List[Quote] = []
        for metal in metals:
            value = _find_metal_value(payload, metal)
            if value is None:
                log.warning("metals.dev: %s missing from payload", metal)
                continue
            out.append(
                Quote(
                    metal=metal,
                    price=normalise_to_tonne(metal, value, "mt"),
                    ts=ts,
                    source=self.id,
                    latency_ms=latency,
                    raw={"provider": self.id, "value": value, "unit": "mt"},
                )
            )
        if not out:
            raise ProviderError("metals.dev returned no usable metals")
        return out


# --------------------------------------------------------------------------- #
# 2. metalpriceapi.com — keyed, XAL / XCU symbols
# --------------------------------------------------------------------------- #
class MetalPriceApiProvider(PriceProvider):
    id = "metalprice_api"
    display_name = "MetalpriceAPI (XAL / XCU)"
    kind = "spot"
    docs_url = "https://metalpriceapi.com/documentation"
    BASE = "https://api.metalpriceapi.com/v1/latest"

    @property
    def configured(self) -> bool:
        return bool(settings.metalprice_api_key)

    async def fetch_latest(self, metals: List[str]) -> List[Quote]:
        if not self.configured:
            raise ProviderError("MetalpriceAPI key not configured")
        started = time.perf_counter()
        r = await self.client.get(
            self.BASE,
            params={
                "api_key": settings.metalprice_api_key,
                "base": "USD",
                "currencies": "XAL,XCU",
            },
        )
        r.raise_for_status()
        payload = r.json()
        if payload.get("success") is False:
            raise ProviderError(f"MetalpriceAPI error: {payload.get('error')}")

        latency = int((time.perf_counter() - started) * 1000)
        ts = _parse_ts(payload.get("timestamp")) or utcnow()
        rates = payload.get("rates") or {}

        out: List[Quote] = []
        for metal in metals:
            symbol = "XAL" if metal == "aluminium" else "XCU"
            value = rates.get(symbol) or rates.get(f"USD{symbol}") or _find_metal_value(rates, metal)
            if value is None:
                continue
            try:
                # rates are metal-per-USD; normalise_to_tonne tries both senses.
                price = normalise_to_tonne(metal, float(value), None)
            except ProviderError as exc:
                log.warning("metalpriceapi normalisation failed: %s", exc)
                continue
            out.append(
                Quote(
                    metal=metal,
                    price=price,
                    ts=ts,
                    source=self.id,
                    latency_ms=latency,
                    raw={"provider": self.id, "symbol": symbol, "rate": value},
                )
            )
        if not out:
            raise ProviderError("MetalpriceAPI returned no usable metals")
        return out


# --------------------------------------------------------------------------- #
# 3. commodities-api.com — keyed
# --------------------------------------------------------------------------- #
class CommoditiesApiProvider(PriceProvider):
    id = "commodities_api"
    display_name = "Commodities-API"
    kind = "spot"
    docs_url = "https://commodities-api.com/documentation"
    BASE = "https://commodities-api.com/api/latest"

    @property
    def configured(self) -> bool:
        return bool(settings.commodities_api_key)

    async def fetch_latest(self, metals: List[str]) -> List[Quote]:
        if not self.configured:
            raise ProviderError("Commodities-API key not configured")
        started = time.perf_counter()
        r = await self.client.get(
            self.BASE,
            params={
                "access_key": settings.commodities_api_key,
                "base": "USD",
                "symbols": "ALU,XCU",
            },
        )
        r.raise_for_status()
        payload = r.json()
        data = payload.get("data", payload)
        rates = data.get("rates") or {}
        latency = int((time.perf_counter() - started) * 1000)
        ts = _parse_ts(data.get("timestamp")) or utcnow()

        out: List[Quote] = []
        for metal in metals:
            symbol = "ALU" if metal == "aluminium" else "XCU"
            value = rates.get(symbol) or _find_metal_value(rates, metal)
            if value is None:
                continue
            try:
                price = normalise_to_tonne(metal, float(value), None)
            except ProviderError:
                continue
            out.append(
                Quote(
                    metal=metal,
                    price=price,
                    ts=ts,
                    source=self.id,
                    latency_ms=latency,
                    raw={"provider": self.id, "symbol": symbol, "rate": value},
                )
            )
        if not out:
            raise ProviderError("Commodities-API returned no usable metals")
        return out


# --------------------------------------------------------------------------- #
# 4. Yahoo Finance futures — keyless FALLBACK + historical backfill
# --------------------------------------------------------------------------- #
class YahooFuturesProvider(PriceProvider):
    """Exchange-traded futures (COMEX HG=F, ALI=F).

    Real market data, but *delayed* and futures-based rather than LME cash.
    Used as (a) a resilience fallback and (b) the multi-year daily history that
    the forecasting models train on. Every row it writes is tagged
    source='yahoo_futures' and surfaced in the UI.
    """

    id = "yahoo_futures"
    display_name = "Yahoo Finance futures (COMEX/CME, delayed)"
    kind = "futures_delayed"
    docs_url = "https://finance.yahoo.com/commodities"
    requires_key = False
    BASE = "https://query1.finance.yahoo.com/v8/finance/chart/"

    def _symbol(self, metal: str) -> str:
        return (
            settings.yahoo_symbol_aluminium
            if metal == "aluminium"
            else settings.yahoo_symbol_copper
        )

    async def _chart(self, symbol: str, interval: str, range_: str) -> Dict[str, Any]:
        r = await self.client.get(
            f"{self.BASE}{symbol}",
            params={"interval": interval, "range": range_, "includePrePost": "false"},
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; MetalCast/1.0)",
                "Accept": "application/json",
            },
        )
        r.raise_for_status()
        payload = r.json()
        chart = payload.get("chart") or {}
        if chart.get("error"):
            raise ProviderError(f"yahoo error for {symbol}: {chart['error']}")
        results = chart.get("result") or []
        if not results:
            raise ProviderError(f"yahoo returned no result for {symbol}")
        return results[0]

    async def fetch_latest(self, metals: List[str]) -> List[Quote]:
        out: List[Quote] = []
        for metal in metals:
            symbol = self._symbol(metal)
            started = time.perf_counter()
            try:
                result = await self._chart(symbol, "5m", "1d")
            except Exception as exc:
                log.warning("yahoo latest failed for %s: %s", symbol, exc)
                continue
            latency = int((time.perf_counter() - started) * 1000)
            meta = result.get("meta") or {}
            price = meta.get("regularMarketPrice")
            ts_raw = meta.get("regularMarketTime")

            if price is None:  # fall back to the last non-null close
                closes = (((result.get("indicators") or {}).get("quote") or [{}])[0]).get("close") or []
                stamps = result.get("timestamp") or []
                for value, stamp in zip(reversed(closes), reversed(stamps)):
                    if value is not None:
                        price, ts_raw = value, stamp
                        break
            if price is None:
                continue

            unit_hint = "lb" if metal == "copper" else "mt"
            try:
                normalised = normalise_to_tonne(metal, float(price), unit_hint)
            except ProviderError as exc:
                log.warning("yahoo normalisation failed: %s", exc)
                continue

            out.append(
                Quote(
                    metal=metal,
                    price=normalised,
                    ts=_parse_ts(ts_raw) or utcnow(),
                    source=self.id,
                    latency_ms=latency,
                    raw={
                        "provider": self.id,
                        "symbol": symbol,
                        "raw_price": price,
                        "raw_currency": meta.get("currency"),
                        "exchange": meta.get("fullExchangeName"),
                    },
                )
            )
        if not out:
            raise ProviderError("yahoo returned no usable metals")
        return out

    async def fetch_history(self, metal: str, days: int) -> List[DailyBar]:
        symbol = self._symbol(metal)
        range_ = "10y" if days > 1825 else "5y" if days > 730 else "2y" if days > 365 else "1y"
        try:
            result = await self._chart(symbol, "1d", range_)
        except Exception as exc:
            log.warning("yahoo history failed for %s: %s", symbol, exc)
            return []

        stamps = result.get("timestamp") or []
        quote = (((result.get("indicators") or {}).get("quote") or [{}])[0])
        opens, highs, lows, closes = (
            quote.get("open") or [],
            quote.get("high") or [],
            quote.get("low") or [],
            quote.get("close") or [],
        )
        unit_hint = "lb" if metal == "copper" else "mt"
        cutoff = utcnow() - timedelta(days=days)

        bars: List[DailyBar] = []
        for i, stamp in enumerate(stamps):
            close = closes[i] if i < len(closes) else None
            if close is None:
                continue
            when = datetime.fromtimestamp(stamp, tz=timezone.utc)
            if when < cutoff:
                continue
            try:
                c = normalise_to_tonne(metal, float(close), unit_hint)
                o = normalise_to_tonne(metal, float(opens[i]), unit_hint) if i < len(opens) and opens[i] else c
                h = normalise_to_tonne(metal, float(highs[i]), unit_hint) if i < len(highs) and highs[i] else max(o, c)
                l = normalise_to_tonne(metal, float(lows[i]), unit_hint) if i < len(lows) and lows[i] else min(o, c)
            except ProviderError:
                continue
            bars.append(
                DailyBar(
                    metal=metal,
                    date=when.date().isoformat(),
                    open=o,
                    high=max(h, o, c),
                    low=min(l, o, c),
                    close=c,
                    source=self.id,
                )
            )
        return bars


# --------------------------------------------------------------------------- #
# 5. Synthetic — DEV ONLY, disabled unless ALLOW_SYNTHETIC=true
# --------------------------------------------------------------------------- #
class SyntheticProvider(PriceProvider):
    """Deterministic GBM walk so the stack can be developed offline.

    Rows are stamped source_kind='synthetic'; the API reports it and the
    dashboard renders a red banner. Not acceptable as a data source for the
    deliverable — see README.
    """

    id = "synthetic"
    display_name = "Synthetic generator (DEV ONLY — not market data)"
    kind = "synthetic"
    requires_key = False
    ANCHOR = {"aluminium": 2450.0, "copper": 9600.0}
    VOL = {"aluminium": 0.013, "copper": 0.016}

    @property
    def configured(self) -> bool:
        return settings.allow_synthetic

    async def fetch_latest(self, metals: List[str]) -> List[Quote]:
        if not self.configured:
            raise ProviderError("synthetic provider disabled (ALLOW_SYNTHETIC=false)")
        now = utcnow()
        out: List[Quote] = []
        for metal in metals:
            seed = int(now.timestamp() // 60) ^ hash(metal) % 10_000
            rng = random.Random(seed)
            base = self.ANCHOR[metal]
            drift = math.sin(now.timestamp() / 86400.0) * 0.02
            shock = rng.gauss(0, self.VOL[metal])
            price = base * (1 + drift + shock)
            out.append(
                Quote(
                    metal=metal,
                    price=round(price, 2),
                    ts=now,
                    source=self.id,
                    source_kind="synthetic",
                    raw={"provider": self.id, "warning": "NOT MARKET DATA"},
                )
            )
        return out

    async def fetch_history(self, metal: str, days: int) -> List[DailyBar]:
        if not self.configured:
            return []
        rng = random.Random(hash(metal) & 0xFFFF)
        price = self.ANCHOR[metal] * 0.85
        vol = self.VOL[metal]
        bars: List[DailyBar] = []
        start = utcnow().date() - timedelta(days=days)
        for i in range(days):
            day = start + timedelta(days=i)
            if day.weekday() >= 5:
                continue
            price *= 1 + rng.gauss(0.00035, vol)
            o = price * (1 + rng.gauss(0, vol / 3))
            h = max(o, price) * (1 + abs(rng.gauss(0, vol / 4)))
            l = min(o, price) * (1 - abs(rng.gauss(0, vol / 4)))
            bars.append(
                DailyBar(metal=metal, date=day.isoformat(), open=round(o, 2),
                         high=round(h, 2), low=round(l, 2), close=round(price, 2),
                         source=self.id)
            )
        return bars


# --------------------------------------------------------------------------- #
def _parse_ts(value: Any) -> Optional[datetime]:
    if value in (None, "", 0):
        return None
    try:
        if isinstance(value, (int, float)):
            # heuristics: ms vs s epoch
            seconds = float(value) / 1000.0 if float(value) > 1e11 else float(value)
            return datetime.fromtimestamp(seconds, tz=timezone.utc)
        text = str(value).strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(text)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


REGISTRY = {
    MetalsDevProvider.id: MetalsDevProvider,
    MetalPriceApiProvider.id: MetalPriceApiProvider,
    CommoditiesApiProvider.id: CommoditiesApiProvider,
    "yahoo": YahooFuturesProvider,
    YahooFuturesProvider.id: YahooFuturesProvider,
    SyntheticProvider.id: SyntheticProvider,
}
