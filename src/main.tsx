import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './features/onboarding/components/signalAccessGate.css'
import AppErrorBoundary from './AppErrorBoundary'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Application root is missing')
const root = createRoot(rootElement)

async function boot() {
  try {
    const [{ default: App }, { SignalAccessGate }] = await Promise.all([
      import('./App.tsx'),
      import('./features/onboarding/components'),
    ])

    root.render(
      <StrictMode>
        <AppErrorBoundary>
          <SignalAccessGate>
            <App />
          </SignalAccessGate>
        </AppErrorBoundary>
      </StrictMode>,
    )
  } catch (error) {
    console.error('SIGNAL failed to start', error)
    const message = error instanceof Error ? error.message : 'Unknown startup error'
    root.render(<main className="startup-error"><h1>SIGNAL couldn’t start</h1><p>{message}</p></main>)
  }
}

void boot()
