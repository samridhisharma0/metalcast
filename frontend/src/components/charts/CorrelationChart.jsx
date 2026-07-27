import { useMemo } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { dateLabel } from '../../lib/format'

/**
 * Both metals rebased to 100 at the start of the window. Absolute prices are
 * an order of magnitude apart, so a shared axis would flatten aluminium into a
 * straight line; rebasing is the only honest way to show co-movement.
 */
export function CorrelationChart({ series = [], height = 250 }) {
  const data = useMemo(
    () =>
      series.map((d) => ({
        x: d.date,
        Aluminium: Number(d.aluminium),
        Copper: Number(d.copper),
      })),
    [series],
  )

  if (data.length < 3) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-line text-xs text-muted"
        style={{ height }}
      >
        Not enough overlapping history to compare the two metals yet.
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
          width={44}
          tickLine={false}
          axisLine={false}
          domain={['auto', 'auto']}
          tickFormatter={(v) => v.toFixed(0)}
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
          formatter={(value, name) => [`${Number(value).toFixed(2)} idx`, name]}
        />
        <Legend
          verticalAlign="top"
          height={26}
          iconType="plainline"
          wrapperStyle={{ fontSize: 11, fontFamily: 'IBM Plex Mono', color: 'var(--c-muted)' }}
        />
        <Line type="monotone" dataKey="Aluminium" stroke="var(--c-aluminium)" strokeWidth={1.8} dot={false} />
        <Line type="monotone" dataKey="Copper" stroke="var(--c-copper)" strokeWidth={1.8} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
