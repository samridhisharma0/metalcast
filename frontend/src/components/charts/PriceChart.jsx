import { useMemo } from 'react'
import {
  Area,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { dateLabel, money, timeLabel } from '../../lib/format'

function ChartTooltip({ active, payload, label, granularity, unit }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <div className="panel min-w-[9.5rem] p-2.5 text-xs shadow-lift">
      <div className="eyebrow mb-1.5">
        {granularity === 'tick' ? timeLabel(label, 'HH:mm') : dateLabel(label)}
      </div>
      <div className="tnum text-base font-medium text-ink">{money(row.close)}</div>
      <div className="mt-0.5 text-[10px] text-faint">{unit}</div>
      {Number.isFinite(row.high) && Number.isFinite(row.low) && (
        <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 border-t border-line pt-1.5 font-mono text-[10px] text-muted">
          <span>H {money(row.high, { decimals: 0 })}</span>
          <span>L {money(row.low, { decimals: 0 })}</span>
        </div>
      )}
    </div>
  )
}

export function PriceChart({
  series = [],
  color = 'var(--c-patina)',
  granularity = 'daily',
  unit = 'USD / tonne',
  height = 300,
  showBrush = false,
  showMovingAverage = true,
  referenceValue,
}) {
  const data = useMemo(() => {
    const rows = series
      .map((d) => ({
        x: d.date ?? d.ts,
        close: Number(d.close ?? d.price),
        high: Number.isFinite(Number(d.high)) ? Number(d.high) : undefined,
        low: Number.isFinite(Number(d.low)) ? Number(d.low) : undefined,
      }))
      .filter((d) => d.x && Number.isFinite(d.close))

    if (showMovingAverage && rows.length > 20) {
      const window = rows.length > 240 ? 50 : 20
      let sum = 0
      rows.forEach((row, i) => {
        sum += row.close
        if (i >= window) sum -= rows[i - window].close
        row.ma = i >= window - 1 ? sum / window : undefined
      })
    }
    return rows
  }, [series, showMovingAverage])

  const domain = useMemo(() => {
    if (!data.length) return ['auto', 'auto']
    const values = data.map((d) => d.close)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const pad = (max - min || max * 0.02) * 0.12
    return [Math.max(0, min - pad), max + pad]
  }, [data])

  const gid = `price-fill-${color.replace(/[^a-z]/gi, '')}`

  if (!data.length) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-line text-xs text-muted"
        style={{ height }}
      >
        No price history in this range yet.
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.26} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="x"
          tickLine={false}
          axisLine={false}
          minTickGap={44}
          tickFormatter={(v) =>
            granularity === 'tick' ? timeLabel(v, 'HH:mm') : dateLabel(v, 'd MMM')
          }
        />
        <YAxis
          domain={domain}
          tickLine={false}
          axisLine={false}
          width={54}
          tickFormatter={(v) => money(v, { decimals: 0 })}
          orientation="right"
        />
        <Tooltip
          content={<ChartTooltip granularity={granularity} unit={unit} />}
          cursor={{ stroke: 'var(--c-faint)', strokeDasharray: '3 3', strokeWidth: 1 }}
        />
        {Number.isFinite(Number(referenceValue)) && (
          <ReferenceLine
            y={Number(referenceValue)}
            stroke="var(--c-faint)"
            strokeDasharray="4 4"
            strokeWidth={1}
          />
        )}
        <Area
          type="monotone"
          dataKey="close"
          stroke="none"
          fill={`url(#${gid})`}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="close"
          stroke={color}
          strokeWidth={1.9}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0, fill: color }}
          animationDuration={700}
        />
        {showMovingAverage && data.some((d) => d.ma !== undefined) && (
          <Line
            type="monotone"
            dataKey="ma"
            stroke="var(--c-faint)"
            strokeWidth={1.1}
            strokeDasharray="5 4"
            dot={false}
            isAnimationActive={false}
          />
        )}
        {showBrush && (
          <Brush
            dataKey="x"
            height={22}
            travellerWidth={8}
            stroke="var(--c-line)"
            fill="var(--c-raised)"
            tickFormatter={() => ''}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}
