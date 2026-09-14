import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
}

type State = {
  hasError: boolean
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('SIGNAL runtime error', error, info)
  }

  private reload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="runtime-error" role="alert">
          <span>SIGNAL</span>
          <h1>Something went wrong</h1>
          <p>Your account data is safe. Reload SIGNAL to reconnect and restore the latest state.</p>
          <button type="button" onClick={this.reload}>
            RELOAD SIGNAL
          </button>
        </main>
      )
    }

    return this.props.children
  }
}
