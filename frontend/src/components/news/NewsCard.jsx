import { motion } from 'framer-motion'
import { ExternalLink, TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Skeleton } from '../ui/Skeleton'
import { cn } from '../../lib/cn'
import { relativeTime, titleCase } from '../../lib/format'

const SENTIMENT = {
  bullish: { tone: 'up', icon: TrendingUp, label: 'bullish' },
  bearish: { tone: 'down', icon: TrendingDown, label: 'bearish' },
  neutral: { tone: 'neutral', icon: Minus, label: 'neutral' },
}

export function NewsCard({ article, index = 0, compact = false }) {
  const sentiment = SENTIMENT[article.sentiment_label] || SENTIMENT.neutral
  const SentimentIcon = sentiment.icon

  return (
    <motion.a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.4), ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'group block border-b border-line px-4 py-3.5 transition-colors duration-200 last:border-b-0 hover:bg-raised sm:px-5',
        compact && 'py-3',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-patina">
              {article.source}
            </span>
            <span className="text-faint">·</span>
            <span className="font-mono text-[10px] text-faint">{relativeTime(article.published_at)}</span>
            <Badge tone={sentiment.tone} icon={SentimentIcon} className="ml-0.5">
              {sentiment.label}
            </Badge>
          </div>

          <h3
            className={cn(
              'mt-1.5 font-display font-medium leading-snug tracking-tight text-ink transition-colors group-hover:text-patina',
              compact ? 'text-[13.5px]' : 'text-sm',
            )}
          >
            {article.title}
          </h3>

          {!compact && article.summary && (
            <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted">
              {article.summary}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {(article.metals || []).map((m) => (
              <span
                key={m}
                className="rounded border px-1.5 py-px font-mono text-[9.5px] uppercase tracking-[0.08em]"
                style={{
                  color: m === 'copper' ? 'var(--c-copper)' : 'var(--c-aluminium)',
                  borderColor: 'var(--c-line)',
                }}
              >
                {m}
              </span>
            ))}
            {(article.tags || []).slice(0, compact ? 2 : 4).map((t) => (
              <span
                key={t}
                className="rounded border border-line px-1.5 py-px font-mono text-[9.5px] uppercase tracking-[0.08em] text-faint"
              >
                {titleCase(t)}
              </span>
            ))}
          </div>
        </div>

        <ExternalLink
          size={13}
          className="mt-1 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100"
        />
      </div>
    </motion.a>
  )
}

export function NewsCardSkeleton() {
  return (
    <div className="space-y-2 border-b border-line px-5 py-4 last:border-b-0">
      <Skeleton className="h-2.5 w-32" />
      <Skeleton className="h-3.5 w-full" />
      <Skeleton className="h-3.5 w-4/5" />
      <div className="flex gap-1.5 pt-1">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  )
}
