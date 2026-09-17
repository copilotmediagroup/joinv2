export type SignalOpeningPeriod = {
  open?: { day?: number; hour?: number; minute?: number } | null
  close?: { day?: number; hour?: number; minute?: number } | null
}

export type SignalVenueAvailabilityPolicy = {
  leadMinutes: number
  durationMinutes: number
  closingBufferMinutes: number
  alignmentMinutes: number
}

const WEEK_MINUTES = 7 * 24 * 60

export function venueWeekMinute(epochMs: number, offsetMinutes: number): number {
  const local = new Date(epochMs + offsetMinutes * 60_000)
  return local.getUTCDay() * 1440 + local.getUTCHours() * 60 + local.getUTCMinutes()
}

export function alignVenueTime(epochMs: number, offsetMinutes: number, alignmentMinutes: number): number {
  const localMs = epochMs + offsetMinutes * 60_000
  const step = alignmentMinutes * 60_000
  return Math.ceil(localMs / step) * step - offsetMinutes * 60_000
}

export function periodContainsWindow(
  pointWeekMinute: number,
  durationMinutes: number,
  openWeekMinute: number,
  closeWeekMinute: number,
): boolean {
  let close = closeWeekMinute
  if (close <= openWeekMinute) close += WEEK_MINUTES
  for (const point of [pointWeekMinute, pointWeekMinute + WEEK_MINUTES]) {
    for (const open of [openWeekMinute, openWeekMinute + WEEK_MINUTES]) {
      const normalizedClose = close + (open - openWeekMinute)
      if (point >= open && point + durationMinutes <= normalizedClose) return true
    }
  }
  return false
}

export function fitsVenueOpeningHours(
  epochMs: number,
  offsetMinutes: number,
  periods: SignalOpeningPeriod[],
  durationMinutes: number,
  closingBufferMinutes: number,
): boolean {
  const candidate = venueWeekMinute(epochMs, offsetMinutes)
  return periods.some((period) => {
    if (!period.open) return false
    const open = (period.open.day ?? 0) * 1440 + (period.open.hour ?? 0) * 60 + (period.open.minute ?? 0)
    const close = period.close
      ? (period.close.day ?? 0) * 1440 + (period.close.hour ?? 0) * 60 + (period.close.minute ?? 0)
      : open + WEEK_MINUTES
    return periodContainsWindow(
      candidate,
      durationMinutes + closingBufferMinutes,
      open,
      close,
    )
  })
}

export function buildVenueTimeCandidates(
  signalStartsAt: number,
  signalEndsAt: number,
  offsetMinutes: number,
  periods: SignalOpeningPeriod[],
  policy: SignalVenueAvailabilityPolicy,
  nowEpoch = Date.now(),
): number[] {
  if (!Number.isFinite(signalStartsAt) || !Number.isFinite(signalEndsAt) || signalEndsAt <= signalStartsAt) return []
  if (!Number.isFinite(offsetMinutes) || !Array.isArray(periods) || periods.length === 0) return []
  const earliest = alignVenueTime(
    Math.max(signalStartsAt, nowEpoch + policy.leadMinutes * 60_000),
    offsetMinutes,
    policy.alignmentMinutes,
  )
  const latest = signalEndsAt - policy.durationMinutes * 60_000
  if (earliest > latest) return []
  const candidates: number[] = []
  for (let candidate = earliest; candidate <= latest; candidate += policy.alignmentMinutes * 60_000) {
    if (fitsVenueOpeningHours(
      candidate,
      offsetMinutes,
      periods,
      policy.durationMinutes,
      policy.closingBufferMinutes,
    )) candidates.push(candidate)
  }
  return candidates
}

export function minutesUntilCurrentClose(
  periods: SignalOpeningPeriod[],
  offsetMinutes: number,
  epochMs = Date.now(),
): number | null {
  if (!Array.isArray(periods) || periods.length === 0 || !Number.isFinite(offsetMinutes)) return null
  const nowMinute = venueWeekMinute(epochMs, offsetMinutes)
  for (const period of periods) {
    if (!period.open) continue
    const open = (period.open.day ?? 0) * 1440 + (period.open.hour ?? 0) * 60 + (period.open.minute ?? 0)
    let close = period.close
      ? (period.close.day ?? 0) * 1440 + (period.close.hour ?? 0) * 60 + (period.close.minute ?? 0)
      : open + WEEK_MINUTES
    if (close <= open) close += WEEK_MINUTES
    for (const point of [nowMinute, nowMinute + WEEK_MINUTES]) {
      for (const normalizedOpen of [open, open + WEEK_MINUTES]) {
        const normalizedClose = close + (normalizedOpen - open)
        if (point >= normalizedOpen && point < normalizedClose) return normalizedClose - point
      }
    }
  }
  return null
}
