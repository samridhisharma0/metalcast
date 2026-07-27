import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Database, HardDriveDownload, Key, Play, RefreshCw, ServerCrash, X } from 'lucide-react'
import { api, getAdminToken, setAdminToken } from '../lib/api'
import { relativeTime, timeLabel } from '../lib/format'
import { useToast } from '../hooks/useToast'
import { Panel } from '../components/ui/Panel'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { StatTile } from '../components/ui/StatTile'
import { SkeletonText } from '../components/ui/Skeleton'
import { Empty } from '../components/ui/Empty'

function JobRow({ job }) {
  const ok = job.status === 'ok'
  const running = job.status === 'running'
  return (
    <tr className="border-b border-line transition-colors last:border-b-0 hover:bg-raised">
      <td className="px-3 py-2 pl-5 font-mono text-[11.5px] text-ink">{job.job_name}</td>
      <td className="px-3 py-2">
        <Badge tone={running ? 'amber' : ok ? 'up' : 'down'}>{job.status}</Badge>
      </td>
      <td className="tnum px-3 py-2 text-muted">{timeLabel(job.started_at, 'd MMM HH:mm:ss')}</td>
      <td className="tnum px-3 py-2 text-muted">{job.duration_ms ?? '—'}</td>
      <td className="px-3 py-2 pr-5">
        <span className="line-clamp-1 text-[11.5px] text-faint" title={job.message || ''}>
          {job.message || '—'}
        </span>
      </td>
    </tr>
  )
}

