import { supabase } from '../../lib/supabaseClient'

export type PlanLiveLocation = {
  userId: string
  displayName: string
  latitude: number
  longitude: number
  accuracyMeters: number | null
  capturedAt: string
  isMe: boolean
}

export async function setMyPlanLocation(planId: string, position: GeolocationPosition): Promise<void> {
  const { error } = await supabase.rpc('set_my_plan_location', {
    p_plan_id: planId,
    p_latitude: position.coords.latitude,
    p_longitude: position.coords.longitude,
    p_accuracy_meters: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
    p_captured_at: new Date(position.timestamp).toISOString(),
  })
  if (error) throw error
}

export async function getMyPlanMemberLocations(planId: string): Promise<PlanLiveLocation[]> {
  const { data, error } = await supabase.rpc('get_my_plan_member_locations', { p_plan_id: planId })
  if (error) throw error
  if (!Array.isArray(data)) return []
  return data.map((row) => ({
    userId: String(row.user_id), displayName: String(row.display_name ?? 'SIGNAL member'),
    latitude: Number(row.latitude), longitude: Number(row.longitude),
    accuracyMeters: row.accuracy_meters == null ? null : Number(row.accuracy_meters),
    capturedAt: String(row.captured_at), isMe: row.is_me === true,
  })).filter((row) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude))
}
