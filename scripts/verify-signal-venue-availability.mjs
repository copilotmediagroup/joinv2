import fs from 'node:fs'

const shared = fs.readFileSync('supabase/functions/_shared/signalVenueAvailability.ts', 'utf8')
const places = fs.readFileSync('supabase/functions/signal-places/index.ts', 'utf8')
const times = fs.readFileSync('supabase/functions/signal-times/index.ts', 'utf8')
const fail = (message) => { console.error(`Signal venue availability verification failed: ${message}`); process.exit(1) }

if (!places.includes("from '../_shared/signalVenueAvailability.ts'")) fail('signal-places does not import shared availability')
if (!times.includes("from '../_shared/signalVenueAvailability.ts'")) fail('signal-times does not import shared availability')
if (!places.includes('buildVenueTimeCandidates(')) fail('signal-places does not consume shared candidate authority')
if (!times.includes('buildVenueTimeCandidates(')) fail('signal-times does not consume shared candidate authority')
for (const duplicate of ['function periodContainsWindow(', 'function hasUsableSignalSlot(', 'function fitsOpeningHours(', 'function alignVenueTime(']) {
  if (places.includes(duplicate) || times.includes(duplicate)) fail(`duplicate availability authority remains: ${duplicate}`)
}
if (!places.includes('const hasMinimumOpenTime = requireOpenNow')) fail('future availability is still coupled to openNow')

let executable = shared
  .replace(/export type[\s\S]*?\n}\n\n/g, '')
  .replaceAll('export function ', 'function ')
  .replace(/: number\[\]/g, '')
  .replace(/: number \| null/g, '')
  .replace(/: number/g, '')
  .replace(/: boolean/g, '')
  .replace(/: SignalOpeningPeriod\[\]/g, '')
  .replace(/: SignalVenueAvailabilityPolicy/g, '')

const factory = new Function(`${executable}; return { buildVenueTimeCandidates, fitsVenueOpeningHours }`)
const { buildVenueTimeCandidates } = factory()
const policy = { leadMinutes: 10, durationMinutes: 30, closingBufferMinutes: 5, alignmentMinutes: 15 }
const at = (iso) => new Date(iso).getTime()
const period = (openDay, openHour, openMinute, closeDay, closeHour, closeMinute) => [{
  open: { day: openDay, hour: openHour, minute: openMinute },
  close: { day: closeDay, hour: closeHour, minute: closeMinute },
}]
const candidates = (start, end, periods, now = start) => buildVenueTimeCandidates(at(start), at(end), 0, periods, policy, at(now))
const expectSome = (name, value) => { if (!value.length) fail(`${name}: expected eligible slot`) }
const expectNone = (name, value) => { if (value.length) fail(`${name}: expected no eligible slot`) }

expectSome('closed-now/open-tomorrow', candidates('2026-09-18T19:00:00Z','2026-09-18T22:00:00Z',period(5,18,0,5,23,0),'2026-09-17T03:00:00Z'))
expectNone('closing-too-soon', candidates('2026-09-17T02:30:00Z','2026-09-17T04:00:00Z',period(4,18,0,4,3,0),'2026-09-17T02:30:00Z'))
expectSome('overnight-friday-saturday', candidates('2026-09-18T23:30:00Z','2026-09-19T03:00:00Z',period(5,20,0,6,2,30),'2026-09-18T23:00:00Z'))
expectSome('future-weekend', candidates('2026-09-19T20:00:00Z','2026-09-19T23:00:00Z',period(6,18,0,6,23,30),'2026-09-17T03:00:00Z'))
expectSome('24-hour', candidates('2026-09-17T10:00:00Z','2026-09-17T12:00:00Z',[{open:{day:4,hour:0,minute:0},close:null}],'2026-09-17T09:00:00Z'))
expectNone('missing-hours', candidates('2026-09-17T10:00:00Z','2026-09-17T12:00:00Z',[],'2026-09-17T09:00:00Z'))

console.log('Signal venue availability verification passed.')
