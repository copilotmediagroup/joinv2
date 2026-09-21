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
  myConnections,
  profileMomentClient,
  publicProfileClient,
  avatarClient,
  stayConnected,
  directMessagingClient,
  directMessagesPanel,
  signalConnectionsClient,
  signalParticipantsClient,
  profileSearchClient,
  momentSocialClient,
  userSafetyClient,
  adminClient,
  messagingClient,
  notificationPanel,
  adminOpsMigration,
  liveLocationMigration,
  planMembersClient,
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
  read('src/features/profile/MyConnectionsPanel.tsx'),
  read('src/features/profile/profileSignalMomentsClient.ts'),
  read('src/features/profile/publicProfileClient.ts'),
  read('src/features/onboarding/avatarClient.ts'),
  read('src/features/activity/StayConnectedPanel.tsx'),
  read('src/features/messaging/directMessagingClient.ts'),
  read('src/features/messaging/DirectMessagesPanel.tsx'),
  read('src/features/activity/signalConnectionsClient.ts'),
  read('src/features/signal/participants/signalParticipantsClient.ts'),
  read('src/features/profile/profileSearchClient.ts'),
  read('src/features/activity/signalMomentSocialClient.ts'),
  read('src/features/safety/userSafetyClient.ts'),
  read('src/features/admin/adminClient.ts'),
  read('src/features/messaging/messagingClient.ts'),
  read('src/features/notifications/NotificationPanel.tsx'),
  read('supabase/migrations/20260921081000_scale_admin_operations_snapshot.sql'),
  read('supabase/migrations/20260921083500_fix_live_plan_location_states.sql'),
  read('src/features/plan/planMembersClient.ts'),
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
  /subscribeToSignalDiscovery\(refreshLiveCounts,[\s\S]*?setInterval\([\s\S]*?visibilityState === 'visible'[\s\S]*?30_000[\s\S]*?visibilitychange[\s\S]*?online/,
  'Realtime + self-healing reconciliation must remain installed.')
lock('Discovery preview avatars remain batch signed', discovery,
  /createProfileAvatarSignedUrls[\s\S]*?new Set\(rows\.flatMap[\s\S]*?return rows\.map/,
  'Discovery reconciliation must not fan out one Storage signing request per preview avatar.')
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
lock('Direct message history stays cursor-paginated', directMessagingClient + directMessagesPanel,
  /get_my_direct_messages_page[\s\S]*?p_before_sent_at[\s\S]*?DIRECT_MESSAGE_PAGE_SIZE \+ 1[\s\S]*?LOAD OLDER MESSAGES/,
  'Long-running direct conversations must preserve older history without eager-loading the entire thread.')
lock('Group message history stays cursor-paginated', messagingClient + messages,
  /get_my_plan_messages_page[\s\S]*?PLAN_MESSAGE_PAGE_SIZE \+ 1[\s\S]*?LOAD OLDER MESSAGES/,
  'Long-running Signal group chats must preserve older history without a fixed 200-message ceiling.')
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
lock('Live location publishing accepts real live Plan states', liveLocationMigration,
  /set_my_plan_location[\s\S]*?'locked'::public\.plan_state[\s\S]*?'recovery_required'::public\.plan_state[\s\S]*?'active_outing'::public\.plan_state/,
  'The live map must never regress to the obsolete Plan state literal that blocked location publishing after check-in.')
lock('Live map retains fixed destination and user markers', liveMap,
  /destination\.latitude[\s\S]*?destination\.longitude[\s\S]*?redIcon[\s\S]*?userPosition[\s\S]*?blueIcon/,
  'The destination and current-user positions must remain distinct map authorities.')
lock('Pre-lock formation keeps joined participant proof', app,
  /signalParticipants\.slice\(0, 4\)[\s\S]*?participant\.displayName[\s\S]*?\+ JOINED/,
  'Users must see who is joining before the Signal locks instead of jumping blindly to coordination.')
lock('Notification unread authority remains server counted', notifications,
  /head: true[\s\S]*?state[\s\S]*?unread|state[\s\S]*?unread[\s\S]*?head: true/,
  'Unread badges must not be inferred only from a bounded notification page.')
lock('Notification history stays cursor-paginated', notifications + notificationPanel,
  /get_my_notifications_page[\s\S]*?p_before_created_at[\s\S]*?LOAD OLDER ALERTS/,
  'Notification history must remain bounded while allowing users to reach older alerts.')
lock('Notification realtime toast remains wired', app,
  /notification-toast[\s\S]*?setNotificationsOpen\(true\)/,
  'Peer events must remain visible without requiring navigation/reload.')
lock('Profile reputation stats remain prominent', profile,
  /signalsJoined[\s\S]*?Signals[\s\S]*?completedMeetups[\s\S]*?Meet ups[\s\S]*?verifiedShowUps[\s\S]*?Verified showups/,
  'Signals, Meetups, and verified show-ups are locked profile product requirements.')
lock('Your Signal Life remains on profile', profile,
  /ProfileSignalLife/,
  'Verified Signal media must retain its profile home.')
lock('Profile identity gallery uses batched private signing', profile,
  /createProfileAvatarSignedUrls[\s\S]*?sourcePhotos\.map\(\(photo\) => photo\.objectPath\)[\s\S]*?signedUrls\.get\(photo\.objectPath\)/,
  'Opening or editing the identity gallery must not create one Storage signing request per profile photo.')
lock('Signal Life stays cursor-paginated with batched media signing', profileMomentClient + publicProfileClient + publicProfile,
  /createSignedUrls[\s\S]*?get_my_profile_signal_moments_page[\s\S]*?get_signal_public_profile_moments_page[\s\S]*?createSignedUrls[\s\S]*?LOAD MORE SIGNAL LIFE/,
  'Profile growth must not restore the old 60-Moment eager load or one signing request per media object.')
lock('Public connections remain clickable and exact-count driven', publicProfile,
  /getPublicProfileConnectionCount[\s\S]*?connectionCount[\s\S]*?setConnectionsOpen\(true\)[\s\S]*?SIGNAL CONNECTIONS/,
  'Connections count/list/profile navigation is a locked profile behavior.')
lock('Public connection modal stays paginated with batched avatars', publicProfileClient + avatarClient + publicProfile,
  /get_signal_public_profile_connections_page[\s\S]*?createProfileAvatarSignedUrls[\s\S]*?createSignedUrls[\s\S]*?LOAD MORE CONNECTIONS/,
  'Large social graphs must remain cursor-paginated and avoid one avatar-signing request per connection.')
lock('Declined post-Signal connections remain retryable', stayConnected,
  /person\.state === 'none' \|\| person\.state === 'declined'[\s\S]*?CONNECT AGAIN/,
  'A declined request must not permanently remove the ability to reconnect after the Signal.')
lock('Own profile connections remain exact-count clickable', myConnections,
  /getPublicProfileConnectionCount\(userId\)[\s\S]*?setConnectionCount\(exactCount\)[\s\S]*?profile-connections-summary[\s\S]*?setOpen\(true\)[\s\S]*?My SIGNAL connections/,
  'The owner profile must show an exact clickable Connections count and modal list.')
lock('My Energy stays out of public profile', publicProfile,
  /^(?![\s\S]*MY ENERGY)(?![\s\S]*SignalPreferencesPanel)[\s\S]*$/,
  'My Energy is private/backend-facing preference data and must not render publicly.')
lock('My Energy remains editable only in own profile flow', profile + profilePreferences,
  /SignalPreferencesPanel[\s\S]*?MY ENERGY[\s\S]*?SAVE MY ENERGY/,
  'Private preference editing must remain available to the owner.')
lock('Admin operations counters remain independently indexable', adminOpsMigration,
  /get_admin_operations_snapshot[\s\S]*?select count\(\*\) from public\.signal_groups[\s\S]*?select count\(\*\) from public\.plans[\s\S]*?select count\(\*\) from public\.user_reports[\s\S]*?select count\(\*\) from public\.signal_moment_reports/,
  'Admin monitoring must not regress to broad materialized scans as production tables grow.')
lock('Admin-authorized users retain user/admin mode switch', app,
  /USER MODE[\s\S]*?ADMIN MODE/,
  'Authorized admin accounts must retain explicit user/admin screen switching.')
lock('Plan member avatars use batched private signing', planMembersClient,
  /createProfileAvatarSignedUrls[\s\S]*?new Set\(rows\.map[\s\S]*?return rows\.map/,
  'Live Plan member refreshes must not create one Storage signing request per participant.')
lock('Social list avatars use batched private signing', signalConnectionsClient + signalParticipantsClient + profileSearchClient + directMessagingClient,
  /createProfileAvatarSignedUrls[\s\S]*?getMySignalParticipants[\s\S]*?createProfileAvatarSignedUrls[\s\S]*?searchSignalProfiles[\s\S]*?createProfileAvatarSignedUrls[\s\S]*?getMyDirectThreadsPage[\s\S]*?createProfileAvatarSignedUrls/,
  'Search, participants, connections, and inbox pages must not create one Storage signing request per person.')
lock('Comments, blocked users, and moderation evidence batch signing', momentSocialClient + userSafetyClient + adminClient,
  /getMomentCommentsPage[\s\S]*?createProfileAvatarSignedUrls[\s\S]*?getMyBlockedUsersPage[\s\S]*?createProfileAvatarSignedUrls[\s\S]*?getModerationMomentEvidence[\s\S]*?createSignedUrls/,
  'Bounded social and moderation pages must avoid per-row Storage signing fan-out.')
lock('Activity feed batches private media and avatar signing', moments,
  /createProfileAvatarSignedUrls[\s\S]*?createSignedUrls\(mediaPaths[\s\S]*?mediaUrls/,
  'A feed page must not fan out into one Storage signing request per avatar or media object.')
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
