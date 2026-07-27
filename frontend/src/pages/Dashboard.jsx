import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueries, useQuery } from '@tanstack/react-query'
import { ArrowRight, Gauge, Newspaper, RefreshCw, Scale, Sigma } from 'lucide-react'
import { api } from '../lib/api'
import { metalColor, money, pct, probability, relativeTime } from '../lib/format'
import { Panel } from '../components/ui/Panel'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Segmented } from '../components/ui/Segmented'
import { StatTile } from '../components/ui/StatTile'
import { SkeletonChart, SkeletonText } from '../components/ui/Skeleton'
import { Empty } from '../components/ui/Empty'
import { ProbabilityMeter } from '../components/ui/Meter'
import { PriceTapeCard, PriceTapeSkeleton } from '../components/PriceTape'
import { HorizonStrip } from '../components/forecast/HorizonStrip'
import { ForecastFan } from '../components/charts/ForecastFan'
import { CorrelationChart } from '../components/charts/CorrelationChart'
import { NewsCard, NewsCardSkeleton } from '../components/news/NewsCard'
import { SentimentSummary } from '../components/news/SentimentSummary'
import { DataNotice } from '../components/DataNotice'

const METALS = ['aluminium', 'copper']

export default function Dashboard({ live }) {
  const [focus, setFocus] = useState('copper')
  const [horizon, setHorizon] = useState(7)

  const sparkQueries = useQueries({
    queries: METALS.map((m) => ({
      queryKey: ['history', m, '1M'],
      queryFn: () => api.history(m, '1M'),
      staleTime: 5 * 60 * 1000,
    })),
  })

  const predictionQueries = useQueries({
    queries: METALS.map((m) => ({
      queryKey: ['predictions', m, 'all'],
      queryFn: () => api.predictions(m, 'all'),
      staleTime: 5 * 60 * 1000,
    })),
  })

  const focusHistory = useQuery({
    queryKey: ['history', focus, '6M'],
    queryFn: () => api.history(focus, '6M'),
    staleTime: 5 * 60 * 1000,
  })

  const correlation = useQuery({
    queryKey: ['correlation', 90],
    queryFn: () => api.correlation(90),
    staleTime: 10 * 60 * 1000,
  })

  const news = useQuery({
    queryKey: ['news', { pageSize: 6 }],
    queryFn: () => api.news({ pageSize: 6 }),
    staleTime: 3 * 60 * 1000,
  })

  const sentiment = useQuery({
    queryKey: ['newsSentiment', 72],
    queryFn: () => api.newsSentiment(72),
    staleTime: 5 * 60 * 1000,
  })

  const sparkMap = useMemo(() => {
    const out = {}
    METALS.forEach((m, i) => {
      out[m] = sparkQueries[i]?.data?.series ?? []
    })
    return out
  }, [sparkQueries])

  const focusIndex = METALS.indexOf(focus)
  const focusPrediction = predictionQueries[focusIndex]?.data
  const focusPredictionLoading = predictionQueries[focusIndex]?.isLoading
  const predictions = focusPrediction?.available ? focusPrediction.predictions : []
  const selected = predictions.find((p) => p.horizon_days === horizon) || predictions[0]

  const consensus = useMemo(() => {
    const rows = []
    METALS.forEach((m, i) => {
      const data = predictionQueries[i]?.data
      if (!data?.available) return
      const week = data.predictions.find((p) => p.horizon_days === 7)
      const quarter = data.predictions.find((p) => p.horizon_days === 63)
      rows.push({ metal: m, week, quarter, anchor: data.anchor_price, runTs: data.run_ts })
    })
    return rows
  }, [predictionQueries])

  return (
    <div className="space-y-4 sm:space-y-5">
      <DataNotice prices={live.prices} />

      {/* ============ HERO: the quote board ============ */}
      <section>
        <div className="mb-2.5 flex items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
              The board
            </h1>
            <p className="mt-0.5 text-[12.5px] text-muted">
              Cash prices for the two metals, the week's range, and where the ensemble thinks they go
              next.
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            icon={RefreshCw}
            onClick={() => live.refetch()}
            className="shrink-0"
          >
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>

        <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
          {live.isLoading && live.prices.length === 0 ? (
            <>
              <PriceTapeSkeleton />
              <PriceTapeSkeleton />
            </>
          ) : live.prices.length === 0 ? (
            <div className="lg:col-span-2">
              <Panel>
                <Empty
                  icon={Gauge}
                  title="No prices recorded yet"
                  hint="The backend polls on a schedule; the first tick usually lands within a minute of startup. If it doesn't, a provider key is probably missing."
                  action="Check feeds and jobs"
                  onAction={() => {
                    window.location.href = '/system'
                  }}
                />
              </Panel>
            </div>
          ) : (
            live.prices.map((quote, i) => (
              <PriceTapeCard
                key={quote.metal}
                quote={quote}
                spark={sparkMap[quote.metal]}
                flash={live.flash[quote.metal]}
                streamState={live.streamState}
                index={i}
              />
            ))
          )}
        </div>
      </section>

      {/* ============ Forecast: strip + fan ============ */}
      <Panel
        eyebrow="Ensemble forecast · log-space, uncertainty included"
        title="Term structure of expected movement"
        subtitle={
          focusPrediction?.available
            ? `${focusPrediction.model_version} · anchored on the ${focusPrediction.anchor_date} close of ${money(focusPrediction.anchor_price)} · run ${relativeTime(focusPrediction.run_ts)}`
            : 'Waiting for the first forecast run'
        }
        actions={
          <Segmented
            layoutId="dash-focus"
            options={METALS.map((m) => ({ value: m, label: m === 'aluminium' ? 'AL' : 'CU' }))}
            value={focus}
            onChange={setFocus}
          />
        }
        bodyClassName="space-y-5"
        delay={0.05}
      >
        {focusPredictionLoading ? (
          <SkeletonChart height={120} />
        ) : (
          <HorizonStrip
            predictions={predictions}
            selected={selected?.horizon_days}
            onSelect={setHorizon}
            anchorPrice={focusPrediction?.anchor_price}
          />
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="min-w-0">
            {focusHistory.isLoading ? (
              <SkeletonChart height={320} />
            ) : (
              <ForecastFan
                history={focusHistory.data?.series ?? []}
                predictions={predictions}
                anchorPrice={focusPrediction?.anchor_price}
                anchorDate={focusPrediction?.anchor_date}
                color={metalColor(focus)}
                highlightHorizon={selected?.horizon_days}
                historyTail={90}
                height={320}
              />
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-4" style={{ background: 'var(--c-ink)' }} /> realised close
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="h-0.5 w-4"
                  style={{
                    background: `repeating-linear-gradient(90deg, ${metalColor(focus)} 0 4px, transparent 4px 7px)`,
                  }}
                />
                central path
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-4 rounded-sm"
                  style={{ background: metalColor(focus), opacity: 0.24 }}
                />
                80% interval
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-4 rounded-sm"
                  style={{ background: metalColor(focus), opacity: 0.1 }}
                />
                95% interval
              </span>
            </div>
          </div>

          {/* selected horizon readout */}
          <aside className="min-w-0 space-y-4 rounded-xl border border-line bg-raised p-4">
            {selected ? (
              <>
                <div>
                  <div className="eyebrow">Selected horizon</div>
                  <div className="mt-0.5 flex items-baseline gap-2">
                    <span className="font-display text-lg font-semibold text-ink">
                      {selected.horizon_label}
                    </span>
                    <span className="text-[11px] text-faint">
                      target {selected.target_date}
                    </span>
                  </div>
                </div>

                <div>
                  <div className="tnum text-2xl font-medium text-ink">
                    {money(selected.point_price)}
                  </div>
                  <div
                    className="tnum mt-0.5 text-[12.5px]"
                    style={{
                      color:
                        selected.expected_return > 0
                          ? 'var(--c-up)'
                          : selected.expected_return < 0
                            ? 'var(--c-down)'
                            : 'var(--c-muted)',
                    }}
                  >
                    {pct(selected.expected_return * 100)} expected
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between">
                    <span className="eyebrow">P(higher)</span>
                    <span className="tnum text-[13px] text-ink">{probability(selected.prob_up)}</span>
                  </div>
                  <ProbabilityMeter value={selected.prob_up} />
                </div>

                <dl className="space-y-1.5 border-t border-line pt-3 text-[11.5px]">
                  <div className="flex justify-between gap-2">
                    <dt className="text-faint">80% interval</dt>
                    <dd className="tnum text-muted">
                      {money(selected.lower_80, { decimals: 0 })}–{money(selected.upper_80, { decimals: 0 })}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-faint">95% interval</dt>
                    <dd className="tnum text-muted">
                      {money(selected.lower_95, { decimals: 0 })}–{money(selected.upper_95, { decimals: 0 })}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-faint">Confidence</dt>
                    <dd className="tnum text-muted">{probability(selected.confidence)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-faint">Direction call</dt>
                    <dd>
                      <Badge
                        tone={
                          selected.direction === 'up'
                            ? 'up'
                            : selected.direction === 'down'
                              ? 'down'
                              : 'neutral'
                        }
                      >
                        {selected.direction}
                      </Badge>
                    </dd>
                  </div>
                </dl>

                <Link
                  to="/forecasts"
                  className="flex items-center justify-between rounded-lg border border-line px-2.5 py-1.5 text-[11.5px] text-muted transition-colors hover:border-patina hover:text-ink"
                >
                  Ensemble weights &amp; skill <ArrowRight size={12} />
                </Link>
              </>
            ) : (
              <Empty
                icon={Sigma}
                title="No forecast yet"
                hint="A run needs at least 90 stored daily bars. Trigger a backfill from the System page."
              />
            )}
          </aside>
        </div>
      </Panel>

      {/* ============ Consensus + correlation ============ */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          eyebrow="Side by side"
          title="One-week and one-quarter view"
          delay={0.1}
          bodyClassName="space-y-4"
        >
          {predictionQueries.some(q => q.isLoading) ? (
            <SkeletonText lines={4} />
          ) : consensus.length === 0 ? (
            <Empty
              icon={Sigma}
              title="No forecasts available"
              hint="Run a backfill from the System page to populate daily history, then forecasts will generate automatically."
            />
          ) : (
            consensus.map((row) => (
              <div key={row.metal} className="rounded-xl border border-line bg-raised p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-sm"
                      style={{ background: metalColor(row.metal) }}
                    />
                    <Link
                      to={`/metal/${row.metal}`}
                      className="font-display text-[14px] font-semibold capitalize text-ink transition-colors hover:text-patina"
                    >
                      {row.metal}
                    </Link>
                  </span>
                  <span className="tnum text-[11px] text-faint">
                    anchor {money(row.anchor, { decimals: 0 })}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {[
                    { label: '7 days', p: row.week },
                    { label: '3 months', p: row.quarter },
                  ].map(({ label, p }) => (
                    <div key={label} className="rounded-lg border border-line bg-panel p-2.5">
                      <div className="eyebrow">{label}</div>
                      <div className="tnum mt-1 text-[15px] text-ink">
                        {p ? money(p.point_price, { decimals: 0 }) : '—'}
                      </div>
                      <div
                        className="tnum text-[11px]"
                        style={{
                          color: !p
                            ? 'var(--c-muted)'
                            : p.expected_return > 0
                              ? 'var(--c-up)'
                              : p.expected_return < 0
                                ? 'var(--c-down)'
                                : 'var(--c-muted)',
                        }}
                      >
                        {p ? pct(p.expected_return * 100) : '—'}
                      </div>
                      {p && <ProbabilityMeter value={p.prob_up} height={4} showTicks={false} className="mt-2" />}
                      {p && (
                        <div className="tnum mt-1 text-[10px] text-faint">
                          P(up) {probability(p.prob_up)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </Panel>

        <Panel
          eyebrow="Co-movement · rebased to 100"
          title="Aluminium against copper"
          subtitle={
            correlation.data?.correlation !== null && correlation.data?.correlation !== undefined
              ? `90-day return correlation ${correlation.data.correlation.toFixed(2)} · ${correlation.data.points} overlapping sessions`
              : 'Needs overlapping daily history for both metals'
          }
          actions={<Badge tone="patina" icon={Scale}>90d</Badge>}
          delay={0.15}
        >
          {correlation.isLoading ? (
            <SkeletonChart height={250} />
          ) : (
            <CorrelationChart series={correlation.data?.series ?? []} height={250} />
          )}
        </Panel>
      </div>

      {/* ============ News ============ */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel
          eyebrow="Metals coverage · deduplicated across providers"
          title="Latest headlines"
          actions={
            <Link
              to="/news"
              className="flex items-center gap-1 rounded-md border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-faint transition-colors hover:border-patina hover:text-patina"
            >
              All news <ArrowRight size={11} />
            </Link>
          }
          bodyClassName="p-0"
          delay={0.2}
        >
          {news.isLoading ? (
            <>
              <NewsCardSkeleton />
              <NewsCardSkeleton />
              <NewsCardSkeleton />
            </>
          ) : news.data?.articles?.length ? (
            news.data.articles.map((a, i) => <NewsCard key={a.id} article={a} index={i} compact />)
          ) : (
            <Empty
              icon={Newspaper}
              title="No articles stored yet"
              hint="RSS feeds work without an API key, so an empty feed usually means the news job hasn't run yet or outbound HTTP is blocked."
            />
          )}
        </Panel>

        <Panel
          eyebrow="Lexicon sentiment · 72 hours"
          title="How the coverage reads"
          subtitle="Scored against a metals-specific term list, not a generic classifier"
          delay={0.25}
        >
          {sentiment.isLoading ? (
            <SkeletonText lines={5} />
          ) : (
            <>
              <SentimentSummary byMetal={sentiment.data?.by_metal ?? []} />
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3">
                <StatTile
                  label="Articles scored"
                  value={(sentiment.data?.by_metal ?? []).reduce((s, r) => s + r.articles, 0)}
                />
                <StatTile
                  label="Net tone"
                  value={(() => {
                    const rows = sentiment.data?.by_metal ?? []
                    if (!rows.length) return '—'
                    const avg = rows.reduce((s, r) => s + r.avg_sentiment, 0) / rows.length
                    return `${avg >= 0 ? '+' : '−'}${Math.abs(avg).toFixed(2)}`
                  })()}
                  tone={(() => {
                    const rows = sentiment.data?.by_metal ?? []
                    if (!rows.length) return 'default'
                    const avg = rows.reduce((s, r) => s + r.avg_sentiment, 0) / rows.length
                    return avg > 0.05 ? 'up' : avg < -0.05 ? 'down' : 'default'
                  })()}
                />
              </div>
            </>
          )}
        </Panel>
      </div>
    </div>
  )
}
