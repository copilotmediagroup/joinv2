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
  chillDatingPreferences,
  discovery,
  signalPlaceStage,
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
  profileSearchPanel,
  planGovernance,
  activityView,
  blockedPeople,
  profileSignalLife,
  moderationView,
  momentModeration,
  signalCompletion,
  userSafetyActions,
  authGate,
  onboardingGate,
  signalAccessGate,
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
  read('src/features/profile/ChillDatingPreferencesPanel.tsx'),
  read('src/features/signal/discovery/signalDiscoveryClient.ts'),
  read('src/features/signal/SignalPlaceStage.tsx'),
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
  read('src/features/profile/ProfileSearchPanel.tsx'),
  read('src/features/plan/PlanGovernancePanel.tsx'),
  read('src/features/activity/ActivityView.tsx'),
  read('src/features/safety/BlockedPeoplePanel.tsx'),
  read('src/features/profile/ProfileSignalLife.tsx'),
  read('src/features/admin/ModerationView.tsx'),
  read('src/features/admin/MomentModerationPanel.tsx'),
  read('src/features/outing/SignalCompletionView.tsx'),
  read('src/features/safety/UserSafetyActions.tsx'),
  read('src/features/onboarding/components/AuthGateView.tsx'),
  read('src/features/onboarding/components/OnboardingGateView.tsx'),
  read('src/features/onboarding/components/SignalAccessGate.tsx'),
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
lock('Discovery refresh rejects stale count responses', app,
  /discoveryRequestEpochRef[\s\S]*?refreshDiscovery[\s\S]*?requestEpoch = \+\+discoveryRequestEpochRef\.current[\s\S]*?requestEpoch !== discoveryRequestEpochRef\.current[\s\S]*?refreshLiveCounts[\s\S]*?requestEpoch = \+\+discoveryRequestEpochRef\.current[\s\S]*?requestEpoch === discoveryRequestEpochRef\.current/,
  'Older discovery reads must never overwrite newer realtime social-proof counts and force users to reload.')
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
lock('Direct and group sends serialize rapid submissions', directMessagesPanel + messages,
  /sendRequestRef[\s\S]*?send[\s\S]*?sendRequestRef\.current[\s\S]*?sendRequestRef\.current = true[\s\S]*?sendRequestRef\.current = false[\s\S]*?sendRequestRef[\s\S]*?handleSend[\s\S]*?sendRequestRef\.current[\s\S]*?sendRequestRef\.current = true[\s\S]*?sendRequestRef\.current = false/,
  'Rapid direct and group message submits must not create duplicate sends.')
lock('Message pagination pauses during sends', directMessagesPanel + messages,
  /sendRequestRef\.current[\s\S]*?disabled=\{loadingOlderMessages \|\| sending\}[\s\S]*?disabled=\{loadingMore \|\| sending\}[\s\S]*?sendRequestRef\.current[\s\S]*?disabled=\{loadingOlderMessages \|\| sending\}[\s\S]*?disabled=\{loadingMoreConversations \|\| sending\}/,
  'Thread and conversation pagination must not race a send mutation in either messaging surface.')
lock('Direct message pagination serializes and rejects stale conversation pages', directMessagesPanel,
  /messagePageRequestRef[\s\S]*?requestedConversationId = selectedId[\s\S]*?requestEpoch = messageRefreshEpochRef\.current[\s\S]*?requestEpoch !== messageRefreshEpochRef\.current/,
  'Rapid LOAD OLDER requests must serialize and an older conversation page must not append after realtime refresh or thread navigation.')
lock('Direct thread pagination serializes rapid requests', directMessagesPanel,
  /threadPageRequestRef[\s\S]*?if \(!last \|\| threadPageRequestRef\.current \|\| sendRequestRef\.current\) return[\s\S]*?threadPageRequestRef\.current = true[\s\S]*?threadPageRequestRef\.current = false/,
  'Rapid direct-thread pagination must not issue duplicate cursor requests.')
lock('Direct message refresh ignores stale conversation responses', directMessagesPanel,
  /messageRefreshEpochRef[\s\S]*?requestedConversationId = selectedId[\s\S]*?requestEpoch = \+\+messageRefreshEpochRef\.current[\s\S]*?requestEpoch !== messageRefreshEpochRef\.current[\s\S]*?messageRefreshEpochRef\.current \+= 1/,
  'Switching or closing a direct conversation must invalidate older message refresh responses.')
lock('Direct message history stays cursor-paginated', directMessagingClient + directMessagesPanel,
  /get_my_direct_messages_page[\s\S]*?p_before_sent_at[\s\S]*?DIRECT_MESSAGE_PAGE_SIZE \+ 1[\s\S]*?LOAD OLDER MESSAGES/,
  'Long-running direct conversations must preserve older history without eager-loading the entire thread.')
lock('Group message pagination serializes and rejects stale conversation pages', messages,
  /groupMessageEpochRef[\s\S]*?groupMessagePageRequestRef[\s\S]*?requestedConversationId = selectedConversationId[\s\S]*?requestEpoch = groupMessageEpochRef\.current[\s\S]*?requestEpoch !== groupMessageEpochRef\.current/,
  'Rapid group LOAD OLDER requests must serialize and pages from an older conversation generation must be discarded.')
lock('Group conversation pagination serializes rapid requests', messages,
  /groupConversationPageRequestRef[\s\S]*?if \(!conversationCursor \|\| groupConversationPageRequestRef\.current \|\| sendRequestRef\.current\) return[\s\S]*?groupConversationPageRequestRef\.current = true[\s\S]*?groupConversationPageRequestRef\.current = false/,
  'Rapid Plan conversation pagination must not issue duplicate cursor requests.')
lock('Group message history stays cursor-paginated', messagingClient + messages,
  /get_my_plan_messages_page[\s\S]*?PLAN_MESSAGE_PAGE_SIZE \+ 1[\s\S]*?LOAD OLDER MESSAGES/,
  'Long-running Signal group chats must preserve older history without a fixed 200-message ceiling.')
