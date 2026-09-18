import { useCallback, useEffect, useMemo, useState } from 'react'
import { Camera, CheckCircle2, Clock3, ImagePlus, MessageCircle, ShieldAlert, Sparkles, Upload, Users, X, Zap } from 'lucide-react'
import { getMyPlanGovernance, leaveMyPlan, type PlanGovernanceSnapshot } from '../plan/planGovernanceClient'
import { getMyPlanAttendanceStatus, type PlanAttendanceStatus } from '../plan/planAttendanceClient'
import { getMyPlanMembers, type PlanMemberIdentity } from '../plan/planMembersClient'
import { publishSignalMoment } from '../activity/signalMomentsClient'
import { finishMyPlanOuting } from './activeOutingClient'
import { toUserFacingError } from '../../lib/userFacingError'
import './ActiveOutingView.css'

type Props = {
  planId: string
  onOpenChat: (planId: string) => void
  onOutingEnded: (reason: 'ended' | 'safety') => void
  captureMode?: 'camera' | 'upload' | null
  onCaptureModeHandled?: () => void
}

function formatTime(value: string | null) {
  if (!value) return 'Live now'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Live now'
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
}

export default function ActiveOutingView({ planId, onOpenChat, onOutingEnded, captureMode = null, onCaptureModeHandled }: Props) {
  const [plan, setPlan] = useState<PlanGovernanceSnapshot | null>(null)
  const [attendance, setAttendance] = useState<PlanAttendanceStatus | null>(null)
  const [members, setMembers] = useState<PlanMemberIdentity[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [caption, setCaption] = useState('')
  const [saving, setSaving] = useState(false)
  const [ending, setEnding] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cameraInputId = `live-signal-camera-${planId}`
  const uploadInputId = `live-signal-upload-${planId}`

  useEffect(() => {
    if (!captureMode) return
    const input = document.getElementById(captureMode === 'camera' ? cameraInputId : uploadInputId) as HTMLInputElement | null
    input?.click()
    onCaptureModeHandled?.()
  }, [cameraInputId, captureMode, onCaptureModeHandled, uploadInputId])

  const refresh = useCallback(async () => {
    try {
      const [nextPlan, nextAttendance, nextMembers] = await Promise.all([
        getMyPlanGovernance(planId), getMyPlanAttendanceStatus(planId), getMyPlanMembers(planId),
      ])
      if (!nextAttendance.checkedIn || !['locked', 'recovery_required', 'active_outing'].includes(nextAttendance.planState)) {
        onOutingEnded('ended'); return
      }
      setPlan(nextPlan); setAttendance(nextAttendance); setMembers(nextMembers); setError(null)
    } catch (loadError) {
      const message = toUserFacingError(loadError, 'Unable to refresh this outing right now.')
      if (/membership|required|no longer|completed/i.test(message)) onOutingEnded('ended')
      else setError(message)
    }
  }, [onOutingEnded, planId])
  useEffect(() => {
    const initial = window.setTimeout(() => { void refresh() }, 0)
    const timer = window.setInterval(() => { void refresh() }, 10000)
    return () => { window.clearTimeout(initial); window.clearInterval(timer) }
  }, [refresh])

  const selectedLabel = useMemo(() => files.length === 0
    ? 'Nothing selected yet'
    : `${files.length} ${files.length === 1 ? 'item' : 'items'} ready`, [files])

  const acceptFiles = (incoming: FileList | null) => {
    if (!incoming) return
    const next = [...incoming].filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/'))
    if (next.length === 0) { setError('Choose photos or videos only.'); return }
    setFiles((current) => [...current, ...next].slice(0, 6))
    setNotice(null); setError(null)
  }

  const saveMoment = async () => {
    if (saving || files.length === 0) return
    setSaving(true); setError(null); setNotice(null)
    try {
      await publishSignalMoment({ planId, caption, files })
      setFiles([]); setCaption('')
      setNotice('Saved to this SIGNAL. It will publish to Moments when the outing ends.')
    } catch (saveError) {
      setError(toUserFacingError(saveError, 'Unable to save this Moment right now.'))
    } finally { setSaving(false) }
  }

  const finishOuting = async () => {
    if (ending) return
    setEnding(true); setError(null)
    try { await finishMyPlanOuting(planId); onOutingEnded('ended') }
    catch (endError) { setError(toUserFacingError(endError, 'Unable to end your Signal right now.')) }
    finally { setEnding(false) }
  }
  const safetyLeave = async () => {
    if (leaving) return
    setLeaving(true); setError(null)
    try { await leaveMyPlan(planId); onOutingEnded('safety') }
    catch (leaveError) { setError(toUserFacingError(leaveError, 'Unable to leave this outing right now.')) }
    finally { setLeaving(false) }
  }

  return (
    <section className="active-outing-shell">
      <header className="active-outing-hero" style={plan?.currentVenuePhotoUrl ? {
        backgroundImage: `linear-gradient(90deg,rgba(4,10,20,.96),rgba(4,10,20,.72),rgba(4,10,20,.28)),url("${plan.currentVenuePhotoUrl}")`,
      } : undefined}>
        <span className="active-outing-live"><i /> SIGNAL LIVE · YOU'RE HERE</span>
        <div className="active-outing-title-row">
          <div><small>{plan?.activityName ?? 'SIGNAL OUTING'}</small><h1>{plan?.currentVenueName || plan?.title || 'Your group is live'}</h1><p>{plan?.currentVenueAddress || plan?.cityName || ''}</p></div>
          <span className="active-outing-bolt"><Zap size={24} fill="currentColor" /></span>
        </div>
        <div className="active-outing-meta">
          <span><Clock3 size={14} /><strong>LIVE UNTIL {formatTime(plan?.scheduledEndsAt ?? null)}</strong><small>Enjoy the meetup</small></span>
          <span><Users size={14} /><strong>{attendance?.checkedInCount ?? 0}/{attendance?.activeMemberCount ?? members.length} HERE</strong><small>checked into this Signal</small></span>
        </div>
      </header>

      <section className="active-outing-now">
        <div className="active-outing-section-heading"><strong>YOUR SIGNAL IS LIVE</strong><span>{members.length} PEOPLE</span></div>
        <p>You're at the meetup. Everything you need now stays inside this Signal.</p>
        <div className="active-outing-members">
          {members.map((member) => (
            <div key={member.userId} className="active-outing-member">
              {member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : <span>{member.displayName.charAt(0).toUpperCase()}</span>}
              <small>{member.isMe ? 'YOU' : member.displayName}</small>
            </div>
          ))}
        </div>
        <button type="button" className="active-outing-chat" onClick={() => onOpenChat(planId)}>
          <MessageCircle size={18} /><span><strong>GROUP CHAT</strong><small>Message everyone in this Signal</small></span>
        </button>
      </section>

      <section className="active-outing-capture">
        <div className="active-outing-section-heading"><strong>CAPTURE THE MOMENT</strong><span>LIVE ONLY</span></div>
        <p>Take something from tonight with you. Photos and videos publish to Moments after the Signal ends.</p>
        <div className="active-outing-capture-actions">
          <label className="active-outing-capture-button primary"><Camera size={18}/><span><strong>TAKE PHOTO / VIDEO</strong><small>Open your camera</small></span>
            <input id={cameraInputId} type="file" accept="image/*,video/*" capture="environment" onChange={(event) => { acceptFiles(event.target.files); event.currentTarget.value = '' }}/>
          </label>
          <label className="active-outing-capture-button"><Upload size={18}/><span><strong>UPLOAD</strong><small>Choose from your device</small></span>
            <input id={uploadInputId} type="file" accept="image/*,video/*" multiple onChange={(event) => { acceptFiles(event.target.files); event.currentTarget.value = '' }}/>
          </label>
        </div>
        <div className="active-outing-selection"><span><ImagePlus size={15}/> {selectedLabel}</span>{files.length > 0 && <button type="button" onClick={() => setFiles([])}><X size={14}/> CLEAR</button>}</div>
        {files.length > 0 && <div className="active-outing-file-list">{files.map((file,index) => <span key={`${file.name}-${file.size}-${index}`}>{file.type.startsWith('video/') ? 'VIDEO' : 'PHOTO'} · {file.name}</span>)}</div>}
        <textarea value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={500} placeholder="Add a caption to this Signal…"/>
        <button type="button" className="active-outing-save" disabled={saving || files.length === 0} onClick={() => { void saveMoment() }}>
          <CheckCircle2 size={17}/> {saving ? 'SAVING…' : 'SAVE TO THIS SIGNAL'}
        </button>
        {notice && <div className="active-outing-notice" role="status">{notice}</div>}
      </section>

      <section className="active-outing-finish">
        <Sparkles size={21}/>
        <div><small>WHEN YOU'RE DONE</small><strong>Had a good time?</strong><p>End your live Signal when you're finished here. This won't end anyone else's night.</p></div>
        {!confirmEnd ? (
          <button type="button" onClick={() => setConfirmEnd(true)}>DONE HERE</button>
        ) : (
          <div className="active-outing-confirm">
            <strong>END YOUR SIGNAL?</strong><span>Your check-in and Moments stay with this outing.</span>
            <div><button type="button" className="confirm" disabled={ending} onClick={() => { void finishOuting() }}>{ending ? 'ENDING…' : 'YES · GOOD NIGHT'}</button><button type="button" onClick={() => setConfirmEnd(false)}>NOT YET</button></div>
          </div>
        )}
      </section>

      <button type="button" className="active-outing-safety" disabled={leaving} onClick={() => { void safetyLeave() }}>
        <ShieldAlert size={17}/><span><strong>{leaving ? 'LEAVING…' : "I DON'T FEEL SAFE"}</strong><small>Leave this Signal immediately</small></span>
      </button>
      {error && <div className="active-outing-error" role="alert">{error}</div>}
    </section>
  )
}
