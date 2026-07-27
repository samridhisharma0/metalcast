import { cn } from '../../lib/cn'

export function Skeleton({ className }) {
  return <div className={cn('skeleton rounded-md', className)} />
}

export function SkeletonText({ lines = 3, className }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-3', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  )
}

export function SkeletonChart({ height = 260 }) {
  return (
    <div className="relative w-full overflow-hidden rounded-lg" style={{ height }}>
      <Skeleton className="absolute inset-0" />
      <div className="absolute inset-x-0 bottom-0 flex h-2/3 items-end gap-1.5 px-3 pb-3 opacity-40">
        {Array.from({ length: 26 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm bg-line"
            style={{ height: `${28 + Math.abs(Math.sin(i * 1.3)) * 62}%` }}
          />
        ))}
      </div>
    </div>
  )
}
