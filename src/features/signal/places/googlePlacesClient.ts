import type {
  SignalPlacesRequest,
  SignalPlacesResponse,
} from './contract'

const getSupabaseConfig = () => {
  const url = import.meta.env.VITE_SUPABASE_URL
  const publishableKey =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

  if (!url) {
    throw new Error('VITE_SUPABASE_URL is not configured')
  }

  if (!publishableKey) {
    throw new Error(
      'VITE_SUPABASE_PUBLISHABLE_KEY is not configured',
    )
  }

  return {
    url: url.replace(/\/+$/, ''),
    publishableKey,
  }
}

export async function fetchSignalPlaces(
  request: SignalPlacesRequest,
): Promise<SignalPlacesResponse> {
  const { url, publishableKey } = getSupabaseConfig()

  const response = await fetch(
    `${url}/functions/v1/signal-places`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
      },
      body: JSON.stringify(request),
    },
  )

  if (!response.ok) {
    const message = await response.text()

    throw new Error(
      `Signal Places request failed (${response.status}): ${
        message || response.statusText
      }`,
    )
  }

  return (await response.json()) as SignalPlacesResponse
}
