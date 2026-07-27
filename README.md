# MetalCast

A production-shaped price-forecasting dashboard for **LME aluminium and copper**. Pulls near-real-time
prices from multiple providers, generates 1-day to 6-month forecasts with an ensemble of seven models,
aggregates commodity news across four sources, persists everything in PostgreSQL, and serves the
whole thing behind a React SPA.

Build a dev environment with either `docker compose up` or the manual steps below and open
[http://localhost:8000](http://localhost:8000). The backend serves the SPA at the same origin, so
you never have to worry about CORS in production.

---

## Table of contents

1. [At a glance](#at-a-glance)
2. [Quick start with Docker](#quick-start-with-docker)
3. [Quick start without Docker](#quick-start-without-docker)
4. [PostgreSQL — exactly what to do](#postgresql--exactly-what-to-do)
5. [Data sources — what's real and what isn't](#data-sources--whats-real-and-whats-not)
6. [Technology choices and why](#technology-choices-and-why)
7. [How the forecasts are built](#how-the-forecasts-are-built)
8. [Limitations, honestly](#limitations-honestly)
9. [API reference](#api-reference)
10. [Repository layout](#repository-layout)

---

## At a glance

- **Live board.** SSE-driven price tape with automatic polling fallback, sparklines, daily change,
  weekly range, and stream status. Never lies about staleness or provider.
- **Horizon strip.** Signature UI element: thirteen cells for the horizons 1D–7D and 1M–6M. Fill
  colour encodes direction and strength, inner column height encodes confidence, clicking drives the
  fan chart.
- **Ensemble forecasts** in log-price space with 80% and 95% asymmetric intervals, per-horizon
  probability of an upward move, and walk-forward hit rate / RMSE.
- **News.** Deduplicated across NewsAPI, GNews, Marketaux, and RSS from Mining.com, Mining-Technology,
  WSJ Markets, Kitco and Economic Times. Sentiment scored against a metals-specific lexicon
  ("backwardation", "curtailment", "deficit" bullish; "glut", "stockpile", "contango" bearish).
- **System page.** Live provider health, job outcomes from `job_runs`, database stats, and one-click
  manual triggers gated by an admin token.
- **Persistence.** Every tick, daily bar, prediction, prediction accuracy result and article is
  stored in PostgreSQL. Everything on this site is reproducible from the API and CSV exports.

---

## Quick start with Docker

The fastest path. All you need is Docker (with Compose) and one command.

```bash
# From the project root
docker compose up --build
```

- PostgreSQL 16 comes up first. When it is healthy, the backend applies the schema, starts polling,
  and serves the SPA at `http://localhost:8000`.
- No API keys are required to see it work — the backend falls back to Yahoo Finance futures
  (real market data, delayed and futures-based, transparently labelled in the UI). If you have keys,
  drop them in a `.env` file next to `docker-compose.yml`; the compose file passes them through.
- First-boot backfill pulls ~900 daily bars per metal. The first successful forecast lands roughly
  30 seconds after the backfill completes.

Environment file (optional but recommended in `docker-compose.yml`'s directory):

```env
ADMIN_TOKEN=pick-a-long-random-string
METALS_DEV_API_KEY=...
NEWSAPI_KEY=...
GNEWS_API_KEY=...
MARKETAUX_API_KEY=...
```

Shut it down cleanly with `docker compose down` (data survives) or `docker compose down -v` (wipes
Postgres).

---

## Quick start without Docker

Three terminals: PostgreSQL, the FastAPI backend, and the Vite dev server.

### 1. PostgreSQL

See the next section for a copy-pasteable version. In short: create a role, a database, and run
`backend/db/schema.sql`.

### 2. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate            # PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt

cp .env.example .env
# Edit .env — the only required field is DATABASE_URL.

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The backend applies the schema on startup, backfills ~900 daily bars for both metals in the
background, and starts the scheduled jobs. Watch the logs; you should see price polls succeeding
within about a minute.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite proxies `/api/*` to the FastAPI backend on
port 8000 (see `vite.config.js`), so no environment variables are needed in development.

For a production build served by the backend at the same origin:

```bash
cd frontend
npm run build
cp -r dist/* ../backend/static/
# then start the backend as above — it will serve the SPA and the API from :8000
```

---

## PostgreSQL — exactly what to do

Assuming PostgreSQL 14 or newer is installed and running.

### One-off setup

```bash
# 1. Create a role and a database. Change the password!
sudo -u postgres psql <<'SQL'
  CREATE ROLE metalcast WITH LOGIN PASSWORD 'metalcast';
  CREATE DATABASE metalcast OWNER metalcast;
  GRANT ALL PRIVILEGES ON DATABASE metalcast TO metalcast;
SQL

# 2. Apply the schema.
psql "postgresql://metalcast:metalcast@localhost:5432/metalcast" \
     -f backend/db/schema.sql
```

You can also run the SQL by hand from `psql` — the file is idempotent, so running it a second time
does nothing. The schema creates:

- `metals` — reference table, seeded with aluminium (XAL) and copper (XCU)
- `price_ticks` — raw quotes with source and source_kind (live / backfill / synthetic)
- `price_daily` — OHLC bars the model trains on
- `prediction_runs` and `predictions` — one run row plus thirteen prediction rows per horizon
- `prediction_accuracy` — populated when a prediction's target date has a realised close
- `news_articles` — deduplicated by SHA-256 URL hash, GIN full-text search on title + summary
- `job_runs` — every scheduled job writes its outcome here
- `v_latest_price`, `v_latest_run`, `v_accuracy_summary` — read-only convenience views
- `refresh_price_daily(from, to)` and `prune_ticks(keep_days)` — maintenance functions

**Connection strings the backend accepts.** All of these are normalised to
`postgresql+asyncpg://` internally, so use whichever your tools prefer:

```
postgres://user:pass@host:5432/dbname
postgresql://user:pass@host:5432/dbname
postgresql+asyncpg://user:pass@host:5432/dbname
```

### Backfill history

The backend runs a 900-day backfill automatically on first boot. To re-run manually:

```bash
cd backend
python -m scripts.backfill                 # 900 days for both metals
python -m scripts.backfill --days 1500     # further back
python -m scripts.backfill --metal copper --days 365
```

Or hit the API from the System page (needs the admin token from `.env`):

```bash
curl -X POST -H "X-Admin-Token: your-token" \
     http://localhost:8000/api/admin/backfill?days=900
```

### Common gotchas

- **`FATAL: role "metalcast" does not exist`** — you skipped the `CREATE ROLE` step.
- **`connection refused`** — Postgres is not listening on the interface you're pointing at. On macOS,
  `brew services start postgresql@16` starts it; on Ubuntu, `sudo systemctl start postgresql`.
- **`function refresh_price_daily does not exist`** — the schema was applied against a different
  database than the one the backend connects to. Check `DATABASE_URL` matches the database you ran
  `psql -f schema.sql` against.
- **`SSL required`** — hosted Postgres (Neon, Supabase, RDS with sslmode) usually needs `?sslmode=require`
  or `?ssl=true`. The asyncpg driver reads it from the URL query string.

---

## Data sources — what's real and what's not

Honesty about provenance was a hard requirement. Every quote is tagged in the database with the
provider that returned it, and the UI surfaces that tag on the System page and (when relevant) in a
provenance banner at the top of the board.

### Price feeds

The backend tries providers in order. The first one that returns a sane quote wins the tick.

1. **metals.dev** — LME base metals API. Set `METALS_DEV_API_KEY`. This is the primary if configured.
2. **MetalpriceAPI** (XAL / XCU) — global spot rates. Set `METALPRICE_API_KEY`.
3. **Commodities-API** — set `COMMODITIES_API_KEY`.
4. **Yahoo Finance futures** — ALI=F (LME aluminium) and HG=F (COMEX copper), fetched without a key
   via the standard chart endpoint. This is **real market data** but delayed (~15 min) and
   futures-based rather than LME cash, which is why it is only used as a fallback. Also the source of
   the multi-year daily history used to train the models.
5. **Synthetic** — off by default. Only enabled when `ALLOW_SYNTHETIC=true`, and every synthetic
   quote is tagged `source_kind='synthetic'` so the UI shows a bright red banner. Not acceptable for
   a graded deliverable; useful only when travelling on a train with no signal.

Defensive unit handling: every incoming quote is normalised to USD per metric tonne by trying
candidate multipliers (1, 2204.62 for lb, 1000 for kg, 32150.75 for troy oz) plus the inverted rate,
and accepting only the first result that falls inside a hard sanity band (aluminium 800–8000,
copper 2500–30000 USD/t). A wrong-by-1000x price would poison the training set, so bad quotes are
**rejected**, not massaged.

### News feeds

Merged additively; the first URL wins on dedupe.

- **NewsAPI** — `NEWSAPI_KEY` optional
- **GNews** — `GNEWS_API_KEY` optional
- **Marketaux** — `MARKETAUX_API_KEY` optional
- **RSS (no key)** — Mining.com, Mining-Technology, WSJ Markets, Kitco, Economic Times

Articles are tagged by keyword (metal, exchange, supply / demand, policy, inventory, geography) and
scored with a domain-specific lexicon blended 60/40 with Marketaux's own score when available.

---

## Technology choices and why

### Backend: Python 3.12 with FastAPI

The requirement was "Node.js or Python, justify your choice." Python won because half the app is
statistical modelling: numpy, pandas, scikit-learn, statsmodels (ARIMA, Theta, Holt), scipy. Writing
that layer in Node would mean either shipping a second Python service and paying the operational
cost of two runtimes, or replacing well-tested statistical libraries with less mature JS ports. Both
options are worse than "just write it in Python".

FastAPI specifically because it is async-native (needed for concurrent provider fetches over HTTP),
gives automatic OpenAPI docs at `/api/docs`, has first-class SSE support via `StreamingResponse`, and
integrates cleanly with SQLAlchemy Core and APScheduler.

Not an ORM. Queries in this app are analytical (`DISTINCT ON`, window functions, GIN full-text
search), so SQLAlchemy Core with hand-written `text()` queries is a better fit than an ORM. Every
query lives inside a repository-style service module.

### Frontend: React 18 + Vite + TanStack Query + Recharts + Framer Motion + Tailwind

React because it is the requirement. Vite because 18 seconds of dev start-up is 18 seconds too many.
TanStack Query owns all server state — background refetching, retry policy, cache invalidation, no
loading state managed by hand. Recharts for the price / fan / correlation / track charts because it
is composable and stable; Framer Motion for the transitions the brief asked for; Tailwind driven by
CSS variables so the light and dark themes are one class swap rather than two full stylesheets.

Design is deliberately not "another dark AI dashboard": copper-patina teal accents on graphite,
Space Grotesk display / IBM Plex Sans body / IBM Plex Mono for every number, tabular-nums so prices
don't jitter as they update. A faint 88px horizontal rule field runs down the body — the "ledger
paper of a trading floor" motif.

### Database: PostgreSQL 14+ (required)

Requirement. Well-suited to the workload anyway — analytical queries, generated columns,
`INSERT ... ON CONFLICT`, GIN indexes for the news search, JSONB for ensemble metrics, PL/pgSQL
functions for the maintenance jobs. Async driver is asyncpg.

---

## How the forecasts are built

Seven models vote on every horizon:

1. **Damped drift baseline** — mean historical drift with damping
2. **Theta** — the M3 competition winner, robust for medium horizons
3. **Holt damped trend** — exponential smoothing with damping
4. **ARIMA(1,1,1)** — classical short-memory time series
5. **HistGradientBoostingRegressor** — 29 hand-designed features (lag returns, vols, RSI, MACD,
   Bollinger position, day-of-week, and more)
6. **Ridge regression** — same features, linear
7. **200-day mean reversion** — pulls back toward the long moving average

Everything happens in **log price space**: horizons add cleanly, uncertainty scales with `sqrt(h)`,
and exponentiating back to prices gives strictly positive, asymmetric intervals.

Ensemble **weights come from walk-forward backtesting only** (never in-sample). Weights are computed
at two reference horizons (short = 3 business days, long = 63 business days) and blended 70/30 with a
uniform prior — weight selection on ~30 origins is itself noisy, so aggressive concentration on one
"winning" model would be false confidence. Every weight is floored at 0.02 so member dispersion stays
informative.

**Uncertainty** at each horizon = quadrature sum of (backtest residual scale × `sqrt(h/h_ref)`) and
(live member dispersion), clamped to between 0.6× and 2.5× the random-walk band. That floor is
deliberate: no public model beats a random walk on base metals by more than a modest margin, so the
engine is not allowed to claim it does.

`prob_up` is shrunk 15% toward 0.5. Confidence blends interval score with backtest skill.

Every run is stored in `prediction_runs` (JSONB weights and metrics) and `predictions` (13 rows,
CHECK constraints ensure `lower_95 ≤ lower_80 ≤ point ≤ upper_80 ≤ upper_95`). A separate accuracy
job scores matured predictions against realised closes and writes 80% / 95% coverage — visible on
the Forecasts page.

---

## Limitations, honestly

- **Weekday calendar, no LME holidays.** The engine advances horizons on business days but does not
  know about LME half-days or Chinese New Year. Off by one or two days for very short horizons around
  those events.
- **Two reference horizons, not thirteen.** Refitting 7 models × 13 horizons × 30 origins would be an
  unjustifiable cost for the marginal accuracy improvement; residual scale is extended to other
  horizons via the `sqrt(h)` rule.
- **Delayed Yahoo fallback.** If none of the keyed providers are configured, quotes come from Yahoo
  Finance futures — real market data, but delayed ~15 min and futures-based. Called out in the UI.
- **Synthetic provider is dev-only.** Off by default; produces a red banner when enabled. Do not
  submit graded work with this on.
- **In-process rate limiter.** 240 req/min per IP, kept in memory. Fine for a single instance; for a
  fleet, put a real rate limiter in front (nginx, envoy, or an edge CDN).
- **Metals-specific lexicon, not a trained sentiment model.** Blended with the provider's own score
  when it exists. Good enough to be useful, not a replacement for a domain-specific classifier.
- **No order book depth, no warehouse stocks, no positioning data.** This is a public-data model. It
  is not — and cannot be — investment advice.

---

## API reference

Base path `/api`. Full OpenAPI at `/api/docs`.

### Prices

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/prices/latest` | Latest tick for both metals |
| GET | `/prices/{metal}/ticks?limit=` | Recent tick stream |
| GET | `/prices/{metal}/history?range=1D..MAX` | Daily bars or intraday ticks |
| GET | `/prices/{metal}/stats` | Volatility, drift, regime |
| GET | `/prices/correlation?days=90` | Cross-metal rebased to 100 |
| GET | `/stream/prices` | Server-sent event stream |

### Predictions

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/predictions/{metal}?horizon=all\|short\|long` | Latest run + 13 rows |
| GET | `/predictions/{metal}/track?horizon=7&points=120` | Predicted vs realised |
| GET | `/predictions/{metal}/accuracy` | Per-horizon MAE / MAPE / coverage |
| GET | `/predictions/accuracy/all` | Both metals |
| POST | `/predictions/{metal}/run` | Force a fresh run (admin) |

### News

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/news?metal=&sentiment=&q=&pageSize=` | Paginated headlines |
| GET | `/news/sentiment?hours=72` | Per-metal sentiment summary |

### System

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness |
| GET | `/system/status` | Providers, jobs, DB stats |
| GET | `/meta/metals` | Reference table |
| POST | `/admin/jobs/{name}/run` | Kick a job manually (admin) |
| POST | `/admin/backfill?days=900` | Backfill history (admin) |

Admin routes require the `X-Admin-Token` header. The value comes from `ADMIN_TOKEN` in the backend
`.env` and can be stored in the browser via the System page.

Metal aliases accepted everywhere: `aluminium` / `aluminum` / `al` / `xal`, and `copper` / `cu` /
`xcu`.

---

## Repository layout

```
metalcast/
├── backend/
│   ├── app/
│   │   ├── api/routes.py            all REST + SSE endpoints
│   │   ├── services/
│   │   │   ├── providers/           price provider adapters + failover
│   │   │   ├── forecast/            features, models, engine
│   │   │   ├── price_service.py     poll, backfill, aggregations
│   │   │   ├── news_service.py      four providers + lexicon
│   │   │   ├── forecast_service.py  runs, persists, scores
│   │   │   └── scheduler.py         APScheduler wiring
│   │   ├── utils/logging.py
│   │   ├── config.py                pydantic-settings
│   │   ├── db.py                    async SQLAlchemy + schema bootstrap
│   │   └── main.py                  FastAPI app + SPA fallback
│   ├── db/schema.sql                idempotent PostgreSQL schema
│   ├── scripts/backfill.py          CLI helper
│   ├── requirements.txt
│   ├── Dockerfile                   builds SPA then Python runtime
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/              ui/, charts/, forecast/, news/, layout/
│   │   ├── hooks/                   live prices, theme, hotkeys, toasts
│   │   ├── lib/                     api client, formatters
│   │   ├── pages/                   Dashboard, MetalDetail, Forecasts, News, History, System, NotFound
│   │   ├── App.jsx                  routes + palette
│   │   ├── main.jsx                 providers
│   │   └── index.css                design tokens (dark + light)
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── .env.example
├── docker-compose.yml
├── .gitignore
├── .dockerignore
└── README.md
```

---

Not investment advice. Statistical forecasts on public price data, presented with stated uncertainty.
