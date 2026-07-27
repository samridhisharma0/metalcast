import { motion } from 'framer-motion'
import { cn } from '../../lib/cn'
import { money, pct, probability } from '../../lib/format'

/**
 * THE SIGNATURE ELEMENT.
 *
 * Thirteen horizons — 1D through 7D, then 1M through 6M — rendered as a single
 * strip of cells. Each cell encodes three things at once:
 *
 *   • fill colour   → direction and strength of P(up), diverging from neutral
 *   • bar height    → the model's confidence at that horizon
 *   • cell width    → uniform, so the strip reads as a term structure
 *
 * A metals trader reads a forward curve left to right; this is that habit
 * applied to a probability surface. Clicking a cell drives the fan chart, so
 * the strip is both the summary and the navigation.
 */
function cellFill(probUp) {
  const p = Math.min(Math.max(Number(probUp) || 0.5, 0), 1)
  const distance = Math.abs(p - 0.5) / 0.5 // 0 at coin-flip, 1 at certainty
  const alpha = 0.12 + distance * 0.68
  return p >= 0.5
    ? `rgba(63, 185, 138, ${alpha.toFixed(3)})`
    : `rgba(225, 91, 107, ${alpha.toFixed(3)})`
}

export function HorizonStrip({ predictions = [], selected, onSelect, anchorPrice }) {
  if (!predictions.length) {
    return (
      <p className="py-6 text-center text-xs text-muted">
        No horizons available yet. The forecast job runs on the schedule shown on the System page.
      </p>
    )
  }

  const shortSet = predictions.filter((p) => p.horizon_type === 'short')
  const longSet = predictions.filter((p) => p.horizon_type === 'long')

  const renderGroup = (group, label) => (
    <div className="min-w-0 flex-1">
      <div className="eyebrow mb-1.5 flex items-baseline justify-between">
        <span>{label}</span>
        <span className="normal-case tracking-normal text-faint">
          {group.length} horizon{group.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="flex gap-1">
        {group.map((p, i) => {
          const active = selected === p.horizon_days
          const delta = anchorPrice ? (p.point_price / anchorPrice - 1) * 100 : null
          return (
            <button
              key={p.horizon_days}
              type="button"
              onClick={() => onSelect?.(p.horizon_days)}
              aria-pressed={active}
              title={`${p.horizon_label}: ${money(p.point_price)} · P(up) ${probability(p.prob_up)} · confidence ${probability(p.confidence)}`}
              className={cn(
                'group relative min-w-0 flex-1 overflow-hidden rounded-md border px-1 pb-1 pt-1.5 text-center transition-all duration-200 ease-spring',
                active
                  ? 'border-patina shadow-glow'
                  : 'border-line hover:border-faint focus-visible:border-patina',
              )}
              style={{ background: cellFill(p.prob_up) }}
            >
              <span className="tnum block text-[11px] font-semibold leading-none text-ink">
                {p.horizon_label}
              </span>
              <span
                className="tnum mt-1 block text-[9.5px] leading-none"
                style={{ color: 'var(--c-ink)', opacity: 0.72 }}
              >
                {delta === null ? '—' : pct(delta, { decimals: 1 })}
              </span>

              {/* confidence as a rising column at the base of the cell */}
              <span className="mt-1.5 block h-4 w-full">
                <span className="relative block h-full w-full rounded-sm bg-black/20">
                  <motion.span
                    className="absolute bottom-0 left-0 w-full rounded-sm"
                    style={{ background: 'var(--c-ink)', opacity: 0.55 }}
                    initial={{ height: 0 }}
                    animate={{ height: `${Math.min(Math.max(p.confidence, 0), 1) * 100}%` }}
                    transition={{ duration: 0.5, delay: 0.05 * i, ease: [0.22, 1, 0.36, 1] }}
                  />
                </span>
              </span>

              <span className="tnum mt-1 block text-[9px] leading-none text-ink opacity-60">
                {probability(p.prob_up)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-5">
        {shortSet.length > 0 && renderGroup(shortSet, 'Next 1–7 days')}
        {longSet.length > 0 && renderGroup(longSet, '1–6 months')}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-2.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm" style={{ background: cellFill(0.85) }} />
          higher
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm" style={{ background: cellFill(0.5) }} />
          coin flip
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm" style={{ background: cellFill(0.15) }} />
          lower
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-flex h-2.5 w-1 items-end rounded-sm bg-line">
            <span className="block h-1.5 w-full rounded-sm bg-ink opacity-55" />
          </span>
          column height = confidence
        </span>
        <span className="ml-auto normal-case tracking-normal">Percentages are change vs the anchor close</span>
      </div>
    </div>
  )
}
