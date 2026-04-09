import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleDismiss = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    if (this.props.fallback) return this.props.fallback

    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100%', gap: 16, padding: 32,
        fontFamily: 'system-ui, sans-serif', color: '#333',
      }}>
        <h2 style={{ margin: 0 }}>Ein unerwarteter Fehler ist aufgetreten</h2>
        <p style={{ margin: 0, color: '#666', maxWidth: 480, textAlign: 'center' }}>
          {this.state.error?.message || 'Unbekannter Fehler'}
        </p>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={this.handleDismiss} style={{
            padding: '8px 20px', border: '1px solid #ccc', borderRadius: 6,
            background: '#fff', cursor: 'pointer', fontSize: 14,
          }}>
            Weiterarbeiten
          </button>
          <button onClick={this.handleReload} style={{
            padding: '8px 20px', border: 'none', borderRadius: 6,
            background: '#1976d2', color: '#fff', cursor: 'pointer', fontSize: 14,
          }}>
            Seite neu laden
          </button>
        </div>
      </div>
    )
  }
}
