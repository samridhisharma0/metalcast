import { useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Info, Target } from 'lucide-react'
import { api } from '../lib/api'
import { metalColor, money, pct, probability, relativeTime } from '../lib/format'
import { Panel } from '../components/ui/Panel'
import { Badge } from '../components/ui/Badge'
import { Segmented } from '../components/ui/Segmented'
import { StatTile } from '../components/ui/StatTile'
import { SkeletonChart, SkeletonText } from '../components/ui/Skeleton'
import { Empty } from '../components/ui/Empty'
import { ConfidencePips, ProbabilityMeter, WeightsBar } from '../components/ui/Meter'
import { HorizonStrip } from '../components/forecast/HorizonStrip'
import { ForecastFan } from '../components/charts/ForecastFan'
import { TrackChart } from '../components/charts/TrackChart'

const METALS = ['aluminium', 'copper']
const TRACK_HORIZONS = [
  { value: 1, label: '1D' },
  { value: 3, label: '3D' },
  { value: 7, label: '7D' },
  { value: 21, label: '1M' },
  { value: 63, label: '3M' },
]

function MetalForecastBlock({ metal, index }) {
  const [selected, setSelected] = useState(7)

  const prediction = useQuery({
    queryKey: ['predictions', metal, 'all'],
    queryFn: () => api.predictions(metal, 'all'),
    staleTime: 5 * 60 * 1000,
  })

  const history = useQuery({
    queryKey: ['history', metal, '6M'],
    queryFn: () => api.history(metal, '6M'),
    staleTime: 5 * 60 * 1000,
  })

  const data = prediction.data
  const color = metalColor(metal)
  const predictions = data?.available ? data.predictions : []
  const focus = predictions.find((p) => p.horizon_days === selected)
  const horizonType = focus?.horizon_type || 'short'

  return (
    <Panel
      eyebrow={
        data?.available
          ? `${data.model_version} · run ${relativeTime(data.run_ts)} · ${data.history_points} bars`
          : 'Ensemble forecast'
      }
      title={metal.charAt(0).toUpperCase() + metal.slice(1)}
      subtitle={
        data?.available
          ? `Anchor ${money(data.anchor_price)} on ${data.anchor_date}`
          : 'No successful run recorded yet'
      }
      actions={
        data?.status && data.status !== 'ok' ? (
          <Badge tone="amber" title={data.warnings || ''}>
            {data.status}
          </Badge>
        ) : (
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
        )
      }
      delay={index * 0.08}
      bodyClassName="space-y-5"
    >
      {prediction.isLoading ? (
        <SkeletonChart height={280} />
      ) : !data?.available ? (
        <Empty
          icon={Target}
          title="Nothing to show yet"
          hint={data?.reason || 'The forecast job has not produced a successful run for this metal.'}
        />
      ) : (
        <>
          <HorizonStrip
            predictions={predictions}
            selected={selected}
            onSelect={setSelected}
            anchorPrice={data.anchor_price}
          />

          <ForecastFan
            history={history.data?.series ?? []}
            predictions={predictions.filter((p) => p.horizon_type === horizonType)}
            anchorPrice={data.anchor_price}
            anchorDate={data.anchor_date}
            color={color}
            highlightHorizon={selected}
            height={280}
            historyTail={horizonType === 'short' ? 45 : 130}
          />

          {focus && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-4 rounded-xl border border-line bg-raised p-4 sm:grid-cols-4">
              <StatTile label={`${focus.horizon_label} point`} value={money(focus.point_price)} />
              <StatTile
                label="Expected move"
                value={pct(focus.expected_return * 100)}
                tone={focus.expected_return > 0 ? 'up' : focus.expected_return < 0 ? 'down' : 'default'}
              />
              <div className="min-w-0">
                <div className="tnum text-lg font-medium text-ink">{probability(focus.prob_up)}</div>
                <div className="eyebrow mt-0.5">P(higher)</div>
                <ProbabilityMeter value={focus.prob_up} height={4} showTicks={false} className="mt-1.5" />
              </div>
              <div className="min-w-0">
                <div className="flex h-[27px] items-center">
                  <ConfidencePips value={focus.confidence} total={6} />
                </div>
                <div className="eyebrow mt-0.5">Confidence {probability(focus.confidence)}</div>
              </div>
            </div>
          )}

          <div className="grid gap-5 border-t border-line pt-4 sm:grid-cols-2">
            <div>
              <div className="eyebrow mb-2">Weights · {horizonType} horizon</div>
              <WeightsBar
                weights={data.weights?.[horizonType] || {}}
                labels={data.weights?.labels || {}}
              />
            </div>
            <div>
              <div className="eyebrow mb-2">Walk-forward backtest</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                <StatTile
                  label="Hit rate"
                  value={probability(data.metrics?.ensemble?.[horizonType]?.hit_rate)}
                />
                <StatTile
                  label="Typical error"
                  value={`${(data.metrics?.ensemble?.[horizonType]?.mape_equiv ?? 0).toFixed(2)}%`}
                />
                <StatTile
                  label="Reference horizon"
                  value={`${data.metrics?.ensemble?.[horizonType]?.ref_horizon ?? '—'} bars`}
                />
                <StatTile
                  label="200d gap"
                  value={
                    data.diagnostics?.distance_to_200ma_pct === null ||
                    data.diagnostics?.distance_to_200ma_pct === undefined
                      ? '—'
                      : pct(data.diagnostics.distance_to_200ma_pct)
                  }
                  tone={
                    (data.diagnostics?.distance_to_200ma_pct ?? 0) > 0
                      ? 'up'
                      : (data.diagnostics?.distance_to_200ma_pct ?? 0) < 0
                        ? 'down'
                        : 'default'
                  }
                />
              </div>
            </div>
          </div>
        </>
      )}
    </Panel>
  )
}

