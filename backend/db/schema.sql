-- ============================================================================
--  MetalCast — PostgreSQL schema
--  Target: PostgreSQL 14+   (tested on 14, 15, 16)
--  Idempotent: safe to run repeatedly.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- 1. Reference data
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS metals (
    id            SERIAL PRIMARY KEY,
    code          TEXT NOT NULL UNIQUE,              -- 'aluminium' | 'copper'
    symbol        TEXT NOT NULL,                     -- 'XAL' | 'XCU'
    display_name  TEXT NOT NULL,
    exchange      TEXT NOT NULL DEFAULT 'LME',
    currency      CHAR(3) NOT NULL DEFAULT 'USD',
    unit          TEXT NOT NULL DEFAULT 'tonne',
    hex_color     TEXT NOT NULL DEFAULT '#8FA8C8',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO metals (code, symbol, display_name, exchange, unit, hex_color) VALUES
    ('aluminium', 'XAL', 'Aluminium', 'LME', 'tonne', '#8FA8C8'),
    ('copper',    'XCU', 'Copper',    'LME', 'tonne', '#C1743A')
ON CONFLICT (code) DO UPDATE
    SET symbol = EXCLUDED.symbol,
        display_name = EXCLUDED.display_name,
        hex_color = EXCLUDED.hex_color;

-- ---------------------------------------------------------------------------
-- 2. Raw ticks (near-real-time polls)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_ticks (
    id            BIGSERIAL PRIMARY KEY,
    metal_id      INTEGER NOT NULL REFERENCES metals(id) ON DELETE CASCADE,
    ts            TIMESTAMPTZ NOT NULL,
    price         NUMERIC(18,6) NOT NULL CHECK (price > 0),
    currency      CHAR(3) NOT NULL DEFAULT 'USD',
    unit          TEXT NOT NULL DEFAULT 'tonne',
    source        TEXT NOT NULL,                     -- provider id
    source_kind   TEXT NOT NULL DEFAULT 'live',      -- live | backfill | synthetic
    latency_ms    INTEGER,
    raw           JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT price_ticks_unique_point UNIQUE (metal_id, ts, source)
);

CREATE INDEX IF NOT EXISTS idx_ticks_metal_ts      ON price_ticks (metal_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_ticks_ts            ON price_ticks (ts DESC);
CREATE INDEX IF NOT EXISTS idx_ticks_source        ON price_ticks (source);

-- ---------------------------------------------------------------------------
-- 3. Daily OHLC roll-up (the model training surface)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_daily (
    metal_id      INTEGER NOT NULL REFERENCES metals(id) ON DELETE CASCADE,
    trade_date    DATE NOT NULL,
    open          NUMERIC(18,6) NOT NULL,
    high          NUMERIC(18,6) NOT NULL,
    low           NUMERIC(18,6) NOT NULL,
    close         NUMERIC(18,6) NOT NULL,
    avg_price     NUMERIC(18,6) NOT NULL,
    volume        NUMERIC(20,4),
    sample_count  INTEGER NOT NULL DEFAULT 1,
    source        TEXT NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (metal_id, trade_date),
    CONSTRAINT price_daily_sane CHECK (high >= low AND close > 0)
);

CREATE INDEX IF NOT EXISTS idx_daily_date ON price_daily (trade_date DESC);

-- ---------------------------------------------------------------------------
-- 4. Forecast runs + individual horizon predictions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prediction_runs (
    id             BIGSERIAL PRIMARY KEY,
    run_uid        UUID NOT NULL DEFAULT gen_random_uuid(),
    metal_id       INTEGER NOT NULL REFERENCES metals(id) ON DELETE CASCADE,
    run_ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
    model_version  TEXT NOT NULL,
    anchor_price   NUMERIC(18,6) NOT NULL,
    anchor_date    DATE NOT NULL,
    history_points INTEGER NOT NULL DEFAULT 0,
    ensemble       JSONB NOT NULL DEFAULT '{}'::jsonb,   -- member weights
    metrics        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- walk-forward backtest
    diagnostics    JSONB NOT NULL DEFAULT '{}'::jsonb,   -- vol, trend, regime
    duration_ms    INTEGER,
    status         TEXT NOT NULL DEFAULT 'ok',           -- ok | degraded | failed
    error          TEXT,
    UNIQUE (run_uid)
);

CREATE INDEX IF NOT EXISTS idx_runs_metal_ts ON prediction_runs (metal_id, run_ts DESC);

CREATE TABLE IF NOT EXISTS predictions (
    id              BIGSERIAL PRIMARY KEY,
    run_id          BIGINT NOT NULL REFERENCES prediction_runs(id) ON DELETE CASCADE,
    metal_id        INTEGER NOT NULL REFERENCES metals(id) ON DELETE CASCADE,
    horizon_type    TEXT NOT NULL CHECK (horizon_type IN ('short','long')),
    horizon_label   TEXT NOT NULL,                  -- '1D' .. '7D', '1M' .. '6M'
    horizon_days    INTEGER NOT NULL CHECK (horizon_days > 0),
    target_date     DATE NOT NULL,
    point_price     NUMERIC(18,6) NOT NULL,
    lower_80        NUMERIC(18,6) NOT NULL,
    upper_80        NUMERIC(18,6) NOT NULL,
    lower_95        NUMERIC(18,6) NOT NULL,
    upper_95        NUMERIC(18,6) NOT NULL,
    sigma_log       NUMERIC(18,8) NOT NULL,
    prob_up         NUMERIC(6,5) NOT NULL CHECK (prob_up BETWEEN 0 AND 1),
    expected_return NUMERIC(12,8) NOT NULL,
    direction       TEXT NOT NULL CHECK (direction IN ('up','down','flat')),
    confidence      NUMERIC(6,5) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT predictions_unique_horizon UNIQUE (run_id, horizon_days),
    CONSTRAINT predictions_band_order CHECK (lower_95 <= lower_80 AND upper_80 <= upper_95)
);

CREATE INDEX IF NOT EXISTS idx_pred_metal_target ON predictions (metal_id, target_date);
CREATE INDEX IF NOT EXISTS idx_pred_run          ON predictions (run_id);
CREATE INDEX IF NOT EXISTS idx_pred_type         ON predictions (metal_id, horizon_type, created_at DESC);

-- ---------------------------------------------------------------------------
-- 5. Realised accuracy (scored once the target date passes)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prediction_accuracy (
    id                BIGSERIAL PRIMARY KEY,
    prediction_id     BIGINT NOT NULL UNIQUE REFERENCES predictions(id) ON DELETE CASCADE,
    metal_id          INTEGER NOT NULL REFERENCES metals(id) ON DELETE CASCADE,
    horizon_days      INTEGER NOT NULL,
    actual_price      NUMERIC(18,6) NOT NULL,
    predicted_price   NUMERIC(18,6) NOT NULL,
    abs_error         NUMERIC(18,6) NOT NULL,
    pct_error         NUMERIC(12,6) NOT NULL,
    direction_correct BOOLEAN NOT NULL,
    within_80         BOOLEAN NOT NULL,
    within_95         BOOLEAN NOT NULL,
    evaluated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_acc_metal ON prediction_accuracy (metal_id, horizon_days);

-- ---------------------------------------------------------------------------
-- 6. News
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS news_articles (
    id              BIGSERIAL PRIMARY KEY,
    url_hash        CHAR(64) NOT NULL UNIQUE,      -- sha256(normalised url)
    url             TEXT NOT NULL,
    title           TEXT NOT NULL,
    summary         TEXT,
    content_snippet TEXT,
    source_name     TEXT NOT NULL,
    author          TEXT,
    published_at    TIMESTAMPTZ NOT NULL,
    image_url       TEXT,
    provider        TEXT NOT NULL,                 -- newsapi | gnews | marketaux | rss:<host>
    language        TEXT NOT NULL DEFAULT 'en',
    sentiment       NUMERIC(6,4),                  -- -1..1
    sentiment_label TEXT,                          -- bullish | bearish | neutral
    relevance       NUMERIC(6,4) NOT NULL DEFAULT 0,
    metals          TEXT[] NOT NULL DEFAULT '{}',  -- tagged metal codes
    tags            TEXT[] NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_news_published ON news_articles (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_metals    ON news_articles USING GIN (metals);
CREATE INDEX IF NOT EXISTS idx_news_tags      ON news_articles USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_news_search    ON news_articles
    USING GIN (to_tsvector('english', title || ' ' || coalesce(summary,'')));

-- ---------------------------------------------------------------------------
-- 7. Operational log for every background job
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_runs (
    id           BIGSERIAL PRIMARY KEY,
    job_name     TEXT NOT NULL,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ,
    duration_ms  INTEGER,
    status       TEXT NOT NULL DEFAULT 'running',  -- running | ok | partial | failed
    records      INTEGER NOT NULL DEFAULT 0,
    detail       JSONB NOT NULL DEFAULT '{}'::jsonb,
    message      TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_name_started ON job_runs (job_name, started_at DESC);

CREATE OR REPLACE VIEW v_latest_price AS
SELECT DISTINCT ON (t.metal_id)
       t.metal_id,
       m.code,
       m.display_name,
       m.unit,
       m.currency,
       m.hex_color,
       t.ts,
       t.price,
       t.source,
       t.source_kind
FROM price_ticks t
JOIN metals m ON m.id = t.metal_id
ORDER BY t.metal_id, t.ts DESC;

CREATE OR REPLACE VIEW v_latest_run AS
SELECT DISTINCT ON (metal_id) *
FROM prediction_runs
WHERE status <> 'failed'
ORDER BY metal_id, run_ts DESC;

CREATE OR REPLACE VIEW v_accuracy_summary AS
SELECT a.metal_id,
       m.code,
       a.horizon_days,
       count(*)                                             AS n,
       round(avg(a.abs_error), 2)                            AS mae,
       round(avg(abs(a.pct_error)), 4)                       AS mape,
       round(sqrt(avg(power(a.abs_error, 2))), 2)             AS rmse,
       round(avg(CASE WHEN a.direction_correct THEN 1 ELSE 0 END), 4) AS hit_rate,
       round(avg(CASE WHEN a.within_80 THEN 1 ELSE 0 END), 4) AS coverage_80,
       round(avg(CASE WHEN a.within_95 THEN 1 ELSE 0 END), 4) AS coverage_95
FROM prediction_accuracy a
JOIN metals m ON m.id = a.metal_id
GROUP BY a.metal_id, m.code, a.horizon_days;

-- ---------------------------------------------------------------------------
-- 9. Roll-up function: rebuild price_daily from ticks for a date window
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_price_daily(p_from DATE, p_to DATE)
RETURNS INTEGER AS $$
DECLARE
    affected INTEGER;
BEGIN
    WITH agg AS (
        SELECT metal_id,
               (ts AT TIME ZONE 'UTC')::date AS trade_date,
               (array_agg(price ORDER BY ts ASC))[1]  AS o,
               max(price)                             AS h,
               min(price)                             AS l,
               (array_agg(price ORDER BY ts DESC))[1] AS c,
               avg(price)                             AS a,
               count(*)                               AS n,
               (array_agg(source ORDER BY ts DESC))[1] AS src
        FROM price_ticks
        WHERE (ts AT TIME ZONE 'UTC')::date BETWEEN p_from AND p_to
        GROUP BY metal_id, (ts AT TIME ZONE 'UTC')::date
    )
    INSERT INTO price_daily (metal_id, trade_date, open, high, low, close,
                             avg_price, sample_count, source, updated_at)
    SELECT metal_id, trade_date, o, h, l, c, a, n, src, now() FROM agg
    ON CONFLICT (metal_id, trade_date) DO UPDATE SET
        high         = GREATEST(price_daily.high, EXCLUDED.high),
        low          = LEAST(price_daily.low, EXCLUDED.low),
        close        = EXCLUDED.close,
        avg_price    = EXCLUDED.avg_price,
        sample_count = EXCLUDED.sample_count,
        updated_at   = now();

    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 10. Retention helper (keep tick table bounded on small instances)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prune_ticks(p_keep_days INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    removed INTEGER;
BEGIN
    DELETE FROM price_ticks
    WHERE ts < now() - (p_keep_days || ' days')::interval
      AND source_kind = 'live';
    GET DIAGNOSTICS removed = ROW_COUNT;
    RETURN removed;
END;
$$ LANGUAGE plpgsql;

COMMIT;
