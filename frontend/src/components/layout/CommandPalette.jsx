import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Moon, RefreshCw, Search, Sun } from 'lucide-react'
import { NAV } from './Shell'
import { useTheme } from '../../hooks/useTheme'
import { cn } from '../../lib/cn'

/**
 * ⌘K palette. Keyboard-first navigation matters on a dashboard people keep open
 * all day; it also gives the two metal detail pages a discoverable route.
 */
export function CommandPalette({ open, onClose, onRefresh }) {
  const navigate = useNavigate()
  const { theme, toggle } = useTheme()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef(null)

  const commands = useMemo(
    () => [
      ...NAV.map((n) => ({
        id: `nav:${n.to}`,
        label: n.label,
        hint: n.hint,
        group: 'Go to',
        icon: n.icon,
        run: () => navigate(n.to),
      })),
      {
        id: 'metal:aluminium',
        label: 'Aluminium detail',
        hint: 'LME XAL — chart, stats, forecast, news',
        group: 'Go to',
        icon: ArrowRight,
        run: () => navigate('/metal/aluminium'),
      },
      {
        id: 'metal:copper',
        label: 'Copper detail',
        hint: 'LME XCU — chart, stats, forecast, news',
        group: 'Go to',
        icon: ArrowRight,
        run: () => navigate('/metal/copper'),
      },
      {
        id: 'action:refresh',
        label: 'Refresh all data',
        hint: 'Refetch every query on the page',
        group: 'Actions',
        icon: RefreshCw,
        run: () => onRefresh?.(),
      },
      {
        id: 'action:theme',
        label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        hint: 'Persisted for next visit',
        group: 'Actions',
        icon: theme === 'dark' ? Sun : Moon,
        run: () => toggle(),
      },
    ],
    [navigate, onRefresh, theme, toggle],
  )

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.hint?.toLowerCase().includes(q),
    )
  }, [commands, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
      const t = setTimeout(() => inputRef.current?.focus(), 40)
      return () => clearTimeout(t)
    }
    return undefined
  }, [open])

  useEffect(() => setCursor(0), [query])

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      onClose()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setCursor((c) => (results.length ? (c + 1) % results.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCursor((c) => (results.length ? (c - 1 + results.length) % results.length : 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const target = results[cursor]
      if (target) {
        target.run()
        onClose()
      }
    }
  }

  let lastGroup = null

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]">
          <motion.button
            type="button"
            aria-label="Close quick jump"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0"
            style={{ background: 'var(--c-scrim)', backdropFilter: 'blur(3px)' }}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Quick jump"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="panel relative w-full max-w-lg overflow-hidden shadow-lift"
            onKeyDown={onKeyDown}
          >
            <div className="flex items-center gap-2.5 border-b border-line px-3.5 py-3">
              <Search size={15} className="shrink-0 text-faint" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Jump to a page or run an action…"
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-faint"
                aria-label="Search commands"
              />
              <kbd className="tnum rounded border border-line bg-raised px-1.5 py-0.5 text-[9.5px] text-faint">
                esc
              </kbd>
            </div>

            <ul className="max-h-[52vh] overflow-y-auto py-1.5" role="listbox">
              {results.length === 0 && (
                <li className="px-4 py-6 text-center text-xs text-muted">
                  Nothing matches “{query}”. Try a page name like “forecasts”.
                </li>
              )}
              {results.map((c, i) => {
                const showGroup = c.group !== lastGroup
                lastGroup = c.group
                return (
                  <li key={c.id}>
                    {showGroup && <div className="eyebrow px-3.5 pb-1 pt-2">{c.group}</div>}
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === cursor}
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => {
                        c.run()
                        onClose()
                      }}
                      className={cn(
                        'flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors',
                        i === cursor ? 'bg-raised' : 'hover:bg-raised',
                      )}
                    >
                      <c.icon size={14} className={i === cursor ? 'text-patina' : 'text-faint'} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-ink">{c.label}</span>
                        {c.hint && <span className="block truncate text-[11px] text-faint">{c.hint}</span>}
                      </span>
                      {i === cursor && (
                        <kbd className="rounded border border-line bg-panel px-1 py-px text-[9px] text-faint">
                          ↵
                        </kbd>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
