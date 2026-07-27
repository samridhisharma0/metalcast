import { motion } from 'framer-motion'
import { cn } from '../../lib/cn'

/**
 * Probability meter. Centre is 50/50 and the bar grows out from the middle,
 * because "58% up" and "42% up" are the same distance from no-information and
 * should look that way.
 */
export function ProbabilityMeter({ value = 0.5, height = 6, showTicks = true, className }) {
  const p = Math.min(Math.max(Number(value) || 0.5, 0), 1)
  const offset = (p - 0.5) * 100
  const width = Math.abs(offset)
  const bullish = p >= 0.5
  return (
    <div className={cn('w-full', className)}>
      <div className="relative w-full overflow-hidden rounded-full bg-lineSoft" style={{ height }}>
        <motion.div
          className="absolute top-0 h-full"
          style={{
            background: bullish ? 'var(--c-up)' : 'var(--c-down)',
            left: bullish ? '50%' : `${50 - width}%`,
          }}
          initial={{ width: 0 }}
          animate={{ width: `${width}%` }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        />
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-faint opacity-70" />
      </div>
      {showTicks && (
        <div className="mt-1 flex justify-between font-mono text-[9.5px] uppercase tracking-widest text-faint">
          <span>down</span>
          <span>even</span>
          <span>up</span>
        </div>
      )}
    </div>
  )
}

/** Horizontal stacked bar of ensemble weights. */
export function WeightsBar({ weights = {}, labels = {}, palette = [] }) {
  const entries = Object.entries(weights)
    .filter(([, v]) => Number.isFinite(Number(v)))
    .sort((a, b) => b[1] - a[1])
  const total = entries.reduce((sum, [, v]) => sum + Number(v), 0) || 1
  const colors =
    palette.length
      ? palette
      : ['var(--c-patina)', 'var(--c-aluminium)', 'var(--c-copper)', 'var(--c-amber)', 'var(--c-up)', 'var(--c-down)', 'var(--c-faint)']

  if (!entries.length) return <p className="text-xs text-muted">No ensemble weights recorded yet.</p>

  return (
    <div className="space-y-2.5">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-lineSoft">
        {entries.map(([name, value], i) => (
          <motion.div
            key={name}
            initial={{ width: 0 }}
            animate={{ width: `${(Number(value) / total) * 100}%` }}
            transition={{ duration: 0.5, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
            style={{ background: colors[i % colors.length] }}
            title={`${labels[name] || name}: ${(Number(value) * 100).toFixed(1)}%`}
          />
        ))}
      </div>
      <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        {entries.map(([name, value], i) => (
          <li key={name} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-sm"
                style={{ background: colors[i % colors.length] }}
              />
              <span className="truncate text-muted">{labels[name] || name}</span>
            </span>
            <span className="tnum shrink-0 text-ink">{(Number(value) * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Confidence rendered as discrete pips — reads as an instrument, not a % */
export function ConfidencePips({ value = 0, total = 5 }) {
  const filled = Math.round(Math.min(Math.max(value, 0), 1) * total)
  return (
    <span className="inline-flex items-center gap-0.5" title={`Confidence ${(value * 100).toFixed(0)}%`}>
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className="h-2.5 w-[3px] rounded-sm transition-colors"
          style={{ background: i < filled ? 'var(--c-patina)' : 'var(--c-line)' }}
        />
      ))}
    </span>
  )
}
