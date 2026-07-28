import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, CheckCircle2, Eye, EyeOff, Mail, User, LogIn } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { cn } from '../lib/cn'

const FIELD =
  'w-full rounded-lg border border-line bg-panel px-3.5 py-2.5 pl-10 text-[13.5px] text-ink outline-none placeholder:text-faint transition-colors duration-200 focus:border-patina focus:ring-1 focus:ring-patina/30'

function FloatingOrb({ className, delay = 0 }) {
  return (
    <motion.div
      className={cn('absolute rounded-full blur-3xl opacity-20', className)}
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: [0.8, 1.1, 0.9, 1], opacity: 0.2 }}
      transition={{ duration: 8, delay, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' }}
    />
  )
}

export default function Login() {
  const { user, login, signup } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const firstRef = useRef(null)

  useEffect(() => {
    if (user) navigate('/', { replace: true })
  }, [user, navigate])

  useEffect(() => {
    setError('')
    setSuccess(false)
    setName('')
    setEmail('')
    setPassword('')
    setTimeout(() => firstRef.current?.focus(), 120)
  }, [mode])

  if (user) return null

  const valid =
    mode === 'signup'
      ? name.trim().length > 0 && email.includes('@') && password.length >= 4
      : email.includes('@') && password.length >= 4

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!valid || loading) return
    setLoading(true)
    setError('')
    await new Promise((r) => setTimeout(r, 400))

    let result
    if (mode === 'signup') {
      result = signup(name.trim(), email.trim().toLowerCase(), password)
    } else {
      result = login(email.trim().toLowerCase(), password)
    }

    if (result.error) {
      setError(result.error)
      setLoading(false)
    } else {
      setSuccess(true)
      setLoading(false)
      setTimeout(() => navigate('/', { replace: true }), 600)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      {/* background orbs */}
      <FloatingOrb className="h-72 w-72 bg-patina" delay={0} />
      <FloatingOrb className="absolute bottom-10 right-10 h-64 w-64 bg-copper" delay={2} />
      <FloatingOrb className="absolute top-20 left-1/3 h-48 w-48 bg-aluminium" delay={4} />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-md"
      >
        {/* logo */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-line bg-panel/80 backdrop-blur-sm">
            <svg viewBox="0 0 24 24" style={{ width: 28, height: 28 }}>
              <circle cx="12" cy="12" r="8" fill="none" stroke="var(--c-patina)" strokeWidth="1.5" />
              <circle cx="12" cy="12" r="3.5" fill="none" stroke="var(--c-copper)" strokeWidth="1.5" />
              <path d="M12 4v16" stroke="var(--c-aluminium)" strokeWidth="1" opacity="0.55" />
            </svg>
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">MetalCast</h1>
          <p className="mt-1 text-[12.5px] text-muted">
            Aluminium &amp; Copper intelligence — forecasts, prices and news
          </p>
        </div>

        {/* card */}
        <div className="rounded-2xl border border-line bg-panel/80 p-6 shadow-lift backdrop-blur-sm sm:p-8">
          {/* mode tabs */}
          <div className="mb-6 flex rounded-lg border border-line bg-raised p-0.5">
            {['login', 'signup'].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  'relative flex-1 rounded-md py-2 text-[13px] font-medium transition-colors duration-200',
                  mode === m ? 'text-ink' : 'text-muted hover:text-ink',
                )}
              >
                {mode === m && (
                  <motion.span
                    layoutId="auth-tab"
                    className="absolute inset-0 rounded-md border border-line bg-panel shadow-sm"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  />
                )}
                <span className="relative z-10">{m === 'login' ? 'Sign in' : 'Create account'}</span>
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <AnimatePresence mode="wait">
              <motion.div
                key={mode}
                initial={{ opacity: 0, x: mode === 'login' ? -8 : 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: mode === 'login' ? 8 : -8 }}
                transition={{ duration: 0.22 }}
                className="space-y-4"
              >
                {mode === 'signup' && (
                  <div className="relative">
                    <User size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
                    <input
                      ref={firstRef}
                      type="text"
                      placeholder="Your name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className={FIELD}
                      autoComplete="name"
                    />
                  </div>
                )}

                <div className="relative">
                  <Mail size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
                  <input
                    ref={mode === 'login' ? firstRef : undefined}
                    type="email"
                    placeholder="Email address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={FIELD}
                    autoComplete="email"
                  />
                </div>

                <div className="relative">
                  <LogIn size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
                  <input
                    type={showPw ? 'text' : 'password'}
                    placeholder="Password (min 4 characters)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={cn(FIELD, 'pr-10')}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-faint transition-colors hover:text-ink"
                    tabIndex={-1}
                  >
                    {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </motion.div>
            </AnimatePresence>

            <AnimatePresence>
              {error && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden text-[12px] text-down"
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            <button
              type="submit"
              disabled={!valid || loading}
              className={cn(
                'group relative flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-[13.5px] font-semibold transition-all duration-200',
                valid && !loading
                  ? 'bg-patina text-[#04100f] hover:brightness-110'
                  : 'cursor-not-allowed bg-raised text-faint',
              )}
            >
              {loading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
              ) : success ? (
                <>
                  <CheckCircle2 size={15} />
                  Welcome
                </>
              ) : (
                <>
                  {mode === 'login' ? 'Sign in' : 'Create account'}
                  <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>

          {mode === 'login' && (
            <p className="mt-4 text-center text-[12px] text-muted">
              Don&apos;t have an account?{' '}
              <button
                type="button"
                onClick={() => setMode('signup')}
                className="font-medium text-patina transition-colors hover:text-patina-deep"
              >
                Sign up
              </button>
            </p>
          )}
          {mode === 'signup' && (
            <p className="mt-4 text-center text-[12px] text-muted">
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => setMode('login')}
                className="font-medium text-patina transition-colors hover:text-patina-deep"
              >
                Sign in
              </button>
            </p>
          )}
        </div>

        <p className="mt-6 text-center text-[10.5px] leading-relaxed text-faint">
          Data is stored locally in your browser. No third-party auth service is used.
        </p>
      </motion.div>
    </div>
  )
}
