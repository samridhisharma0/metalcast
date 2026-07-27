import { useMemo } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { dateLabel, money } from '../../lib/format'

/**
 * Track record: what a given horizon was predicted to be, versus what it
 * turned out to be. This is the panel that makes the forecasts falsifiable, so
 * it is deliberately not hidden behind a tab.
 */
export function TrackChart({ runs = [], color = 'var(--c-patina)', height = 260 }) {
  const data = useMemo(
    () =>
      runs
        .filter((r) => Number.isFinite(Number(r.point_price)))
        .map((r) => ({
          x: r.target_date,
          predicted: Number(r.point_price),
          actual: Number.isFinite(Number(r.actual_price)) ? Number(r.actual_price) : null,
          spacer: Number(r.lower_80),
          band: Number(r.upper_80) - Number(r.lower_80),
          lower80: Number(r.lower_80),
          upper80: Number(r.upper_80),
        })),
    [runs],
  )

  if (!data.length) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-line px-6 text-center text-xs text-muted"
        style={{ height }}
      >
        No scored forecasts yet. Predictions are scored once their target date has a close.
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="x"
          tickLine={false}
          axisLine={false}
          minTickGap={44}
          tickFormatter={(v) => dateLabel(v, 'd MMM')}
        />
        <YAxis
          orientation="right"
          width={54}
          tickLine={false}
          axisLine={false}
          domain={['auto', 'auto']}
          tickFormatter={(v) => money(v, { decimals: 0 })}
        />
        <Tooltip
          cursor={{ stroke: 'var(--c-faint)', strokeDasharray: '3 3' }}
          contentStyle={{
            background: 'var(--c-panel)',
            border: '1px solid var(--c-line)',
            borderRadius: 10,
            fontSize: 12,
            fontFamily: 'IBM Plex Mono',
          }}
          labelFormatter={(v) => dateLabel(v)}
          formatter={(value, name) => {
            if (name === 'spacer' || name === 'band') return [null, null]
            return [money(value), name === 'predicted' ? 'Predicted' : 'Actual']
          }}
        />
        <Area dataKey="spacer" stackId="t" stroke="none" fill="none" isAnimationActive={false} />
        <Area dataKey="band" stackId="t" stroke="none" fill={color} fillOpacity={0.16} isAnimationActive={false} />
        <Line
          type="monotone"
          dataKey="predicted"
          stroke={color}
          strokeWidth={1.8}
          strokeDasharray="5 4"
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="actual"
          stroke="var(--c-ink)"
          strokeWidth={1.9}
          dot={{ r: 1.8, strokeWidth: 0, fill: 'var(--c-ink)' }}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
