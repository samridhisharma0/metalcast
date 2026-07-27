import { cn } from '../../lib/cn'

const TONES = {
  neutral: 'border-line bg-raised text-muted',
  patina: 'border-patina-deep bg-patina/10 text-patina',
  up: 'border-transparent text-up',
  down: 'border-transparent text-down',
  amber: 'border-transparent text-amber',
  outline: 'border-line text-faint',
}

export function Badge({ tone = 'neutral', children, className, icon: Icon, title }) {
  const style =
    tone === 'up'
      ? { background: 'var(--c-up-wash)' }
      : tone === 'down'
        ? { background: 'var(--c-down-wash)' }
        : tone === 'amber'
          ? { background: 'rgba(232,163,61,0.14)' }
          : undefined
  return (
    <span
      title={title}
      style={style}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]',
        TONES[tone] || TONES.neutral,
        className,
      )}
    >
      {Icon && <Icon size={11} strokeWidth={2.4} />}
      {children}
    </span>
  )
}
