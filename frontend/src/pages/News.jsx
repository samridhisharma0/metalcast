import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Newspaper, Search, X } from 'lucide-react'
import { api } from '../lib/api'
import { Panel } from '../components/ui/Panel'
import { Segmented } from '../components/ui/Segmented'
import { SkeletonText } from '../components/ui/Skeleton'
import { Empty } from '../components/ui/Empty'
import { NewsCard, NewsCardSkeleton } from '../components/news/NewsCard'
import { SentimentSummary } from '../components/news/SentimentSummary'

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'aluminium', label: 'Aluminium' },
  { value: 'copper', label: 'Copper' },
]
const SENTIMENTS = [
  { value: 'any', label: 'Any' },
  { value: 'bullish', label: 'Bullish' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'bearish', label: 'Bearish' },
]

export default function News() {
  const [params, setParams] = useSearchParams()
  const initialMetal = params.get('metal') || 'all'
  const [metal, setMetal] = useState(initialMetal)
  const [sentiment, setSentiment] = useState('any')
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    const next = new URLSearchParams(params)
    if (metal === 'all') next.delete('metal')
    else next.set('metal', metal)
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metal])

  const query = useMemo(
    () => ({
      metal: metal === 'all' ? undefined : metal,
      sentiment: sentiment === 'any' ? undefined : sentiment,
      q: debouncedQ || undefined,
      pageSize: 40,
    }),
    [metal, sentiment, debouncedQ],
  )

  const news = useQuery({
    queryKey: ['news', query],
    queryFn: () => api.news(query),
    staleTime: 2 * 60 * 1000,
  })

  const sentimentQuery = useQuery({
    queryKey: ['newsSentiment', 72],
    queryFn: () => api.newsSentiment(72),
    staleTime: 5 * 60 * 1000,
  })

  return (
    <div className="space-y-4 sm:space-y-5">
      <div>
        <h1 className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
          Metals coverage
        </h1>
        <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-muted">
          Deduplicated across NewsAPI, GNews, Marketaux and Mining.com / Kitco RSS feeds. Sentiment is
          scored against a metals-specific lexicon rather than a generic classifier — “deficit”,
          “backwardation” and “curtailment” pull bullish; “glut”, “contango” and “stockpile” pull
          bearish.
        </p>
      </div>

      <Panel
        eyebrow="Rolling 72 hours"
        title="Sentiment snapshot"
        delay={0.05}
      >
        {sentimentQuery.isLoading ? (
          <SkeletonText lines={4} />
        ) : (
          <SentimentSummary byMetal={sentimentQuery.data?.by_metal ?? []} />
        )}
      </Panel>

      <Panel
        eyebrow={
          news.data?.total !== undefined
            ? `${news.data.total} matching articles`
            : 'Filter and search'
        }
        title="Headlines"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented layoutId="news-metal" options={FILTERS} value={metal} onChange={setMetal} />
            <Segmented
              layoutId="news-sent"
              options={SENTIMENTS}
              value={sentiment}
              onChange={setSentiment}
            />
          </div>
        }
        delay={0.1}
        bodyClassName="p-0"
      >
        <div className="border-b border-line px-4 py-2.5 sm:px-5">
          <label className="flex items-center gap-2 rounded-lg border border-line bg-raised px-2.5 py-1.5">
            <Search size={13} className="text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by keyword (e.g. Chile, warehouse, curtailment)"
              className="w-full bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ('')}
                className="rounded p-0.5 text-faint transition-colors hover:text-ink"
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </label>
        </div>

        {news.isLoading ? (
          <>
            {[0, 1, 2, 3, 4].map((i) => (
              <NewsCardSkeleton key={i} />
            ))}
          </>
        ) : news.data?.articles?.length ? (
          news.data.articles.map((a, i) => <NewsCard key={a.id} article={a} index={i} />)
        ) : (
          <Empty
            icon={Newspaper}
            title="Nothing matches this filter"
            hint="Widen the metal filter, clear the search, or run the news job from the System page."
          />
        )}
      </Panel>
    </div>
  )
}
