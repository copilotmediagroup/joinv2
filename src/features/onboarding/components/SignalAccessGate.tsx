import { useCallback, useEffect, useRef, useState } from 'react'
import { signOut } from '../../auth/authClient'
import { useAuthSession } from '../../auth/useAuthSession'
import {
  getMyOnboardingState,
  type OnboardingState,
} from '../onboardingClient'
import { AuthGateView } from './AuthGateView'
import { OnboardingGateView } from './OnboardingGateView'
import { SignalCurrentUserProvider } from './signalCurrentUserContext'
import { toUserFacingError } from '../../../lib/userFacingError'

type SignalAccessGateProps = {
  children: React.ReactNode
}

type GateState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | {
      kind: 'onboarding'
      onboarding: OnboardingState | null
    }
  | {
      kind: 'ready'
      onboarding: OnboardingState
    }
  | {
      kind: 'error'
      message: string
    }

export function SignalAccessGate({
  children,
}: SignalAccessGateProps) {
  const auth = useAuthSession()
  const [gateState, setGateState] = useState<GateState>({
    kind: 'loading',
  })
  const resolveEpochRef = useRef(0)

  const resolveGate = useCallback(async () => {
    const requestEpoch = ++resolveEpochRef.current
    if (auth.loading) {
      setGateState({ kind: 'loading' })
      return
    }

    if (auth.error) {
      setGateState({
        kind: 'error',
        message: 'SIGNAL could not verify your saved session. Check your connection and try again.',
      })
      return
    }

    if (!auth.user) {
      setGateState({ kind: 'signed-out' })
      return
    }

    setGateState({ kind: 'loading' })

    try {
      const onboarding = await getMyOnboardingState()
      if (requestEpoch !== resolveEpochRef.current) return

      if (
        onboarding?.completionState === 'complete'
      ) {
        setGateState({
          kind: 'ready',
          onboarding,
        })
        return
      }

      setGateState({
        kind: 'onboarding',
        onboarding,
      })
    } catch (error) {
      if (requestEpoch !== resolveEpochRef.current) return
      setGateState({
        kind: 'error',
        message:
          toUserFacingError(error, 'SIGNAL could not load your account right now.'),
      })
    }
  }, [auth.error, auth.loading, auth.user])

  useEffect(() => {
    let active = true

    queueMicrotask(() => {
      if (active) {
        void resolveGate()
      }
    })

    return () => {
      active = false
      resolveEpochRef.current += 1
    }
  }, [resolveGate])

  const updateCurrentUser = useCallback(
    (currentUser: OnboardingState) => {
      setGateState({
        kind: 'ready',
        onboarding: currentUser,
      })
    },
    [],
  )

  if (gateState.kind === 'loading') {
    return (
      <main className="signal-access-shell">
        <section className="signal-access-loading">
          <div className="signal-access-mark" aria-hidden="true">
            ⚡
          </div>
          <strong>SIGNAL</strong>
          <span>Finding your signal…</span>
        </section>
      </main>
    )
  }

  if (gateState.kind === 'signed-out') {
    return (
      <AuthGateView
        onAuthSuccess={resolveGate}
      />
    )
  }

  if (gateState.kind === 'error') {
    return (
      <main className="signal-access-shell">
        <section className="signal-access-card">
          <div className="signal-access-brand">
            <div
              className="signal-access-mark"
              aria-hidden="true"
            >
              ⚡
            </div>

            <div>
              <div className="signal-access-kicker">
                SIGNAL
              </div>
              <h1>We couldn't open your account.</h1>
              <p>{gateState.message}</p>
            </div>
          </div>

          <div className="signal-access-error-actions">
            <button
              type="button"
              className="signal-access-primary"
              onClick={() => {
                if (auth.error) {
                  window.location.reload()
                  return
                }
                void resolveGate()
              }}
            >
              TRY AGAIN
            </button>

            <button
              type="button"
              className="signal-access-secondary"
              onClick={() => void signOut()}
            >
              SIGN OUT
            </button>
          </div>
        </section>
      </main>
    )
  }

  if (gateState.kind === 'onboarding') {
    if (!auth.user) {
      return <AuthGateView />
    }

    return (
      <OnboardingGateView
        initialState={gateState.onboarding}
        onComplete={(onboarding) => {
          setGateState({
            kind: 'ready',
            onboarding,
          })
        }}
      />
    )
  }

  return (
    <SignalCurrentUserProvider
      value={{
        currentUser: gateState.onboarding,
        updateCurrentUser,
      }}
    >
      {children}
    </SignalCurrentUserProvider>
  )
}
