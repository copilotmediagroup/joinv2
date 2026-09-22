import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Bell,
  Camera,
  ImagePlus,
  MoreHorizontal,
  ChevronRight,
  Compass,
  MessageCircle,
  LogOut,
  Search,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  ShieldCheck,
  Zap,
} from 'lucide-react'
import './App.css'
import { toUserFacingError } from './lib/userFacingError'
import { getMyAdminCapabilities } from './features/admin/adminClient'
import { signOutCurrentUser } from './features/auth/authClient'
import NotificationPanel from './features/notifications/NotificationPanel'
import SignalCompletionView from './features/outing/SignalCompletionView'
import { getMyPendingSignalCompletionPlanId, resetCompletionRecoverySession } from './features/outing/signalCompletionClient'
import { getOrCreateDirectConversationWithUser } from './features/messaging/directMessagingClient'
import ProfileSearchPanel from './features/profile/ProfileSearchPanel'
import { getMyNotifications, getMyUnreadNotificationCount, subscribeToMyNotifications, type SignalNotification } from './features/notifications/notificationClient'
import {
  getMyActivity,
  type ActivityItem,
} from './features/activity/activityClient'
import { createProfileAvatarSignedUrl } from './features/onboarding/avatarClient'
import {
  getMySignalParticipants,
  type SignalParticipantIdentity,
} from './features/signal/participants/signalParticipantsClient'
import { useSignalCurrentUser } from './features/onboarding/components/signalCurrentUserContext'
import {
  getMySignalDiscovery,
  subscribeToSignalDiscovery,
  type SignalDiscoveryActivity,
} from './features/signal/discovery/signalDiscoveryClient'
import {
  getMyBoredOpportunity,
  acceptMyBoredOpportunity,
  type BoredOpportunity,
} from './features/signal/discovery/boredOpportunityClient'
import {
  getAuthoritativeHomeCity,
} from './features/city/homeCityAuthority'
import {
  formSignal,
  type SignalFormationResult,
} from './features/signal/formation/signalFormationClient'
import {
  getMyActiveSignalResume,
  openMySignalPlanDetails,
  type SignalResumeResult,
} from './features/signal/resume/signalResumeClient'
import { advanceMySignalJourneyStage } from './features/signal/journey/signalJourneyClient'
import {
  claimMatchingPlanReplacement,
} from './features/plan/planGovernanceClient'
import { getMyChillDatingPreferences } from './features/profile/chillDatingPreferencesClient'
import type {
  SignalRealtimeTarget,
} from './features/signal/realtime/contract'
import {
  useSignalRealtime,
} from './features/signal/realtime/useSignalRealtime'
import {
  withdrawMySignal,
} from './features/signal/withdrawal/signalWithdrawalClient'
import type {
  LockedSignalVenue,
} from './features/signal/SignalTimeStage'

const ActivityView = React.lazy(
  () => import('./features/activity/ActivityView'),
)
const MessagesView = React.lazy(
  () => import('./features/messaging/MessagesView'),
)
const ProfileView = React.lazy(
  () => import('./features/profile/ProfileView'),
)
const PublicProfileView = React.lazy(
  () => import('./features/profile/PublicProfileView'),
)
const ModerationView = React.lazy(
  () => import('./features/admin/ModerationView'),
)
const ActiveOutingView = React.lazy(
  () => import('./features/outing/ActiveOutingView'),
)
const SignalPlanDetailsView = React.lazy(
  () => import('./features/outing/SignalPlanDetailsView'),
)
const SignalPlaceStage = React.lazy(
  () => import('./features/signal/SignalPlaceStage'),
)
const SignalTimeStage = React.lazy(
  () => import('./features/signal/SignalTimeStage'),
)

type Pulse = {
  id: string
  emoji: string
  label: string
  line: string
  image: string
  size: 'hero' | 'wide' | 'medium' | 'small'
}

type SignalPreferenceTime =
  | 'NOW'
  | 'TONIGHT'
  | 'TOMORROW'
  | 'THIS_WEEKEND'

type SignalPreferenceCrowd =
  | 'everyone'
  | 'women_only'
  | 'men_only'

type SignalPreferenceAge =
  | 'open'
  | '30_plus'
  | '40_plus'

function getProfileAge(
  birthDate: string | null,
): number | null {
  if (!birthDate) {
    return null
  }

  const parts = birthDate
    .split('-')
    .map((value) => Number(value))

  if (
    parts.length !== 3 ||
    parts.some((value) => !Number.isInteger(value))
  ) {
    return null
  }

  const [birthYear, birthMonth, birthDay] = parts
  const now = new Date()

  const currentYear = now.getUTCFullYear()
  const currentMonth = now.getUTCMonth() + 1
  const currentDay = now.getUTCDate()

  let age = currentYear - birthYear

  if (
    currentMonth < birthMonth ||
    (
      currentMonth === birthMonth &&
      currentDay < birthDay
    )
  ) {
    age -= 1
  }

  return age >= 0 ? age : null
}

const imageUrl = (id: string) =>
  ['https:', '//images.unsplash.com/photo-', id, '?auto=format&fit=crop&w=1400&q=90'].join('')



const pulses: Pulse[] = [
  {
    id: 'drinks',
    emoji: '🍸',
    label: 'DRINKS',
    line: 'down for drinks',
    image: imageUrl('1513558161293-cdaf765ed2fd'),
    size: 'hero',
  },
  {
    id: 'sports',
    emoji: '🏀',
    label: 'SPORTS',
    line: 'ready to play',
    image: imageUrl('1546519638-68e109498ffc'),
    size: 'medium',
  },
  {
    id: 'creative',
    emoji: '🎨',
    label: 'CREATIVE',
    line: 'making something',
    image: imageUrl('1541961017774-22349e4a1262'),
    size: 'medium',
  },
  {
    id: 'food',
    emoji: '🍽️',
    label: 'FOOD',
    line: 'hungry right now',
    image: imageUrl('1414235077428-338989a2e8c0'),
    size: 'wide',
  },
  {
    id: 'music',
    emoji: '🎶',
    label: 'LIVE MUSIC',
    line: 'vibing tonight',
    image: imageUrl('1501386761578-eac5c94b800a'),
    size: 'wide',
  },
  {
    id: 'outdoors',
    emoji: '🌴',
    label: 'OUTDOORS',
    line: 'outside today',
    image: imageUrl('1500530855697-b586d89ba3ee'),
    size: 'small',
  },
  {
    id: 'chill',
    emoji: '📺',
    label: 'CHILL',
    line: 'down to chill',
    image: imageUrl('1489599849927-2ee91cede3ba'),
    size: 'small',
  },
  {
    id: 'explore',
    emoji: '🛍️',
    label: 'EXPLORE',
    line: 'wanna go',
    image: imageUrl('1519501025264-65ba15a82390'),
    size: 'small',
  },
  {
    id: 'nightlife',
    emoji: '🌙',
    label: 'NIGHTLIFE',
    line: 'going out tonight',
    image: imageUrl('1514525253161-7a46d19cd819'),
    size: 'small',
  },
]

