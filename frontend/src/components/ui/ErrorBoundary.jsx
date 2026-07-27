import { Component } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from './Button'

/** Keeps one broken widget from taking the whole dashboard down. */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[MetalCast] component crashed', error, info)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="panel flex flex-col items-center gap-3 p-6 text-center">
        <AlertTriangle size={20} className="text-amber" />
        <div>
          <p className="font-display text-sm font-semibold text-ink">
            {this.props.label || 'This panel stopped rendering'}
          </p>
          <p className="mt-1 max-w-md text-xs text-muted">{error.message}</p>
        </div>
        <Button size="sm" icon={RotateCcw} onClick={() => this.setState({ error: null })}>
          Try again
        </Button>
      </div>
    )
  }
}
