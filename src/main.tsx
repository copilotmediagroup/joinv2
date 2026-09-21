import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './features/onboarding/components/signalAccessGate.css'
import AppErrorBoundary from './AppErrorBoundary'

const DEPLOY_RELOAD_KEY = 'signal:last-stale-deploy-reload-at'
const DEPLOY_RELOAD_COOLDOWN_MS = 30_000

// Netlify deploys replace hashed lazy chunks atomically. A browser that was
// already open can still hold the previous app shell and request an old chunk
// when the user navigates later. Vite emits this event specifically for that
// stale-deploy boundary; recover once into the current deployment instead of
// dropping the user into the global runtime-error screen.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  const previous = Number(window.sessionStorage.getItem(DEPLOY_RELOAD_KEY) ?? '0')
  const now = Date.now()
  if (Number.isFinite(previous) && now - previous < DEPLOY_RELOAD_COOLDOWN_MS) return
  window.sessionStorage.setItem(DEPLOY_RELOAD_KEY, String(now))
  window.location.reload()
})

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
