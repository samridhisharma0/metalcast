import { useMemo } from 'react'

/**
 * Hand-rolled SVG sparkline. Recharts is excellent but far too heavy for a
 * 60-point trend line rendered a dozen times on one page.
 */
export function Sparkline({ data = [], color = 'var(--c-patina)', height = 34, width = 120, showArea = true }) {
  const path = useMemo(() => {
    const values = data.map((d) => (typeof d === 'number' ? d : d.close ?? d.price ?? 0)).filter(Number.isFinite)
    if (values.length < 2) return null
    const min = Math.min(...values)
    const max = Math.max(...values)
    const span = max - min || 1
    const stepX = width / (values.length - 1)
    const pad = 2
    const usable = height - pad * 2
    const points = values.map((v, i) => [i * stepX, pad + usable - ((v - min) / span) * usable])
    const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
    const area = `${line} L${width},${height} L0,${height} Z`
    return { line, area, last: points[points.length - 1], rising: values[values.length - 1] >= values[0] }
  }, [data, height, width])

  if (!path) {
    return <div className="h-[34px] w-[120px] rounded bg-lineSoft" aria-hidden="true" />
  }

  const stroke = color === 'auto' ? (path.rising ? 'var(--c-up)' : 'var(--c-down)') : color
  const gid = `spark-${Math.random().toString(36).slice(2, 8)}`

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="trend">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {showArea && <path d={path.area} fill={`url(#${gid})`} />}
      <path d={path.line} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={path.last[0]} cy={path.last[1]} r="1.9" fill={stroke} />
    </svg>
  )
}
