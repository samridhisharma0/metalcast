import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Download, Newspaper, TrendingUp } from 'lucide-react'
import { api } from '../lib/api'
import {
  dateLabel,
  downloadCsv,
  metalColor,
  money,
  pct,
  probability,
  relativeTime,
  toCsv,
} from '../lib/format'
import { Panel } from '../components/ui/Panel'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Segmented } from '../components/ui/Segmented'
import { StatTile } from '../components/ui/StatTile'
import { SkeletonChart, SkeletonText } from '../components/ui/Skeleton'
import { Empty } from '../components/ui/Empty'
import { ConfidencePips, ProbabilityMeter, WeightsBar } from '../components/ui/Meter'
import { PriceChart } from '../components/charts/PriceChart'
import { ForecastFan } from '../components/charts/ForecastFan'
import { NewsCard, NewsCardSkeleton } from '../components/news/NewsCard'

const RANGES = ['1D', '1W', '1M', '3M', '6M', '1Y', '5Y', 'MAX']
const VALID = new Set(['aluminium', 'copper'])

export default function MetalDetail({ live }) {
  const { code } = useParams()
  const metal = VALID.has(code) ? code : null
  const [range, setRange] = useState('6M')
  const [horizonType, setHorizonType] = useState('short')

  const history = useQuery({
    queryKey: ['history', metal, range],
    queryFn: () => api.history(metal, range),
    enabled: Boolean(metal),
    staleTime: 3 * 60 * 1000,
  })

  const stats = useQuery({
    queryKey: ['priceStats', metal],
    queryFn: () => api.priceStats(metal),
    enabled: Boolean(metal),
    staleTime: 5 * 60 * 1000,
  })

  const prediction = useQuery({
    queryKey: ['predictions', metal, 'all'],
    queryFn: () => api.predictions(metal, 'all'),
    enabled: Boolean(metal),
    staleTime: 5 * 60 * 1000,
  })

  const news = useQuery({
    queryKey: ['news', { metal, pageSize: 8 }],
    queryFn: () => api.news({ metal, pageSize: 8 }),
    enabled: Boolean(metal),
    staleTime: 3 * 60 * 1000,
  })

  const quote = useMemo(
    () => live.prices.find((p) => p.metal === metal),
    [live.prices, metal],
  )

  if (!metal) {
    return (
      <Panel>
        <Empty
          icon={TrendingUp}
          title={`“${code}” is not a metal this system tracks`}
          hint="MetalCast covers LME aluminium and copper. Pick one of those to continue."
          action="Back to the dashboard"
          onAction={() => {
            window.location.href = '/'
          }}
        />
      </Panel>
    )
  }

  const color = metalColor(metal)
  const predictions = prediction.data?.available ? prediction.data.predictions : []
  const shown = predictions.filter((p) => p.horizon_type === horizonType)

  const exportHistory = () => {
    const rows = history.data?.series ?? []
    if (!rows.length) return
    downloadCsv(
      `metalcast-${metal}-${range.toLowerCase()}.csv`,
      toCsv(
        rows.map((r) => ({
          date: r.date ?? r.ts,
          open: r.open ?? '',
          high: r.high ?? '',
          low: r.low ?? '',
          close: r.close,
          source: r.source ?? '',
        })),
        ['date', 'open', 'high', 'low', 'close', 'source'],
      ),
    )
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            to="/"
            className="mb-1.5 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-faint transition-colors hover:text-patina"
          >
            <ArrowLeft size={11} /> Board
          </Link>
          <h1 className="flex items-center gap-2.5 font-display text-2xl font-bold tracking-tight text-ink">
            <span className="h-3 w-3 rounded-sm" style={{ background: color }} />
            <span className="capitalize">{metal}</span>
            <span className="tnum rounded border border-line px-1.5 py-0.5 text-[11px] font-normal text-faint">
              {quote?.symbol || (metal === 'copper' ? 'XCU' : 'XAL')}
            </span>
          </h1>
          <p className="mt-1 text-[12.5px] text-muted">
            {quote?.exchange || 'LME'} cash · {quote?.currency || 'USD'} per {quote?.unit || 'tonne'}
            {quote?.source && (
              <>
                {' '}
                · feed <span className="text-faint">{quote.source}</span> ·{' '}
                {relativeTime(quote.ts)}
              </>
            )}
          </p>
        </div>

        <div className="flex items-end gap-4">
          <div className="text-right">
            <div className="tnum text-3xl font-medium leading-none text-ink">
              {money(quote?.price, { decimals: 2 })}
            </div>
            <div
              className="tnum mt-1 text-[13px]"
              style={{
                color:
                  (quote?.change ?? 0) > 0
                    ? 'var(--c-up)'
                    : (quote?.change ?? 0) < 0
                      ? 'var(--c-down)'
                      : 'var(--c-muted)',
              }}
            >
              {pct(quote?.change_pct)} today
            </div>
          </div>
        </div>
      </div>

      {/* price chart */}
      <Panel
        eyebrow={`Stored ${history.data?.granularity === 'tick' ? 'ticks' : 'daily bars'} · PostgreSQL`}
        title="Price history"
        subtitle={
          history.data?.count
            ? `${history.data.count} points · ${range === 'MAX' ? 'all stored history' : `last ${range}`}`
            : undefined
        }
        actions={
          <div className="flex items-center gap-2">
            <Segmented
              layoutId="detail-range"
              options={RANGES}
              value={range}
              onChange={setRange}
              className="hidden sm:inline-flex"
            />
            <Button size="sm" variant="ghost" icon={Download} onClick={exportHistory} title="Download CSV">
              <span className="hidden md:inline">CSV</span>
            </Button>
          </div>
        }
      >
        <div className="mb-3 sm:hidden">
          <Segmented layoutId="detail-range-m" options={RANGES} value={range} onChange={setRange} />
        </div>
        {history.isLoading ? (
          <SkeletonChart height={320} />
        ) : (
          <PriceChart
            series={history.data?.series ?? []}
            granularity={history.data?.granularity}
            color={color}
            height={320}
            showBrush={range === 'MAX' || range === '5Y' || range === '1Y'}
            referenceValue={quote?.prev_close}
          />
        )}
      </Panel>

      {/* stats */}
      <Panel eyebrow="Realised statistics · computed in Postgres" title="Volatility and position" delay={0.05}>
        {stats.isLoading ? (
          <SkeletonText lines={3} />
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Daily vol (21d)" value={pct((stats.data?.vol_21d ?? 0) * 100, { withSign: false })} />
            <StatTile
              label="Annualised vol"
              value={pct((stats.data?.annualised_vol_21d ?? 0) * 100, { withSign: false })}
              tone="patina"
            />
            <StatTile
              label="21d drift"
              value={pct((stats.data?.drift_21d ?? 0) * 100 * 21, { decimals: 2 })}
              tone={(stats.data?.drift_21d ?? 0) > 0 ? 'up' : (stats.data?.drift_21d ?? 0) < 0 ? 'down' : 'default'}
            />
            <StatTile label="52-week low" value={money(quote?.year_low, { decimals: 0 })} />
            <StatTile label="52-week high" value={money(quote?.year_high, { decimals: 0 })} />
            <StatTile
              label="Stored bars"
              value={stats.data?.bars ?? 0}
              hint={
                stats.data?.first_date
                  ? `${dateLabel(stats.data.first_date, 'MMM yyyy')} → ${dateLabel(stats.data.last_date, 'MMM yyyy')}`
                  : undefined
              }
            />
            <div className="col-span-2 sm:col-span-3 lg:col-span-6">
              <Badge tone={stats.data?.regime === 'elevated volatility' ? 'amber' : 'neutral'}>
                regime: {stats.data?.regime || 'unknown'}
              </Badge>
            </div>
          </div>
        )}
      </Panel>

      {/* forecast */}
      <Panel
        eyebrow={
          prediction.data?.available
            ? `${prediction.data.model_version} · ${prediction.data.history_points} training bars`
            : 'Ensemble forecast'
        }
        title="Forecast detail"
        subtitle={
          prediction.data?.available
            ? `Run ${relativeTime(prediction.data.run_ts)} in ${prediction.data.duration_ms} ms · anchored on ${prediction.data.anchor_date}`
            : undefined
        }
        actions={
          <Segmented
            layoutId="detail-horizon"
            options={[
              { value: 'short', label: '1–7 d' },
              { value: 'long', label: '1–6 m' },
            ]}
            value={horizonType}
            onChange={setHorizonType}
          />
        }
        delay={0.1}
        bodyClassName="space-y-5"
      >
        {prediction.isLoading ? (
          <SkeletonChart height={300} />
        ) : !prediction.data?.available ? (
          <Empty
            icon={TrendingUp}
            title="No forecast run for this metal yet"
            hint={prediction.data?.reason || 'A run needs at least 90 stored daily bars. Backfill history from the System page, then trigger the forecast job.'}
          />
        ) : (
          <>
            <ForecastFan
              history={history.data?.granularity === 'daily' ? history.data.series : []}
              predictions={shown}
              anchorPrice={prediction.data.anchor_price}
              anchorDate={prediction.data.anchor_date}
              color={color}
              height={300}
              historyTail={horizonType === 'short' ? 40 : 140}
            />

            <div className="-mx-4 overflow-x-auto sm:-mx-5">
              <table className="w-full min-w-[46rem] border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-y border-line bg-raised">
                    {['Horizon', 'Target', 'Point', 'Change', '80% interval', '95% interval', 'P(up)', 'Confidence'].map(
                      (h) => (
                        <th
                          key={h}
                          className="eyebrow px-3 py-2 text-left font-medium first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => {
                    const change = (p.point_price / prediction.data.anchor_price - 1) * 100
                    return (
                      <tr key={p.horizon_days} className="border-b border-line transition-colors hover:bg-raised">
                        <td className="px-3 py-2.5 pl-4 sm:pl-5">
                          <span className="tnum font-medium text-ink">{p.horizon_label}</span>
                          <span className="ml-1.5 text-[10.5px] text-faint">{p.horizon_days}b</span>
                        </td>
                        <td className="tnum px-3 py-2.5 text-muted">{dateLabel(p.target_date, 'd MMM yy')}</td>
                        <td className="tnum px-3 py-2.5 font-medium text-ink">{money(p.point_price)}</td>
                        <td
                          className="tnum px-3 py-2.5"
                          style={{
                            color: change > 0 ? 'var(--c-up)' : change < 0 ? 'var(--c-down)' : 'var(--c-muted)',
                          }}
                        >
                          {pct(change)}
                        </td>
                        <td className="tnum px-3 py-2.5 text-muted">
                          {money(p.lower_80, { decimals: 0 })} – {money(p.upper_80, { decimals: 0 })}
                        </td>
                        <td className="tnum px-3 py-2.5 text-faint">
                          {money(p.lower_95, { decimals: 0 })} – {money(p.upper_95, { decimals: 0 })}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="tnum w-8 text-ink">{probability(p.prob_up)}</span>
                            <ProbabilityMeter value={p.prob_up} height={4} showTicks={false} className="w-16" />
                          </div>
                        </td>
                        <td className="px-3 py-2.5 pr-4 sm:pr-5">
                          <ConfidencePips value={p.confidence} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="grid gap-5 border-t border-line pt-4 lg:grid-cols-2">
              <div>
                <div className="eyebrow mb-2">
                  Ensemble weights · {horizonType === 'short' ? 'short horizon' : 'long horizon'}
                </div>
                <WeightsBar
                  weights={prediction.data.weights?.[horizonType] || {}}
                  labels={prediction.data.weights?.labels || {}}
                />
              </div>
              <div>
                <div className="eyebrow mb-2">Walk-forward skill</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                  <StatTile
                    label="Directional hit rate"
                    value={probability(prediction.data.metrics?.ensemble?.[horizonType]?.hit_rate)}
                    hint="Share of backtest origins where the sign was right"
                  />
                  <StatTile
                    label="Typical error"
                    value={`${(prediction.data.metrics?.ensemble?.[horizonType]?.mape_equiv ?? 0).toFixed(2)}%`}
                    hint="RMSE in log space, expressed as a price error"
                  />
                  <StatTile
                    label="Annualised vol"
                    value={pct((prediction.data.diagnostics?.annualised_vol ?? 0) * 100, { withSign: false })}
                  />
                  <StatTile
                    label="Vol regime"
                    value={prediction.data.diagnostics?.vol_regime || '—'}
                    mono={false}
                    tone={prediction.data.diagnostics?.vol_regime === 'elevated' ? 'amber' : 'default'}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </Panel>

      {/* news */}
      <Panel
        eyebrow={`Tagged “${metal}”`}
        title="Coverage for this metal"
        actions={
          <Link
            to={`/news?metal=${metal}`}
            className="rounded-md border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-faint transition-colors hover:border-patina hover:text-patina"
          >
            More
          </Link>
        }
        bodyClassName="p-0"
        delay={0.15}
      >
        {news.isLoading ? (
          <>
            <NewsCardSkeleton />
            <NewsCardSkeleton />
          </>
        ) : news.data?.articles?.length ? (
          news.data.articles.map((a, i) => <NewsCard key={a.id} article={a} index={i} />)
        ) : (
          <Empty
            icon={Newspaper}
            title={`Nothing tagged ${metal} yet`}
            hint="Articles are tagged by keyword when they are stored. Run the news job from the System page to pull the latest batch."
          />
        )}
      </Panel>
    </div>
  )
}
