import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowUpRight, Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { Sparkline } from './ui/Sparkline'
import { Skeleton } from './ui/Skeleton'
import { Badge } from './ui/Badge'
import { cn } from '../lib/cn'
import { money, pct, relativeTime, signed } from '../lib/format'

/**
 * The quote board. This is the page's thesis: the two numbers a metals desk
 * actually looks at, at the size they deserve, with the day's range drawn
 * underneath as a physical bar the current price sits inside.
 */
function RangeBar({ low, high, price, color }) {
  if (![low, high, price].every((v) => Number.isFinite(Number(v))) || high <= low) {
    return <div className="h-1 w-full rounded-full bg-lineSoft" />
  }
  const position = Math.min(Math.max((price - low) / (high - low), 0), 1)
  return (
    <div className="w-full">
      <div className="relative h-1 w-full rounded-full bg-lineSoft">
        <motion.span
          className="absolute top-1/2 h-2.5 w-[3px] -translate-y-1/2 rounded-full"
          style={{ background: color }}
          initial={{ left: '50%' }}
          animate={{ left: `${position * 100}%` }}
          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
        />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9.5px] text-faint">
        <span>{money(low, { decimals: 0 })}</span>
        <span className="uppercase tracking-widest">7-day range</span>
        <span>{money(high, { decimals: 0 })}</span>
      </div>
    </div>
  )
}

export function PriceTapeCard({ quote, spark = [], flash, streamState, index = 0 }) {
  const color = quote.color || (quote.metal === 'copper' ? 'var(--c-copper)' : 'var(--c-aluminium)')
  const up = (quote.change ?? 0) > 0
  const down = (quote.change ?? 0) < 0
  const TrendIcon = up ? TrendingUp : down ? TrendingDown : Minus

  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'panel group relative overflow-hidden',
        flash === 'up' && 'animate-flash-up',
        flash === 'down' && 'animate-flash-down',
      )}
    >
      {/* the metal's own colour bleeds in from the left edge */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: color }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-[0.07] blur-2xl transition-opacity duration-500 group-hover:opacity-[0.14]"
        style={{ background: color }}
      />

      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-display text-base font-semibold tracking-tight text-ink">
                {quote.name || quote.metal}
              </h3>
              <span className="tnum rounded border border-line px-1 py-px text-[10px] text-faint">
                {quote.symbol}
              </span>
            </div>
            <p className="eyebrow mt-1">
              {quote.exchange || 'LME'} · {quote.currency || 'USD'}/{quote.unit || 'tonne'}
            </p>
          </div>
          <Link
            to={`/metal/${quote.metal}`}
            className="flex items-center gap-1 rounded-md border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-faint transition-colors hover:border-patina hover:text-patina"
          >
            Detail <ArrowUpRight size={11} />
          </Link>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="tnum text-tape font-medium text-ink">
                {money(quote.price, { decimals: 0 })}
              </span>
              <span className="mb-1 text-[11px] text-faint">
                .{String(Math.round(((quote.price ?? 0) % 1) * 100)).padStart(2, '0')}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span
                className="tnum inline-flex items-center gap-1 text-sm font-medium"
                style={{ color: up ? 'var(--c-up)' : down ? 'var(--c-down)' : 'var(--c-muted)' }}
              >
                <TrendIcon size={13} strokeWidth={2.4} />
                {signed(quote.change, { decimals: 2 })}
              </span>
              <span
                className="tnum text-xs"
                style={{ color: up ? 'var(--c-up)' : down ? 'var(--c-down)' : 'var(--c-muted)' }}
              >
                {pct(quote.change_pct)}
              </span>
              <span className="text-[10.5px] text-faint">vs prev close</span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1.5">
            <Sparkline data={spark} color={color} width={132} height={38} />
            <div className="flex items-center gap-1.5">
              {quote.stale ? (
                <Badge tone="amber" title="No fresh tick within the expected window">
                  stale
                </Badge>
              ) : (
                <span className="flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-widest text-faint">
                  <span className="relative flex h-1.5 w-1.5">
                    {streamState === 'live' && (
                      <span
                        className="absolute inline-flex h-full w-full animate-ring-pulse rounded-full"
                        style={{ background: 'var(--c-up)' }}
                      />
                    )}
                    <span
                      className="relative inline-flex h-1.5 w-1.5 rounded-full"
                      style={{ background: streamState === 'live' ? 'var(--c-up)' : 'var(--c-amber)' }}
                    />
                  </span>
                  {relativeTime(quote.ts)}
                </span>
              )}
            </div>
          </div>
        </div>

        <RangeBar low={quote.week_low} high={quote.week_high} price={quote.price} color={color} />
      </div>
    </motion.article>
  )
}

export function PriceTapeSkeleton() {
  return (
    <div className="panel space-y-4 p-5">
      <div className="flex justify-between">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-5 w-16" />
      </div>
      <Skeleton className="h-12 w-44" />
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-1 w-full" />
    </div>
  )
}
