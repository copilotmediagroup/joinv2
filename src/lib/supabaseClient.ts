import { createClient } from '@supabase/supabase-js'

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL

const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl) {
  throw new Error(
    'VITE_SUPABASE_URL is not configured',
  )
}

if (!supabasePublishableKey) {
  throw new Error(
    'VITE_SUPABASE_PUBLISHABLE_KEY is not configured',
  )
}

/**
 * Single browser-owned Supabase client.
 *
 * Security contract:
 * - publishable key only
 * - browser session owns authenticated identity
 * - PostgreSQL RLS remains authoritative
 * - never place a service-role or secret key here
 */
export const supabase = createClient(
  supabaseUrl,
  supabasePublishableKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)
