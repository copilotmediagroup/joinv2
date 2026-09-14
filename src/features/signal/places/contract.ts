export type SignalPlaceReview = {
  rating: number
  text: string
  relativeTime: string | null
  authorName: string
  authorPhotoUrl: string | null
  authorUri: string | null
  googleMapsUri: string | null
}

export type SignalPlace = {
  optionId: string
  placeId: string
  name: string
  address: string
  lat: number
  lng: number
  distanceMiles: number
  groupTravelAverageMiles?: number
  groupTravelMaxMiles?: number
  meetingPointMode?: 'group_midpoint' | 'city_center'
  locationMemberCount?: number
  activeMemberCount?: number
  venueTimeBand?: 'morning' | 'daytime' | 'evening' | 'late_night'
  minimumOpenMinutes?: number
  openMinutesRemaining?: number | null
  supportsSignalWindow?: boolean
  rating: number | null
  ratingCount: number
  category: string
  openNow: boolean | null
  utcOffsetMinutes: number | null
  openingHours: {
    periods: Array<{
      open: { day: number; hour: number; minute: number } | null
      close: { day: number; hour: number; minute: number } | null
    }>
    weekdayDescriptions: string[]
  } | null
  photoName: string | null
  photoUrl: string | null
  photoAttributions: Array<{
    displayName: string
    uri: string | null
    photoUri: string | null
  }>
  googleMapsUri: string | null
  reviews: SignalPlaceReview[]
  signalRank: number
  signalScore: number
  scoreBreakdown: {
    distance: number
    rating: number
    confidence: number
    availability: number
    relevance: number
    facilityFit: number
  }
}

export type SignalVenueRound = {
  id: string
  roundNumber: 1 | 2
  roundKind: 'initial' | 'runoff'
  state: 'open' | 'won' | 'runoff' | 'deadlocked'
  opensAt: string
  closesAt: string
  winnerOptionId: string | null
  eligibleVoterCount: number
  majorityRequired: number
  currentUserOptionId: string | null
  voteCounts: Record<string, number>
}

export type SignalPlacesRequest = {
  signalGroupId: string
  limit?: number
  allowCityFallback?: boolean
}

export type SignalPlacesResponse = {
  version: 'signal-venue-vote-v1'
  source: 'google' | 'database'
  query: string | null
  activitySlug: string
  citySlug: string
  round: SignalVenueRound
  places: SignalPlace[]
}

export type SignalVenueVoteResult = {
  voteAccepted: boolean
  roundState: SignalVenueRound['state']
  winnerOptionId: string | null
}
