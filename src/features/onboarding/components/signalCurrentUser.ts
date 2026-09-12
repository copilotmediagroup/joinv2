import {
  createContext,
  useContext,
} from 'react'
import type { OnboardingState } from '../onboardingClient'

export type SignalCurrentUserContextValue = {
  currentUser: OnboardingState
  updateCurrentUser: (currentUser: OnboardingState) => void
}

export const SignalCurrentUserContext =
  createContext<SignalCurrentUserContextValue | null>(null)

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

export function useSignalCurrentUser(): OnboardingState {
  return useSignalCurrentUserContextValue().currentUser
}

export function useUpdateSignalCurrentUser():
SignalCurrentUserContextValue['updateCurrentUser'] {
  return useSignalCurrentUserContextValue().updateCurrentUser
}
