export type SignalTimeOption = {
  optionId: string
  startsAt: string
  displayTime: string
  label: string
  sourceRank: number
}

export type SignalTimeRound = {
  id: string
  state: 'open' | 'won' | 'no_eligible'
  opensAt: string
  closesAt: string
  winnerOptionId: string | null
  eligibleParticipantCount: number
  activationThreshold: number
  respondedParticipantCount: number
  currentUserAvailableOptionIds: string[]
  currentUserPreferredOptionId: string | null
  availableCounts: Record<string, number>
  preferredCounts: Record<string, number>
}

export type SignalTimesResponse =
  | {
      version: 'signal-time-coordination-v1'
      status: 'no_options'
      round: null
      options: []
    }
  | {
      version: 'signal-time-coordination-v1'
      status: 'ready'
      round: SignalTimeRound
      options: SignalTimeOption[]
    }
