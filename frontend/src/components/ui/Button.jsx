import { cn } from '../../lib/cn'

const VARIANTS = {
  primary:
    'bg-patina text-[#04100f] hover:brightness-110 border border-transparent font-semibold',
  ghost: 'bg-transparent text-muted hover:text-ink hover:bg-raised border border-transparent',
  outline: 'bg-transparent text-ink border border-line hover:border-patina hover:text-patina',
  danger: 'bg-transparent text-down border border-line hover:border-down',
}

const SIZES = {
  sm: 'h-7 px-2.5 text-[11px]',
  md: 'h-9 px-3.5 text-[13px]',
  lg: 'h-11 px-5 text-sm',
}

export function Button({
  variant = 'outline',
  size = 'md',
  icon: Icon,
  children,
  className,
  loading = false,
  ...rest
}) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-sans transition-all duration-200 ease-spring',
        'disabled:cursor-not-allowed disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading ? (
        <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
      ) : (
        Icon && <Icon size={size === 'sm' ? 12 : 14} strokeWidth={2.2} />
      )}
      {children}
    </button>
  )
}
