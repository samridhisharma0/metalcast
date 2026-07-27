import { Button } from './Button'

/** Empty and error states get direction, not an apology. */
export function Empty({ icon: Icon, title, hint, action, onAction, actionIcon }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      {Icon && (
        <div className="rounded-xl border border-line bg-raised p-3 text-faint">
          <Icon size={20} strokeWidth={1.8} />
        </div>
      )}
      <div>
        <p className="font-display text-sm font-semibold text-ink">{title}</p>
        {hint && <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted">{hint}</p>}
      </div>
      {action && (
        <Button size="sm" variant="outline" icon={actionIcon} onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
  )
}