export default function System() {
  const status = useQuery({ queryKey: ['systemStatus'], queryFn: () => api.systemStatus(), refetchInterval: 20_000 })
  const [token, setToken] = useState(getAdminToken())
  const toast = useToast()
  const qc = useQueryClient()

  const saveToken = (v) => {
    setToken(v)
    setAdminToken(v)
    toast.push({ title: v ? 'Admin token saved locally' : 'Admin token cleared', tone: 'default' })
  }

  const runJob = async (name) => {
    try {
      await api.runJob(name)
      toast.push({ title: `Kicked off ${name}`, tone: 'success' })
      qc.invalidateQueries({ queryKey: ['systemStatus'] })
    } catch (err) {
      toast.push({ title: err.message || 'Job could not be started', tone: 'error' })
    }
  }

  const triggerBackfill = async () => {
    try {
      toast.push({ title: 'Backfilling daily history…', tone: 'default' })
      const res = await api.backfill(900, true)
      const metals = Object.entries(res.metals || {})
      const written = metals.reduce((s, [, m]) => s + (m.written || 0), 0)
      toast.push({ title: `Backfill done · ${written} bars stored. Running forecasts…`, tone: 'success' })
      try {
        await api.runJob('forecast')
        toast.push({ title: 'Forecasts generated', tone: 'success' })
      } catch {
        toast.push({ title: 'Forecast run failed — try Run forecast manually', tone: 'error' })
      }
      qc.invalidateQueries({ queryKey: ['systemStatus'] })
      qc.invalidateQueries({ queryKey: ['predictions'] })
      qc.invalidateQueries({ queryKey: ['history'] })
    } catch (err) {
      toast.push({ title: err.message || 'Backfill request failed', tone: 'error' })
    }
  }

  const data = status.data

  return (
    <div className="space-y-4 sm:space-y-5">
      <div>
        <h1 className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
          System status
        </h1>
        <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-muted">
          Every scheduled job writes its outcome to <span className="font-mono">job_runs</span>, so a
          silent failure is loud on this page. Everything below reads from the same tables the rest of
          the app uses.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel eyebrow="Providers" title="Price feeds" bodyClassName="p-0">
          {status.isLoading ? (
            <div className="px-5 py-5">
              <SkeletonText lines={4} />
            </div>
          ) : (
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-raised">
                  {['Provider', 'Status', 'Requests', 'Last success'].map((h) => (
                    <th key={h} className="eyebrow px-3 py-2 text-left font-medium first:pl-5">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.price_providers ?? []).map((p) => (
                  <tr key={p.name} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2.5 pl-5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12px] text-ink">{p.name}</span>
                        {!p.configured && (
                          <span className="text-[10px] text-faint" title="No API key set">
                            (no key)
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={p.status === 'ok' ? 'up' : p.status === 'unused' ? 'neutral' : 'down'}>
                        {p.status}
                      </Badge>
                    </td>
                    <td className="tnum px-3 py-2.5 text-muted">{p.calls ?? 0}</td>
                    <td className="tnum px-3 py-2.5 text-muted">
                      {p.last_success ? relativeTime(p.last_success) : '—'}
                    </td>
                  </tr>
                ))}
                {(data?.price_providers ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-5">
                      <Empty icon={ServerCrash} title="No providers reported" hint="Backend may be starting up." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel eyebrow="Providers" title="News feeds" bodyClassName="p-0">
          {status.isLoading ? (
            <div className="px-5 py-5">
              <SkeletonText lines={4} />
            </div>
          ) : (
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-raised">
                  {['Feed', 'Status', 'Fetched', 'Last success'].map((h) => (
                    <th key={h} className="eyebrow px-3 py-2 text-left font-medium first:pl-5">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.news_providers ?? []).map((p) => (
                  <tr key={p.name} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2.5 pl-5 font-mono text-[12px] text-ink">{p.name}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={p.status === 'ok' ? 'up' : p.status === 'unused' ? 'neutral' : 'down'}>
                        {p.status}
                      </Badge>
                    </td>
                    <td className="tnum px-3 py-2.5 text-muted">{p.articles ?? 0}</td>
                    <td className="tnum px-3 py-2.5 text-muted">
                      {p.last_success ? relativeTime(p.last_success) : '—'}
                    </td>
                  </tr>
                ))}
                {(data?.news_providers ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-5">
                      <Empty icon={ServerCrash} title="No feeds configured" hint="RSS feeds work without keys." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <Panel eyebrow="PostgreSQL" title="Database" delay={0.05}>
        {status.isLoading ? (
          <SkeletonText lines={3} />
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
            <StatTile
              label="Database"
              value={data?.db?.ok ? 'connected' : 'unreachable'}
              tone={data?.db?.ok ? 'up' : 'down'}
              mono={false}
            />
            <StatTile label="Price ticks" value={data?.db?.stats?.ticks ?? 0} />
            <StatTile label="Daily bars" value={data?.db?.stats?.daily ?? 0} />
            <StatTile label="Prediction runs" value={data?.db?.stats?.runs ?? 0} />
            <StatTile label="Predictions stored" value={data?.db?.stats?.predictions ?? 0} />
            <StatTile label="News articles" value={data?.db?.stats?.articles ?? 0} />
            <StatTile label="Job records" value={data?.db?.stats?.jobs ?? 0} />
            <StatTile label="Version" value={data?.db?.version || '—'} mono />
          </div>
        )}
      </Panel>

      <Panel
        eyebrow="Scheduled jobs"
        title="Recent job runs"
        subtitle={(() => {
          const sched = data?.schedule
          if (!sched || !Array.isArray(sched) || sched.length === 0) return undefined
          const map = Object.fromEntries(sched.map(j => [j.id, j.trigger]))
          return `Prices ${map.prices || '—'} · News ${map.news || '—'} · Forecast ${map.forecast || '—'}`
        })()}
        actions={
          <Button
            size="sm"
            variant="ghost"
            icon={RefreshCw}
            onClick={() => {
              qc.invalidateQueries({ queryKey: ['systemStatus'] })
            }}
          >
            Refresh
          </Button>
        }
        delay={0.1}
        bodyClassName="p-0"
      >
        {status.isLoading ? (
          <div className="px-5 py-5">
            <SkeletonText lines={5} />
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead className="sticky top-0 bg-panel">
                <tr className="border-b border-line">
                  {['Job', 'Status', 'Started', 'Duration (ms)', 'Notes'].map((h) => (
                    <th key={h} className="eyebrow px-3 py-2 text-left font-medium first:pl-5">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.recent_jobs ?? []).map((j) => (
                  <JobRow key={`${j.job_name}-${j.started_at}`} job={j} />
                ))}
                {(data?.recent_jobs ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-5">
                      <Empty icon={Database} title="No jobs have run yet" hint="They start automatically once the backend is up." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        eyebrow="Manual controls"
        title="Admin actions"
        subtitle="Kick jobs manually. Requires the admin token from the backend .env."
        delay={0.15}
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <div className="rounded-xl border border-line bg-raised p-4">
            <div className="mb-2 flex items-center gap-1.5">
              <Key size={13} className="text-patina" />
              <div className="eyebrow">Admin token</div>
              {token ? <Check size={12} className="text-up" /> : <X size={12} className="text-faint" />}
            </div>
            <input
              value={token}
              onChange={(e) => saveToken(e.target.value)}
              type="password"
              placeholder="Paste the admin token from your .env"
              className="w-full rounded-md border border-line bg-panel px-2.5 py-1.5 font-mono text-[12px] text-ink outline-none placeholder:text-faint focus:border-patina"
            />
            <p className="mt-2 text-[10.5px] leading-relaxed text-faint">
              Stored in this browser's localStorage. Never sent anywhere except to your own backend.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {['prices', 'news', 'forecast', 'accuracy', 'maintenance'].map((name) => (
              <Button
                key={name}
                variant="secondary"
                icon={Play}
                onClick={() => runJob(name)}
                disabled={!token}
                className="capitalize"
              >
                Run {name}
              </Button>
            ))}
            <Button variant="primary" icon={HardDriveDownload} onClick={triggerBackfill} disabled={!token}>
              Backfill history
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  )
}
