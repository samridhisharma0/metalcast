import { Link } from 'react-router-dom'
import { Panel } from '../components/ui/Panel'
import { Button } from '../components/ui/Button'
import { ArrowRight, Compass } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg py-10">
      <Panel bodyClassName="p-8 text-center">
        <Compass size={28} className="mx-auto text-patina" strokeWidth={1.5} />
        <h1 className="mt-4 font-display text-2xl font-semibold text-ink">Off the map</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          This route does not exist in MetalCast. The dashboard, the two metals, forecasts, history,
          news and system are the whole of it.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Link to="/">
            <Button variant="primary" icon={ArrowRight} iconPosition="right">
              Back to the board
            </Button>
          </Link>
        </div>
      </Panel>
    </div>
  )
}
