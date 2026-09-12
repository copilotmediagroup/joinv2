import {
  createContext,
  useContext,
  type ReactNode,
} from 'react'
import type { OnboardingState } from '../onboardingClient'

export type SignalCurrentUserContextValue = {
  currentUser: OnboardingState
  updateCurrentUser: (currentUser: OnboardingState) => void
}

const SignalCurrentUserContext =
  createContext<SignalCurrentUserContextValue | null>(null)

type SignalCurrentUserProviderProps = {
  value: SignalCurrentUserContextValue
  children: ReactNode
}

export function SignalCurrentUserProvider({
  value,
  children,
}: SignalCurrentUserProviderProps) {
  return (
    <SignalCurrentUserContext.Provider value={value}>
      {children}
    </SignalCurrentUserContext.Provider>
  )
}

function useSignalCurrentUserContextValue():
SignalCurrentUserContextValue {
  const context =
    useContext(SignalCurrentUserContext)

  if (!context) {
    throw new Error(
      'SIGNAL current-user context is unavailable.',
    )
  }

  return context
}

// Hook exports intentionally share this tiny context module with its provider.
// eslint-disable-next-line react-refresh/only-export-components
export function useSignalCurrentUser(): OnboardingState {
  return useSignalCurrentUserContextValue().currentUser
}

// eslint-disable-next-line react-refresh/only-export-components
export function useUpdateSignalCurrentUser():
SignalCurrentUserContextValue['updateCurrentUser'] {
  return useSignalCurrentUserContextValue().updateCurrentUser
}
