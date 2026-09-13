import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabaseClient'

export type AuthSnapshot = {
  session: Session | null
  user: User | null
}

export async function getAuthSnapshot(): Promise<AuthSnapshot> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession()

  if (error) {
    throw error
  }

  return {
    session,
    user: session?.user ?? null,
  }
}

export async function getAuthenticatedUser(): Promise<User | null> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error) {
    throw error
  }

  return user
}

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<AuthSnapshot> {
  const normalizedEmail = email.trim().toLowerCase()

  if (!normalizedEmail) {
    throw new Error('Email is required.')
  }

  if (!password) {
    throw new Error('Password is required.')
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  })

  if (error) {
    throw error
  }

  return {
    session: data.session,
    user: data.user,
  }
}

export async function signUpWithPassword(
  email: string,
  password: string,
): Promise<AuthSnapshot> {
  const normalizedEmail = email.trim().toLowerCase()

  if (!normalizedEmail) {
    throw new Error('Email is required.')
  }

  if (!password) {
    throw new Error('Password is required.')
  }

  const { data, error } = await supabase.auth.signUp({
    email: normalizedEmail,
    password,
  })

  if (error) {
    throw error
  }

  return {
    session: data.session,
    user: data.user,
  }
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()

  if (error) {
    throw error
  }
}

export async function signOutCurrentUser(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}
