import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Table2 } from 'lucide-react'
import { api } from '../lib/api'
import { dateLabel, downloadCsv, metalColor, money, pct, toCsv } from '../lib/format'
import { Panel } from '../components/ui/Panel'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Segmented } from '../components/ui/Segmented'
import { SkeletonChart, SkeletonText } from '../components/ui/Skeleton'
import { Empty } from '../components/ui/Empty'
import { PriceChart } from '../components/charts/PriceChart'

const METALS = ['aluminium', 'copper']
const RANGES = ['1M', '3M', '6M', '1Y', '2Y', '5Y', 'MAX']

export default function History() {
  const [metal, setMetal] = useState('copper')
  const [range, setRange] = useState('1Y')

  const history = useQuery({
    queryKey: ['history', metal, range],
    queryFn: () => api.history(metal, range),
    staleTime: 5 * 60 * 1000,
  })

  const rows = history.data?.series ?? []
  const dailyRows = useMemo(() => rows.filter((r) => r.date), [rows])

  const summary = useMemo(() => {
    if (!dailyRows.length) return null
    const first = dailyRows[0]
    const last = dailyRows[dailyRows.length - 1]
    const closes = dailyRows.map((r) => r.close).filter((v) => v !== null && v !== undefined)
    const change = ((last.close - first.close) / first.close) * 100
    const high = Math.max(...closes)
    const low = Math.min(...closes)
    return { first, last, change, high, low, n: dailyRows.length }
  }, [dailyRows])

  const exportCsv = () => {
    if (!rows.length) return
    downloadCsv(
      `metalcast-${metal}-${range.toLowerCase()}-history.csv`,
      toCsv(
        rows.map((r) => ({
          date: r.date ?? r.ts,
          open: r.open ?? '',
          high: r.high ?? '',
          low: r.low ?? '',
          close: r.close,
          source: r.source ?? '',
        })),
        ['date', 'open', 'high', 'low', 'close', 'source'],
      ),
    )
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <div>
        <h1 className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
          Stored history
        </h1>
        <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-muted">
          Every daily bar is aggregated from stored ticks and persisted in PostgreSQL — the same table
          the forecast engine trains on. Download it as CSV to reproduce any number on this site.
        </p>
      </div>

      <Panel
        eyebrow={history.data ? `${history.data.count} points · granularity ${history.data.granularity}` : 'Stored bars'}
        title="Chart"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              layoutId="history-metal"
              options={METALS.map((m) => ({ value: m, label: m === 'aluminium' ? 'AL' : 'CU' }))}
              value={metal}
              onChange={setMetal}
            />
            <Segmented layoutId="history-range" options={RANGES} value={range} onChange={setRange} />
            <Button size="sm" variant="ghost" icon={Download} onClick={exportCsv}>
              CSV
            </Button>
          </div>
        }
      >
        {history.isLoading ? (
          <SkeletonChart height={340} />
        ) : rows.length === 0 ? (
          <Empty
            icon={Table2}
            title="No bars stored for this window"
            hint="Trigger a backfill from the System page to populate history."
          />
        ) : (
          <PriceChart series={rows} granularity={history.data.granularity} color={metalColor(metal)} height={340} showBrush />
        )}
      </Panel>

      {summary && (
        <Panel
          eyebrow={`${metal} · ${range}`}
          title="Range summary"
          delay={0.05}
          bodyClassName="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-5"
        >
          <div>
            <div className="eyebrow">Open</div>
            <div className="tnum mt-0.5 text-lg text-ink">{money(summary.first.close)}</div>
            <div className="text-[10.5px] text-faint">{dateLabel(summary.first.date, 'd MMM yy')}</div>
          </div>
          <div>
            <div className="eyebrow">Close</div>
            <div className="tnum mt-0.5 text-lg text-ink">{money(summary.last.close)}</div>
            <div className="text-[10.5px] text-faint">{dateLabel(summary.last.date, 'd MMM yy')}</div>
          </div>
          <div>
            <div className="eyebrow">Change</div>
            <div
              className="tnum mt-0.5 text-lg"
              style={{
                color: summary.change > 0 ? 'var(--c-up)' : summary.change < 0 ? 'var(--c-down)' : 'var(--c-muted)',
              }}
            >
              {pct(summary.change)}
            </div>
          </div>
          <div>
            <div className="eyebrow">High</div>
            <div className="tnum mt-0.5 text-lg text-ink">{money(summary.high, { decimals: 0 })}</div>
          </div>
          <div>
            <div className="eyebrow">Low</div>
            <div className="tnum mt-0.5 text-lg text-ink">{money(summary.low, { decimals: 0 })}</div>
          </div>
        </Panel>
      )}

      <Panel
        eyebrow="Daily bars · newest first"
        title="Data table"
        subtitle="This is the exact content the model sees when it trains"
        delay={0.1}
        bodyClassName="p-0"
      >
        {history.isLoading ? (
          <div className="px-5 py-5">
            <SkeletonText lines={6} />
          </div>
        ) : dailyRows.length === 0 ? (
          <div className="px-5 py-8">
            <Empty
              icon={Table2}
              title="No daily bars in this window"
              hint="Ticks arrive from the price job; daily bars are built from ticks by a maintenance job."
            />
          </div>
        ) : (
          <div className="max-h-[32rem] overflow-y-auto">
            <table className="w-full min-w-[40rem] border-collapse text-[12.5px]">
              <thead className="sticky top-0 z-10 bg-panel">
                <tr className="border-b border-line">
                  {['Date', 'Open', 'High', 'Low', 'Close', 'Change', 'Source'].map((h) => (
                    <th key={h} className="eyebrow px-3 py-2 text-left font-medium first:pl-5 last:pr-5">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...dailyRows].reverse().map((r, i, arr) => {
                  const prev = arr[i + 1]
                  const chg = prev && r.close && prev.close ? ((r.close - prev.close) / prev.close) * 100 : null
                  return (
                    <tr key={r.date} className="border-b border-line transition-colors last:border-b-0 hover:bg-raised">
                      <td className="tnum px-3 py-2 pl-5 text-muted">{dateLabel(r.date, 'd MMM yy')}</td>
                      <td className="tnum px-3 py-2 text-ink">{money(r.open, { decimals: 2 })}</td>
                      <td className="tnum px-3 py-2 text-ink">{money(r.high, { decimals: 2 })}</td>
                      <td className="tnum px-3 py-2 text-ink">{money(r.low, { decimals: 2 })}</td>
                      <td className="tnum px-3 py-2 font-medium text-ink">{money(r.close, { decimals: 2 })}</td>
                      <td
                        className="tnum px-3 py-2"
                        style={{
                          color: chg === null ? 'var(--c-muted)' : chg > 0 ? 'var(--c-up)' : chg < 0 ? 'var(--c-down)' : 'var(--c-muted)',
                        }}
                      >
                        {chg === null ? '—' : pct(chg)}
                      </td>
                      <td className="px-3 py-2 pr-5">
                        <Badge tone={r.source === 'yahoo_futures' ? 'amber' : 'patina'}>
                          {r.source || 'stored'}
                        </Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
