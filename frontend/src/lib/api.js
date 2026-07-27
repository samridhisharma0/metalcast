/**
 * Single place that knows how to talk to the backend.
 * Every call funnels through `request` so timeouts, JSON errors and the
 * envelope shape are handled once.
 */
const BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')
const ADMIN_TOKEN_KEY = 'metalcast.adminToken'

export class ApiError extends Error {
  constructor(message, { status = 0, detail = null, url = '' } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
    this.url = url
  }
}

export function getAdminToken() {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function setAdminToken(token) {
  try {
    if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token)
    else localStorage.removeItem(ADMIN_TOKEN_KEY)
  } catch {
    /* storage blocked — token simply won't persist */
  }
}

function qs(params = {}) {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') search.append(k, v)
  })
  const s = search.toString()
  return s ? `?${s}` : ''
}

async function request(path, { method = 'GET', params, body, admin = false, timeout = 30000 } = {}) {
  const url = `${BASE}${path}${qs(params)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  const headers = { Accept: 'application/json' }
  if (body) headers['Content-Type'] = 'application/json'
  if (admin) headers['X-Admin-Token'] = getAdminToken()

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    const text = await res.text()
    let payload = null
    if (text) {
      try {
        payload = JSON.parse(text)
      } catch {
        payload = { detail: text.slice(0, 400) }
      }
    }

    if (!res.ok) {
      const detail = payload?.detail || payload?.error || res.statusText
      throw new ApiError(
        typeof detail === 'string' ? detail : `Request failed with ${res.status}`,
        { status: res.status, detail: payload, url },
      )
    }
    return payload
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ApiError('The request timed out. The backend may still be warming up.', { url })
    }
    if (err instanceof ApiError) throw err
    throw new ApiError(
      'Cannot reach the API. Check that the backend is running and VITE_API_BASE_URL is correct.',
      { detail: String(err), url },
    )
  } finally {
    clearTimeout(timer)
  }
}

export const api = {
  health: () => request('/health', { timeout: 10000 }),
  metals: () => request('/meta/metals'),
  systemStatus: () => request('/system/status'),

  latestPrices: () => request('/prices/latest'),
  history: (metal, range = '1Y') => request(`/prices/${metal}/history`, { params: { range } }),
  ticks: (metal, hours = 24) => request(`/prices/${metal}/ticks`, { params: { hours } }),
  priceStats: (metal) => request(`/prices/${metal}/stats`),
  correlation: (window = 90) => request('/prices/correlation', { params: { window } }),

  predictions: (metal, horizon = 'all') =>
    request(`/predictions/${metal}`, { params: { horizon } }),
  predictionTrack: (metal, horizonDays = 1, limit = 90) =>
    request(`/predictions/${metal}/track`, { params: { horizon_days: horizonDays, limit } }),
  accuracy: (metal) => request(`/predictions/${metal}/accuracy`),
  accuracyAll: () => request('/predictions/accuracy/all'),
  runPrediction: (metal) => request(`/predictions/${metal}/run`, { method: 'POST', admin: true, timeout: 120000 }),

  news: ({ metal, q, sentiment, page = 1, pageSize = 18 } = {}) =>
    request('/news', { params: { metal, q, sentiment, page, page_size: pageSize } }),
  newsSentiment: (hours = 72) => request('/news/sentiment', { params: { hours } }),

  runJob: (name) => request(`/admin/jobs/${name}/run`, { method: 'POST', admin: true, timeout: 180000 }),
  backfill: (days = 900, force = false) =>
    request('/admin/backfill', { method: 'POST', admin: true, params: { days, force }, timeout: 180000 }),
}

export const STREAM_URL = `${BASE}/stream/prices`
export const METAL_META = {
  aluminium: { label: 'Aluminium', symbol: 'XAL', varName: '--c-aluminium' },
  copper: { label: 'Copper', symbol: 'XCU', varName: '--c-copper' },
}
