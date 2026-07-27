import { metalColor, probability } from '../../lib/format'
import { cn } from '../../lib/cn'

/** Bull/bear/neutral split per metal as a single stacked bar. */
export function SentimentSummary({ byMetal = [], className }) {
  if (!byMetal.length) {
    return <p className="text-xs text-muted">No tagged articles in this window yet.</p>
  }

  return (
    <div className={cn('space-y-4', className)}>
      {byMetal.map((row) => {
        const total = (row.bullish || 0) + (row.bearish || 0) + (row.neutral || 0) || 1
        const parts = [
          { key: 'bullish', value: row.bullish || 0, color: 'var(--c-up)' },
          { key: 'neutral', value: row.neutral || 0, color: 'var(--c-faint)' },
          { key: 'bearish', value: row.bearish || 0, color: 'var(--c-down)' },
        ]
        return (
          <div key={row.metal}>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-sm"
                  style={{ background: metalColor(row.metal) }}
                />
                <span className="text-[13px] capitalize text-ink">{row.metal}</span>
              </span>
              <span className="tnum text-[11px] text-muted">
                {row.articles} article{row.articles === 1 ? '' : 's'} · net{' '}
                <span
                  style={{
                    color:
                      row.avg_sentiment > 0.05
                        ? 'var(--c-up)'
                        : row.avg_sentiment < -0.05
                          ? 'var(--c-down)'
                          : 'var(--c-muted)',
                  }}
                >
                  {row.avg_sentiment >= 0 ? '+' : '−'}
                  {Math.abs(row.avg_sentiment).toFixed(2)}
                </span>
              </span>
            </div>
            <div className="flex h-1.5 overflow-hidden rounded-full bg-lineSoft">
              {parts.map((p) => (
                <div
                  key={p.key}
                  style={{ width: `${(p.value / total) * 100}%`, background: p.color, opacity: 0.85 }}
                  title={`${p.key}: ${p.value} (${probability(p.value / total)})`}
                />
              ))}
            </div>
            <div className="mt-1 flex justify-between font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">
              <span>{row.bullish} bullish</span>
              <span>{row.neutral} neutral</span>
              <span>{row.bearish} bearish</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
