import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity,
  BarChart3,
  Command,
  Database,
  LineChart,
  LogOut,
  Menu,
  Moon,
  Newspaper,
  Radio,
  Sun,
  User,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useTheme } from '../../hooks/useTheme'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { cn } from '../../lib/cn'
import { timeLabel } from '../../lib/format'

export const NAV = [
  { to: '/', label: 'Dashboard', icon: Activity, hint: 'Live board and next-week outlook' },
  { to: '/forecasts', label: 'Forecasts', icon: LineChart, hint: 'Horizons, ensemble and skill' },
  { to: '/history', label: 'History', icon: BarChart3, hint: 'Stored daily bars and CSV export' },
  { to: '/news', label: 'News', icon: Newspaper, hint: 'Tagged metals coverage' },
  { to: '/system', label: 'System', icon: Database, hint: 'Feeds, jobs and database health' },
]

function Wordmark({ collapsed = false }) {
  return (
    <Link to="/" className="flex items-center gap-2.5 outline-none">
      <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-raised">
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" style={{ width: 18, height: 18 }}>
          <circle cx="12" cy="12" r="8" fill="none" stroke="var(--c-patina)" strokeWidth="1.5" />
          <circle cx="12" cy="12" r="3.5" fill="none" stroke="var(--c-copper)" strokeWidth="1.5" />
          <path d="M12 4v16" stroke="var(--c-aluminium)" strokeWidth="1" opacity="0.55" />
        </svg>
      </span>
      {!collapsed && (
        <span className="min-w-0">
          <span className="block font-display text-[15px] font-bold leading-none tracking-tight text-ink">
            MetalCast
          </span>
          <span className="eyebrow mt-1 block leading-none">AL · CU intelligence</span>
        </span>
      )}
    </Link>
  )
}

