/** Formatting helpers. All money is USD per metric tonne unless stated. */
import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns'

const nf = (min, max) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max })

const f0 = nf(0, 0)
const f2 = nf(2, 2)

export function money(value, { decimals = 2, dash = '—' } = {}) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return dash
  return (decimals === 0 ? f0 : f2).format(Number(value))
}

export function compact(value, dash = '—') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return dash
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value))
}

export function signed(value, { decimals = 2, dash = '—' } = {}) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return dash
  const n = Number(value)
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${(decimals === 0 ? f0 : f2).format(Math.abs(n))}`
}

export function pct(value, { decimals = 2, dash = '—', withSign = true } = {}) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return dash
  const n = Number(value)
  const sign = withSign ? (n > 0 ? '+' : n < 0 ? '−' : '') : ''
  return `${sign}${Math.abs(n).toFixed(decimals)}%`
}

export function probability(value, dash = '—') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return dash
  return `${(Number(value) * 100).toFixed(0)}%`
}

function toDate(value) {
  if (!value) return null
  if (value instanceof Date) return isValid(value) ? value : null
  const parsed = typeof value === 'string' ? parseISO(value) : new Date(value)
  return isValid(parsed) ? parsed : null
}

export function dateLabel(value, pattern = 'd MMM yyyy') {
  const d = toDate(value)
  return d ? format(d, pattern) : '—'
}

export function timeLabel(value, pattern = 'HH:mm:ss') {
  const d = toDate(value)
  return d ? format(d, pattern) : '—'
}

export function relativeTime(value) {
  const d = toDate(value)
  if (!d) return '—'
  const seconds = (Date.now() - d.getTime()) / 1000
  if (seconds < 45) return 'just now'
  try {
    return `${formatDistanceToNowStrict(d)} ago`
  } catch {
    return '—'
  }
}

export function direction(value) {
  if (value === null || value === undefined) return 'flat'
  const n = Number(value)
  return n > 0 ? 'up' : n < 0 ? 'down' : 'flat'
}

export function trendColor(value) {
  const d = direction(value)
  return d === 'up' ? 'var(--c-up)' : d === 'down' ? 'var(--c-down)' : 'var(--c-muted)'
}

export function metalColor(metal) {
  return metal === 'copper' ? 'var(--c-copper)' : 'var(--c-aluminium)'
}

export function titleCase(text = '') {
  return text.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Turn an array of objects into a downloadable CSV. */
export function toCsv(rows, columns) {
  if (!rows?.length) return ''
  const cols = columns || Object.keys(rows[0])
  const esc = (v) => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
}

export function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
