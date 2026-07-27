"""Application settings, loaded from environment / .env."""
from __future__ import annotations

from functools import lru_cache
from typing import List, Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ---- core ------------------------------------------------------------
    app_name: str = "MetalCast API"
    app_version: str = "1.0.0"
    environment: str = "development"
    debug: bool = False
    api_prefix: str = "/api"
    port: int = 8000

    # ---- database --------------------------------------------------------
    # Accepts postgres:// , postgresql:// or postgresql+asyncpg://
    database_url: str = "postgresql://metalcast:metalcast@localhost:5432/metalcast"
    db_pool_size: int = 10
    db_max_overflow: int = 20
    db_pool_recycle: int = 1800
    db_echo: bool = False
    auto_migrate: bool = True          # run db/schema.sql on boot

    # ---- security --------------------------------------------------------
    cors_origins: str = "http://localhost:5173,http://localhost:4173,http://localhost:3000"
    admin_token: str = "change-me-in-production"
    rate_limit_per_minute: int = 240

    # ---- price providers -------------------------------------------------
    # Comma-separated priority list. First provider that answers wins.
    price_providers: str = "metals_dev,metalprice_api,commodities_api,yahoo"
    metals_dev_api_key: Optional[str] = None
    metalprice_api_key: Optional[str] = None
    commodities_api_key: Optional[str] = None
    twelvedata_api_key: Optional[str] = None

    # Yahoo Finance continuous futures symbols (no key required, delayed).
    yahoo_symbol_aluminium: str = "ALI=F"
    yahoo_symbol_copper: str = "HG=F"
    # COMEX copper quotes in USD/lb -> convert to USD/tonne
    copper_lb_to_tonne: float = 2204.62262185

    # Dev-only escape hatch. Rows are stamped source_kind='synthetic' and the
    # dashboard shows a loud banner. NEVER enable for a graded deliverable.
    allow_synthetic: bool = False

    # ---- news providers --------------------------------------------------
    news_providers: str = "newsapi,gnews,marketaux,rss"
    newsapi_key: Optional[str] = None
    gnews_api_key: Optional[str] = None
    marketaux_api_key: Optional[str] = None
    news_rss_feeds: str = (
        "https://www.mining.com/feed/,"
        "https://www.mining-technology.com/feed/,"
        "https://feeds.a.dj.com/rss/RSSMarketsMain.xml,"
        "https://www.kitco.com/rss/KitcoNewsRSS.xml,"
        "https://economictimes.indiatimes.com/markets/commodities/rssfeeds/1808175712.cms"
    )

    # ---- scheduler -------------------------------------------------------
    enable_scheduler: bool = True
    price_poll_seconds: int = 90
    news_poll_minutes: int = 20
    forecast_interval_minutes: int = 60
    accuracy_eval_minutes: int = 180
    tick_retention_days: int = 45
    backfill_days_on_boot: int = 900   # ~3.5y of daily history for the models

    # ---- forecasting -----------------------------------------------------
    model_version: str = "ensemble-v1.3"
    short_horizons: str = "1,2,3,4,5,6,7"                 # trading days
    long_horizons: str = "21,42,63,84,105,126"            # ~1..6 months
    backtest_origins: int = 30
    min_history_points: int = 90

    # ---------------- derived helpers ------------------------------------
    @field_validator("database_url")
    @classmethod
    def _normalise_db_url(cls, v: str) -> str:
        if v.startswith("postgres://"):
            v = "postgresql://" + v[len("postgres://"):]
        return v

    @property
    def async_database_url(self) -> str:
        url = self.database_url
        if url.startswith("postgresql+asyncpg://"):
            return url
        if url.startswith("postgresql://"):
            return "postgresql+asyncpg://" + url[len("postgresql://"):]
        return url

    @property
    def cors_origin_list(self) -> List[str]:
        raw = [o.strip() for o in self.cors_origins.split(",") if o.strip()]
        return raw or ["*"]

    @property
    def price_provider_list(self) -> List[str]:
        return [p.strip() for p in self.price_providers.split(",") if p.strip()]

    @property
    def news_provider_list(self) -> List[str]:
        return [p.strip() for p in self.news_providers.split(",") if p.strip()]

    @property
    def rss_feed_list(self) -> List[str]:
        return [f.strip() for f in self.news_rss_feeds.split(",") if f.strip()]

    @property
    def short_horizon_list(self) -> List[int]:
        return sorted({int(x) for x in self._expand_range(self.short_horizons)})

    @property
    def long_horizon_list(self) -> List[int]:
        return sorted({int(x) for x in self._expand_range(self.long_horizons)})

    @staticmethod
    def _expand_range(value: str) -> List[str]:
        """Support both comma-separated (1,2,3) and range (1..3) syntax."""
        parts: List[str] = []
        for token in value.split(","):
            token = token.strip()
            if ".." in token:
                lo, hi = token.split("..", 1)
                parts.extend(str(i) for i in range(int(lo), int(hi) + 1))
            elif token:
                parts.append(token)
        return parts


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