function NavItems({ onNavigate }) {
  return (
    <nav className="space-y-0.5">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] transition-colors duration-200',
              isActive ? 'text-ink' : 'text-muted hover:bg-raised hover:text-ink',
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.span
                  layoutId="nav-active"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  className="absolute inset-0 rounded-lg border border-line bg-raised"
                />
              )}
              <span
                className={cn(
                  'absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full transition-opacity',
                  isActive ? 'opacity-100' : 'opacity-0',
                )}
                style={{ background: 'var(--c-patina)' }}
              />
              <item.icon size={15} strokeWidth={1.9} className="relative z-10 shrink-0" />
              <span className="relative z-10 truncate">{item.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

function StreamPill({ streamState, asOf }) {
  const live = streamState === 'live'
  const Icon = live ? Wifi : streamState === 'connecting' ? Radio : WifiOff
  const color = live ? 'var(--c-up)' : streamState === 'connecting' ? 'var(--c-amber)' : 'var(--c-muted)'
  const label = live ? 'streaming' : streamState === 'connecting' ? 'connecting' : 'polling'
  return (
    <span
      className="flex items-center gap-1.5 rounded-md border border-line bg-panel px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em]"
      title={
        live
          ? 'Connected to the server-sent event stream'
          : 'Server-sent events unavailable — falling back to interval polling'
      }
    >
      <Icon size={11} style={{ color }} />
      <span style={{ color }}>{label}</span>
      {asOf && <span className="tnum hidden text-faint sm:inline">{timeLabel(asOf, 'HH:mm:ss')}</span>}
    </span>
  )
}

export function Shell({ children, streamState = 'connecting', asOf, onOpenPalette }) {
  const { user, logout } = useAuth()
  const { theme, toggle } = useTheme()
  const isMobile = useIsMobile()
  const [drawer, setDrawer] = useState(false)
  const location = useLocation()

  useEffect(() => setDrawer(false), [location.pathname])
  useEffect(() => {
    document.body.style.overflow = drawer ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [drawer])

  return (
    <div className="min-h-screen">
      {/* ---------------- desktop sidebar ---------------- */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[15.5rem] flex-col border-r border-line bg-panel/95 px-3 py-4 backdrop-blur lg:flex">
        <div className="px-1.5">
          <Wordmark />
        </div>

        <div className="mt-6 flex-1">
          <div className="eyebrow mb-2 px-2.5">Sections</div>
          <NavItems />
        </div>

        <div className="space-y-3 border-t border-line pt-3">
          <button
            type="button"
            onClick={onOpenPalette}
            className="flex w-full items-center justify-between rounded-lg border border-line px-2.5 py-1.5 text-left text-xs text-muted transition-colors hover:border-patina hover:text-ink"
          >
            <span className="flex items-center gap-1.5">
              <Command size={12} /> Quick jump
            </span>
            <kbd className="tnum rounded border border-line bg-raised px-1 py-px text-[9.5px] text-faint">
              ⌘K
            </kbd>
          </button>
          <p className="px-1.5 text-[10.5px] leading-relaxed text-faint">
            Forecasts are statistical estimates with stated uncertainty. Not investment advice.
          </p>
        </div>
      </aside>

      {/* ---------------- mobile drawer ---------------- */}
      <AnimatePresence>
        {drawer && isMobile && (
          <>
            <motion.button
              type="button"
              aria-label="Close navigation"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawer(false)}
              className="fixed inset-0 z-40 lg:hidden"
              style={{ background: 'var(--c-scrim)', backdropFilter: 'blur(2px)' }}
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 340, damping: 34 }}
              className="fixed inset-y-0 left-0 z-50 flex w-[15rem] flex-col border-r border-line bg-panel px-3 py-4 lg:hidden"
            >
              <div className="flex items-center justify-between px-1.5">
                <Wordmark />
                <button
                  type="button"
                  onClick={() => setDrawer(false)}
                  className="rounded-md p-1 text-muted hover:text-ink"
                  aria-label="Close navigation"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="mt-6 flex-1">
                <NavItems onNavigate={() => setDrawer(false)} />
              </div>
              {user && (
                <div className="flex items-center justify-between border-t border-line pt-3 px-1.5">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-raised text-[11px] font-semibold text-patina">
                      {user.name?.charAt(0)?.toUpperCase() || user.email?.charAt(0)?.toUpperCase() || 'U'}
                    </div>
                    <div>
                      <div className="text-[12px] font-medium text-ink truncate">{user.name}</div>
                      <div className="text-[10px] text-faint truncate">{user.email}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={logout}
                    className="rounded-md border border-line p-1.5 text-muted transition-colors hover:border-down hover:text-down"
                    aria-label="Sign out"
                  >
                    <LogOut size={14} />
                  </button>
                </div>
              )}
              <p className="px-1.5 text-[10.5px] leading-relaxed text-faint">
                Forecasts are statistical estimates with stated uncertainty. Not investment advice.
              </p>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ---------------- main column ---------------- */}
      <div className="lg:pl-[15.5rem]">
        <header className="sticky top-0 z-30 border-b border-line bg-base/85 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-[100rem] items-center gap-3 px-3 sm:px-5">
            <button
              type="button"
              onClick={() => setDrawer(true)}
              className="rounded-md border border-line p-1.5 text-muted transition-colors hover:text-ink lg:hidden"
              aria-label="Open navigation"
            >
              <Menu size={16} />
            </button>

            <div className="lg:hidden">
              <Wordmark collapsed />
            </div>

            <div className="hidden min-w-0 flex-1 items-baseline gap-2 lg:flex">
              <span className="eyebrow">
                {NAV.find((n) => n.to === location.pathname)?.label || 'MetalCast'}
              </span>
              <span className="truncate text-[11.5px] text-faint">
                {NAV.find((n) => n.to === location.pathname)?.hint || ''}
              </span>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <StreamPill streamState={streamState} asOf={asOf} />
              <button
                type="button"
                onClick={onOpenPalette}
                className="rounded-md border border-line p-1.5 text-muted transition-colors hover:border-patina hover:text-ink sm:hidden"
                aria-label="Quick jump"
              >
                <Command size={15} />
              </button>
              <button
                type="button"
                onClick={toggle}
                className="rounded-md border border-line p-1.5 text-muted transition-colors hover:border-patina hover:text-ink"
                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              >
                {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
              </button>
              {user && (
                <div className="flex items-center gap-1.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-raised text-[11px] font-semibold text-patina">
                    {user.name?.charAt(0)?.toUpperCase() || user.email?.charAt(0)?.toUpperCase() || 'U'}
                  </div>
                  <button
                    type="button"
                    onClick={logout}
                    className="rounded-md border border-line p-1.5 text-muted transition-colors hover:border-down hover:text-down"
                    aria-label="Sign out"
                    title="Sign out"
                  >
                    <LogOut size={14} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[100rem] px-3 py-4 sm:px-5 sm:py-6">{children}</main>

        <footer className="mx-auto max-w-[100rem] px-3 pb-8 pt-2 sm:px-5">
          <div className="hairline mb-3" />
          <div className="flex flex-col gap-1.5 text-[10.5px] text-faint sm:flex-row sm:items-center sm:justify-between">
            <span>
              MetalCast · prices, forecasts and news persisted in PostgreSQL · every figure on this
              site is reproducible from the API
            </span>
            <span className="tnum">
              <Link to="/system" className="transition-colors hover:text-patina">
                data sources &amp; job health →
              </Link>
            </span>
          </div>
        </footer>
      </div>
    </div>
  )
}
