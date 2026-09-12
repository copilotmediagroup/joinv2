import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

import { SignalAccessGate } from './features/onboarding/components'
import './features/onboarding/components/signalAccessGate.css'
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SignalAccessGate>
      <App />
    </SignalAccessGate>
  </StrictMode>,
)
