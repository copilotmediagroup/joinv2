export type SignalVenueTimeBand = 'morning' | 'daytime' | 'evening' | 'late_night'

export type SignalCoordinationPolicy = {
  leadMinutes: number
  durationMinutes: number
  closingBufferMinutes: number
  alignmentMinutes: number
}

export function signalCoordinationPolicy(
  activitySlug?: string,
  venueTimeBand?: SignalVenueTimeBand,
): SignalCoordinationPolicy {
  if (venueTimeBand === 'late_night') {
    return { leadMinutes: 10, durationMinutes: 30, closingBufferMinutes: 5, alignmentMinutes: 15 }
  }
  if (activitySlug === 'sports' || activitySlug === 'creative') {
    return { leadMinutes: 20, durationMinutes: 90, closingBufferMinutes: 15, alignmentMinutes: 30 }
  }
  return { leadMinutes: 20, durationMinutes: 75, closingBufferMinutes: 15, alignmentMinutes: 15 }
}
