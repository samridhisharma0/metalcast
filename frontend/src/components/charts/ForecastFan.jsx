import { useMemo } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { dateLabel, money, pct } from '../../lib/format'

/**
 * The fan.
 *
 * Recharts has no native "band" series, so each interval is drawn as two
 * stacked areas: an invisible spacer up to the lower bound, then a visible
 * band of `upper - lower`. Stacking guarantees the 95% band sits behind the
 * 80% band without any z-index guesswork.
 *
 * History and forecast live in one dataset with separate keys, so the line
 * breaks cleanly at the anchor instead of being interpolated across it.
 */
function FanTooltip({ active, payload, label, anchorPrice }) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload
  if (!row) return null
  const isForecast = row.forecast !== undefined && row.forecast !== null
  const value = isForecast ? row.forecast : row.history
  const change = anchorPrice && Number.isFinite(value) ? (value / anchorPrice - 1) * 100 : null

  return (
    <div className="panel min-w-[11rem] p-2.5 text-xs shadow-lift">
      <div className="eyebrow mb-1.5 flex items-center justify-between gap-2">
        <span>{dateLabel(label)}</span>
        <span className={isForecast ? 'text-patina' : 'text-faint'}>
          {isForecast ? 'forecast' : 'actual'}
        </span>
      </div>
      <div className="tnum text-base font-medium text-ink">{money(value)}</div>
      {change !== null && (
        <div className="tnum mt-0.5 text-[11px]" style={{ color: change >= 0 ? 'var(--c-up)' : 'var(--c-down)' }}>
          {pct(change)} vs anchor
        </div>
      )}
      {isForecast && (
        <dl className="mt-2 space-y-1 border-t border-line pt-1.5 font-mono text-[10px]">
          <div className="flex justify-between gap-4">
            <dt className="text-faint">80% band</dt>
            <dd className="tnum text-muted">
              {money(row.lower80, { decimals: 0 })} – {money(row.upper80, { decimals: 0 })}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-faint">95% band</dt>
            <dd className="tnum text-muted">
              {money(row.lower95, { decimals: 0 })} – {money(row.upper95, { decimals: 0 })}
            </dd>
          </div>
        </dl>
      )}
    </div>
  )
}

export function ForecastFan({
  history = [],
  predictions = [],
  anchorPrice,
  anchorDate,
  color = 'var(--c-patina)',
  height = 340,
  historyTail = 90,
  highlightHorizon,
}) {
  const data = useMemo(() => {
    const tail = history.slice(-historyTail).map((d) => ({
      x: d.date ?? d.ts,
      history: Number(d.close ?? d.price),
    }))

    const anchor = Number.isFinite(Number(anchorPrice))
      ? Number(anchorPrice)
      : tail.length
        ? tail[tail.length - 1].history
        : null

    // Stitch: the last actual point is also the first forecast point, so the
    // line is continuous and the bands start at zero width.
    if (tail.length && anchor !== null) {
      const last = tail[tail.length - 1]
      last.forecast = anchor
      last.lower80 = anchor
      last.upper80 = anchor
      last.lower95 = anchor
      last.upper95 = anchor
      last.band80 = 0
      last.band95Lower = 0
      last.band95Upper = 0
      last.spacer = anchor
    }

    const forward = predictions
      .filter((p) => Number.isFinite(Number(p.point_price)))
      .sort((a, b) => a.horizon_days - b.horizon_days)
      .map((p) => ({
        x: p.target_date,
        forecast: Number(p.point_price),
        lower80: Number(p.lower_80),
        upper80: Number(p.upper_80),
        lower95: Number(p.lower_95),
        upper95: Number(p.upper_95),
        horizonDays: p.horizon_days,
        horizonLabel: p.horizon_label,
        spacer: Number(p.lower_95),
        band95Lower: Number(p.lower_80) - Number(p.lower_95),
        band80: Number(p.upper_80) - Number(p.lower_80),
        band95Upper: Number(p.upper_95) - Number(p.upper_80),
      }))

    return [...tail, ...forward]
  }, [history, predictions, anchorPrice, historyTail])

  const domain = useMemo(() => {
    const values = data.flatMap((d) =>
      [d.history, d.lower95, d.upper95].filter((v) => Number.isFinite(v)),
    )
    if (!values.length) return ['auto', 'auto']
    const min = Math.min(...values)
    const max = Math.max(...values)
    const pad = (max - min || max * 0.02) * 0.08
    return [Math.max(0, min - pad), max + pad]
  }, [data])

  const highlighted = useMemo(
    () => data.find((d) => d.horizonDays === highlightHorizon),
    [data, highlightHorizon],
  )

  if (!data.length) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-line px-6 text-center text-xs text-muted"
        style={{ height }}
      >
        Waiting on the first forecast run for this metal.
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="fan-history" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.2} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>

        <CartesianGrid strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="x"
          tickLine={false}
          axisLine={false}
          minTickGap={46}
          tickFormatter={(v) => dateLabel(v, 'd MMM')}
        />
        <YAxis
          domain={domain}
          orientation="right"
          width={54}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => money(v, { decimals: 0 })}
        />
        <Tooltip
          content={<FanTooltip anchorPrice={anchorPrice} />}
          cursor={{ stroke: 'var(--c-faint)', strokeDasharray: '3 3' }}
        />

        {/* invisible base so the bands float at the right height */}
        <Area
          dataKey="spacer"
          stackId="fan"
          stroke="none"
          fill="none"
          isAnimationActive={false}
          legendType="none"
        />
        <Area
          dataKey="band95Lower"
          stackId="fan"
          stroke="none"
          fill={color}
          fillOpacity={0.1}
          isAnimationActive={false}
        />
        <Area
          dataKey="band80"
          stackId="fan"
          stroke="none"
          fill={color}
          fillOpacity={0.24}
          isAnimationActive={false}
        />
        <Area
          dataKey="band95Upper"
          stackId="fan"
          stroke="none"
          fill={color}
          fillOpacity={0.1}
          isAnimationActive={false}
        />

        <Area
          type="monotone"
          dataKey="history"
          stroke="none"
          fill="url(#fan-history)"
          isAnimationActive={false}
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="history"
          stroke="var(--c-ink)"
          strokeWidth={1.8}
          dot={false}
          connectNulls={false}
          animationDuration={600}
        />
        <Line
          type="monotone"
          dataKey="forecast"
          stroke={color}
          strokeWidth={2.1}
          strokeDasharray="6 4"
          dot={false}
          connectNulls
          activeDot={{ r: 3.5, strokeWidth: 0, fill: color }}
          animationDuration={900}
        />

        {anchorDate && (
          <ReferenceLine
            x={anchorDate}
            stroke="var(--c-faint)"
            strokeDasharray="3 3"
            label={{
              value: 'now',
              position: 'insideTopLeft',
              fill: 'var(--c-faint)',
              fontSize: 9.5,
              fontFamily: 'IBM Plex Mono',
            }}
          />
        )}
        {highlighted && (
          <ReferenceLine
            x={highlighted.x}
            stroke="var(--c-patina)"
            strokeWidth={1.2}
            label={{
              value: highlighted.horizonLabel,
              position: 'insideTopRight',
              fill: 'var(--c-patina)',
              fontSize: 9.5,
              fontFamily: 'IBM Plex Mono',
            }}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}
