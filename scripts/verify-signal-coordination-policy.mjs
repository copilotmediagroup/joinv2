import fs from 'node:fs'

const shared = fs.readFileSync('supabase/functions/_shared/signalCoordinationPolicy.ts', 'utf8')
const places = fs.readFileSync('supabase/functions/signal-places/index.ts', 'utf8')
const times = fs.readFileSync('supabase/functions/signal-times/index.ts', 'utf8')

const fail = (message) => { console.error(`Signal coordination policy verification failed: ${message}`); process.exit(1) }

if (!places.includes("from '../_shared/signalCoordinationPolicy.ts'")) fail('signal-places does not import shared policy')
if (!times.includes("from '../_shared/signalCoordinationPolicy.ts'")) fail('signal-times does not import shared policy')
if (!places.includes('signalCoordinationPolicy(activity.slug, venueTimeBand)')) fail('signal-places does not consume shared policy')
if (!times.includes('signalCoordinationPolicy(venue.activitySlug, venue.venueTimeBand)')) fail('signal-times does not consume shared policy')
if ((places.match(/function coordinationPolicy/g) ?? []).length) fail('signal-places still owns a duplicate policy')
if ((times.match(/function coordinationPolicy/g) ?? []).length) fail('signal-times still owns a duplicate policy')

const lateNight = /venueTimeBand === 'late_night'[\s\S]*?leadMinutes: 10, durationMinutes: 30, closingBufferMinutes: 5, alignmentMinutes: 15/.test(shared)
if (!lateNight) fail('late-night contract is not 10/30/5/15 in shared authority')

console.log('Signal coordination policy verification passed.')
