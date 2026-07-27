import { lazy, Suspense, useState } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import { Shell } from './components/layout/Shell'
import { CommandPalette } from './components/layout/CommandPalette'
import { Toaster } from './components/ui/Toaster'
import { SkeletonChart } from './components/ui/Skeleton'
import { useLivePrices } from './hooks/useLivePrices'
import { useHotkey } from './hooks/useHotkey'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const MetalDetail = lazy(() => import('./pages/MetalDetail'))
const Forecasts = lazy(() => import('./pages/Forecasts'))
const News = lazy(() => import('./pages/News'))
const History = lazy(() => import('./pages/History'))
const System = lazy(() => import('./pages/System'))
const NotFound = lazy(() => import('./pages/NotFound'))

function PageFallback() {
  return (
    <div className="space-y-4">
      <SkeletonChart height={140} />
      <SkeletonChart height={260} />
    </div>
  )
}

function RoutedApp({ live }) {
  const location = useLocation()
  return (
    <Suspense fallback={<PageFallback />}>
      <AnimatePresence mode="wait">
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          <Routes location={location}>
            <Route path="/" element={<Dashboard live={live} />} />
            <Route path="/metal/:code" element={<MetalDetail live={live} />} />
            <Route path="/forecasts" element={<Forecasts />} />
            <Route path="/news" element={<News />} />
            <Route path="/history" element={<History />} />
            <Route path="/system" element={<System />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </motion.div>
      </AnimatePresence>
    </Suspense>
  )
}

export default function App() {
  const live = useLivePrices()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const qc = useQueryClient()

  useHotkey('mod+k', (e) => {
    e.preventDefault()
    setPaletteOpen((v) => !v)
  })
  useHotkey('/', (e) => {
    // Only trigger when not already inside an input, so search boxes still work.
    const tag = document.activeElement?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    e.preventDefault()
    setPaletteOpen(true)
  })

  return (
    <>
      <Shell
        streamState={live.streamState}
        asOf={live.asOf}
        onOpenPalette={() => setPaletteOpen(true)}
      >
        <RoutedApp live={live} />
      </Shell>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onRefresh={() => qc.invalidateQueries()}
      />
      <Toaster />
    </>
  )
}