lock('Group chat member refresh ignores stale realtime responses', messages,
  /refreshEpoch = 0[\s\S]*?requestEpoch = \+\+refreshEpoch[\s\S]*?requestEpoch === refreshEpoch/,
  'Group chat member lists must not let older realtime reads overwrite newer membership state.')
lock('Signal time preference control freezes during submission', signalTimeStage,
  /signal-time-preference-button[\s\S]*?disabled=\{submitting\}[\s\S]*?choosePreference/,
  'Nested preferred-time control must freeze with the shared availability mutation owner.')
lock('Signal venue and time choices serialize rapid submissions', signalPlaceStage + signalTimeStage,
  /voteRequestRef[\s\S]*?castVote[\s\S]*?voteRequestRef\.current[\s\S]*?voteRequestRef\.current = true[\s\S]*?voteRequestRef\.current = false[\s\S]*?availabilityRequestRef[\s\S]*?toggleAvailability[\s\S]*?availabilityRequestRef\.current[\s\S]*?availabilityRequestRef\.current = true[\s\S]*?availabilityRequestRef\.current = false[\s\S]*?choosePreference[\s\S]*?availabilityRequestRef\.current/,
  'Rapid venue votes and time choices must preserve one client-owned mutation at a time.')
lock('Venue-stage refresh ignores stale realtime responses', signalPlaceStage,
  /roundRequestIdRef[\s\S]*?requestId = \+\+roundRequestIdRef\.current[\s\S]*?requestId !== roundRequestIdRef\.current[\s\S]*?requestId === roundRequestIdRef\.current/,
  'Overlapping initial, realtime, and post-vote venue reads must not let an older response overwrite newer round authority.')
lock('Time-stage member refresh ignores stale realtime responses', signalTimeStage,
  /refreshEpoch = 0[\s\S]*?requestEpoch = \+\+refreshEpoch[\s\S]*?requestEpoch === refreshEpoch/,
  'Time-stage member lists must not let older realtime reads overwrite newer membership state.')
