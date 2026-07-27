import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { dateLabel } from '../../lib/format'

/** Daily average news sentiment. Bars diverge from zero, coloured by sign. */
export function SentimentChart({ daily = [], height = 180 }) {
  const data = useMemo(
    () => daily.map((d) => ({ x: d.day, value: Number(d.avg_sentiment), n: d.articles })),
    [daily],
  )

  if (!data.length) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-line text-xs text-muted"
        style={{ height }}
      >
        No scored articles in the last two weeks.
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="x"
          tickLine={false}
          axisLine={false}
          minTickGap={28}
          tickFormatter={(v) => dateLabel(v, 'd MMM')}
        />
        <YAxis
          orientation="right"
          width={38}
          tickLine={false}
          axisLine={false}
          domain={[-1, 1]}
          ticks={[-1, -0.5, 0, 0.5, 1]}
          tickFormatter={(v) => v.toFixed(1)}
        />
        <Tooltip
          cursor={{ fill: 'var(--c-grid)' }}
          contentStyle={{
            background: 'var(--c-panel)',
            border: '1px solid var(--c-line)',
            borderRadius: 10,
            fontSize: 12,
            fontFamily: 'IBM Plex Mono',
          }}
          labelFormatter={(v) => dateLabel(v)}
          formatter={(value, _n, entry) => [
            `${Number(value).toFixed(2)} (${entry.payload.n} articles)`,
            'Avg sentiment',
          ]}
        />
        <ReferenceLine y={0} stroke="var(--c-line)" />
        <Bar dataKey="value" radius={[2, 2, 2, 2]} maxBarSize={16}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.value >= 0 ? 'var(--c-up)' : 'var(--c-down)'} fillOpacity={0.75} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