function AvatarStack({ urls }: { urls: string[] }) {
  if (urls.length === 0) {
    return null
  }

  return (
    <div className="avatar-stack">
      {urls.map((url) => (
        <img key={url} src={url} alt="" />
      ))}
    </div>
  )
}
function App() {
  const currentUser = useSignalCurrentUser()

  const currentUserAge = useMemo(
    () => getProfileAge(currentUser.birthDate),
    [currentUser.birthDate],
  )

  const canSelectWomenOnly =
    currentUser.gender === 'female'

  const canSelectMenOnly =
    currentUser.gender === 'male'

  const canSelect30Plus =
    currentUserAge !== null &&
    currentUserAge >= 30

  const canSelect40Plus =
    currentUserAge !== null &&
    currentUserAge >= 40

  const [currentUserAvatarUrl, setCurrentUserAvatarUrl] =
    useState<string | null>(null)
  const [discovery, setDiscovery] =
    useState<SignalDiscoveryActivity[]>([])
  const [discoveryLoading, setDiscoveryLoading] =
    useState(true)
  const [discoveryError, setDiscoveryError] =
    useState<string | null>(null)
  const discoveryRequestEpochRef = useRef(0)

  const [activeSurface, setActiveSurface] =
    useState<'discover' | 'activity' | 'messages' | 'profile' | 'public-profile' | 'admin'>('discover')
  const activeSurfaceRef = useRef(activeSurface)
  useEffect(() => { activeSurfaceRef.current = activeSurface }, [activeSurface])
  const [publicProfileUserId, setPublicProfileUserId] = useState<string | null>(null)
  const [liveCaptureMode, setLiveCaptureMode] =
    useState<'camera' | 'upload' | null>(null)
  const [activityItems, setActivityItems] =
    useState<ActivityItem[]>([])
  const [activityLoading, setActivityLoading] =
    useState(false)
  const [activityError, setActivityError] =
    useState<string | null>(null)
  const activityRequestEpochRef = useRef(0)
  const [profileSearchOpen, setProfileSearchOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] =
    useState(false)
  const [notificationUnreadCount, setNotificationUnreadCount] =
    useState(0)
  const [notificationRefreshToken, setNotificationRefreshToken] = useState(0)
  const [notificationToast, setNotificationToast] = useState<SignalNotification | null>(null)
  const notificationToastTimerRef = useRef<number | null>(null)

  useEffect(() => {
    let active = true
    const refreshUnread = async () => {
      try {
        const count = await getMyUnreadNotificationCount()
        if (active) setNotificationUnreadCount(count)
      } catch { /* Panel remains the user-facing error surface. */ }
    }
    void refreshUnread()
    const unsubscribe = subscribeToMyNotifications(currentUser.userId, () => {
      void refreshUnread()
      setNotificationRefreshToken((current) => current + 1)
      void getMyNotifications(1).then(([latest]) => {
        if (!active || !latest || latest.state !== 'unread') return
        setNotificationToast(latest)
        if (notificationToastTimerRef.current !== null) window.clearTimeout(notificationToastTimerRef.current)
        notificationToastTimerRef.current = window.setTimeout(() => setNotificationToast(null), 6500)
      }).catch(() => {})
    })
    return () => {
      active = false
      unsubscribe()
      if (notificationToastTimerRef.current !== null) window.clearTimeout(notificationToastTimerRef.current)
    }
  }, [currentUser.userId])
  const [adminCapabilities, setAdminCapabilities] = useState<string[]>([])

  const canReviewModeration = adminCapabilities.includes('moderation.review')

  useEffect(() => {
    let cancelled = false
    void getMyAdminCapabilities()
      .then((capabilities) => { if (!cancelled) setAdminCapabilities(capabilities) })
      .catch(() => { if (!cancelled) setAdminCapabilities([]) })
    return () => { cancelled = true }
  }, [currentUser.userId])

  const [active, setActive] = useState('drinks')
  const [directActivitySlug, setDirectActivitySlug] =
    useState<string | null>(null)
  const [bored, setBored] = useState(false)
  const [boredOpportunity, setBoredOpportunity] = useState<BoredOpportunity | null>(null)
  const [boredOpportunityLoading, setBoredOpportunityLoading] = useState(false)
  const [boredOpportunityExcluded, setBoredOpportunityExcluded] = useState<string[]>([])
  const [accepted, setAccepted] = useState(false)
  const [signalTimePreference, setSignalTimePreference] =
    useState<SignalPreferenceTime>('TONIGHT')
  const [signalCrowdPreference, setSignalCrowdPreference] =
    useState<SignalPreferenceCrowd>('everyone')
  const [signalAgePreference, setSignalAgePreference] =
    useState<SignalPreferenceAge>('open')
  const [signalPreferencesOpen, setSignalPreferencesOpen] =
    useState(false)
  const [formationResult, setFormationResult] =
    useState<SignalFormationResult | null>(null)
  const [signalRealtimeTarget, setSignalRealtimeTarget] =
    useState<SignalRealtimeTarget | null>(null)
  const [signalParticipants, setSignalParticipants] =
    useState<SignalParticipantIdentity[]>([])
  const [formationSubmitting, setFormationSubmitting] =
    useState(false)
  const formationRequestRef = useRef(false)
  const boredAutomationRequestRef = useRef(false)
  const [formationError, setFormationError] =
    useState<string | null>(null)
  const [withdrawalSubmitting, setWithdrawalSubmitting] =
    useState(false)
  const withdrawalRequestRef = useRef(false)
  const [withdrawalError, setWithdrawalError] =
    useState<string | null>(null)

  const effectiveSignalCrowdPreference: SignalPreferenceCrowd =
    signalCrowdPreference === 'women_only' && !canSelectWomenOnly
      ? 'everyone'
      : signalCrowdPreference === 'men_only' && !canSelectMenOnly
        ? 'everyone'
        : signalCrowdPreference

  const effectiveSignalAgePreference: SignalPreferenceAge =
    signalAgePreference === '40_plus' && !canSelect40Plus
      ? 'open'
      : signalAgePreference === '30_plus' && !canSelect30Plus
        ? 'open'
        : signalAgePreference
  const [signalThreshold, setSignalThreshold] = useState(false)
  const [serverJourneyStage, setServerJourneyStage] = useState<
    'forming' | 'arrival' | 'places' | 'time' | 'plan' | 'active_outing' | 'completed'
  >('forming')

  const [lockedSignalVenue, setLockedSignalVenue] =
    useState<LockedSignalVenue | null>(null)

  const [messagePlanId, setMessagePlanId] =
    useState<string | null>(null)
  const [messageDirectConversationId, setMessageDirectConversationId] =
    useState<string | null>(null)
  const [activePlanId, setActivePlanId] =
    useState<string | null>(null)
  const [activeSignalResume, setActiveSignalResume] =
    useState<SignalResumeResult | null>(null)
  const lastRealtimeJourneyVersionRef = React.useRef<string | null>(null)
  const lastRealtimeGroupIdRef = React.useRef<string | null>(null)
  const journeyRestorePromiseRef = React.useRef<Promise<void> | null>(null)
  const journeyRestoreEpochRef = React.useRef(0)
  const completionHandoffRef = React.useRef(false)
  const [activeOutingPlanId, setActiveOutingPlanId] =
    useState<string | null>(null)
  const [planExitNotice, setPlanExitNotice] =
    useState<string | null>(null)
  const [completionPlanId, setCompletionPlanId] = useState<string | null>(null)
  const [momentComposerPlanId, setMomentComposerPlanId] =
    useState<string | null>(null)
  const [stayConnectedPlanId, setStayConnectedPlanId] =
    useState<string | null>(null)
  const [notificationMomentId, setNotificationMomentId] = useState<string | null>(null)
  const [logoutSubmitting, setLogoutSubmitting] = useState(false)
  const logoutRequestRef = useRef(false)
  const planDetailsOpenRequestRef = useRef(false)
  const publicProfileMessageRequestRef = useRef(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)

  const directActivity = directActivitySlug
    ? pulses.find(
        (pulse) => pulse.id === directActivitySlug,
      ) ?? null
    : null

  const boredOpportunityPulse = boredOpportunity
    ? pulses.find((pulse) => pulse.id === boredOpportunity.activitySlug) ?? null
    : null

  const journeyPresentation = directActivity
    ? {
        id: directActivity.id,
        emoji: directActivity.emoji,
        title: directActivity.label,
        subtitle: directActivity.line,
        image: directActivity.image,
        activitySlug: directActivity.id,
        kicker: 'YOUR SIGNAL',
      }
    : boredOpportunity && boredOpportunityPulse
      ? {
          id: boredOpportunity.activityId,
          emoji: boredOpportunityPulse.emoji,
          title: boredOpportunity.activityName.toUpperCase() + '?',
          subtitle: boredOpportunity.activitySlug === 'chill'
            ? 'A reciprocal dating match is available right now. SIGNAL keeps identities private until the pair locks.'
            : boredOpportunity.activeCount > 0
              ? boredOpportunity.activeCount + ' people are active around this opportunity in your city right now.'
              : 'SIGNAL picked this for right now based on timing and your activity history.',
          image: boredOpportunityPulse.image,
          activitySlug: boredOpportunity.activitySlug,
          kicker: 'SIGNAL FOUND SOMETHING',
        }
      : {
          id: 'bored-search',
          emoji: '⚡',
          title: 'LOOKING AROUND...',
          subtitle: 'Checking what fits right now and where people are active.',
          image: imageUrl('1514525253161-7a46d19cd819'),
          activitySlug: '',
          kicker: 'SIGNAL IS SEARCHING',
        }

  useEffect(() => {
    let cancelled = false

    const loadCurrentUserAvatar = async () => {
      if (!currentUser.avatarPath) {
        setCurrentUserAvatarUrl(null)
        return
      }

      try {
        const signedUrl =
          await createProfileAvatarSignedUrl(
            currentUser.avatarPath,
          )

        if (!cancelled) {
          setCurrentUserAvatarUrl(signedUrl)
        }
      } catch {
        if (!cancelled) {
          setCurrentUserAvatarUrl(null)
        }
      }
    }

    void loadCurrentUserAvatar()

    return () => {
      cancelled = true
    }
  }, [currentUser.avatarPath])

  const refreshDiscovery = async () => {
    const requestEpoch = ++discoveryRequestEpochRef.current
    setDiscoveryLoading(true)
    setDiscoveryError(null)

    try {
      const result =
        await getMySignalDiscovery()

      if (requestEpoch !== discoveryRequestEpochRef.current) return
      setDiscovery(result)
    } catch (error) {
      if (requestEpoch !== discoveryRequestEpochRef.current) return
      setDiscoveryError(
        toUserFacingError(error, 'Unable to load live Signal activity.'),
      )
    } finally {
      if (requestEpoch === discoveryRequestEpochRef.current) setDiscoveryLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    const loadDiscovery = async () => {
      const requestEpoch = ++discoveryRequestEpochRef.current
      setDiscoveryLoading(true)
      setDiscoveryError(null)

      try {
        const result =
          await getMySignalDiscovery()

        if (!cancelled && requestEpoch === discoveryRequestEpochRef.current) {
          setDiscovery(result)
        }
      } catch (error) {
        if (!cancelled && requestEpoch === discoveryRequestEpochRef.current) {
          setDiscovery([])
          setDiscoveryError(
            toUserFacingError(error, 'Unable to load live Signal activity.'),
          )
        }
      } finally {
        if (!cancelled && requestEpoch === discoveryRequestEpochRef.current) {
          setDiscoveryLoading(false)
        }
      }
    }

    void loadDiscovery()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let stopped = false
    let unsubscribe: (() => void) | null = null
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectAttempt = 0

    const refreshLiveCounts = () => {
      if (stopped || refreshTimer) return

      refreshTimer = setTimeout(() => {
        refreshTimer = null

        const requestEpoch = ++discoveryRequestEpochRef.current
        void getMySignalDiscovery()
          .then((result) => {
            if (!stopped && requestEpoch === discoveryRequestEpochRef.current) setDiscovery(result)
          })
          .catch(() => undefined)
      }, 80)
    }

    const connectDiscoveryRealtime = () => {
      if (stopped) return

      void subscribeToSignalDiscovery(refreshLiveCounts, () => {
        if (stopped || reconnectTimer) return
        unsubscribe?.()
        unsubscribe = null
        const delay = Math.min(1_000 * (2 ** reconnectAttempt), 15_000)
        reconnectAttempt += 1
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          connectDiscoveryRealtime()
        }, delay)
      })
        .then((stop) => {
          if (stopped) {
            stop()
            return
          }
          unsubscribe?.()
          unsubscribe = stop
          reconnectAttempt = 0
          refreshLiveCounts()
        })
        .catch(() => {
          if (stopped || reconnectTimer) return
          const delay = Math.min(1_000 * (2 ** reconnectAttempt), 15_000)
          reconnectAttempt += 1
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null
            connectDiscoveryRealtime()
          }, delay)
        })
    }

    connectDiscoveryRealtime()

    // Realtime is the primary authority. This bounded reconciliation is a
    // self-healing backstop for sleeping laptops, transient WebSocket loss,
    // browser throttling, and deployments; it prevents stale social proof
    // from surviving until a manual reload.
    const reconciliationRefresh = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshLiveCounts()
    }, 30_000)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refreshLiveCounts()
    }
    const handleOnline = () => {
      refreshLiveCounts()
      if (!unsubscribe && !reconnectTimer) connectDiscoveryRealtime()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('online', handleOnline)

    return () => {
      stopped = true
      if (refreshTimer) clearTimeout(refreshTimer)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      window.clearInterval(reconciliationRefresh)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('online', handleOnline)
      unsubscribe?.()
    }
  }, [])

  const restoreActiveSignal = useCallback((openJourney = false) => {
    // Completion is intentionally historical, not resumable. Focus/visibility
    // events during its receipt must never reopen the Signal that just ended.
    if (completionHandoffRef.current) return Promise.resolve()

    const inFlight = journeyRestorePromiseRef.current
    if (inFlight) return inFlight

    const restoreEpoch = journeyRestoreEpochRef.current
    const restore = (async () => {
      try {
      // Resolve the canonical journey and this member's attendance independently.
      // A matching checked-in attendance row is the sole authority for live outing;
      // opening Plan details must never impersonate arrival.
      const resume = await getMyActiveSignalResume()
      // A leave/completion boundary can occur while this RPC is in flight. Any
      // response started before that boundary is stale and must not resurrect it.
      if (restoreEpoch !== journeyRestoreEpochRef.current) return
      setActiveSignalResume(resume)
      if (resume?.planId && resume.checkedInAt) {
        setActiveOutingPlanId(resume.planId)
        setActivePlanId(resume.planId)
        setPlanExitNotice(null)
        setMessagePlanId(resume.planId)
        setMessageDirectConversationId(null)
        setSignalThreshold(false)
        setFormationResult(null)
        setSignalRealtimeTarget(null)
        setAccepted(false)
        setBored(false)
        if (openJourney) setActiveSurface('discover')
        return
      }
      setActiveOutingPlanId(null)
      if (!resume) {
        // Server truth says there is no live journey. Purge any stale browser-only
        // Signal/Plan state instead of leaving an old room alive in memory.
        setFormationResult(null)
        setSignalRealtimeTarget(null)
        setSignalParticipants([])
        setSignalThreshold(false)
        setServerJourneyStage('forming')
        setLockedSignalVenue(null)
        setActivePlanId(null)
        setActiveOutingPlanId(null)
        setMessagePlanId(null)
        setMessageDirectConversationId(null)
        setAccepted(false)
        setActive('drinks')
        setDirectActivitySlug(null)
        setBored(false)
        setBoredOpportunity(null)
        setBoredOpportunityExcluded([])
        setSignalTimePreference('TONIGHT')
        setSignalCrowdPreference('everyone')
        setSignalAgePreference('open')
        setSignalPreferencesOpen(false)
        lastRealtimeJourneyVersionRef.current = null
        lastRealtimeGroupIdRef.current = null
        setFormationError(null)
        setWithdrawalError(null)
        if (openJourney) setActiveSurface('discover')
        return
      }

      const matchingPulse = pulses.find(
        (pulse) => pulse.id === resume.activitySlug,
      )
      if (!matchingPulse) return

      setActive(matchingPulse.id)
      setDirectActivitySlug(matchingPulse.id)

      if (resume.groupState === 'active_outing' && resume.planId) {
        // The authoritative Plan snapshot owns the live shell on every session.
        // Preserve the PLAN SET handoff surface, but never let stale historical
        // browser state downgrade a member who is still in this live Signal.
        setActivePlanId(resume.planId)
        setPlanExitNotice(null)
        setMessagePlanId(null)
        setMessageDirectConversationId(null)
        setServerJourneyStage('plan')
        setLockedSignalVenue(resume.lockedVenue)
        if (openJourney) {
          // Details-opened and checked-in are separate server facts. Attendance
          // alone owns entry to the live outing surface.
          setBored(!resume.planDetailsOpened)
          setSignalThreshold(!resume.planDetailsOpened)
          setActiveSurface('discover')
        }
        setFormationError(null)
        setWithdrawalError(null)
        return
      }

      if (!resume.signalIntentId) {
        return
      }

      if (resume.timeWindowCode) setSignalTimePreference(resume.timeWindowCode)
      setSignalCrowdPreference(resume.crowdMode)
      setSignalAgePreference(
        resume.minAge !== null && resume.minAge >= 40
          ? '40_plus'
          : resume.minAge !== null && resume.minAge >= 30
            ? '30_plus'
            : 'open',
      )
      setActivePlanId(null)
      setMessagePlanId(null)
      setFormationResult({
        signalIntentId: resume.signalIntentId,
        signalGroupId: resume.signalGroupId,
        groupState: resume.groupState,
        memberCount: resume.memberCount,
        activationThreshold: resume.activationThreshold,
      })
      setSignalRealtimeTarget({
        signalIntentId: resume.signalIntentId,
        signalGroupId: resume.signalGroupId,
      })
      setFormationError(null)
      setWithdrawalError(null)
      setAccepted(true)
      setBored(true)
      setActiveSurface('discover')

      const coordinationReady =
        resume.groupState === 'coordinating' ||
        resume.groupState === 'locked' ||
        resume.groupState === 'active_outing'
      setSignalThreshold(coordinationReady)
      setServerJourneyStage(resume.signalStage)
      setLockedSignalVenue(resume.lockedVenue)
      setActivePlanId(resume.planId)
      setMessagePlanId(null)
      // A converted Plan remains on the explicit PLAN SET handoff. Chat is a
      // user action; reconciliation/focus/realtime must never auto-open it.
      } catch {
        // Discovery remains available if resume authority is temporarily unavailable.
      }
    })()

    journeyRestorePromiseRef.current = restore
    void restore.finally(() => {
      if (journeyRestorePromiseRef.current === restore) {
        journeyRestorePromiseRef.current = null
      }
    })
    return restore
  }, [])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      void getMyPendingSignalCompletionPlanId()
        .then((planId) => {
          if (cancelled) return
          if (planId) {
            completionHandoffRef.current = true
            setCompletionPlanId(planId)
            return
          }
          void restoreActiveSignal(true)
        })
        .catch(() => { if (!cancelled) void restoreActiveSignal(true) })
    })
    return () => { cancelled = true }
  }, [restoreActiveSignal])

  useEffect(() => {
    // Returning to a visible/focused app is a journey-entry event. Server resume
    // already owns whether a live Signal exists, so restore its current surface
    // instead of merely refreshing hidden state behind Discover.
    // Focus/visibility reconciliation must refresh server journey state without
    // stealing the user's current surface. Clicking/focusing a text input can
    // focus the window, and must never navigate Messages back to Discover.
    const refreshJourney = () => { void restoreActiveSignal(activeSurfaceRef.current === 'discover') }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshJourney()
    }
    window.addEventListener('focus', refreshJourney)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', refreshJourney)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [restoreActiveSignal])

  useEffect(() => {
    const handleOffline = () => setIsOnline(false)
    const handleOnline = () => {
      setIsOnline(true)
      void restoreActiveSignal(false)
    }
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [restoreActiveSignal])

  const discoveryBySlug = useMemo(
    () =>
      new Map(
        discovery.map((activity) => [
          activity.activitySlug,
          activity,
        ]),
      ),
    [discovery],
  )

  const journeyDiscovery =
    discoveryBySlug.get(
      journeyPresentation.activitySlug,
    ) ?? null

  const {
    snapshot: signalRealtimeSnapshot,
    loading: signalRealtimeLoading,
    error: signalRealtimeError,
    connectionState: signalRealtimeConnectionState,
  } = useSignalRealtime(signalRealtimeTarget)

  const authoritativeFormationCount =
    signalRealtimeSnapshot?.memberCount ??
    formationResult?.memberCount ??
    activeSignalResume?.memberCount ??
    0

  const authoritativeActivationThreshold =
    formationResult?.activationThreshold ??
    activeSignalResume?.activationThreshold ??
    0

  const authoritativeGroupState =
    signalRealtimeSnapshot?.group.state ??
    formationResult?.groupState ??
    activeSignalResume?.groupState ??
    null

  const authoritativeSignalGroupId =
    signalRealtimeTarget?.signalGroupId ??
    formationResult?.signalGroupId ??
    activeSignalResume?.signalGroupId ??
    null

  const authoritativeJourneyStage =
    signalRealtimeSnapshot?.group.journeyStage ??
    activeSignalResume?.signalStage ??
    serverJourneyStage

  const authoritativeRoomStage: 'arrival' | 'places' | 'time' =
    authoritativeJourneyStage === 'time' ||
    authoritativeJourneyStage === 'plan' ||
    authoritativeJourneyStage === 'active_outing'
      ? 'time'
      : authoritativeJourneyStage === 'places'
        ? 'places'
        : 'arrival'

  const presentationRoomStage: 'arrival' | 'places' | 'time' = authoritativeRoomStage

  useEffect(() => {
    if (!signalThreshold || authoritativeRoomStage !== 'time' || lockedSignalVenue) return
    const timer = window.setTimeout(() => { void restoreActiveSignal(false) }, 0)
    return () => window.clearTimeout(timer)
  }, [authoritativeRoomStage, lockedSignalVenue, restoreActiveSignal, signalThreshold])

  useEffect(() => {
    const targetGroupId = signalRealtimeTarget?.signalGroupId ?? null
    if (!signalRealtimeSnapshot || !targetGroupId) {
      lastRealtimeJourneyVersionRef.current = null
      lastRealtimeGroupIdRef.current = null
      return
    }

    if (lastRealtimeGroupIdRef.current !== targetGroupId) {
      lastRealtimeGroupIdRef.current = targetGroupId
      lastRealtimeJourneyVersionRef.current = null
    }

    const journeyVersion = [
      signalRealtimeSnapshot.group.id,
      signalRealtimeSnapshot.group.state,
      signalRealtimeSnapshot.group.journeyStage,
      signalRealtimeSnapshot.group.updatedAt,
    ].join(':')

    if (lastRealtimeJourneyVersionRef.current === null) {
      lastRealtimeJourneyVersionRef.current = journeyVersion
      if (
        signalRealtimeSnapshot.group.journeyStage === 'plan' ||
        signalRealtimeSnapshot.group.journeyStage === 'active_outing' ||
        signalRealtimeSnapshot.group.state === 'active_outing'
      ) {
        window.setTimeout(() => { void restoreActiveSignal(false) }, 0)
      }
      return
    }
    if (lastRealtimeJourneyVersionRef.current === journeyVersion) return

    const previousJourneyVersion = lastRealtimeJourneyVersionRef.current
    lastRealtimeJourneyVersionRef.current = journeyVersion
    if (
      previousJourneyVersion !== journeyVersion &&
      (
        signalRealtimeSnapshot.group.journeyStage === 'plan' ||
        signalRealtimeSnapshot.group.journeyStage === 'active_outing' ||
        signalRealtimeSnapshot.group.state === 'active_outing'
      )
    ) {
      void restoreActiveSignal(false)
    }
  }, [
    restoreActiveSignal,
    signalRealtimeSnapshot,
    signalRealtimeTarget?.signalGroupId,
  ])


  const signalParticipantRosterVersion =
    signalRealtimeSnapshot?.memberships
      .filter((membership) =>
        membership.state === 'matched' ||
        membership.state === 'confirmed',
      )
      .map((membership) =>
        `${membership.userId}:${membership.state}:${membership.updatedAt}`,
      )
      .join('|') ?? ''

  useEffect(() => {
    let cancelled = false

    if (!authoritativeSignalGroupId) {
      queueMicrotask(() => {
        if (!cancelled) setSignalParticipants([])
      })
      return () => { cancelled = true }
    }

    void getMySignalParticipants(authoritativeSignalGroupId)
      .then((participants) => {
        if (!cancelled) setSignalParticipants(participants)
      })
      .catch(() => {
        if (!cancelled) setSignalParticipants([])
      })

    return () => { cancelled = true }
  }, [authoritativeSignalGroupId, signalParticipantRosterVersion])

  const previousSignalGroupStateRef =
    useRef<typeof authoritativeGroupState>(null)

  useEffect(() => {
    const previousGroupState =
      previousSignalGroupStateRef.current

    previousSignalGroupStateRef.current =
      authoritativeGroupState

    if (
      authoritativeGroupState === 'locked' &&
      previousGroupState !== 'locked' &&
      !signalThreshold
    ) {
      // Product beat: critical mass should be felt, not skipped. Keep the live
      // forming roster on screen long enough for the newly joined person to
      // animate in before revealing coordination. Server state is already locked.
      const revealTimer = window.setTimeout(() => {
        setLockedSignalVenue(null)
        setSignalThreshold(true)


      }, 3200)
      return () => window.clearTimeout(revealTimer)
    }
  }, [authoritativeGroupState, authoritativeSignalGroupId, restoreActiveSignal, signalThreshold])

  // One owner for arrival -> places. Fresh locks wait for the reveal beat above;
  // resumed locked Signals that are already at arrival converge through the same
  // path. There is no separate user-controlled NEXT transition.
  useEffect(() => {
    if (!signalThreshold || !authoritativeSignalGroupId || authoritativeRoomStage !== 'arrival') return

    let cancelled = false
    void advanceMySignalJourneyStage(authoritativeSignalGroupId, 'places')
      .then((stage) => {
        if (cancelled) return
        setServerJourneyStage(stage)
      })
      .catch(() => {
        if (!cancelled) void restoreActiveSignal(false)
      })

    return () => { cancelled = true }
  }, [authoritativeRoomStage, authoritativeSignalGroupId, restoreActiveSignal, signalThreshold])

  const signalHasReachedCriticalMass =
    authoritativeGroupState === 'confirming' ||
    authoritativeGroupState === 'coordinating' ||
    authoritativeGroupState === 'locked' ||
    authoritativeGroupState === 'active_outing'

  const formationMessage =
    formationError
      ? formationError
      : formationSubmitting
        ? 'Joining your Signal...'
        : authoritativeFormationCount === 0
          ? 'Scanning nearby Signals...'
          : signalHasReachedCriticalMass
            ? 'SIGNAL FORMED'
            : authoritativeActivationThreshold > 0 &&
                authoritativeFormationCount >=
                  Math.max(
                    authoritativeActivationThreshold - 1,
                    1,
                  )
              ? 'Almost there...'
              : authoritativeFormationCount >= 3
                ? 'Momentum building...'
                : 'Finding your people...'

  const refreshActivity = async () => {
    const requestEpoch = ++activityRequestEpochRef.current
    setActivityLoading(true)
    setActivityError(null)

    try {
      const result = await getMyActivity()
      if (requestEpoch !== activityRequestEpochRef.current) return
      setActivityItems(result)
    } catch (error) {
      if (requestEpoch !== activityRequestEpochRef.current) return
      setActivityError(
        toUserFacingError(error, 'Unable to load Activity.'),
      )
    } finally {
      if (requestEpoch === activityRequestEpochRef.current) setActivityLoading(false)
    }
  }

  const handleActivityNavigation = () => {
    if (activeOutingPlanId) { void restoreActiveSignal(true); return }
    setActiveSurface('activity')
    void refreshActivity()
  }

  const handleOpenActivityItem = () => {
    setNotificationsOpen(false)
    // Activity is only a doorway to the caller's CURRENT server-owned journey.
    // Never hydrate live UI from a row that may have become stale after render.
    void restoreActiveSignal(true)
  }

  const handleMessagesNavigation = () => {
    const livePlanId = activeOutingPlanId ?? activePlanId
    if (livePlanId) { setMessagePlanId(livePlanId); setMessageDirectConversationId(null); setActiveSurface('messages'); return }
    setMessagePlanId(null)
    setMessageDirectConversationId(null)
    setActiveSurface('messages')
  }

  const handleOpenPlanDetails = async (planId: string) => {
    if (planDetailsOpenRequestRef.current) return
    planDetailsOpenRequestRef.current = true
    try {
      await openMySignalPlanDetails(planId)
      setActivePlanId(planId)
    setMessagePlanId(planId)
    setMessageDirectConversationId(null)
    setNotificationsOpen(false)
    setSignalThreshold(false)
    setActiveOutingPlanId(null)
      setActiveSignalResume((current) => current && current.planId === planId ? { ...current, planDetailsOpened: true } : current)
      setActiveSurface('discover')
    } finally {
      planDetailsOpenRequestRef.current = false
    }
  }

  const handleOpenPlanChat = (planId: string) => {
    setActivePlanId(planId)
    setMessagePlanId(planId)
    setMessageDirectConversationId(null)
    setNotificationsOpen(false)
    setSignalThreshold(false)
    setActiveSurface('messages')
  }

  const handleOpenSignalNotification = () => {
    setNotificationsOpen(false)
    // The resolver proves a live journey exists, but the browser still rehydrates
    // from the canonical resume RPC instead of trusting notification-era IDs.
    void restoreActiveSignal(true)
  }

  const handleHistoricalNotification = (notificationType: string, relatedPlanId: string | null, relatedEntityId: string | null) => {
    setNotificationsOpen(false)
    setFormationResult(null)
    setSignalRealtimeTarget(null)
    setSignalThreshold(false)
    setLockedSignalVenue(null)
    setMessagePlanId(null)
    setActivePlanId(null)
    setAccepted(false)
    setBored(false)

    if ((notificationType === 'moment_signal' || notificationType === 'moment_comment' || notificationType === 'moment_reply') && relatedEntityId) {
      setMessageDirectConversationId(null)
      setMomentComposerPlanId(null)
      setStayConnectedPlanId(null)
      setNotificationMomentId(relatedEntityId)
      setActiveSurface('activity')
      setPlanExitNotice(null)
    } else if (notificationType === 'direct_message' && relatedEntityId) {
      setMessageDirectConversationId(relatedEntityId)
      setMessagePlanId(null)
      setActiveSurface('messages')
      setPlanExitNotice(null)
    } else if (notificationType === 'plan_completed') {
      setMessageDirectConversationId(null)
      setMomentComposerPlanId(relatedPlanId)
      setStayConnectedPlanId(relatedPlanId)
      setActiveSurface('activity')
      setPlanExitNotice('SIGNAL complete. Add a photo or video to Moments while it’s fresh.')
    } else if (notificationType === 'connection_request' || notificationType === 'connection_accepted') {
      setMessageDirectConversationId(null)
      setMomentComposerPlanId(null)
      setStayConnectedPlanId(relatedPlanId)
      setActiveSurface('activity')
      setPlanExitNotice(notificationType === 'connection_request' ? 'Someone from your SIGNAL wants to stay connected.' : 'You’re connected with someone from SIGNAL.')
    } else {
      setMessageDirectConversationId(null)
      setMomentComposerPlanId(null)
      setStayConnectedPlanId(null)
      setActiveSurface('discover')
      setPlanExitNotice('This Signal has ended. There is no live room to return to.')
    }

    void Promise.all([refreshActivity(), refreshDiscovery()])
  }

  const handleProfileNavigation = () => {
    if (activeOutingPlanId) { void restoreActiveSignal(true); return }
    setActiveSurface('profile')
  }

  const handleLogout = async () => {
    if (logoutRequestRef.current) return
    logoutRequestRef.current = true
    setLogoutSubmitting(true)
    setLogoutError(null)
    try {
      // Completion suppression is scoped to this authenticated browser session.
      // Never let it survive sign-out and suppress journey restoration for the
      // next account that signs in on the same tab.
      completionHandoffRef.current = false
      setCompletionPlanId(null)
      resetCompletionRecoverySession()
      journeyRestoreEpochRef.current += 1
      journeyRestorePromiseRef.current = null
      await signOutCurrentUser()
    } catch {
      logoutRequestRef.current = false
      setLogoutError('Unable to log out right now. Please try again.')
      setLogoutSubmitting(false)
    }
  }

  const handleSignalCenterNavigation = () => {
    setActiveSurface('discover')

    // Re-open the already-authoritative journey immediately. Do not expose the
    // ordinary I'M DOWN discovery card while the resume RPC is in flight.
    if (activeSignalResume?.groupState === 'active_outing' && activeSignalResume.planId) {
      setBored(true)
      setSignalThreshold(true)
      setServerJourneyStage('plan')
      setLockedSignalVenue(activeSignalResume.lockedVenue)
      void restoreActiveSignal(true)
      return
    }

    if (activeOutingPlanId) { void restoreActiveSignal(true); return }

    if (hasActiveSignalJourney) {
      setBored(true)
      void restoreActiveSignal(true)
      return
    }

    setDirectActivitySlug(null)
    setBored(true)
    setAccepted(false)
    setFormationError(null)
    setFormationResult(null)
    setSignalRealtimeTarget(null)
    setSignalThreshold(false)
    setLockedSignalVenue(null)
  }

  const handleDiscoverNavigation = () => {
    setActiveSurface('discover')
    if (activeOutingPlanId) { void restoreActiveSignal(true); return }

    if (hasActiveSignalJourney) {
      setBored(true)
      void restoreActiveSignal(true)
      return
    }

    setBored(false)
    setSignalThreshold(false)
    setLockedSignalVenue(null)
    void refreshDiscovery()
  }

  const handleLeaveSignal = async () => {
    if (
      withdrawalRequestRef.current ||
      !canWithdrawSignal
    ) {
      return
    }

    const signalIntentId =
      signalRealtimeTarget?.signalIntentId ??
      formationResult?.signalIntentId ??
      null

    if (!signalIntentId) {
      setWithdrawalError(
        'Unable to identify your active Signal.',
      )
      return
    }

    withdrawalRequestRef.current = true
    setWithdrawalSubmitting(true)
    setWithdrawalError(null)

    try {
      await withdrawMySignal(signalIntentId)
      journeyRestoreEpochRef.current += 1
      journeyRestorePromiseRef.current = null

      /*
       * PostgreSQL succeeded first.
       *
       * Only now may the browser discard the departed
       * journey and stop its Realtime subscription.
       */
      setActiveSignalResume(null)
      setAccepted(false)
      setFormationResult(null)
      setSignalRealtimeTarget(null)
      setSignalParticipants([])
      setActive('drinks')
      setDirectActivitySlug(null)
      setBored(false)
      setBoredOpportunity(null)
      setBoredOpportunityExcluded([])
      setSignalTimePreference('TONIGHT')
      setSignalCrowdPreference('everyone')
      setSignalAgePreference('open')
      setSignalPreferencesOpen(false)

      // Leaving is a hard local journey boundary. Do not leave any coordination
      // or Plan pointer behind that can make a departed Signal render again.
      setSignalThreshold(false)
      setServerJourneyStage('forming')
      setLockedSignalVenue(null)
      setActivePlanId(null)
      setActiveOutingPlanId(null)
      setMessagePlanId(null)
      setMessageDirectConversationId(null)
      lastRealtimeJourneyVersionRef.current = null
      lastRealtimeGroupIdRef.current = null

      setFormationError(null)
      setActiveSurface('discover')

      await Promise.all([
        refreshDiscovery(),
        refreshActivity(),
      ])
    } catch (error) {
      setWithdrawalError(
        toUserFacingError(error, 'Unable to leave this Signal right now.'),
      )
    } finally {
      withdrawalRequestRef.current = false
      setWithdrawalSubmitting(false)
    }
  }

  const loadBoredOpportunity = async (excluded: string[] = []) => {
    setBoredOpportunityLoading(true)
    setFormationError(null)
    try {
      const opportunity = await getMyBoredOpportunity(excluded)
      if (!opportunity) throw new Error('No automatic opportunity is available right now.')
      setBoredOpportunity(opportunity)
      setBoredOpportunityExcluded(excluded)
    } catch (error) {
      setBoredOpportunity(null)
      setFormationError(toUserFacingError(error, 'Unable to find something right now.'))
    } finally {
      setBoredOpportunityLoading(false)
    }
  }

  const handleImDown = async (boredOpportunityOverride?: BoredOpportunity) => {
    // React state does not synchronously lock a rapid second click. The ref does.
    // One user gesture must own exactly one immutable formation request.
    if (formationRequestRef.current) return
    formationRequestRef.current = true

    const selectedBoredOpportunity = boredOpportunityOverride ?? boredOpportunity
    const requestedActivitySlug =
      directActivitySlug ??
      selectedBoredOpportunity?.activitySlug ??
      null
    const requestedJourneyOrigin = directActivitySlug
      ? 'direct_signal' as const
      : 'im_bored' as const
    const requestedTimeWindow = directActivitySlug
      ? signalTimePreference
      : selectedBoredOpportunity?.timeWindow ?? 'NOW'
    const requestedCrowdMode = requestedActivitySlug === 'chill'
      ? 'everyone' as const
      : effectiveSignalCrowdPreference
    const requestedAgePreference = effectiveSignalAgePreference

    setFormationSubmitting(true)
    setFormationError(null)

    try {
      if (!requestedActivitySlug) {
        throw new Error('This Signal suggestion is not available yet.')
      }

      const existingJourney = await getMyActiveSignalResume()
      if (existingJourney?.signalIntentId) {
        // Only an in-flight Signal intent blocks another formation request.
        // A future Plan is not the Signal the user just tapped and must not turn
        // I'M DOWN into a silent no-op.
        if (existingJourney.activitySlug !== requestedActivitySlug) {
          throw new Error(
            `You already have an active ${existingJourney.activitySlug.replace(/[-_]/g, ' ')} Signal. Leave it before joining another Signal.`,
          )
        }
        await restoreActiveSignal(true)
        return
      }

      const homeCity = await getAuthoritativeHomeCity()
      const activitySlug = requestedActivitySlug
      const journeyOrigin = requestedJourneyOrigin

      if (activitySlug === 'chill') {
        const datingPreferences = await getMyChillDatingPreferences()
        if (!datingPreferences?.isEnabled) {
          throw new Error('Set your Chill dating preferences in Profile before starting a Chill Signal.')
        }
      }

      const minAge = activitySlug === 'chill'
        ? null
        : requestedAgePreference === '30_plus'
          ? 30
          : requestedAgePreference === '40_plus'
            ? 40
            : null

      const replacement = activitySlug === 'chill'
        ? { claimed: false, planId: null }
        : await claimMatchingPlanReplacement({
        citySlug: homeCity.slug,
        activitySlug,
        timeWindow: requestedTimeWindow,
        crowdMode: requestedCrowdMode,
        minAge,
        maxAge: null,
      })

      if (replacement.claimed && replacement.planId) {
        if (!directActivitySlug && selectedBoredOpportunity) {
          await acceptMyBoredOpportunity(selectedBoredOpportunity.boredIntentId, activitySlug)
        }
        setFormationResult(null)
        setSignalRealtimeTarget(null)
        setSignalThreshold(false)
        setLockedSignalVenue(null)
        setAccepted(false)
        setBored(false)
        setMessagePlanId(replacement.planId)
        setActivePlanId(replacement.planId)
        setActiveSurface('messages')
        await Promise.all([refreshActivity(), refreshDiscovery()])
        return
      }

      const result =
        await formSignal({
          citySlug: homeCity.slug,
          activitySlug,
          timeWindow:
            requestedTimeWindow,
          crowdMode:
            requestedCrowdMode,
          minAge,
          maxAge: null,
          journeyOrigin,
        })

      if (!directActivitySlug && selectedBoredOpportunity) {
        await acceptMyBoredOpportunity(selectedBoredOpportunity.boredIntentId, activitySlug)
      }

      setFormationResult(result)
      setWithdrawalError(null)

      setSignalRealtimeTarget({
        signalIntentId:
          result.signalIntentId,
        signalGroupId:
          result.signalGroupId,
      })

      setAccepted(true)
    } catch (error) {
      setAccepted(false)
      setFormationResult(null)
      setSignalRealtimeTarget(null)

      // A formation request can commit on the server even if the browser loses
      // the response. Reconcile once before declaring failure so Incognito does
      // not visually fall back to the pre-join card after a successful commit.
      const committedJourney = await getMyActiveSignalResume().catch(() => null)
      if (
        committedJourney?.signalIntentId &&
        committedJourney.activitySlug === requestedActivitySlug
      ) {
        if (!directActivitySlug && selectedBoredOpportunity) {
          await acceptMyBoredOpportunity(
            selectedBoredOpportunity.boredIntentId,
            requestedActivitySlug,
          ).catch(() => undefined)
        }
        await restoreActiveSignal(true)
        return
      }

      setFormationError(
        toUserFacingError(error, 'Unable to join this Signal right now.'),
      )
    } finally {
      formationRequestRef.current = false
      setFormationSubmitting(false)
    }
  }

  const handleImBoredAutomation = async () => {
    if (boredAutomationRequestRef.current || formationRequestRef.current || boredOpportunityLoading || formationSubmitting) return
    boredAutomationRequestRef.current = true

    const existingJourney = await getMyActiveSignalResume().catch(() => null)
    if (existingJourney?.signalIntentId || existingJourney?.planId) {
      try { await restoreActiveSignal(true) } finally { boredAutomationRequestRef.current = false }
      return
    }

    setDirectActivitySlug(null)
    setBored(true)
    setAccepted(false)
    setFormationError(null)
    setFormationResult(null)
    setSignalRealtimeTarget(null)
    setBoredOpportunity(null)
    setBoredOpportunityExcluded([])
    setSignalTimePreference('NOW')
    setSignalCrowdPreference('everyone')
    setSignalAgePreference('open')
    setBoredOpportunityLoading(true)

    try {
      const opportunity = await getMyBoredOpportunity([])
      if (!opportunity) throw new Error('No automatic opportunity is available right now.')
      setBoredOpportunity(opportunity)
      await handleImDown(opportunity)
    } catch (error) {
      setFormationError(toUserFacingError(error, 'Unable to find something right now.'))
    } finally {
      boredAutomationRequestRef.current = false
      setBoredOpportunityLoading(false)
    }
  }

  const nextSuggestion = () => {
    setAccepted(false)
    setFormationError(null)
    setFormationResult(null)
    setSignalRealtimeTarget(null)

    if (directActivitySlug) {
      const currentIndex =
        pulses.findIndex(
          (pulse) =>
            pulse.id === directActivitySlug,
        )

      const nextIndex =
        currentIndex >= 0
          ? (currentIndex + 1) % pulses.length
          : 0

      const nextPulse = pulses[nextIndex]

      setDirectActivitySlug(nextPulse.id)
      setActive(nextPulse.id)
      return
    }

    const excluded = boredOpportunity
      ? [...new Set([...boredOpportunityExcluded, boredOpportunity.activitySlug])]
      : boredOpportunityExcluded
    void loadBoredOpportunity(excluded.length >= pulses.length ? [] : excluded)
  }

  const hasActiveSignalJourney =
    Boolean(activeSignalResume) ||
    Boolean(activePlanId) ||
    (
      accepted &&
      Boolean(
        signalRealtimeTarget ||
        formationResult,
      )
    )

  useEffect(() => {
    if (!hasActiveSignalJourney) return

    const guardState = {
      ...(window.history.state ?? {}),
      signalJourneyGuard: true,
    }

    if (!window.history.state?.signalJourneyGuard) {
      window.history.pushState(guardState, '', window.location.href)
    }

    const handlePopState = () => {
      window.history.pushState(guardState, '', window.location.href)
      void restoreActiveSignal(true)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [hasActiveSignalJourney, restoreActiveSignal])

  const canWithdrawSignal =
    hasActiveSignalJourney &&
    (
      authoritativeGroupState === 'forming' ||
      authoritativeGroupState === 'confirming' ||
      authoritativeGroupState === 'coordinating' ||
      authoritativeGroupState === 'locked'
    )

  const formedSignalTimeLabel =
    signalTimePreference === 'THIS_WEEKEND'
      ? 'THIS WEEKEND'
      : signalTimePreference

  const formedSignalCrowdMode =
    signalRealtimeSnapshot?.group.crowdMode ??
    effectiveSignalCrowdPreference

  const formedSignalMinAge =
    signalRealtimeSnapshot?.group.minAge ??
    (
      effectiveSignalAgePreference === '30_plus'
        ? 30
        : effectiveSignalAgePreference === '40_plus'
          ? 40
          : null
    )

  const formedSignalMaxAge =
    signalRealtimeSnapshot?.group.maxAge ??
    null

  const formedSignalCrowdLabel =
    formedSignalCrowdMode === 'women_only'
      ? 'WOMEN ONLY'
      : formedSignalCrowdMode === 'men_only'
        ? 'MEN ONLY'
        : 'EVERYONE'

  const formedSignalAgeLabel =
    formedSignalMinAge === null &&
    formedSignalMaxAge === null
      ? 'OPEN'
      : formedSignalMinAge !== null &&
          formedSignalMaxAge === null
        ? `${formedSignalMinAge}+`
        : formedSignalMinAge === null &&
            formedSignalMaxAge !== null
          ? `UP TO ${formedSignalMaxAge}`
          : `${formedSignalMinAge}–${formedSignalMaxAge}`

  const formedSignalCriteria =
    `${formedSignalTimeLabel} · ${formedSignalCrowdLabel} · ${formedSignalAgeLabel}`

  const boredStatus = (() => {
    if (
      !bored &&
      !hasActiveSignalJourney
    ) {
      return 'idle'
    }

    if (
      hasActiveSignalJourney &&
      (
        authoritativeGroupState ===
          'locked' ||
        authoritativeGroupState ===
          'active_outing'
      )
    ) {
      return 'locked'
    }

    if (
      hasActiveSignalJourney ||
      formationSubmitting
    ) {
      return 'forming'
    }

    return 'searching'
  })()

  return (
    <main className="app">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />

      {notificationToast && (
        <button type="button" className="notification-toast" onClick={() => { setNotificationsOpen(true); setNotificationToast(null) }} aria-label="Open notification">
          <strong>{notificationToast.title}</strong>
          {notificationToast.body && <span>{notificationToast.body}</span>}
        </button>
      )}

      {!isOnline && (
        <div className="connection-banner" role="status">
          You’re offline. SIGNAL will sync back to the live state when your connection returns.
        </div>
      )}

      <header className="topbar">
        <div className="profile-wrap">
          {currentUserAvatarUrl ? (
            <img
              src={currentUserAvatarUrl}
              alt={currentUser.displayName ?? 'Your profile'}
            />
          ) : (
            <UserRound
              size={20}
              aria-label={currentUser.displayName ?? 'Your profile'}
            />
          )}
          <span className="online-dot" />
        </div>

        <div className="brand">
          <Zap size={17} fill="currentColor" />
          <span>SIGNAL</span>
        </div>

        <div className="top-actions">
          <button type="button" aria-label="Search SIGNAL people" aria-expanded={profileSearchOpen} onClick={() => { setProfileSearchOpen(true); setNotificationsOpen(false) }}>
            <Search size={18} />
          </button>
          <button
            type="button"
            className="notification-trigger"
            aria-label="Notifications"
            aria-expanded={notificationsOpen}
            onClick={() => setNotificationsOpen((current) => !current)}
          >
            <Bell size={18} />
            {notificationUnreadCount > 0 && (
              <span className="notification-trigger-badge">
                {notificationUnreadCount > 9 ? '9+' : notificationUnreadCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {canReviewModeration && (
        <div className="admin-mode-switch" role="group" aria-label="App mode">
          <button
            type="button"
            className={activeSurface !== 'admin' ? 'active' : ''}
            onClick={() => { setActiveSurface('discover'); setNotificationsOpen(false) }}
          >
            <UserRound size={15} />
            USER MODE
          </button>
          <button
            type="button"
            className={activeSurface === 'admin' ? 'active' : ''}
            onClick={() => { setActiveSurface('admin'); setNotificationsOpen(false) }}
          >
            <ShieldCheck size={15} />
            ADMIN MODE
          </button>
        </div>
      )}

      {profileSearchOpen && (
        <ProfileSearchPanel onClose={() => setProfileSearchOpen(false)} onOpenProfile={(userId) => { setProfileSearchOpen(false); setPublicProfileUserId(userId); setActiveSurface('public-profile') }} />
      )}

      {notificationsOpen && (
        <NotificationPanel
          userId={currentUser.userId}
          refreshToken={notificationRefreshToken}
          totalUnreadCount={notificationUnreadCount}
          onOpenPlan={() => { setNotificationsOpen(false); void restoreActiveSignal(true) }}
          onOpenSignal={handleOpenSignalNotification}
          onHistorical={handleHistoricalNotification}
        />
      )}

      <React.Suspense fallback={<div className="surface-loading">Loading…</div>}>
      {completionPlanId ? (
        <SignalCompletionView planId={completionPlanId} onDone={() => {
          completionHandoffRef.current = false
          setCompletionPlanId(null)
          setActiveSurface('activity')
          setPlanExitNotice('SIGNAL complete. Your night is now part of Activity.')
          void Promise.all([refreshActivity(), refreshDiscovery()])
        }} />
      ) : activeOutingPlanId && activeSurface !== 'messages' ? (
        <ActiveOutingView
          planId={activeOutingPlanId}
          captureMode={liveCaptureMode}
          onCaptureModeHandled={() => setLiveCaptureMode(null)}
          onOpenChat={handleOpenPlanChat}
          onOutingEnded={(reason) => {
            const finishedPlanId = activeOutingPlanId
            journeyRestoreEpochRef.current += 1
            journeyRestorePromiseRef.current = null
            setActiveSignalResume(null)
            setActiveOutingPlanId(null)
            setActivePlanId(null)
            setMessagePlanId(null)
            if (reason === 'completed' && finishedPlanId) {
              // DONE HERE closes the live journey even though we keep the Plan id
              // briefly for the completion receipt / connection handoff.
              setFormationResult(null)
              setSignalRealtimeTarget(null)
              setSignalParticipants([])
              setAccepted(false)
              setActive('drinks')
              setDirectActivitySlug(null)
              setBored(false)
              setBoredOpportunity(null)
              setBoredOpportunityExcluded([])
              setSignalTimePreference('TONIGHT')
              setSignalCrowdPreference('everyone')
              setSignalAgePreference('open')
              setSignalPreferencesOpen(false)
              setSignalThreshold(false)
              setServerJourneyStage('forming')
              setLockedSignalVenue(null)
              setMessageDirectConversationId(null)
              lastRealtimeJourneyVersionRef.current = null
              lastRealtimeGroupIdRef.current = null
              setFormationError(null)
              setWithdrawalError(null)
              completionHandoffRef.current = true
              setCompletionPlanId(finishedPlanId)
              setPlanExitNotice(null)
            } else {
              // A live-outing departure is terminal for this user's current
              // journey. Never let stale formation/lock state or an immediate
              // resume fetch resurrect the Signal after leaving.
              setFormationResult(null)
              setSignalRealtimeTarget(null)
              setSignalParticipants([])
              setAccepted(false)
              setActive('drinks')
              setDirectActivitySlug(null)
              setBored(false)
              setBoredOpportunity(null)
              setBoredOpportunityExcluded([])
              setSignalTimePreference('TONIGHT')
              setSignalCrowdPreference('everyone')
              setSignalAgePreference('open')
              setSignalPreferencesOpen(false)
              setSignalThreshold(false)
              setServerJourneyStage('forming')
              setLockedSignalVenue(null)
              setMessageDirectConversationId(null)
              lastRealtimeJourneyVersionRef.current = null
              lastRealtimeGroupIdRef.current = null
              setFormationError(null)
              setWithdrawalError(null)
              setActiveSurface('discover')
              setPlanExitNotice(reason === 'safety' ? 'You left the live outing.' : 'Your live SIGNAL has ended.')
            }
            void Promise.all([refreshActivity(), refreshDiscovery()])
          }}
        />
      ) : activePlanId && activeSignalResume?.planDetailsOpened && activeSurface !== 'messages' ? (
        <SignalPlanDetailsView
          planId={activePlanId}
          onOpenChat={handleOpenPlanChat}
          onCheckedIn={() => {
            // Check-in is a forward journey boundary. A restore that started before
            // attendance committed must not keep the user on the pre-arrival shell.
            journeyRestoreEpochRef.current += 1
            journeyRestorePromiseRef.current = null
            void restoreActiveSignal(true)
          }}
          onPlanEnded={() => {
            // LEAVE SIGNAL from Plan details is the same hard user boundary as
            // withdrawing before conversion. The server has already removed the
            // Plan membership; now discard every browser-owned journey remnant.
            journeyRestoreEpochRef.current += 1
            journeyRestorePromiseRef.current = null
            setActiveSignalResume(null)
            setFormationResult(null)
            setSignalRealtimeTarget(null)
            setSignalParticipants([])
            setAccepted(false)
            setActive('drinks')
            setDirectActivitySlug(null)
            setBored(false)
            setBoredOpportunity(null)
            setBoredOpportunityExcluded([])
            setSignalTimePreference('TONIGHT')
            setSignalCrowdPreference('everyone')
            setSignalAgePreference('open')
            setSignalPreferencesOpen(false)
            setSignalThreshold(false)
            setServerJourneyStage('forming')
            setLockedSignalVenue(null)
            setActivePlanId(null)
            setActiveOutingPlanId(null)
            setMessagePlanId(null)
            setMessageDirectConversationId(null)
            lastRealtimeJourneyVersionRef.current = null
            lastRealtimeGroupIdRef.current = null
            setFormationError(null)
            setWithdrawalError(null)
            setPlanExitNotice(null)
            setActiveSurface('discover')
            void Promise.all([refreshActivity(), refreshDiscovery()])
          }}
        />
      ) : activeSurface === 'activity' ? (
        <ActivityView
          items={activityItems}
          loading={activityLoading}
          error={activityError}
          onRefresh={refreshActivity}
          onOpenItem={handleOpenActivityItem}
          currentUserId={currentUser.userId}
          momentComposerPlanId={momentComposerPlanId}
          stayConnectedPlanId={stayConnectedPlanId}
          onMomentComposerHandled={() => setMomentComposerPlanId(null)}
          focusMomentId={notificationMomentId}
          onFocusMomentHandled={() => setNotificationMomentId(null)}
        />
      ) : activeSurface === 'messages' ? (
        <MessagesView
          currentUserId={currentUser.userId}
          currentUserAvatarUrl={currentUserAvatarUrl}
          initialPlanId={messagePlanId}
          initialDirectConversationId={messageDirectConversationId}
          lockedPlanId={activePlanId}
        />
      ) : activeSurface === 'profile' ? (
        <ProfileView onOpenDirectConversation={(conversationId) => { setMessageDirectConversationId(conversationId); setMessagePlanId(null); setActiveSurface('messages') }} onOpenProfile={(userId) => { setPublicProfileUserId(userId); setActiveSurface('public-profile') }} />
      ) : activeSurface === 'public-profile' && publicProfileUserId ? (
        <PublicProfileView userId={publicProfileUserId} onBack={() => { setPublicProfileUserId(null); setActiveSurface('profile') }} onOpenProfile={(userId) => { setPublicProfileUserId(userId); setActiveSurface('public-profile') }} onMessage={async () => { if (publicProfileMessageRequestRef.current) return; publicProfileMessageRequestRef.current = true; const requestedUserId = publicProfileUserId; try { const conversationId = await getOrCreateDirectConversationWithUser(requestedUserId); if (publicProfileUserId !== requestedUserId) return; setMessageDirectConversationId(conversationId); setMessagePlanId(null); setActiveSurface('messages') } finally { publicProfileMessageRequestRef.current = false } }} />
      ) : activeSurface === 'admin' && canReviewModeration ? (
        <ModerationView canEnforce={adminCapabilities.includes('moderation.enforce')} />
      ) : (
        <>
      <section className="intro">
        <span className="eyebrow">
          <Sparkles size={13} />
          DISCOVER
        </span>

        <h1>What are you feeling?</h1>
        <p>Don’t think about it. Pick a vibe.</p>
      </section>

      {logoutError && (
        <div className="signal-journey-notice signal-journey-notice-error" role="alert">
          <span>{logoutError}</span>
          <button type="button" onClick={() => setLogoutError(null)}>GOT IT</button>
        </div>
      )}

      {planExitNotice && (
        <div className="signal-journey-notice" role="status">
          <Zap size={15} fill="currentColor" />
          <span>{planExitNotice}</span>
          <button type="button" onClick={() => setPlanExitNotice(null)}>GOT IT</button>
        </div>
      )}

      <AnimatePresence mode="wait">
        {!bored ? (
          <motion.section
            key="pulse-array"
            className="pulse-array"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -8 }}
          >
            {pulses.map((pulse, index) => {
              const liveActivity =
                discoveryBySlug.get(pulse.id) ?? null

              const activeCount =
                liveActivity?.activeCount ?? 0

              const previewAvatarUrls =
                liveActivity?.previewAvatarUrls ?? []

              return (
              <motion.button
                key={pulse.id}
                className={`pulse-card ${pulse.size} ${active === pulse.id ? 'active' : ''}`}
                onClick={() => {
                  if (hasActiveSignalJourney) {
                    setBored(true)
                    void restoreActiveSignal(true)
                    return
                  }

                  setActive(pulse.id)
                  setDirectActivitySlug(pulse.id)
                  setAccepted(false)
                  setFormationError(null)
                  setFormationResult(null)
                  setSignalRealtimeTarget(null)
                  setBored(true)
                }}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.04 }}
                whileHover={{ y: -6, scale: 1.008 }}
                whileTap={{ scale: 0.985 }}
              >
                <img src={pulse.image} alt="" className="pulse-image" />
                <div className="pulse-shade" />
                <div className="pulse-light" />

                <div className="pulse-top">
                  <span className="live">
                    <i />
                    {discoveryLoading
  ? 'LIVE'
  : `${activeCount} ACTIVE`}
                  </span>
                </div>

                <div className="pulse-content">
                  <h2>
                    <span>{pulse.emoji}</span>
                    {pulse.label}
                  </h2>

                  <div className="pulse-status">
                    <strong>
  {discoveryLoading ? '—' : activeCount}
</strong>
                    <span>{pulse.line}</span>
                  </div>

                  <AvatarStack urls={previewAvatarUrls} />
                </div>

                <span className="enter">
                  Enter Signal
                  <ChevronRight size={14} />
                </span>
              </motion.button>
              )
            })}
          </motion.section>
        ) : (
          <motion.section
            key="bored-loop"
            className="bored-loop"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <div className="bored-loop-header">
              <span>
                <Zap size={14} fill="currentColor" />
                SIGNAL PULSE
              </span>

              <strong>
                {accepted ? 'Finding your people...' : 'React. We’ll learn the rest.'}
              </strong>
            </div>

            <AnimatePresence mode="wait">
              <motion.article
                key={`${journeyPresentation.id}-${accepted}`}
                className={accepted ? 'suggestion-card accepted' : 'suggestion-card'}
                initial={{ opacity: 0, x: 30, scale: 0.985 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -30, scale: 0.985 }}
                transition={{ duration: 0.32 }}
              >
                <img src={journeyPresentation.image} alt="" />
                <div className="suggestion-shade" />

                <div className="suggestion-content">
                  {!accepted ? (
                    <>
                      <span className="suggestion-kicker">
                        {journeyPresentation.emoji} {journeyPresentation.kicker}
                      </span>

                      <h2>{journeyPresentation.title}</h2>
                      <p>{journeyPresentation.subtitle}</p>

                      <div className="suggestion-social">
                        <AvatarStack
  urls={journeyPresentation.activitySlug === 'chill'
    ? []
    : journeyDiscovery?.previewAvatarUrls ?? []}
/>
                        <div>
                          <strong>
  {boredOpportunityLoading && !directActivitySlug
    ? 'Checking live activity…'
    : journeyPresentation.activitySlug === 'chill'
      ? directActivitySlug
        ? `${Math.max(0, (journeyDiscovery?.activeCount ?? 0) - (accepted ? 1 : 0))} compatible nearby`
        : 'Compatible match available'
      : `${directActivitySlug ? (journeyDiscovery?.activeCount ?? 0) : (boredOpportunity?.activeCount ?? 0)} ${
          (directActivitySlug ? (journeyDiscovery?.activeCount ?? 0) : (boredOpportunity?.activeCount ?? 0)) === 1
            ? 'person'
            : 'people'
        } active nearby`}
</strong>
                          <span>
  {discoveryError
    ? 'Live activity is temporarily unavailable.'
    : journeyPresentation.activitySlug === 'chill'
      ? 'Dating identities stay private until a reciprocal pair locks.'
      : directActivitySlug
        ? 'Based on active Signals in your home city.'
        : 'SIGNAL is combining people who are bored now with live activity in your city.'}
</span>
                        </div>
                      </div>

                      {directActivitySlug && (
                        <>
                      <div className="signal-preference-access">
                          <button
                            type="button"
                            className={
                              signalPreferencesOpen
                                ? 'signal-preference-trigger active'
                                : 'signal-preference-trigger'
                            }
                            onClick={() =>
                              setSignalPreferencesOpen(
                                (current) => !current,
                              )
                            }
                            aria-expanded={signalPreferencesOpen}
                            aria-label="Signal preferences"
                          >
                            <SlidersHorizontal size={15} />
                            <span>PREFERENCES</span>
                          </button>

                          <span className="signal-preference-summary">
                            {
                              signalTimePreference === 'THIS_WEEKEND'
                                ? 'THIS WEEKEND'
                                : signalTimePreference
                            }
                            {' · '}
                            {directActivitySlug === 'chill'
                              ? 'DATING · 1-ON-1'
                              : <>
                                  {effectiveSignalCrowdPreference === 'women_only'
                                    ? 'WOMEN ONLY'
                                    : effectiveSignalCrowdPreference === 'men_only'
                                      ? 'MEN ONLY'
                                      : 'EVERYONE'}
                                  {' · '}
                                  {effectiveSignalAgePreference === '30_plus'
                                    ? '30+'
                                    : effectiveSignalAgePreference === '40_plus'
                                      ? '40+'
                                      : 'OPEN'}
                                </>}
                          </span>
                        </div>

                        {signalPreferencesOpen && (
                          <div className="signal-preference-drawer">
                            <div className="signal-preferences">
                        <div className="signal-preference-group">
                          <span className="signal-preference-label">
                            WHEN
                          </span>

                          <div className="signal-preference-options">
                            {[
                              ['NOW', 'NOW'],
                              ['TONIGHT', 'TONIGHT'],
                              ['TOMORROW', 'TOMORROW'],
                              ['THIS_WEEKEND', 'THIS WEEKEND'],
                            ].map(([value, label]) => (
                              <button
                                key={value}
                                type="button"
                                className={
                                  signalTimePreference === value
                                    ? 'signal-preference-option active'
                                    : 'signal-preference-option'
                                }
                                onClick={() =>
                                  setSignalTimePreference(
                                    value as SignalPreferenceTime,
                                  )
                                }
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {directActivitySlug !== 'chill' && <>
                        <div className="signal-preference-group">
                          <span className="signal-preference-label">
                            CROWD
                          </span>

                          <div className="signal-preference-options">
                            {[
                              {
                                value: 'everyone',
                                label: 'EVERYONE',
                                allowed: true,
                                reason: '',
                              },
                              {
                                value: 'women_only',
                                label: 'WOMEN ONLY',
                                allowed: canSelectWomenOnly,
                                reason:
                                  'Women-only Signals are available to women.',
                              },
                              {
                                value: 'men_only',
                                label: 'MEN ONLY',
                                allowed: canSelectMenOnly,
                                reason:
                                  'Men-only Signals are available to men.',
                              },
                            ].map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                className={
                                  effectiveSignalCrowdPreference === option.value
                                    ? 'signal-preference-option active'
                                    : 'signal-preference-option'
                                }
                                disabled={!option.allowed}
                                title={
                                  option.allowed
                                    ? undefined
                                    : option.reason
                                }
                                aria-label={
                                  option.allowed
                                    ? option.label
                                    : `${option.label}. ${option.reason}`
                                }
                                onClick={() =>
                                  setSignalCrowdPreference(
                                    option.value as SignalPreferenceCrowd,
                                  )
                                }
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="signal-preference-group">
                          <span className="signal-preference-label">
                            AGE
                          </span>

                          <div className="signal-preference-options">
                            {[
                              {
                                value: 'open',
                                label: 'OPEN',
                                allowed: true,
                                reason: '',
                              },
                              {
                                value: '30_plus',
                                label: '30+',
                                allowed: canSelect30Plus,
                                reason:
                                  '30+ Signals require you to be at least 30.',
                              },
                              {
                                value: '40_plus',
                                label: '40+',
                                allowed: canSelect40Plus,
                                reason:
                                  '40+ Signals require you to be at least 40.',
                              },
                            ].map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                className={
                                  effectiveSignalAgePreference === option.value
                                    ? 'signal-preference-option active'
                                    : 'signal-preference-option'
                                }
                                disabled={!option.allowed}
                                title={
                                  option.allowed
                                    ? undefined
                                    : option.reason
                                }
                                aria-label={
                                  option.allowed
                                    ? option.label
                                    : `${option.label}. ${option.reason}`
                                }
                                onClick={() =>
                                  setSignalAgePreference(
                                    option.value as SignalPreferenceAge,
                                  )
                                }
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        </>}
                      </div>

                            <button
                              type="button"
                              className="signal-preference-done"
                              onClick={() =>
                                setSignalPreferencesOpen(false)
                              }
                            >
                              DONE
                            </button>
                          </div>
                        )}
                        </>
                      )}

                        {formationError ? (
                          <p className="formation-error" role="alert">
                            {formationError}
                          </p>
                        ) : null}

                        {directActivitySlug ? (
                        <div className="suggestion-actions">
                        <motion.button
                          type="button"
                          className="down-button"
                          onClick={() => {
                            void handleImDown()
                          }}
                          disabled={formationSubmitting || (!directActivitySlug && (boredOpportunityLoading || !boredOpportunity))}
                          whileTap={{ scale: 0.98 }}
                        >
                          <Zap size={18} fill="currentColor" />
                          {formationSubmitting ? 'JOINING…' : boredOpportunityLoading && !directActivitySlug ? 'LOOKING…' : "I'M DOWN"}
                        </motion.button>

                        <button
                          className="next-button"
                          onClick={nextSuggestion}
                        >
                          {directActivitySlug ? 'NEXT' : 'TRY ANOTHER'}
                          <ChevronRight size={16} />
                        </button>
                      </div>
                      ) : (
                        <div className="forming-state">
                          <span className="forming-kicker">AUTOMATIC SIGNAL</span>
                          <h2>{formationSubmitting ? 'PUTTING IT TOGETHER…' : 'SIGNAL IS SEARCHING…'}</h2>
                          <p>No picking. No choosing. SIGNAL is handling it.</p>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="forming-state">
                      <span className="forming-kicker">MATCHING SIGNALS</span>

                      <h2>{journeyPresentation.emoji} {journeyPresentation.title.replace('?', '')}</h2>

                      <div
                        className="forming-signal-criteria"
                        aria-label="Signal criteria"
                      >
                        {formedSignalCriteria}
                      </div>

                      <p>
                        {signalRealtimeError
                          ? 'Reconnecting to the live Signal...'
                          : signalRealtimeLoading
                            ? 'Loading the live Signal...'
                            : `Live Signal · ${signalRealtimeConnectionState}`}
                      </p>

                      {canWithdrawSignal && (
                        <div className="signal-withdrawal">
                          <button
                            type="button"
                            className="signal-withdrawal-button"
                            onClick={() => {
                              void handleLeaveSignal()
                            }}
                            disabled={withdrawalSubmitting}
                          >
                            {withdrawalSubmitting
                              ? 'LEAVING SIGNAL...'
                              : "LEAVE SIGNAL · I'M OUT"}
                          </button>

                          {withdrawalError && (
                            <p
                              className="signal-withdrawal-error"
                              role="alert"
                            >
                              {withdrawalError}
                            </p>
                          )}
                        </div>
                      )}

                      <div className="forming-people arrival-list">
                        {signalParticipants.slice(0, 4).map((participant, index) => (
                          <motion.div
                            className="arrival-person pulse-connected"
                            key={participant.userId}
                            initial={{
                              opacity: 0,
                              x: -16,
                              scale: 0.92,
                            }}
                            animate={{
                              opacity: 1,
                              x: 0,
                              scale: 1,
                            }}
                            transition={{
                              delay: index * 0.12,
                              duration: 0.32,
                            }}
                          >
                            <div className="arrival-avatar-wrap">
                              <span className="arrival-lock-pulse" />
                              {participant.avatarUrl ? (
                                <span className="aligned-avatar">
                                  <img
                                    src={participant.avatarUrl}
                                    alt={participant.displayName}
                                  />
                                </span>
                              ) : (
                                <span
                                  className="aligned-avatar arrival-avatar-fallback"
                                  aria-label={participant.displayName}
                                >
                                  {participant.displayName.charAt(0).toUpperCase()}
                                </span>
                              )}
                            </div>

                            <span>
                              <strong>
                                {participant.displayName}
                                {participant.isMe ? ' · YOU' : ''}
                              </strong>
                              <small>
                                {participant.membershipState === 'confirmed'
                                  ? 'Confirmed for this Signal'
                                  : 'Matched to this Signal'}
                              </small>
                            </span>

                            <em>+ JOINED</em>
                          </motion.div>
                        ))}
                      </div>

                      <AnimatePresence>
                        {authoritativeFormationCount > 4 && (
                          <motion.div
                            className="aligned-overflow"
                            initial={{
                              opacity: 0,
                              y: 8,
                            }}
                            animate={{
                              opacity: 1,
                              y: 0,
                            }}
                            transition={{
                              duration: 0.32,
                            }}
                          >
                            <div className="aligned-overflow-avatars">
                              <motion.span
                                className="aligned-avatar"
                                initial={{
                                  opacity: 0,
                                  scale: 0.72,
                                }}
                                animate={{
                                  opacity: 1,
                                  scale: 1,
                                }}
                                transition={{
                                  type: 'spring',
                                  stiffness: 220,
                                  damping: 16,
                                }}
                              >
                                +{authoritativeFormationCount - 4}
                              </motion.span>
                            </div>

                            <span className="aligned-overflow-copy">
                              <strong>
                                +{authoritativeFormationCount - 4} ALIGNED
                              </strong>
                              <small>
                                More people joined the Signal
                              </small>
                            </span>

                            <span className="aligned-overflow-more">
                              {authoritativeFormationCount}{' '}
                              {authoritativeFormationCount === 1
                                ? 'PERSON'
                                : 'PEOPLE'}
                            </span>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <div className="formation-payoff">
                        <div className="formation-count">
                          <strong>{authoritativeFormationCount} / {authoritativeActivationThreshold || '—'}</strong>
                          <span>{formationMessage}</span>
                        </div>

                        <div className="formation-track">
                          <motion.div
                            initial={{ width: '0%' }}
                            animate={{
                              width: `${
                                authoritativeActivationThreshold > 0
                                  ? Math.min(
                                      (
                                        authoritativeFormationCount /
                                        authoritativeActivationThreshold
                                      ) * 100,
                                      100,
                                    )
                                  : 0
                              }%`,
                            }}
                            transition={{ duration: 0.55, ease: 'easeOut' }}
                          />
                        </div>

                        <AnimatePresence>
                          {signalHasReachedCriticalMass && (
                            <motion.div
                              className="signal-formed signal-formed-final"
                              initial={{ opacity: 0, y: 7, scale: 0.97 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              transition={{
                                type: 'spring',
                                stiffness: 190,
                                damping: 17,
                              }}
                            >
                              <span className="formed-bolt">
                                <Zap size={22} fill="currentColor" />
                              </span>

                              <div>
                                <strong>
                                  {authoritativeFormationCount} /{' '}
                                  {authoritativeActivationThreshold ||
                                    '—'}{' '}
                                  · SIGNAL FORMED
                                </strong>
                                <small>
                                  {authoritativeFormationCount} people aligned
                                </small>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>

                    </div>
                  )}
                </div>
              </motion.article>
            </AnimatePresence>
          </motion.section>
        )}
      </AnimatePresence>

      <motion.button
        className={boredStatus === 'locked' ? 'bored active locked' : bored ? 'bored active' : 'bored'}
        onClick={() => {
          if (hasActiveSignalJourney) {
            setBored(true)
            void restoreActiveSignal(true)
            return
          }

          void handleImBoredAutomation()
        }}
        whileHover={{ y: -3 }}
        whileTap={{ scale: 0.99 }}
      >
        <div className={boredStatus === 'locked' ? 'frequency-wave active locked' : boredStatus === 'idle' ? 'frequency-wave' : 'frequency-wave active'}>
          {Array.from({ length: 44 }).map((_, i) => (
            <i
              key={i}
              style={{ '--wave-i': i } as React.CSSProperties}
            />
          ))}
        </div>

        <span className="bored-bolt">
          <Zap size={24} fill="currentColor" />
        </span>

        <span className="bored-copy">
          <strong>
            {activePlanId
              ? 'SIGNAL LIVE'
              : boredStatus === 'locked'
                ? 'SIGNAL LOCKED'
              : boredStatus === 'forming'
                ? 'SIGNAL IS FORMING...'
                : boredStatus === 'searching'
                  ? 'SIGNAL IS SEARCHING...'
                  : "I'M BORED"}
          </strong>

          <small>
            {activePlanId
              ? 'RETURN TO YOUR CURRENT LIVE SIGNAL'
              : boredStatus === 'locked'
                ? `${authoritativeFormationCount} ${
                  authoritativeFormationCount === 1
                    ? 'person'
                    : 'people'
                } aligned · VIEW SIGNAL`
              : bored
                ? accepted
                  ? 'Compatible people are coming together.'
                  : 'SIGNAL is choosing and joining for you.'
                : "Don't make me choose."}
          </small>
        </span>

        <ChevronRight size={20} />
      </motion.button>


      <AnimatePresence>
        {signalThreshold && (
          <motion.div
            className="signal-threshold"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="threshold-vignette" />

            <motion.div
              className="threshold-lock"
              initial={{ opacity: 0, scale: 0.72 }}
              animate={{
                opacity: [0, 1, 1, 0],
                scale: [0.72, 1.08, 1, 1.8],
              }}
              transition={{
                duration: 0.9,
                times: [0, 0.28, 0.65, 1],
              }}
            >
              <span>🔒</span>
            </motion.div>

            <div className="threshold-tunnel">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>

            <motion.div
              className="threshold-frequency"
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{
                scaleX: [0, 1, 1, 0.18, 1],
                opacity: [0, 1, 1, 1, 1],
              }}
              transition={{
                duration: 1.65,
                times: [0, 0.18, 0.55, 0.72, 1],
              }}
            >
              <span />
            </motion.div>

            <div className="threshold-people">
              {Array.from({
                length: Math.min(
                  authoritativeFormationCount,
                  4,
                ),
              }).map((_, index) => (
                <motion.span
                  className="aligned-avatar"
                  key={index}
                  aria-hidden="true"
                  initial={{
                    opacity: 0,
                    scale: 0.3,
                    y: 35,
                  }}
                  animate={{
                    opacity: [0, 1, 1, 0],
                    scale: [0.3, 1, 0.82, 0.25],
                    y: [35, 0, -5, -20],
                  }}
                  transition={{
                    duration: 1.25,
                    delay: 0.35 + index * 0.07,
                  }}
                >
                  ⚡
                </motion.span>
              ))}
            </div>

            <motion.div
              className={[
                'threshold-copy',
                authoritativeRoomStage !== 'arrival'
                  ? 'threshold-copy-hidden'
                  : '',
              ].filter(Boolean).join(' ')}
              initial={{ opacity: 0, y: 14 }}
              animate={{
                opacity: [0, 0, 1, 1],
                y: [14, 14, 0, 0],
              }}
              transition={{
                duration: 1.45,
                times: [0, 0.48, 0.7, 1],
              }}
            >
              <span>YOUR SIGNAL IS LIVE</span>
              <strong>
                {authoritativeFormationCount}{' '}
                {authoritativeFormationCount === 1
                  ? 'PERSON'
                  : 'PEOPLE'}{' '}
                · ONE SIGNAL
              </strong>
            </motion.div>

            <motion.div
              className="threshold-room"
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{
                opacity: [0, 0, 1],
                scale: [0.94, 0.94, 1],
              }}
              transition={{
                duration: 2.05,
                times: [0, 0.78, 1],
              }}
            >
              <div className="threshold-room-inner">
                <span className="room-kicker">
                  ⚡ SIGNAL LIVE
                </span>

                <h2>{journeyPresentation.emoji} {journeyPresentation.title}</h2>

                <p>
                  {authoritativeFormationCount}{' '}
                  {authoritativeFormationCount === 1
                    ? 'person aligned'
                    : 'people aligned'}
                </p>

                <div
                  className="room-avatar-row"
                  aria-label="Signal participants"
                >
                  {signalParticipants.slice(0, 4).map((participant) => (
                    participant.avatarUrl ? (
                      <span
                        className="aligned-avatar"
                        key={participant.userId}
                        title={participant.isMe ? `${participant.displayName} · YOU` : participant.displayName}
                      >
                        <img
                          src={participant.avatarUrl}
                          alt={participant.displayName}
                        />
                      </span>
                    ) : (
                      <span
                        className="aligned-avatar arrival-avatar-fallback"
                        key={participant.userId}
                        title={participant.isMe ? `${participant.displayName} · YOU` : participant.displayName}
                        aria-label={participant.displayName}
                      >
                        {participant.displayName.charAt(0).toUpperCase()}
                      </span>
                    )
                  ))}

                  {signalParticipants.length > 4 && (
                    <span className="aligned-avatar arrival-avatar-fallback">
                      +{signalParticipants.length - 4}
                    </span>
                  )}
                </div>

                <AnimatePresence mode="wait">
                  {presentationRoomStage === 'arrival' ? (
                    <motion.div
                      key="signal-arrival"
                      className="room-next"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      aria-live="polite"
                    >
                      <small>SIGNAL LOCKED</small>
                      <strong>FINDING THE PLACE</strong>
                    </motion.div>
                  ) : presentationRoomStage === 'places' ? (
                    <motion.div
                      key="signal-places"
                      initial={{ opacity: 0, y: 14, scale: 0.985 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{
                        opacity: 0,
                        y: -10,
                        scale: 0.985,
                      }}
                      transition={{
                        duration: 0.42,
                        ease: [0.18, 0.82, 0.22, 1],
                      }}
                    >
                      {authoritativeSignalGroupId ? (
                        <SignalPlaceStage
                          signalGroupId={authoritativeSignalGroupId}
                          signalLabel={journeyPresentation.title}
                          onLeaveSignal={() => { void handleLeaveSignal() }}
                          leavingSignal={withdrawalSubmitting}
                          onVenueLocked={(venue) => {
                            setLockedSignalVenue(venue)
                            void advanceMySignalJourneyStage(authoritativeSignalGroupId, 'time')
                              .then((stage) => { setServerJourneyStage(stage) })
                              .catch(() => void restoreActiveSignal(false))
                          }}
                        />
                      ) : (
                        <p>Unable to identify the live Signal group.</p>
                      )}
                    </motion.div>
                  ) : lockedSignalVenue && authoritativeSignalGroupId ? (
                    <motion.div
                      key="signal-time"
                      initial={{
                        opacity: 0,
                        y: 16,
                        scale: 0.985,
                      }}
                      animate={{
                        opacity: 1,
                        y: 0,
                        scale: 1,
                      }}
                      exit={{
                        opacity: 0,
                        y: -8,
                      }}
                      transition={{
                        duration: 0.48,
                        ease: [0.18, 0.82, 0.22, 1],
                      }}
                    >
                      <SignalTimeStage
                        signalGroupId={authoritativeSignalGroupId}
                        signalLabel={journeyPresentation.title}
                        venue={lockedSignalVenue}
                        initialPlanId={activeSignalResume?.planId ?? activePlanId}
                        onFindAnotherPlace={() => {
                          setLockedSignalVenue(null)
                        }}
                        onOpenPlanDetails={(planId) => { void handleOpenPlanDetails(planId) }}
                      />
                    </motion.div>
                  ) : null}
                </AnimatePresence>

                {!hasActiveSignalJourney && (
                  <button
                    className="threshold-back"
                    onClick={() => {
                      setSignalThreshold(false)
                      setLockedSignalVenue(null)
                    }}
                  >
                    BACK TO SIGNAL
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

        </>
      )}
      </React.Suspense>

      <nav className={activePlanId ? "bottom-nav live-signal-nav" : "bottom-nav"}>
        {activePlanId ? (
          <>
            <button className="nav-item" disabled={!activeOutingPlanId} title={!activeOutingPlanId ? 'Available after check-in' : undefined} onClick={() => { if (!activeOutingPlanId) return; setLiveCaptureMode('camera'); setActiveSurface('discover') }}><Camera size={20} /><span>Take Pic</span></button>
            <button className="nav-item" disabled={!activeOutingPlanId} title={!activeOutingPlanId ? 'Available after check-in' : undefined} onClick={() => { if (!activeOutingPlanId) return; setLiveCaptureMode('upload'); setActiveSurface('discover') }}><ImagePlus size={20} /><span>Upload</span></button>
            <button className="signal-center live" onClick={handleSignalCenterNavigation} aria-label="Return to live Signal"><Zap size={27} fill="currentColor" /></button>
            <button className={activeSurface === 'messages' ? 'nav-item active' : 'nav-item'} onClick={handleMessagesNavigation}><MessageCircle size={20} /><span>Group</span></button>
            <button className="nav-item" onClick={() => { setLiveCaptureMode(null); void restoreActiveSignal(true) }}><MoreHorizontal size={20} /><span>More</span></button>
          </>
        ) : (
          <>
            <button className={activeSurface === 'discover' ? 'nav-item active' : 'nav-item'} onClick={handleDiscoverNavigation}><Compass size={20} /><span>Discover</span></button>
            <button className={activeSurface === 'activity' ? 'nav-item active' : 'nav-item'} onClick={handleActivityNavigation}><Sparkles size={20} /><span>Activity</span></button>
            <button className="signal-center" onClick={handleSignalCenterNavigation} aria-label="Open Signal"><Zap size={27} fill="currentColor" /></button>
            <button className={activeSurface === 'messages' ? 'nav-item active' : 'nav-item'} onClick={handleMessagesNavigation}><MessageCircle size={20} /><span>Messages</span></button>
            <button className={activeSurface === 'profile' ? 'nav-item active' : 'nav-item'} onClick={handleProfileNavigation}><UserRound size={20} /><span>Profile</span></button>
            {canReviewModeration && <button className={activeSurface === 'admin' ? 'nav-item active' : 'nav-item'} onClick={() => { setActiveSurface('admin'); setNotificationsOpen(false) }}><ShieldCheck size={20} /><span>Admin</span></button>}
            <button className="nav-item nav-logout" onClick={() => { void handleLogout() }} disabled={logoutSubmitting} aria-label="Log out"><LogOut size={20} /><span>{logoutSubmitting ? 'Logging out…' : 'Log out'}</span></button>
          </>
        )}
      </nav>    </main>
  )
}

export default App