lock('Group messages continue following newest messages', messages,
  /shouldFollowGroupLatestRef[\s\S]*?scrollTo\(\{ top: feed\.scrollHeight[\s\S]*?feed\.scrollHeight - feed\.scrollTop - feed\.clientHeight < 80/,
  'New messages must remain visible while preserving deliberate scroll-up.')
lock('I AM HERE serializes rapid check-in submissions', details,
  /checkInRequestRef[\s\S]*?checkIn[\s\S]*?checkInRequestRef\.current[\s\S]*?checkInRequestRef\.current = true[\s\S]*?checkInRequestRef\.current = false/,
  'Rapid check-in taps must not submit duplicate attendance mutations.')
lock('I AM HERE remains explicit check-in', details + outing,
  /I'M HERE[\s\S]*?checkedIn|checkedIn[\s\S]*?SIGNAL LIVE · YOU'RE HERE/,
  'Arrival must remain a user action before live arrival UI.')
lock('Live capture remains check-in gated', outing,
  /!nextAttendance\.checkedIn[\s\S]*?publishSignalMoment[\s\S]*?TAKE PHOTO \/ VIDEO[\s\S]*?UPLOAD[\s\S]*?SAVE TO THIS SIGNAL/,
  'Signal Moments must remain tied to checked-in live outings.')
lock('Completion feedback serializes rapid rating choices', signalCompletion,
  /feedbackRequestRef[\s\S]*?if \(feedbackRequestRef\.current\) return[\s\S]*?requestPlanId = planId[\s\S]*?planEpoch = planEpochRef\.current[\s\S]*?feedbackRequestRef\.current = true[\s\S]*?planEpoch === planEpochRef\.current/,
  'Rapid completion-rating taps must not submit competing feedback writes or let an older Plan response change the current receipt.')
lock('DONE HERE remains separate from safety leave', outing,
  /DONE HERE[\s\S]*?I DON'T FEEL SAFE/,
  'Normal completion and emergency departure are intentionally distinct actions.')
lock('Plan attendance polling ignores stale responses', planGovernance,
  /attendanceRefreshEpochRef[\s\S]*?requestEpoch = \+\+attendanceRefreshEpochRef\.current[\s\S]*?requestEpoch === attendanceRefreshEpochRef\.current[\s\S]*?checkInToMyPlan/,
  'Plan attendance polling and check-in must not let an older attendance read overwrite newer authority.')
lock('Plan governance actions serialize rapid mutations', planGovernance,
  /governanceActionRef[\s\S]*?attendanceActionRef[\s\S]*?if \(attendanceActionRef\.current \|\| governanceActionRef\.current[\s\S]*?runVote[\s\S]*?governanceActionRef\.current \|\| attendanceActionRef\.current[\s\S]*?proposeTime[\s\S]*?governanceActionRef\.current \|\| attendanceActionRef\.current[\s\S]*?leave[\s\S]*?governanceActionRef\.current \|\| attendanceActionRef\.current/,
  'Check-in, governance votes, time proposals, and leave actions must be mutually exclusive under rapid input.')
lock('Plan governance controls mirror shared mutation ownership', planGovernance,
  /disabled=\{attendanceBusy \|\| busy\}[\s\S]*?disabled=\{busy \|\| attendanceBusy\}[\s\S]*?disabled=\{busy \|\| attendanceBusy \|\| changesFrozen/,
  'Check-in and governance controls must visibly freeze each other while either mutation owns the Plan.')
lock('Plan governance refresh invalidates on unmount', planGovernance,
  /active = false[\s\S]*?refreshEpochRef\.current \+= 1[\s\S]*?attendanceRefreshEpochRef\.current \+= 1[\s\S]*?unsubscribe\(\)[\s\S]*?attendanceRefreshEpochRef\.current \+= 1[\s\S]*?window\.clearInterval/,
  'Governance and attendance refreshes must be invalidated when their Plan effects unmount.')
lock('Plan governance refresh ignores stale realtime responses', planGovernance,
  /refreshEpochRef[\s\S]*?requestEpoch = \+\+refreshEpochRef\.current[\s\S]*?requestEpoch !== refreshEpochRef\.current/,
  'Overlapping Plan governance refreshes must not let older voting, replacement, or attendance state overwrite newer authority.')
lock('Plan Options remains lazy mounted', details,
  /planOptionsMounted[\s\S]*?PlanGovernancePanel[\s\S]*?PLAN OPTIONS/,
  'Opening Plan Options must not reintroduce the prior always-mounted governance collision.')
lock('Open Details serializes rapid plan transitions', app,
  /planDetailsOpenRequestRef[\s\S]*?handleOpenPlanDetails[\s\S]*?planDetailsOpenRequestRef\.current[\s\S]*?planDetailsOpenRequestRef\.current = true[\s\S]*?openMySignalPlanDetails[\s\S]*?planDetailsOpenRequestRef\.current = false/,
  'Rapid Open Details actions must not race plan acknowledgement and cross local plan navigation state.')
lock('Locked Signal retains Open Details entry point', signalTimeStage,
  /OPEN DETAILS/,
  'The verified live journey uses details/map separately from group messaging.')
lock('Live details invalidate refreshes across effect lifecycles', details,
  /cancelled = true[\s\S]*?detailsRefreshEpochRef\.current \+= 1[\s\S]*?attendanceRefreshEpochRef\.current \+= 1[\s\S]*?unsubscribeGovernance[\s\S]*?attendanceRefreshEpochRef\.current \+= 1[\s\S]*?window\.clearInterval[\s\S]*?routeRefreshEpochRef\.current \+= 1[\s\S]*?window\.clearTimeout/,
  'Live details must invalidate governance, attendance, and route responses when their effects are replaced or unmounted.')
lock('Live details ignore stale governance and attendance responses', details,
  /detailsRefreshEpochRef[\s\S]*?attendanceRefreshEpochRef[\s\S]*?requestEpoch !== detailsRefreshEpochRef\.current[\s\S]*?initialDetailsEpoch[\s\S]*?initialAttendanceEpoch[\s\S]*?requestEpoch === attendanceRefreshEpochRef\.current/,
  'Open Details must not let older governance, member, or attendance reads overwrite newer realtime authority.')
lock('Live location refresh ignores stale responses', details,
  /locationRefreshEpochRef[\s\S]*?requestEpoch = \+\+locationRefreshEpochRef\.current[\s\S]*?requestEpoch === locationRefreshEpochRef\.current[\s\S]*?locationRefreshEpochRef\.current \+= 1/,
  'Live member locations must not let an older map refresh overwrite newer position authority or survive Plan changes.')
lock('Live route requests serialize rapid direction taps', details,
  /routeRequestRef[\s\S]*?if \(!userPosition \|\| routeRequestRef\.current\) return[\s\S]*?routeRequestRef\.current = true[\s\S]*?getSignalRoute[\s\S]*?routeRequestRef\.current = false/,
  'Rapid DIRECTIONS taps must not launch duplicate route requests before loading state renders.')
lock('Live route refresh ignores stale origins', details,
  /routeRefreshEpochRef[\s\S]*?requestEpoch = \+\+routeRefreshEpochRef\.current[\s\S]*?requestedOrigin = userPosition[\s\S]*?requestEpoch !== routeRefreshEpochRef\.current[\s\S]*?routeRefreshEpochRef\.current \+= 1/,
  'Directions must not let an older route response overwrite a route calculated from a newer user position or survive route cancellation.')
lock('Live details retain route toggle and trip stats', details,
  /route \? ' HIDE ROUTE' : ' DIRECTIONS'[\s\S]*?DISTANCE[\s\S]*?DRIVE[\s\S]*?ETA/,
  'Directions must remain a toggle with distance, drive time, and ETA.')
lock('Live outing mutations serialize rapid actions', outing,
  /momentRequestRef[\s\S]*?outingExitRequestRef[\s\S]*?saveMoment[\s\S]*?momentRequestRef\.current = true[\s\S]*?momentRequestRef\.current = false[\s\S]*?finishOuting[\s\S]*?outingExitRequestRef\.current = true[\s\S]*?outingExitRequestRef\.current = false[\s\S]*?safetyLeave[\s\S]*?outingExitRequestRef\.current = true[\s\S]*?outingExitRequestRef\.current = false/,
  'Moment publishing must serialize, while normal completion and safety leave must share one terminal mutation owner.')
lock('Live outing media and exit mutations are mutually exclusive', outing,
  /saveMoment[\s\S]*?momentRequestRef\.current \|\| outingExitRequestRef\.current[\s\S]*?finishOuting[\s\S]*?outingExitRequestRef\.current \|\| momentRequestRef\.current[\s\S]*?safetyLeave[\s\S]*?outingExitRequestRef\.current \|\| momentRequestRef\.current/,
  'Publishing live media must not race normal completion or safety departure on the same outing.')
lock('Live outing terminal controls disable across exit modes', outing,
  /disabled=\{saving \|\| ending \|\| leaving[\s\S]*?disabled=\{ending \|\| leaving \|\| saving\}[\s\S]*?disabled=\{leaving \|\| ending \|\| saving\}/,
  'Moment publishing, normal completion, and safety leave controls must visibly lock conflicting terminal actions.')
lock('Live outing interactive controls freeze during terminal mutations', outing,
  /acceptFiles[\s\S]*?momentRequestRef\.current \|\| outingExitRequestRef\.current[\s\S]*?active-outing-chat[^\n]*?disabled=\{saving \|\| ending \|\| leaving\}[\s\S]*?capture=\"environment\" disabled=\{saving \|\| ending \|\| leaving\}[\s\S]*?multiple disabled=\{saving \|\| ending \|\| leaving\}[\s\S]*?textarea value=\{caption\} disabled=\{saving \|\| ending \|\| leaving\}[\s\S]*?DONE HERE/,
  'Capture inputs, edits, navigation, and completion entry must not change underneath an owned live mutation.')
lock('Live outing refresh invalidates on unmount', outing,
  /return \(\) => \{[\s\S]*?refreshEpochRef\.current \+= 1[\s\S]*?unsubscribeGovernance\(\)[\s\S]*?unsubscribeLive\(\)/,
  'A live outing refresh started before navigation must not write after the outing view unmounts.')
lock('Live outing refresh ignores stale realtime responses', outing,
  /refreshEpochRef[\s\S]*?requestEpoch = \+\+refreshEpochRef\.current[\s\S]*?requestEpoch !== refreshEpochRef\.current/,
  'Overlapping governance and live refreshes must not let older outing state overwrite newer authority.')
lock('Live Plan fallback polling sleeps in hidden tabs', outing + details,
  /visibilityState !== 'visible'[\s\S]*?getMyPlanAttendanceStatus[\s\S]*?visibilityState !== 'visible'[\s\S]*?getMyPlanAttendanceStatus/,
  'Hidden live-Signal tabs must not keep issuing fallback attendance requests while realtime remains authoritative.')
lock('Live location publishing accepts real live Plan states', liveLocationMigration,
  /set_my_plan_location[\s\S]*?'locked'::public\.plan_state[\s\S]*?'recovery_required'::public\.plan_state[\s\S]*?'active_outing'::public\.plan_state/,
  'The live map must never regress to the obsolete Plan state literal that blocked location publishing after check-in.')
lock('Live map retains fixed destination and user markers', liveMap,
  /destination\.latitude[\s\S]*?destination\.longitude[\s\S]*?redIcon[\s\S]*?userPosition[\s\S]*?blueIcon/,
  'The destination and current-user positions must remain distinct map authorities.')
lock('Signal withdrawal serializes rapid leave actions', app,
  /withdrawalRequestRef[\s\S]*?handleLeaveSignal[\s\S]*?withdrawalRequestRef\.current[\s\S]*?withdrawalRequestRef\.current = true[\s\S]*?withdrawMySignal[\s\S]*?withdrawalRequestRef\.current = false/,
  'Rapid Leave Signal taps must not issue duplicate withdrawal mutations or race local journey reset.')
lock('I AM BORED automation serializes rapid starts', app,
  /boredAutomationRequestRef[\s\S]*?handleImBoredAutomation[\s\S]*?boredAutomationRequestRef\.current \|\| formationRequestRef\.current[\s\S]*?boredAutomationRequestRef\.current = true[\s\S]*?boredAutomationRequestRef\.current = false/,
  'Rapid I AM BORED taps must not issue duplicate opportunity reads before React loading state commits.')
lock('Pre-lock formation keeps joined participant proof', app,
  /signalParticipants\.slice\(0, 4\)[\s\S]*?participant\.displayName[\s\S]*?\+ JOINED/,
  'Users must see who is joining before the Signal locks instead of jumping blindly to coordination.')
lock('Notification unread refresh rejects stale realtime responses', app,
  /notificationUnreadEpochRef[\s\S]*?requestEpoch = \+\+notificationUnreadEpochRef\.current[\s\S]*?requestEpoch === notificationUnreadEpochRef\.current[\s\S]*?notificationUnreadEpochRef\.current \+= 1/,
  'Overlapping unread-count refreshes must not let an older realtime response overwrite a newer badge count.')
lock('Notification unread authority remains server counted', notifications,
  /head: true[\s\S]*?state[\s\S]*?unread|state[\s\S]*?unread[\s\S]*?head: true/,
  'Unread badges must not be inferred only from a bounded notification page.')
lock('Notification refresh invalidates on panel lifecycle change', notificationPanel,
  /return \(\) => \{ active = false; refreshEpochRef\.current \+= 1 \}/,
  'Notification refreshes must be invalidated when the panel lifecycle changes or unmounts.')
lock('Notification refresh ignores stale responses', notificationPanel,
  /refreshEpochRef[\s\S]*?requestEpoch = \+\+refreshEpochRef\.current[\s\S]*?requestEpoch !== refreshEpochRef\.current/,
  'Rapid notification refreshes must not let an older page overwrite newer alert state.')
lock('Notification opening serializes rapid navigation', notificationPanel,
  /openRequestRef[\s\S]*?openItem[\s\S]*?openRequestRef\.current[\s\S]*?openRequestRef\.current = item\.id[\s\S]*?resolveMyNotificationTarget[\s\S]*?openRequestRef\.current = null/,
  'Rapid notification taps must not race read-state mutation and navigation resolution.')
lock('Notification pagination pauses during navigation', notificationPanel,
  /loadMore[\s\S]*?openRequestRef\.current[\s\S]*?setOpening\(true\)[\s\S]*?disabled=\{loadingMore \|\| opening\}/,
  'Older-alert pagination must not race a notification open/navigation mutation.')
lock('Notification pagination serializes and rejects stale pages', notificationPanel,
  /pageRequestRef[\s\S]*?requestEpoch = refreshEpochRef\.current[\s\S]*?pageRequestRef\.current = true[\s\S]*?requestEpoch !== refreshEpochRef\.current/,
  'Rapid notification pagination must serialize and older pages must not append after a newer refresh.')
lock('Notification pagination deduplicates overlapping pages', notificationPanel,
  /page\.notifications\.filter[\s\S]*?item\.id === next\.id/,
  'Cursor overlap must not render duplicate notifications when adjacent pages share a boundary row.')
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
lock('People search ignores stale async responses', profileSearchPanel,
  /requestEpochRef[\s\S]*?requestEpoch === requestEpochRef\.current[\s\S]*?requestEpochRef\.current \+= 1/,
  'Fast typing must not let an older search response overwrite the newest query results.')
lock('Profile identity gallery uses batched private signing', profile,
  /createProfileAvatarSignedUrls[\s\S]*?sourcePhotos\.map\(\(photo\) => photo\.objectPath\)[\s\S]*?signedUrls\.get\(photo\.objectPath\)/,
  'Opening or editing the identity gallery must not create one Storage signing request per profile photo.')
lock('Own Signal Life pagination ignores unmounted responses', profileSignalLife,
  /mountedRef[\s\S]*?mountedRef\.current = true[\s\S]*?mountedRef\.current = false[\s\S]*?if \(!mountedRef\.current\) return[\s\S]*?if \(mountedRef\.current\) setLoadingMore/,
  'A paginated Signal Life response must not write after the profile gallery unmounts.')
lock('Own Signal Life pagination serializes requests', profileSignalLife,
  /pageRequestRef[\s\S]*?pageRequestRef\.current = true[\s\S]*?if \(!last \|\| pageRequestRef\.current \|\| !hasMore\) return[\s\S]*?pageRequestRef\.current = false/,
  'Rapid LOAD MORE clicks must not issue duplicate Signal Life cursor requests or append duplicate pages.')
lock('Profile pagination deduplicates overlapping pages', publicProfile + profileSignalLife,
  /page\.moments\.filter[\s\S]*?item\.momentId === next\.momentId[\s\S]*?page\.connections\.filter[\s\S]*?item\.connectionId === next\.connectionId[\s\S]*?page\.moments\.filter[\s\S]*?item\.momentId === next\.momentId/,
  'Stable-cursor profile pagination must not render duplicate moments or connections if adjacent pages overlap.')
lock('Signal Life stays cursor-paginated with batched media signing', profileMomentClient + publicProfileClient + publicProfile,
  /createSignedUrls[\s\S]*?get_my_profile_signal_moments_page[\s\S]*?get_signal_public_profile_moments_page[\s\S]*?createSignedUrls[\s\S]*?LOAD MORE SIGNAL LIFE/,
  'Profile growth must not restore the old 60-Moment eager load or one signing request per media object.')
lock('Public profile messaging serializes and rejects stale profile navigation', app,
  /publicProfileMessageRequestRef[\s\S]*?onMessage=\{async[\s\S]*?publicProfileMessageRequestRef\.current[\s\S]*?requestedUserId = publicProfileUserId[\s\S]*?getOrCreateDirectConversationWithUser\(requestedUserId\)[\s\S]*?publicProfileUserId !== requestedUserId[\s\S]*?publicProfileMessageRequestRef\.current = false/,
  'Rapid MESSAGE taps or profile switches must not navigate into the wrong direct conversation.')
lock('Public profile pagination ignores unmounted responses', publicProfile,
  /const mountedRef = useRef\(true\)[\s\S]*?mountedRef\.current = false[\s\S]*?if \(!mountedRef\.current \|\| requestedUserId !== activeUserIdRef\.current\) return/,
  'Public profile pagination must not write after the profile view unmounts.')
lock('Public profile pagination serializes rapid requests', publicProfile,
  /momentsPageRequestRef[\s\S]*?momentsPageRequestRef\.current = true[\s\S]*?connectionsPageRequestRef[\s\S]*?connectionsPageRequestRef\.current = true/,
  'Rapid public-profile LOAD MORE actions must not issue duplicate Moment or connection cursor requests.')
lock('Public profile pagination stays bound to viewed user', publicProfile,
  /activeUserIdRef[\s\S]*?requestedUserId !== activeUserIdRef\.current[\s\S]*?getPublicProfileConnections\(requestedUserId[\s\S]*?requestedUserId !== activeUserIdRef\.current/,
  'Navigating between profiles must not append an older profile pagination response into the newly viewed person.')
lock('Public connections remain clickable and exact-count driven', publicProfile,
  /getPublicProfileConnectionCount[\s\S]*?connectionCount[\s\S]*?setConnectionsOpen\(true\)[\s\S]*?SIGNAL CONNECTIONS/,
  'Connections count/list/profile navigation is a locked profile behavior.')
lock('Public connection modal stays paginated with batched avatars', publicProfileClient + avatarClient + publicProfile,
  /get_signal_public_profile_connections_page[\s\S]*?createProfileAvatarSignedUrls[\s\S]*?createSignedUrls[\s\S]*?LOAD MORE CONNECTIONS/,
  'Large social graphs must remain cursor-paginated and avoid one avatar-signing request per connection.')
lock('Connection actions release synchronous ownership', stayConnected + myConnections,
  /connect[\s\S]*?actionRequestRef\.current = true[\s\S]*?actionRequestRef\.current = false[\s\S]*?respond[\s\S]*?actionRequestRef\.current = true[\s\S]*?actionRequestRef\.current = false[\s\S]*?message[\s\S]*?actionRequestRef\.current = true[\s\S]*?actionRequestRef\.current = false[\s\S]*?disconnect[\s\S]*?actionRequestRef\.current = true[\s\S]*?actionRequestRef\.current = false/,
  'Connection request ownership must release after every success or failure so later actions cannot deadlock.')
lock('Connection actions serialize rapid mutations', stayConnected + myConnections,
  /actionRequestRef[\s\S]*?connect[\s\S]*?actionRequestRef\.current[\s\S]*?respond[\s\S]*?actionRequestRef\.current[\s\S]*?message[\s\S]*?actionRequestRef\.current[\s\S]*?disconnect[\s\S]*?actionRequestRef\.current/,
  'Connect, accept/decline, message-open, and disconnect actions must not rely only on delayed React busy state.')
lock('Connection controls mirror shared mutation ownership', stayConnected + myConnections,
  /disabled=\{busyUserId !== null\}[\s\S]*?disabled=\{busyId !== null\}/,
  'When one connection mutation owns the panel, other rows must visibly disable instead of accepting dead clicks.')
lock('Post-Signal connection refresh invalidates on plan unmount', stayConnected,
  /return \(\) => \{ active = false; refreshEpochRef\.current \+= 1 \}/,
  'A completed connection refresh from an old completion panel must not write after that Plan unmounts.')
lock('Post-Signal connection refresh ignores stale responses', stayConnected,
  /refreshEpochRef[\s\S]*?requestEpoch = \+\+refreshEpochRef\.current[\s\S]*?requestEpoch !== refreshEpochRef\.current/,
  'Realtime and action-triggered refreshes must not let an older post-Signal connection response overwrite newer state.')
lock('Declined post-Signal connections remain retryable', stayConnected,
  /person\.state === 'none' \|\| person\.state === 'declined'[\s\S]*?CONNECT AGAIN/,
  'A declined request must not permanently remove the ability to reconnect after the Signal.')
lock('Connection and safety mutations share visible ownership', myConnections + userSafetyActions,
  /safetyBusyId[\s\S]*?actionRequestRef\.current \|\| safetyBusyId !== null[\s\S]*?disabled=\{busyId !== null \|\| safetyBusyId !== null\}[\s\S]*?onBusyChange[\s\S]*?actionRequestRef\.current \|\| disabled[\s\S]*?onBusyChange\?\.\(true\)[\s\S]*?onBusyChange\?\.\(false\)/,
  'Disconnect, message, block, and report actions on a connection must not race one another across component boundaries.')
lock('Own connection navigation and pagination freeze during mutations', myConnections,
  /loadMore[\s\S]*?pageRequestRef\.current \|\| actionRequestRef\.current \|\| safetyBusyId !== null[\s\S]*?profile-connection-identity[\s\S]*?disabled=\{busyId !== null \|\| safetyBusyId !== null\}[\s\S]*?profile-connections-load-more[\s\S]*?disabled=\{loadingMore \|\| busyId !== null \|\| safetyBusyId !== null\}/,
  'Connection mutation ownership must freeze profile navigation and pagination so disconnect/message cannot race stale list actions.')
lock('Own connection pagination serializes and rejects stale pages', myConnections,
  /pageRequestRef[\s\S]*?requestEpoch = refreshEpochRef\.current[\s\S]*?pageRequestRef\.current = true[\s\S]*?requestEpoch !== refreshEpochRef\.current/,
  'Rapid connection pagination must serialize and an older page must not append after a newer full refresh.')
lock('Own connection refresh invalidates on panel unmount', myConnections,
  /return \(\) => \{ active = false; refreshEpochRef\.current \+= 1 \}/,
  'Connection refresh and pagination responses must be invalidated when the panel unmounts.')
lock('Own connection refresh ignores stale responses', myConnections,
  /refreshEpochRef[\s\S]*?requestEpoch = \+\+refreshEpochRef\.current[\s\S]*?requestEpoch !== refreshEpochRef\.current/,
  'Disconnect and block refreshes must not let older connection pages restore stale state.')
lock('Own profile connections remain exact-count clickable', myConnections,
  /getPublicProfileConnectionCount\(userId\)[\s\S]*?setConnectionCount\(exactCount\)[\s\S]*?profile-connections-summary[\s\S]*?setOpen\(true\)[\s\S]*?My SIGNAL connections/,
  'The owner profile must show an exact clickable Connections count and modal list.')
lock('Own profile save serializes upload and profile mutations', profile,
  /saveProfileRequestRef[\s\S]*?saveProfile = async[\s\S]*?saveProfileRequestRef\.current[\s\S]*?saveProfileRequestRef\.current = true[\s\S]*?saveProfileRequestRef\.current = false/,
  'Profile avatar, identity-gallery, and profile writes must remain one client-owned save transaction.')
lock('My Energy stays out of public profile', publicProfile,
  /^(?![\s\S]*MY ENERGY)(?![\s\S]*SignalPreferencesPanel)[\s\S]*$/,
  'My Energy is private/backend-facing preference data and must not render publicly.')
lock('My Energy remains editable only in own profile flow', profile + profilePreferences,
  /SignalPreferencesPanel[\s\S]*?MY ENERGY[\s\S]*?SAVE MY ENERGY/,
  'Private preference editing must remain available to the owner.')
lock('Energy preference controls freeze during save', profilePreferences,
  /saveRequestRef\.current[\s\S]*?disabled=\{saving\}[\s\S]*?GROUPS\.map[\s\S]*?disabled=\{saving\}[\s\S]*?signal-preferences-save[\s\S]*?disabled=\{saving\}/,
  'Energy preference editor controls must freeze while the authoritative save owns the draft.')
lock('Chill preference save preserves newer local edits', chillDatingPreferences,
  /saved = await updateMyChillDatingPreferences\(next\)[\s\S]*?setPreferences\(\(current\)[\s\S]*?current\.minAge !== next\.minAge[\s\S]*?current\.maxAge !== next\.maxAge[\s\S]*?return saved/,
  'A completed Chill save must not wipe age edits made while the request was in flight.')
lock('Profile preference saves serialize rapid mutations', profilePreferences + chillDatingPreferences,
  /saveRequestRef[\s\S]*?save[\s\S]*?saveRequestRef\.current[\s\S]*?saveRequestRef\.current = true[\s\S]*?saveRequestRef\.current = false[\s\S]*?saveRequestRef[\s\S]*?save[\s\S]*?saveRequestRef\.current[\s\S]*?saveRequestRef\.current = true[\s\S]*?saveRequestRef\.current = false/,
  'My Energy and Chill preference writes must not rely only on delayed React saving state.')
lock('Logout serializes rapid sign-out actions', app,
  /logoutRequestRef[\s\S]*?handleLogout[\s\S]*?logoutRequestRef\.current[\s\S]*?logoutRequestRef\.current = true[\s\S]*?signOutCurrentUser[\s\S]*?logoutRequestRef\.current = false/,
  'Rapid logout taps must not issue duplicate sign-out mutations; failure must release ownership for retry.')
lock('Access gate invalidates onboarding reads on lifecycle change', signalAccessGate,
  /return \(\) => \{[\s\S]*?active = false[\s\S]*?resolveEpochRef\.current \+= 1[\s\S]*?\}/,
  'Access gate onboarding reads must be invalidated when the gate effect is replaced or unmounted.')
lock('Access gate rejects stale onboarding responses', signalAccessGate,
  /resolveEpochRef[\s\S]*?requestEpoch = \+\+resolveEpochRef\.current[\s\S]*?getMyOnboardingState[\s\S]*?requestEpoch !== resolveEpochRef\.current/,
  'Session or auth changes must invalidate older onboarding reads before they can restore stale access state.')
lock('Auth and onboarding submissions serialize rapid submits', authGate + onboardingGate,
  /submitRequestRef[\s\S]*?handleSubmit[\s\S]*?submitRequestRef\.current[\s\S]*?submitRequestRef\.current = true[\s\S]*?submitRequestRef\.current = false[\s\S]*?submitRequestRef[\s\S]*?handleSubmit[\s\S]*?submitRequestRef\.current[\s\S]*?submitRequestRef\.current = true[\s\S]*?submitRequestRef\.current = false/,
  'Authentication and onboarding writes must not rely only on delayed React submitting state.')
lock('Auth mode remains stable during submission', authGate,
  /switchMode[\s\S]*?submitRequestRef\.current[\s\S]*?setMode\(nextMode\)/,
  'Sign-in/sign-up mode must not switch underneath an in-flight authentication request.')
lock('Moderation actions serialize rapid admin mutations', moderationView + momentModeration,
  /actionRequestRef[\s\S]*?takeNext[\s\S]*?actionRequestRef\.current = true[\s\S]*?actionRequestRef\.current = false[\s\S]*?releaseSelected[\s\S]*?actionRequestRef\.current[\s\S]*?runEnforcement[\s\S]*?actionRequestRef\.current[\s\S]*?finishSelected[\s\S]*?actionRequestRef\.current[\s\S]*?actionRequestRef[\s\S]*?takeNext[\s\S]*?actionRequestRef\.current = true/,
  'Moderation claim, release, enforcement, and resolution actions must not overlap under rapid admin input.')
lock('Moderation case identity freezes during mutations', moderationView + momentModeration,
  /changeTab[\s\S]*?actionRequestRef\.current[\s\S]*?disabled=\{actionLoading\}[\s\S]*?Refresh queue[\s\S]*?actionRequestRef\.current[\s\S]*?setTab\(value\)[\s\S]*?disabled=\{actionLoading\}[\s\S]*?Refresh Moment queue[\s\S]*?actionRequestRef\.current[\s\S]*?setSelectedId\(item\.reportId\)/,
  'An in-flight moderation mutation must stay bound to the case and queue it started against.')
lock('Moderation pagination pauses during case mutations', moderationView + momentModeration,
  /actionRequestRef\.current[\s\S]*?disabled=\{loadingMore \|\| actionLoading\}/,
  'Queue pagination must not race claim, release, enforcement, or review writes while a case mutation owns the panel.')
lock('Moderation pagination deduplicates overlapping queue pages', moderationView + momentModeration,
  /page\.filter[\s\S]*?item\.reportId === next\.reportId[\s\S]*?page\.filter[\s\S]*?item\.reportId === next\.reportId/,
  'Adjacent moderation cursor pages must not render the same report twice.')
lock('Moderation queues serialize pagination and reject stale tabs', moderationView + momentModeration,
  /queueEpochRef[\s\S]*?pageRequestRef[\s\S]*?requestEpoch = append \? queueEpochRef\.current : \+\+queueEpochRef\.current[\s\S]*?requestEpoch !== queueEpochRef\.current/,
  'People and Moment moderation queues must not duplicate cursor pages or let an older tab response replace the current queue.')
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
lock('Moment social mutations serialize rapid actions', activityView,
  /socialMutationRef[\s\S]*?deleteRequestRef[\s\S]*?reportRequestRef[\s\S]*?handleSignal[\s\S]*?socialMutationRef\.current = true[\s\S]*?socialMutationRef\.current = false[\s\S]*?handleComment[\s\S]*?socialMutationRef\.current = true[\s\S]*?socialMutationRef\.current = false[\s\S]*?handleDelete[\s\S]*?deleteRequestRef\.current = true[\s\S]*?deleteRequestRef\.current = false[\s\S]*?handleReport[\s\S]*?reportRequestRef\.current = true[\s\S]*?reportRequestRef\.current = false/,
  'Moment signals, comments, deletes, and reports must synchronously own their mutation request.')
lock('Moment interactive controls freeze during mutations', activityView,
  /disabled=\{reporting \|\| socialBusy \|\| deleting\}[\s\S]*?<select[\s\S]*?disabled=\{reporting \|\| socialBusy \|\| deleting\}[\s\S]*?<input disabled=\{socialBusy \|\| deleting \|\| reporting\}/,
  'Moment report, comment, and compose controls must freeze while a conflicting card mutation owns the Moment.')
lock('Moment card mutations are mutually exclusive', activityView,
  /handleSignal[\s\S]*?deleteRequestRef\.current[\s\S]*?handleComment[\s\S]*?reportRequestRef\.current[\s\S]*?handleCommentDelete[\s\S]*?socialMutationRef\.current[\s\S]*?handleDelete[\s\S]*?commentDeleteRequestRef\.current[\s\S]*?handleReport[\s\S]*?deleteRequestRef\.current/,
  'Reaction, comment, comment-delete, Moment-delete, and report writes on one card must not race each other.')
lock('Moment comment deletion serializes rapid actions', activityView,
  /commentDeleteRequestRef[\s\S]*?handleCommentDelete[\s\S]*?commentDeleteRequestRef\.current[\s\S]*?commentDeleteRequestRef\.current = true[\s\S]*?deleteMyMomentComment[\s\S]*?commentDeleteRequestRef\.current = false/,
  'Rapid comment delete taps must not issue duplicate destructive mutations.')
lock('Deleted comments disappear without refresh races', activityView,
  /deleteMyMomentComment\(commentId\)[\s\S]*?setComments\(\(current\) => current\.filter\(\(comment\) => comment\.commentId !== commentId\)\)[\s\S]*?loadComments\(\)/,
  'A successful delete must remove the comment locally even when comment refresh serialization is already occupied.')
lock('Moment comment pagination pauses during mutations', activityView,
  /commentsRequestRef\.current \|\| socialMutationRef\.current \|\| deleteRequestRef\.current \|\| reportRequestRef\.current \|\| commentDeleteRequestRef\.current[\s\S]*?disabled=\{commentsLoading \|\| socialBusy \|\| deleting \|\| reporting\}/,
  'Comment pagination must not race signal, comment, delete, or report mutations on the same Moment.')
lock('Moment comment pagination serializes requests', activityView,
  /commentsRequestRef[\s\S]*?commentsRequestRef\.current[\s\S]*?commentsRequestRef\.current = true[\s\S]*?setComments[\s\S]*?loadOlder[\s\S]*?commentsRequestRef\.current = false/,
  'Comment refresh and LOAD OLDER must not overlap and overwrite or duplicate the paginated thread.')
lock('Safety report and block actions serialize rapid submissions', userSafetyActions,
  /actionRequestRef[\s\S]*?submitReport[\s\S]*?if \(actionRequestRef\.current \|\| disabled\) return[\s\S]*?actionRequestRef\.current = true[\s\S]*?confirmBlock[\s\S]*?if \(actionRequestRef\.current \|\| disabled\) return/,
  'Rapid report/block actions must share synchronous request ownership instead of relying on delayed React busy state.')
lock('Safety mode controls stay frozen during mutations', userSafetyActions,
  /disabled=\{busy \|\| disabled\}[\s\S]*?REPORT[\s\S]*?disabled=\{busy \|\| disabled\}[\s\S]*?BLOCK[\s\S]*?<select disabled=\{busy \|\| disabled\}[\s\S]*?<textarea disabled=\{busy \|\| disabled\}[\s\S]*?SEND REPORT[\s\S]*?disabled=\{busy \|\| disabled\}[\s\S]*?CANCEL/,
  'Report/block sheets must not switch or close underneath an in-flight safety mutation.')
lock('Unblock action serializes rapid submissions', blockedPeople,
  /actionRequestRef[\s\S]*?unblock[\s\S]*?if \(actionRequestRef\.current\) return[\s\S]*?actionRequestRef\.current = true[\s\S]*?actionRequestRef\.current = false/,
  'Rapid unblock taps must not submit duplicate mutations.')
lock('Blocked people controls mirror shared unblock ownership', blockedPeople,
  /disabled=\{busyId !== null\}[\s\S]*?busyId === user\.userId \? 'UNBLOCKING…' : 'UNBLOCK'/,
  'While one unblock owns the panel, other rows must visibly disable instead of accepting dead clicks.')
lock('Blocked people pagination serializes and rejects stale pages', blockedPeople,
  /pageRequestRef[\s\S]*?requestEpoch = refreshEpochRef\.current[\s\S]*?pageRequestRef\.current = true[\s\S]*?requestEpoch !== refreshEpochRef\.current/,
  'Rapid blocked-user pagination must serialize and an older page must not append after unblock or refresh authority changes.')
lock('Blocked people pagination pauses during unblock', blockedPeople,
  /loadMore[\s\S]*?pageRequestRef\.current \|\| actionRequestRef\.current[\s\S]*?blocked-people-load-more[\s\S]*?disabled=\{loadingMore \|\| busyId !== null\}/,
  'Pagination must not race an unblock mutation or offer a dead LOAD OLDER action while unblock owns the panel.')
lock('Blocked people refresh invalidates on panel unmount', blockedPeople,
  /return \(\) => \{ active = false; refreshEpochRef\.current \+= 1 \}/,
  'Blocked people refreshes must be invalidated when the panel unmounts.')
lock('Blocked people refresh cannot resurrect unblocked users', blockedPeople,
  /refreshEpochRef[\s\S]*?requestEpoch = \+\+refreshEpochRef\.current[\s\S]*?requestEpoch !== refreshEpochRef\.current[\s\S]*?unblockUser[\s\S]*?refreshEpochRef\.current \+= 1/,
  'An older blocked-people read must not restore a user after a successful unblock.')
lock('Comments, blocked users, and moderation evidence batch signing', momentSocialClient + userSafetyClient + adminClient,
  /getMomentCommentsPage[\s\S]*?createProfileAvatarSignedUrls[\s\S]*?getMyBlockedUsersPage[\s\S]*?createProfileAvatarSignedUrls[\s\S]*?getModerationMomentEvidence[\s\S]*?createSignedUrls/,
  'Bounded social and moderation pages must avoid per-row Storage signing fan-out.')
lock('Activity feed refresh invalidates on view unmount', activityView,
  /cancelled = true[\s\S]*?momentRefreshEpochRef\.current \+= 1[\s\S]*?unsubscribe\(\)/,
  'Activity feed refresh and pagination responses must be invalidated when the Activity view unmounts.')
lock('App activity refresh rejects stale responses', app,
  /activityRequestEpochRef[\s\S]*?refreshActivity[\s\S]*?requestEpoch = \+\+activityRequestEpochRef\.current[\s\S]*?requestEpoch !== activityRequestEpochRef\.current[\s\S]*?requestEpoch === activityRequestEpochRef\.current/,
  'Overlapping app-level Activity refreshes must not let an older response overwrite newer feed authority.')
lock('Activity feed pagination serializes rapid requests', activityView,
  /momentPageRequestRef[\s\S]*?if \(!last \|\| momentPageRequestRef\.current\) return[\s\S]*?momentPageRequestRef\.current = true[\s\S]*?getSignalMomentsPage[\s\S]*?momentPageRequestRef\.current = false/,
  'Rapid LOAD OLDER MOMENTS taps must issue one cursor request at a time.')
lock('Activity feed refresh ordering preserves loaded history', activityView,
  /momentRefreshEpochRef[\s\S]*?requestEpoch = \+\+momentRefreshEpochRef\.current[\s\S]*?retainedOlder[\s\S]*?requestEpoch !== momentRefreshEpochRef\.current[\s\S]*?momentsLoadingMore/,
  'Realtime and manual Activity refreshes must reject stale responses without discarding already-loaded older pages.')
lock('Activity realtime defers hidden-tab refreshes', activityView,
  /document\.visibilityState !== 'visible'[\s\S]*?momentRefreshPendingRef\.current = true[\s\S]*?visibilitychange[\s\S]*?refreshMomentFeed/,
  'Hidden Activity tabs must defer realtime feed reads and catch up once when visible again.')
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
