import fs from 'node:fs/promises'

const read = (path) => fs.readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const [
  app,
  messages,
  messagingRealtime,
  outing,
  details,
  moments,
  notifications,
  profile,
  publicProfile,
  profilePreferences,
  discovery,
  signalTimeStage,
  liveMap,
] = await Promise.all([
  read('src/App.tsx'),
  read('src/features/messaging/MessagesView.tsx'),
  read('src/features/messaging/messagingRealtime.ts'),
  read('src/features/outing/ActiveOutingView.tsx'),
  read('src/features/outing/SignalPlanDetailsView.tsx'),
  read('src/features/activity/signalMomentsClient.ts'),
  read('src/features/notifications/notificationClient.ts'),
  read('src/features/profile/ProfileView.tsx'),
  read('src/features/profile/PublicProfileView.tsx'),
  read('src/features/profile/SignalPreferencesPanel.tsx'),
  read('src/features/signal/discovery/signalDiscoveryClient.ts'),
  read('src/features/signal/SignalTimeStage.tsx'),
  read('src/features/outing/SignalLiveMap.tsx'),
])

const checks = []
const lock = (name, source, pattern, reason) => {
  const ok = pattern.test(source)
  checks.push({ name, ok, reason })
}

// These are user-verified product behaviors. This suite intentionally tests
// ownership/structure rather than snapshots so visual refactors can continue
// without silently deleting or bypassing finished behavior.
lock('Discovery counts remain live without manual reload', app,
  /subscribeToSignalDiscovery\(refreshLiveCounts,[\s\S]*?setInterval\(refreshLiveCounts, 5_000\)[\s\S]*?visibilitychange[\s\S]*?online/,
  'Realtime + self-healing reconciliation must remain installed.')
lock('Discovery realtime remains authenticated/private', discovery,
  /realtime\.setAuth\(\)[\s\S]*?channel\(data, \{ config: \{ private: true \} \}\)[\s\S]*?broadcast[\s\S]*?refresh/,
  'Live category social proof must not regress to reload-only or public delivery.')
lock('Live Signal navigation lock remains present', app,
  /SIGNAL LIVE[\s\S]*?activeSignalResume|activeSignalResume[\s\S]*?SIGNAL LIVE/,
  'A user in a live Signal must retain a direct route back to that Signal.')
lock('Group chat typing presence remains present', messages,
  /subscribeToPlanTyping[\s\S]*?setTypingUserIds[\s\S]*?typingUserIds[\s\S]*?typing…/,
  'Verified live group typing presence must not disappear.')
lock('Group chat typing transport remains realtime', messagingRealtime,
  /plan-typing:[\s\S]*?broadcast[\s\S]*?typing[\s\S]*?2200/,
  'Typing presence must retain realtime publish and idle clearing.')
lock('Group messages continue following newest messages', messages,
  /shouldFollowGroupLatestRef[\s\S]*?scrollTo\(\{ top: feed\.scrollHeight[\s\S]*?feed\.scrollHeight - feed\.scrollTop - feed\.clientHeight < 80/,
  'New messages must remain visible while preserving deliberate scroll-up.')
lock('I AM HERE remains explicit check-in', details + outing,
  /I'M HERE[\s\S]*?checkedIn|checkedIn[\s\S]*?SIGNAL LIVE · YOU'RE HERE/,
  'Arrival must remain a user action before live arrival UI.')
lock('Live capture remains check-in gated', outing,
  /!nextAttendance\.checkedIn[\s\S]*?publishSignalMoment[\s\S]*?TAKE PHOTO \/ VIDEO[\s\S]*?UPLOAD[\s\S]*?SAVE TO THIS SIGNAL/,
  'Signal Moments must remain tied to checked-in live outings.')
lock('DONE HERE remains separate from safety leave', outing,
  /DONE HERE[\s\S]*?I DON'T FEEL SAFE/,
  'Normal completion and emergency departure are intentionally distinct actions.')
lock('Plan Options remains lazy mounted', details,
  /planOptionsMounted[\s\S]*?PlanGovernancePanel[\s\S]*?PLAN OPTIONS/,
  'Opening Plan Options must not reintroduce the prior always-mounted governance collision.')
lock('Locked Signal retains Open Details entry point', signalTimeStage,
  /OPEN DETAILS/,
  'The verified live journey uses details/map separately from group messaging.')
lock('Live details retain route toggle and trip stats', details,
  /route \? ' HIDE ROUTE' : ' DIRECTIONS'[\s\S]*?DISTANCE[\s\S]*?DRIVE[\s\S]*?ETA/,
  'Directions must remain a toggle with distance, drive time, and ETA.')
lock('Live map retains fixed destination and user markers', liveMap,
  /destination\.latitude[\s\S]*?destination\.longitude[\s\S]*?redIcon[\s\S]*?userPosition[\s\S]*?blueIcon/,
  'The destination and current-user positions must remain distinct map authorities.')
lock('Pre-lock formation keeps joined participant proof', app,
  /signalParticipants\.slice\(0, 4\)[\s\S]*?participant\.displayName[\s\S]*?\+ JOINED/,
  'Users must see who is joining before the Signal locks instead of jumping blindly to coordination.')
lock('Notification unread authority remains server counted', notifications,
  /head: true[\s\S]*?state[\s\S]*?unread|state[\s\S]*?unread[\s\S]*?head: true/,
  'Unread badges must not be inferred only from a bounded notification page.')
lock('Notification realtime toast remains wired', app,
  /notification-toast[\s\S]*?setNotificationsOpen\(true\)/,
  'Peer events must remain visible without requiring navigation/reload.')
lock('Profile reputation stats remain prominent', profile,
  /signalsJoined[\s\S]*?Signals[\s\S]*?completedMeetups[\s\S]*?Meetups[\s\S]*?verifiedShowUps[\s\S]*?Show-ups/,
  'Signals, Meetups, and verified show-ups are locked profile product requirements.')
lock('Your Signal Life remains on profile', profile,
  /ProfileSignalLife/,
  'Verified Signal media must retain its profile home.')
lock('Public connections remain clickable and exact-count driven', publicProfile,
  /getPublicProfileConnectionCount[\s\S]*?connectionCount[\s\S]*?setConnectionsOpen\(true\)[\s\S]*?SIGNAL CONNECTIONS/,
  'Connections count/list/profile navigation is a locked profile behavior.')
lock('My Energy stays out of public profile', publicProfile,
  /^(?![\s\S]*MY ENERGY)(?![\s\S]*SignalPreferencesPanel)[\s\S]*$/,
  'My Energy is private/backend-facing preference data and must not render publicly.')
lock('My Energy remains editable only in own profile flow', profile + profilePreferences,
  /SignalPreferencesPanel[\s\S]*?MY ENERGY[\s\S]*?SAVE MY ENERGY/,
  'Private preference editing must remain available to the owner.')
lock('Admin-authorized users retain user/admin mode switch', app,
  /USER MODE[\s\S]*?ADMIN MODE/,
  'Authorized admin accounts must retain explicit user/admin screen switching.')
lock('Activity publishing remains server-authoritative', moments,
  /publishSignalMoment[\s\S]*?publish_my_signal_moment/,
  'Activity must continue to originate from Signal Moment authority, not an arbitrary composer.')

for (const check of checks) {
  console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}`)
  if (!check.ok) console.error(`      ${check.reason}`)
}

const failed = checks.filter((check) => !check.ok)
if (failed.length) {
  console.error(`\nLocked product regression verification failed (${failed.length}/${checks.length}).`)
  process.exit(1)
}

console.log(`\nLocked product regression verification passed (${checks.length}/${checks.length}).`)
