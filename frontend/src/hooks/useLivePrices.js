import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { STREAM_URL, api } from '../lib/api'

/**
 * Live prices with a two-tier strategy:
 *   1. Server-Sent Events — the backend pushes every poll result.
 *   2. If SSE never connects (proxy buffering, corporate firewall, older
 *      hosting tiers), fall back to interval polling so the tape still moves.
 *
 * `flash` records which metals changed on the last update so the tape can
 * flicker green/red the way a real terminal does.
 */
export function useLivePrices({ pollMs = 30000 } = {}) {
  const queryClient = useQueryClient()
  const [streamState, setStreamState] = useState('connecting') // connecting | live | polling
  const [flash, setFlash] = useState({})
  const previous = useRef({})
  const retries = useRef(0)

  const query = useQuery({
    queryKey: ['prices', 'latest'],
    queryFn: api.latestPrices,
    refetchInterval: streamState === 'live' ? false : pollMs,
    staleTime: 5000,
  })

  // remember previous values to compute the flash direction
  useEffect(() => {
    const prices = query.data?.prices
    if (!prices) return
    const next = {}
    const changed = {}
    prices.forEach((p) => {
      next[p.metal] = p.price
      const before = previous.current[p.metal]
      if (before !== undefined && p.price !== null && before !== p.price) {
        changed[p.metal] = p.price > before ? 'up' : 'down'
      }
    })
    previous.current = next
    if (Object.keys(changed).length) {
      setFlash(changed)
      const t = setTimeout(() => setFlash({}), 950)
      return () => clearTimeout(t)
    }
    return undefined
  }, [query.data])

  useEffect(() => {
    if (typeof window === 'undefined' || !('EventSource' in window)) {
      setStreamState('polling')
      return undefined
    }
    let source
    let closed = false
    let fallbackTimer

    const connect = () => {
      try {
        source = new EventSource(STREAM_URL)
      } catch {
        setStreamState('polling')
        return
      }

      // If we do not hear anything within 12s, assume SSE is blocked.
      fallbackTimer = setTimeout(() => {
        if (streamState !== 'live') setStreamState('polling')
      }, 12000)

      source.addEventListener('open', () => {
        retries.current = 0
      })

      const absorb = () => {
        clearTimeout(fallbackTimer)
        setStreamState('live')
        // The event payload is a partial; refetch the enriched snapshot which
        // includes day change, ranges and staleness.
        queryClient.invalidateQueries({ queryKey: ['prices', 'latest'] })
      }

      source.addEventListener('snapshot', absorb)
      source.addEventListener('tick', absorb)

      source.addEventListener('error', () => {
        if (closed) return
        source?.close()
        retries.current += 1
        setStreamState(retries.current > 2 ? 'polling' : 'connecting')
        // exponential backoff, capped
        const wait = Math.min(30000, 2000 * 2 ** Math.min(retries.current, 4))
        fallbackTimer = setTimeout(connect, wait)
      })
    }

    connect()
    return () => {
      closed = true
      clearTimeout(fallbackTimer)
      source?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient])

  return {
    prices: query.data?.prices ?? [],
    asOf: query.data?.as_of,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    streamState,
    flash,
  }
}
