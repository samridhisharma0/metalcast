import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useToast } from '../../hooks/useToast'

const ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle }
const COLORS = {
  info: 'var(--c-patina)',
  success: 'var(--c-up)',
  warning: 'var(--c-amber)',
  error: 'var(--c-down)',
}

export function Toaster() {
  const { toasts, dismiss } = useToast()
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const Icon = ICONS[toast.tone] || Info
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.97 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="panel pointer-events-auto flex items-start gap-2.5 p-3 shadow-lift"
            >
              <Icon size={15} style={{ color: COLORS[toast.tone] }} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium leading-snug text-ink">{toast.title}</p>
                {toast.description && (
                  <p className="mt-0.5 break-words text-xs leading-relaxed text-muted">
                    {toast.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="shrink-0 rounded p-0.5 text-faint transition-colors hover:text-ink"
                aria-label="Dismiss"
              >
                <X size={13} />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
