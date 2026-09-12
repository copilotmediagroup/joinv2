import { useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabaseClient'

export type AuthSessionState = {
  session: Session | null
  user: User | null
  loading: boolean
  error: Error | null
}

export function useAuthSession(): AuthSessionState {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let active = true

    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) {
        return
      }

      if (sessionError) {
        setError(sessionError)
        setLoading(false)
        return
      }

      setSession(data.session)
      setUser(data.session?.user ?? null)
      setError(null)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) {
        return
      }

      setSession(nextSession)
      setUser(nextSession?.user ?? null)
      setError(null)
      setLoading(false)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  return {
    session,
    user,
    loading,
    error,
  }
}
