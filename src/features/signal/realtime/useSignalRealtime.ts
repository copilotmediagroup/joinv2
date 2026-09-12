import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

import type {
  SignalRealtimeConnectionState,
  SignalRealtimeTarget,
  SignalSnapshot,
} from './contract'

import {
  subscribeToSignalRealtime,
} from './signalRealtime'

export type UseSignalRealtimeState = {
  snapshot: SignalSnapshot | null
  loading: boolean
  error: Error | null
  connectionState:
    SignalRealtimeConnectionState
  refresh: () => Promise<void>
}

/**
 * Thin React adapter around the Signal Realtime domain.
 *
 * This hook owns lifecycle only.
 * It contains no matching, capacity, threshold,
 * confirmation, voting, or conversion rules.
 */
export function useSignalRealtime(
  target: SignalRealtimeTarget | null,
): UseSignalRealtimeState {
  const [snapshot, setSnapshot] =
    useState<SignalSnapshot | null>(null)

  const [loading, setLoading] =
    useState(Boolean(target))

  const [error, setError] =
    useState<Error | null>(null)

  const [
    connectionState,
    setConnectionState,
  ] =
    useState<SignalRealtimeConnectionState>(
      'closed',
    )

  const refreshRef =
    useRef<(() => Promise<void>) | null>(
      null,
    )

  const signalIntentId =
    target?.signalIntentId ?? null
  const signalGroupId =
    target?.signalGroupId ?? null

  useEffect(() => {
    let active = true
    refreshRef.current = null

    queueMicrotask(() => {
      if (!active) return

      setSnapshot(null)
      setError(null)
      setLoading(
        signalIntentId !== null &&
        signalGroupId !== null,
      )
      setConnectionState(
        signalIntentId !== null &&
        signalGroupId !== null
          ? 'connecting'
          : 'closed',
      )
    })

    if (
      signalIntentId === null ||
      signalGroupId === null
    ) {
      return () => {
        active = false
      }
    }

    const subscription =
      subscribeToSignalRealtime(
        { signalIntentId, signalGroupId },
        {
          onSnapshot(nextSnapshot) {
            if (!active) return
            setSnapshot(nextSnapshot)
            setError(null)
            setLoading(false)
          },

          onError(nextError) {
            if (!active) return
            setError(nextError)
            setLoading(false)
          },

          onConnectionStateChange(
            nextState,
          ) {
            if (!active) return
            setConnectionState(nextState)
          },
        },
      )

    refreshRef.current =
      subscription.refresh

    return () => {
      active = false
      refreshRef.current = null
      void subscription.stop()
    }
  }, [signalIntentId, signalGroupId])

  const refresh = useCallback(
    async () => {
      const currentRefresh =
        refreshRef.current

      if (!currentRefresh) return

      setLoading(true)

      try {
        await currentRefresh()
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  return {
    snapshot,
    loading,
    error,
    connectionState,
    refresh,
  }
}
