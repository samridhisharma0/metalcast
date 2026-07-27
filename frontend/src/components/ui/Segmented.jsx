import { motion } from 'framer-motion'
import { cn } from '../../lib/cn'

/** Range / tab selector with a sliding indicator. */
export function Segmented({ options, value, onChange, size = 'sm', className, layoutId }) {
  const id = layoutId || `seg-${options.map((o) => o.value ?? o).join('-')}`
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-line bg-raised p-0.5',
        className,
      )}
    >
      {options.map((raw) => {
        const option = typeof raw === 'string' ? { value: raw, label: raw } : raw
        const active = option.value === value
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(option.value)}
            title={option.title}
            className={cn(
              'relative rounded-md font-mono uppercase tracking-[0.06em] transition-colors duration-200',
              size === 'sm' ? 'px-2 py-1 text-[10.5px]' : 'px-3 py-1.5 text-xs',
              active ? 'text-ink' : 'text-faint hover:text-muted',
            )}
          >
            {active && (
              <motion.span
                layoutId={id}
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                className="absolute inset-0 rounded-md border border-line bg-panel"
                style={{ boxShadow: '0 1px 8px -4px rgba(0,0,0,0.6)' }}
              />
            )}
            <span className="relative z-10">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