export default function Forecasts() {
  const [trackMetal, setTrackMetal] = useState('copper')
  const [trackHorizon, setTrackHorizon] = useState(7)

  const track = useQuery({
    queryKey: ['track', trackMetal, trackHorizon],
    queryFn: () => api.predictionTrack(trackMetal, trackHorizon, 120),
    staleTime: 5 * 60 * 1000,
  })

  const accuracy = useQueries({
    queries: METALS.map((m) => ({
      queryKey: ['accuracy', m],
      queryFn: () => api.accuracy(m),
      staleTime: 10 * 60 * 1000,
    })),
  })

  return (
    <div className="space-y-4 sm:space-y-5">
      <div>
        <h1 className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
          Forecasts and how well they hold up
        </h1>
        <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-muted">
          Seven models vote on every horizon. Weights come from a walk-forward backtest, never from
          in-sample fit, and the interval widens when the members disagree. The track record below is
          scored automatically once a target date has a realised close — nothing here is graded by hand.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {METALS.map((m, i) => (
          <MetalForecastBlock key={m} metal={m} index={i} />
        ))}
      </div>

      <Panel
        eyebrow="Predicted versus realised · scored from PostgreSQL"
        title="Track record"
        subtitle="Each point is one forecast run, plotted at the date it was aiming for"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              layoutId="track-metal"
              options={METALS.map((m) => ({ value: m, label: m === 'aluminium' ? 'AL' : 'CU' }))}
              value={trackMetal}
              onChange={setTrackMetal}
            />
            <Segmented
              layoutId="track-horizon"
              options={TRACK_HORIZONS}
              value={trackHorizon}
              onChange={setTrackHorizon}
            />
          </div>
        }
        delay={0.1}
      >
        {track.isLoading ? (
          <SkeletonChart height={260} />
        ) : (
          <>
            <TrackChart runs={track.data?.runs ?? []} color={metalColor(trackMetal)} height={260} />
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-4" style={{ background: 'var(--c-ink)' }} /> realised
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="h-0.5 w-4"
                  style={{
                    background: `repeating-linear-gradient(90deg, ${metalColor(trackMetal)} 0 4px, transparent 4px 7px)`,
                  }}
                />
                predicted
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-4 rounded-sm"
                  style={{ background: metalColor(trackMetal), opacity: 0.16 }}
                />
                80% interval
              </span>
              <span className="ml-auto normal-case tracking-normal">
                {track.data?.count ?? 0} runs stored for this horizon
              </span>
            </div>
          </>
        )}
      </Panel>

      <Panel
        eyebrow="Realised accuracy by horizon"
        title="Scorecard"
        subtitle="Populated as predictions mature. Coverage should sit near the nominal 80% / 95%; well below means the intervals are too tight."
        delay={0.15}
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-raised">
                {['Metal', 'Horizon', 'Scored', 'MAE (USD/t)', 'MAPE', 'RMSE', 'Hit rate', '80% coverage', '95% coverage'].map(
                  (h) => (
                    <th key={h} className="eyebrow px-3 py-2 text-left font-medium first:pl-5">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {accuracy.every((q) => q.isLoading) ? (
                <tr>
                  <td colSpan={9} className="px-5 py-6">
                    <SkeletonText lines={3} />
                  </td>
                </tr>
              ) : (
                (() => {
                  const rows = accuracy.flatMap((q, i) =>
                    (q.data?.by_horizon ?? []).map((r) => ({ ...r, metal: METALS[i] })),
                  )
                  if (!rows.length) {
                    return (
                      <tr>
                        <td colSpan={9}>
                          <Empty
                            icon={Info}
                            title="No matured predictions yet"
                            hint="A 1-day forecast can be scored tomorrow; a 6-month forecast in about half a year. The scoring job runs automatically."
                          />
                        </td>
                      </tr>
                    )
                  }
                  return rows.map((r) => (
                    <tr
                      key={`${r.metal}-${r.horizon_days}`}
                      className="border-b border-line transition-colors last:border-b-0 hover:bg-raised"
                    >
                      <td className="px-3 py-2.5 pl-5">
                        <span className="flex items-center gap-1.5 capitalize text-ink">
                          <span
                            className="h-2 w-2 rounded-sm"
                            style={{ background: metalColor(r.metal) }}
                          />
                          {r.metal}
                        </span>
                      </td>
                      <td className="tnum px-3 py-2.5 text-muted">{r.horizon_days}b</td>
                      <td className="tnum px-3 py-2.5 text-muted">{r.n}</td>
                      <td className="tnum px-3 py-2.5 text-ink">{money(r.mae, { decimals: 0 })}</td>
                      <td className="tnum px-3 py-2.5 text-ink">
                        {pct(Math.abs(Number(r.mape ?? 0)), { withSign: false })}
                      </td>
                      <td className="tnum px-3 py-2.5 text-muted">{money(r.rmse, { decimals: 0 })}</td>
                      <td className="tnum px-3 py-2.5">
                        <span
                          style={{
                            color:
                              Number(r.hit_rate) > 0.55
                                ? 'var(--c-up)'
                                : Number(r.hit_rate) < 0.45
                                  ? 'var(--c-down)'
                                  : 'var(--c-muted)',
                          }}
                        >
                          {probability(r.hit_rate)}
                        </span>
                      </td>
                      <td className="tnum px-3 py-2.5 text-muted">{probability(r.coverage_80)}</td>
                      <td className="tnum px-3 py-2.5 text-muted">{probability(r.coverage_95)}</td>
                    </tr>
                  ))
                })()
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel eyebrow="Reading the numbers" title="What these forecasts do and do not claim" delay={0.2}>
        <div className="grid gap-x-8 gap-y-4 text-[12.5px] leading-relaxed text-muted sm:grid-cols-2">
          <div>
            <p className="mb-1 font-medium text-ink">The interval is the forecast</p>
            <p>
              A point estimate for a metal price three months out is close to meaningless on its own.
              The 80% band is the actual output; the central line is just its midpoint. Bands are
              asymmetric because the model works in log space, which is how prices behave.
            </p>
          </div>
          <div>
            <p className="mb-1 font-medium text-ink">Skill is bounded on purpose</p>
            <p>
              The uncertainty is floored at 60% of a random walk's. No public model beats a random
              walk on base metals by more than a modest margin, so the engine is not permitted to
              claim it does.
            </p>
          </div>
          <div>
            <p className="mb-1 font-medium text-ink">Hit rate near 50% is the honest baseline</p>
            <p>
              Short-horizon direction on liquid metals is close to a coin flip. A hit rate of 52–56%
              is a real edge; anything above 65% on a small sample is almost certainly overfitting,
              not insight.
            </p>
          </div>
          <div>
            <p className="mb-1 font-medium text-ink">Not investment advice</p>
            <p>
              This is a statistical exercise on public price data, with no order-book depth, no
              warehouse-stock data, and no positioning information. Do not trade on it.
            </p>
          </div>
        </div>
      </Panel>
    </div>
  )
}
