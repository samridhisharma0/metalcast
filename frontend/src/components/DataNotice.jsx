import { AlertTriangle, Database, Info } from 'lucide-react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'

/**
 * Provenance banner. The assignment forbids passing mock data off as real, so
 * the app states its own data quality in the interface rather than burying it
 * in a README: a synthetic feed or a delayed proxy is called out on every page.
 */
export function DataNotice({ prices = [] }) {
  const synthetic = prices.some((p) => p.source_kind === 'synthetic')
  const delayed = prices.some((p) => p.source === 'yahoo_futures')
  const stale = prices.some((p) => p.stale)
  const empty = prices.length > 0 && prices.every((p) => p.price === null)

  if (!synthetic && !delayed && !stale && !empty) return null

  const notices = []
  if (synthetic) {
    notices.push({
      tone: 'error',
      icon: AlertTriangle,
      title: 'Synthetic data is switched on',
      body: 'These numbers are generated, not market prices. Set ALLOW_SYNTHETIC=false and configure a real provider key before showing this to anyone.',
    })
  }
  if (empty) {
    notices.push({
      tone: 'warning',
      icon: Database,
      title: 'No prices stored yet',
      body: 'The backend has not recorded a tick. Check provider keys and job status on the System page.',
    })
  }
  if (delayed && !synthetic) {
    notices.push({
      tone: 'info',
      icon: Info,
      title: 'Serving the delayed futures fallback',
      body: 'Primary LME spot feed is unavailable, so quotes come from COMEX/CME futures via Yahoo Finance — real market data, but delayed and futures-based rather than LME cash.',
    })
  }
  if (stale && !empty) {
    notices.push({
      tone: 'warning',
      icon: AlertTriangle,
      title: 'Quotes are older than expected',
      body: 'No fresh tick arrived within the polling window. The exchange may be closed, or the price job may be failing.',
    })
  }

  const COLORS = {
    error: 'var(--c-down)',
    warning: 'var(--c-amber)',
    info: 'var(--c-patina)',
  }

  return (
    <div className="space-y-2">
      {notices.map((n) => (
        <motion.div
          key={n.title}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5"
          style={{
            borderColor: COLORS[n.tone],
            background:
              n.tone === 'error'
                ? 'var(--c-down-wash)'
                : n.tone === 'warning'
                  ? 'rgba(232,163,61,0.12)'
                  : 'var(--c-patina-wash)',
          }}
        >
          <n.icon size={15} style={{ color: COLORS[n.tone] }} className="mt-0.5 shrink-0" />
          <div className="min-w-0 text-[12.5px] leading-relaxed">
            <span className="font-medium text-ink">{n.title}. </span>
            <span className="text-muted">{n.body} </span>
            <Link to="/system" className="whitespace-nowrap text-patina underline-offset-2 hover:underline">
              Open System
            </Link>
          </div>
        </motion.div>
      ))}
    </div>
  )
}
