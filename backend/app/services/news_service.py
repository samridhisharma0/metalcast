"""Commodity news ingestion.

Four provider families, tried in order and merged (news is additive, unlike
prices where we want a single authoritative number):

  newsapi   — NewsAPI.org        (key)
  gnews     — GNews.io           (key)
  marketaux — Marketaux          (key, carries its own sentiment)
  rss       — publisher RSS      (keyless: Mining.com, Kitco, WSJ markets, ET)

Deduplication is on sha256 of a normalised URL, so the same story arriving from
two providers is stored once. Sentiment is a domain lexicon rather than a
general-purpose model: "backwardation" and "smelter restart" carry a directional
meaning in metals that a generic sentiment classifier gets wrong.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse, urlunparse

import httpx

from ..config import settings
from ..db import execute, fetch_all, fetch_one, get_sessionmaker

log = logging.getLogger("metalcast.news")

try:
    import feedparser
    HAVE_FEEDPARSER = True
except Exception:  # pragma: no cover
    HAVE_FEEDPARSER = False
    log.warning("feedparser unavailable — RSS provider disabled")

QUERY = (
    "copper OR aluminium OR aluminum OR LME OR \"base metals\" OR "
    "\"metal prices\" OR smelter OR bauxite OR alumina"
)

METAL_PATTERNS: Dict[str, re.Pattern] = {
    "aluminium": re.compile(r"\b(alumini?um|alumina|bauxite|ali\b|smelter)\b", re.I),
    "copper": re.compile(r"\b(copper|cathode|concentrate|cu\b|comex\s+copper)\b", re.I),
}

TAG_PATTERNS: Dict[str, re.Pattern] = {
    "lme": re.compile(r"\bLME\b|London Metal Exchange", re.I),
    "shfe": re.compile(r"\bSHFE\b|Shanghai Futures", re.I),
    "comex": re.compile(r"\bCOMEX\b", re.I),
    "supply": re.compile(r"\b(supply|output|production|smelter|mine|strike|shutdown|restart|capacity)\b", re.I),
    "demand": re.compile(r"\b(demand|consumption|orders|construction|EV|grid|infrastructure)\b", re.I),
    "inventory": re.compile(r"\b(inventor(y|ies)|stockpile|warehouse|warrant)\b", re.I),
    "policy": re.compile(r"\b(tariff|sanction|export ban|quota|duty|policy|Fed|rate cut|rate hike)\b", re.I),
    "china": re.compile(r"\bChina|Chinese|Yangshan\b", re.I),
    "india": re.compile(r"\bIndia|Indian|Hindalco|Vedanta|NALCO\b", re.I),
}

BULLISH = {
    "surge": 2.0, "surges": 2.0, "soar": 2.2, "soars": 2.2, "rally": 1.8, "rallies": 1.8,
    "jump": 1.6, "jumps": 1.6, "climb": 1.3, "climbs": 1.3, "rise": 1.1, "rises": 1.1,
    "gain": 1.1, "gains": 1.1, "higher": 1.0, "record high": 2.4, "multi-year high": 2.0,
    "shortage": 1.8, "deficit": 1.9, "backwardation": 1.7, "supply disruption": 2.0,
    "strike": 1.4, "shutdown": 1.5, "outage": 1.5, "force majeure": 2.0,
    "strong demand": 2.0, "restocking": 1.4, "stimulus": 1.6, "drawdown": 1.3,
    "bullish": 2.0, "upgrade": 1.2, "tightens": 1.5, "tight": 1.2,
}
BEARISH = {
    "plunge": -2.2, "plunges": -2.2, "slump": -2.0, "slumps": -2.0, "tumble": -1.9,
    "tumbles": -1.9, "fall": -1.2, "falls": -1.2, "drop": -1.3, "drops": -1.3,
    "slide": -1.2, "slides": -1.2, "decline": -1.1, "declines": -1.1, "lower": -1.0,
    "glut": -2.0, "surplus": -1.8, "oversupply": -2.1, "contango": -1.2,
    "weak demand": -2.0, "destocking": -1.4, "recession": -1.8, "slowdown": -1.6,
    "record high inventories": -2.0, "build": -0.8, "builds": -0.8,
    "bearish": -2.0, "downgrade": -1.2, "cuts forecast": -1.7, "profit taking": -1.0,
    "record low": -2.0, "capacity expansion": -1.3, "restart": -1.1,
}


def normalise_url(url: str) -> str:
    try:
        p = urlparse(url.strip())
        return urlunparse((p.scheme.lower(), p.netloc.lower(), p.path.rstrip("/"), "", "", ""))
    except Exception:
        return url.strip()


def url_hash(url: str) -> str:
    return hashlib.sha256(normalise_url(url).encode("utf-8")).hexdigest()


def score_sentiment(text: str) -> Tuple[float, str]:
    lowered = f" {text.lower()} "
    score = 0.0
    hits = 0
    for phrase, weight in {**BULLISH, **BEARISH}.items():
        if phrase in lowered:
            score += weight
            hits += 1
    if hits == 0:
        return 0.0, "neutral"
    normalised = max(-1.0, min(1.0, score / (2.2 * max(1, hits) ** 0.5)))
    label = "bullish" if normalised > 0.15 else "bearish" if normalised < -0.15 else "neutral"
    return round(normalised, 4), label


def tag_metals(text: str) -> List[str]:
    return [code for code, pattern in METAL_PATTERNS.items() if pattern.search(text)]


def tag_topics(text: str) -> List[str]:
    return [tag for tag, pattern in TAG_PATTERNS.items() if pattern.search(text)]


def relevance(text: str, metals: List[str], tags: List[str]) -> float:
    score = 0.30 * len(metals) + 0.08 * len(tags)
    if re.search(r"\b(price|prices|futures|contract|tonne|ton|per pound)\b", text, re.I):
        score += 0.20
    if re.search(r"\bLME\b", text, re.I):
        score += 0.15
    return round(min(score, 1.0), 4)


def parse_dt(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip()
    for fmt in (None, "%a, %d %b %Y %H:%M:%S %z", "%a, %d %b %Y %H:%M:%S %Z",
                "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            dt = (datetime.fromisoformat(text.replace("Z", "+00:00")) if fmt is None
                  else datetime.strptime(text, fmt))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except Exception:
            continue
    return None


class NewsService:
    def __init__(self) -> None:
        self._client: Optional[httpx.AsyncClient] = None
        self._errors: Dict[str, str] = {}

    async def start(self) -> None:
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(15.0, connect=6.0),
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; MetalCast/1.0)"},
        )

    async def stop(self) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None

    # ---------------- providers ----------------
    async def _newsapi(self) -> List[Dict[str, Any]]:
        if not settings.newsapi_key:
            raise RuntimeError("NEWSAPI_KEY not configured")
        r = await self._client.get(
            "https://newsapi.org/v2/everything",
            params={
                "q": QUERY, "language": "en", "sortBy": "publishedAt", "pageSize": 60,
                "from": (datetime.now(timezone.utc) - timedelta(days=7)).date().isoformat(),
            },
            headers={"X-Api-Key": settings.newsapi_key},
        )
        r.raise_for_status()
        data = r.json()
        if data.get("status") != "ok":
            raise RuntimeError(f"newsapi: {data.get('message')}")
        out = []
        for a in data.get("articles", []):
            if not a.get("url") or not a.get("title"):
                continue
            out.append({
                "url": a["url"], "title": a["title"], "summary": a.get("description"),
                "content_snippet": (a.get("content") or "")[:1000],
                "source_name": (a.get("source") or {}).get("name") or "NewsAPI",
                "author": a.get("author"), "published_at": parse_dt(a.get("publishedAt")),
                "image_url": a.get("urlToImage"), "provider": "newsapi",
            })
        return out

    async def _gnews(self) -> List[Dict[str, Any]]:
        if not settings.gnews_api_key:
            raise RuntimeError("GNEWS_API_KEY not configured")
        r = await self._client.get(
            "https://gnews.io/api/v4/search",
            params={"q": "copper OR aluminium OR LME metals", "lang": "en",
                    "max": 50, "apikey": settings.gnews_api_key, "sortby": "publishedAt"},
        )
        r.raise_for_status()
        data = r.json()
        out = []
        for a in data.get("articles", []):
            if not a.get("url"):
                continue
            out.append({
                "url": a["url"], "title": a.get("title") or "", "summary": a.get("description"),
                "content_snippet": (a.get("content") or "")[:1000],
                "source_name": (a.get("source") or {}).get("name") or "GNews",
                "author": None, "published_at": parse_dt(a.get("publishedAt")),
                "image_url": a.get("image"), "provider": "gnews",
            })
        return out

    async def _marketaux(self) -> List[Dict[str, Any]]:
        if not settings.marketaux_api_key:
            raise RuntimeError("MARKETAUX_API_KEY not configured")
        r = await self._client.get(
            "https://api.marketaux.com/v1/news/all",
            params={"api_token": settings.marketaux_api_key,
                    "search": "copper | aluminium | aluminum | LME",
                    "language": "en", "limit": 50, "filter_entities": "true"},
        )
        r.raise_for_status()
        data = r.json()
        out = []
        for a in data.get("data", []):
            if not a.get("url"):
                continue
            entities = a.get("entities") or []
            vendor_sent = None
            scores = [e.get("sentiment_score") for e in entities if e.get("sentiment_score") is not None]
            if scores:
                vendor_sent = sum(scores) / len(scores)
            out.append({
                "url": a["url"], "title": a.get("title") or "",
                "summary": a.get("description") or a.get("snippet"),
                "content_snippet": (a.get("snippet") or "")[:1000],
                "source_name": a.get("source") or "Marketaux",
                "author": None, "published_at": parse_dt(a.get("published_at")),
                "image_url": a.get("image_url"), "provider": "marketaux",
                "vendor_sentiment": vendor_sent,
            })
        return out

    async def _rss_impl(self) -> List[Dict[str, Any]]:
        if not HAVE_FEEDPARSER:
            raise RuntimeError("feedparser not installed")
        out: List[Dict[str, Any]] = []

        async def one(url: str) -> None:
            try:
                r = await self._client.get(url)
                r.raise_for_status()
                parsed = await asyncio.to_thread(feedparser.parse, r.content)
            except Exception as exc:
                log.debug("rss %s failed: %s", url, exc)
                return
            host = urlparse(url).netloc
            feed_title = (parsed.feed or {}).get("title") or host
            for entry in (parsed.entries or [])[:40]:
                link = entry.get("link")
                if not link:
                    continue
                summary = re.sub(r"<[^>]+>", " ", entry.get("summary", "") or "")[:800]
                image = None
                for media in (entry.get("media_content") or []):
                    if media.get("url"):
                        image = media["url"]
                        break
                out.append({
                    "url": link,
                    "title": (entry.get("title") or "").strip(),
                    "summary": summary.strip() or None,
                    "content_snippet": summary[:1000],
                    "source_name": feed_title,
                    "author": entry.get("author"),
                    "published_at": parse_dt(entry.get("published") or entry.get("updated")),
                    "image_url": image,
                    "provider": f"rss:{host}",
                })

        await asyncio.gather(*(one(u) for u in settings.rss_feed_list), return_exceptions=True)
        return out

    # ---------------- ingest ----------------
    async def refresh(self) -> Dict[str, Any]:
        if self._client is None:
            await self.start()

        handlers = {
            "newsapi": self._newsapi,
            "gnews": self._gnews,
            "marketaux": self._marketaux,
            "rss": self._rss_impl,
        }
        gathered: List[Dict[str, Any]] = []
        attempts: List[Dict[str, Any]] = []

        for pid in settings.news_provider_list:
            fn = handlers.get(pid)
            if fn is None:
                continue
            try:
                items = await fn()
                gathered.extend(items)
                attempts.append({"provider": pid, "status": "ok", "items": len(items)})
                self._errors.pop(pid, None)
            except Exception as exc:
                msg = f"{type(exc).__name__}: {exc}"
                self._errors[pid] = msg
                attempts.append({"provider": pid, "status": "error", "error": msg})
                log.info("news provider %s unavailable: %s", pid, msg)

        stored, skipped = await self._persist(gathered)
        return {
            "fetched": len(gathered),
            "stored": stored,
            "skipped_irrelevant": skipped,
            "attempts": attempts,
        }

    async def _persist(self, items: List[Dict[str, Any]]) -> Tuple[int, int]:
        if not items:
            return 0, 0
        maker = get_sessionmaker()
        stored = skipped = 0
        seen: set[str] = set()

        async with maker() as s:
            for item in items:
                url = item.get("url")
                title = (item.get("title") or "").strip()
                if not url or not title:
                    continue
                h = url_hash(url)
                if h in seen:
                    continue
                seen.add(h)

                blob = " ".join(filter(None, [
                    title, item.get("summary") or "", item.get("content_snippet") or ""
                ]))
                metals = tag_metals(blob)
                tags = tag_topics(blob)
                rel = relevance(blob, metals, tags)

                # Keep the feed on-topic: needs a metal mention or strong signals.
                if not metals and rel < 0.35:
                    skipped += 1
                    continue

                vendor = item.get("vendor_sentiment")
                sentiment, label = score_sentiment(blob)
                if vendor is not None:
                    sentiment = round(0.6 * float(vendor) + 0.4 * sentiment, 4)
                    label = ("bullish" if sentiment > 0.15
                             else "bearish" if sentiment < -0.15 else "neutral")

                published = item.get("published_at") or datetime.now(timezone.utc)
                if published > datetime.now(timezone.utc) + timedelta(hours=6):
                    published = datetime.now(timezone.utc)

                await execute(
                    s,
                    """
                    INSERT INTO news_articles
                        (url_hash, url, title, summary, content_snippet, source_name,
                         author, published_at, image_url, provider, sentiment,
                         sentiment_label, relevance, metals, tags)
                    VALUES
                        (:h, :u, :t, :s, :cs, :src, :a, :p, :img, :prov, :sent,
                         :lbl, :rel, :metals, :tags)
                    ON CONFLICT (url_hash) DO UPDATE SET
                        title = EXCLUDED.title,
                        summary = COALESCE(EXCLUDED.summary, news_articles.summary),
                        sentiment = EXCLUDED.sentiment,
                        sentiment_label = EXCLUDED.sentiment_label,
                        relevance = EXCLUDED.relevance,
                        metals = EXCLUDED.metals,
                        tags = EXCLUDED.tags
                    """,
                    {
                        "h": h, "u": url[:2000], "t": title[:600],
                        "s": (item.get("summary") or None),
                        "cs": (item.get("content_snippet") or None),
                        "src": (item.get("source_name") or "unknown")[:200],
                        "a": (item.get("author") or None),
                        "p": published, "img": (item.get("image_url") or None),
                        "prov": item.get("provider", "unknown")[:80],
                        "sent": sentiment, "lbl": label, "rel": rel,
                        "metals": metals, "tags": tags,
                    },
                )
                stored += 1
            await s.commit()
        return stored, skipped

    # ---------------- queries ----------------
    async def list_articles(self, metal: Optional[str] = None, query: Optional[str] = None,
                            sentiment: Optional[str] = None, page: int = 1,
                            page_size: int = 20) -> Dict[str, Any]:
        page = max(1, page)
        page_size = max(1, min(page_size, 100))
        offset = (page - 1) * page_size

        where = ["1=1"]
        params: Dict[str, Any] = {"lim": page_size, "off": offset}
        if metal:
            where.append(":metal = ANY(metals)")
            params["metal"] = metal
        if sentiment in ("bullish", "bearish", "neutral"):
            where.append("sentiment_label = :sent")
            params["sent"] = sentiment
        if query:
            where.append(
                "to_tsvector('english', title || ' ' || coalesce(summary,'')) "
                "@@ websearch_to_tsquery('english', :q)"
            )
            params["q"] = query
        clause = " AND ".join(where)

        maker = get_sessionmaker()
        async with maker() as s:
            rows = await fetch_all(
                s,
                f"""
                SELECT id, url, title, summary, source_name, author, published_at,
                       image_url, provider, sentiment, sentiment_label, relevance,
                       metals, tags
                FROM news_articles
                WHERE {clause}
                ORDER BY published_at DESC, relevance DESC
                LIMIT :lim OFFSET :off
                """,
                params,
            )
            total = await fetch_one(
                s, f"SELECT count(*) AS n FROM news_articles WHERE {clause}",
                {k: v for k, v in params.items() if k not in ("lim", "off")},
            )
        return {
            "page": page,
            "page_size": page_size,
            "total": (total or {}).get("n", 0),
            "articles": [
                {
                    "id": r["id"], "url": r["url"], "title": r["title"],
                    "summary": r["summary"], "source": r["source_name"],
                    "author": r["author"], "published_at": r["published_at"],
                    "image_url": r["image_url"], "provider": r["provider"],
                    "sentiment": float(r["sentiment"]) if r["sentiment"] is not None else None,
                    "sentiment_label": r["sentiment_label"],
                    "relevance": float(r["relevance"]),
                    "metals": list(r["metals"] or []),
                    "tags": list(r["tags"] or []),
                }
                for r in rows
            ],
        }

    async def sentiment_summary(self, hours: int = 72) -> Dict[str, Any]:
        maker = get_sessionmaker()
        async with maker() as s:
            rows = await fetch_all(
                s,
                """
                SELECT unnest(metals) AS metal,
                       count(*) AS n,
                       round(avg(sentiment)::numeric, 4) AS avg_sentiment,
                       count(*) FILTER (WHERE sentiment_label = 'bullish')  AS bullish,
                       count(*) FILTER (WHERE sentiment_label = 'bearish')  AS bearish,
                       count(*) FILTER (WHERE sentiment_label = 'neutral')  AS neutral
                FROM news_articles
                WHERE published_at >= now() - make_interval(hours => :h)
                GROUP BY 1
                """,
                {"h": hours},
            )
            trend = await fetch_all(
                s,
                """
                SELECT date_trunc('day', published_at) AS day,
                       round(avg(sentiment)::numeric, 4) AS avg_sentiment,
                       count(*) AS n
                FROM news_articles
                WHERE published_at >= now() - interval '14 days'
                GROUP BY 1 ORDER BY 1
                """,
            )
        return {
            "window_hours": hours,
            "by_metal": [
                {
                    "metal": r["metal"], "articles": r["n"],
                    "avg_sentiment": float(r["avg_sentiment"] or 0),
                    "bullish": r["bullish"], "bearish": r["bearish"], "neutral": r["neutral"],
                }
                for r in rows
            ],
            "daily": [
                {"day": r["day"].date().isoformat(),
                 "avg_sentiment": float(r["avg_sentiment"] or 0), "articles": r["n"]}
                for r in trend
            ],
        }

    def provider_status(self) -> List[Dict[str, Any]]:
        configured = {
            "newsapi": bool(settings.newsapi_key),
            "gnews": bool(settings.gnews_api_key),
            "marketaux": bool(settings.marketaux_api_key),
            "rss": HAVE_FEEDPARSER and bool(settings.rss_feed_list),
        }
        return [
            {"id": pid, "configured": configured.get(pid, False),
             "requires_key": pid != "rss", "last_error": self._errors.get(pid)}
            for pid in settings.news_provider_list
        ]


news_service = NewsService()
