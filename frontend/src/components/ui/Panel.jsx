import { motion } from 'framer-motion'
import { cn } from '../../lib/cn'

/**
 * The one container in the system. Everything is a Panel with an optional
 * eyebrow label and a right-hand action slot, so the page reads as a set of
 * instrument bays rather than a pile of cards.
 */
export function Panel({
  eyebrow,
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  delay = 0,
  as = 'section',
}) {
  const Component = motion[as] || motion.section
  return (
    <Component
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
      className={cn('panel flex flex-col', className)}
    >
      {(eyebrow || title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            {title && (
              <h2 className="truncate font-display text-[15px] font-semibold tracking-tight text-ink">
                {title}
              </h2>
            )}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('flex-1 p-4 sm:p-5', bodyClassName)}>{children}</div>
    </Component>
  )
}
