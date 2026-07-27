import { cn } from '../../lib/cn'

/**
 * A labelled figure. The label sits *below* the number: on a data page the
 * number is what the eye is hunting for, so it gets the first line.
 */
export function StatTile({ label, value, unit, hint, tone = 'default', className, mono = true }) {
  const color =
    tone === 'up'
      ? 'text-up'
      : tone === 'down'
        ? 'text-down'
        : tone === 'patina'
          ? 'text-patina'
          : tone === 'amber'
            ? 'text-amber'
            : 'text-ink'
  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex items-baseline gap-1">
        <span className={cn('truncate text-lg font-medium leading-tight', mono && 'tnum', color)}>
          {value}
        </span>
        {unit && <span className="shrink-0 text-[10px] text-faint">{unit}</span>}
      </div>
      <div className="eyebrow mt-0.5 truncate" title={label}>
        {label}
      </div>
      {hint && <div className="mt-0.5 truncate text-[11px] text-muted">{hint}</div>}
    </div>
  )
}
