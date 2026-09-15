import { useCallback, useEffect, useMemo, useState } from 'react'
import { Camera, CheckCircle2, Clock3, ImagePlus, MapPin, MessageCircle, ShieldAlert, Upload, Users, X, Zap } from 'lucide-react'
import { getMyPlanGovernance, leaveMyPlan, type PlanGovernanceSnapshot } from '../plan/planGovernanceClient'
import { getMyPlanAttendanceStatus, type PlanAttendanceStatus } from '../plan/planAttendanceClient'
import { getMyPlanMembers, type PlanMemberIdentity } from '../plan/planMembersClient'
import { publishSignalMoment } from '../activity/signalMomentsClient'
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
        getMyPlanGovernance(planId),
        getMyPlanAttendanceStatus(planId),
        getMyPlanMembers(planId),
      ])
      if (!nextAttendance.checkedIn || !['locked', 'recovery_required', 'active_outing'].includes(nextAttendance.planState)) {
        onOutingEnded('ended')
        return
      }
      setPlan(nextPlan)
      setAttendance(nextAttendance)
      setMembers(nextMembers)
      setError(null)
    } catch (loadError) {
      const message = toUserFacingError(loadError, 'Unable to refresh this outing right now.')
      if (/membership|required|no longer|completed/i.test(message)) onOutingEnded('ended')
      else setError(message)
    }
  }, [onOutingEnded, planId])

  useEffect(() => {
    const initial = window.setTimeout(() => { void refresh() }, 0)
    const timer = window.setInterval(() => { void refresh() }, 10000)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [refresh])

  const selectedLabel = useMemo(() => {
    if (files.length === 0) return 'Nothing selected yet'
    return `${files.length} ${files.length === 1 ? 'item' : 'items'} ready`
  }, [files])

  const acceptFiles = (incoming: FileList | null) => {
    if (!incoming) return
    const next = [...incoming].filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/'))
    if (next.length === 0) {
      setError('Choose photos or videos only.')
      return
    }
    setFiles((current) => [...current, ...next].slice(0, 6))
    setNotice(null)
    setError(null)
  }

  const saveMoment = async () => {
    if (saving || files.length === 0) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      await publishSignalMoment({ planId, caption, files })
      setFiles([])
      setCaption('')
      setNotice('Saved to this SIGNAL. It will publish to Moments when the outing ends.')
    } catch (saveError) {
      setError(toUserFacingError(saveError, 'Unable to save this Moment right now.'))
    } finally {
      setSaving(false)
    }
  }

  const safetyLeave = async () => {
    if (leaving) return
    setLeaving(true)
    setError(null)
    try {
      await leaveMyPlan(planId)
      onOutingEnded('safety')
    } catch (leaveError) {
      setError(toUserFacingError(leaveError, 'Unable to leave this outing right now.'))
    } finally {
      setLeaving(false)
    }
  }

  return (
    <section className="active-outing-shell">
      <header className="active-outing-hero">
        <span className="active-outing-live"><i /> SIGNAL LIVE · YOU'RE HERE</span>
        <div className="active-outing-title-row">
          <div>
            <small>{plan?.activityName ?? 'SIGNAL OUTING'}</small>
            <h1>{plan?.title || 'Your group is live'}</h1>
          </div>
          <span className="active-outing-bolt"><Zap size={24} fill="currentColor" /></span>
        </div>
        <div className="active-outing-meta">
          <span><MapPin size={14} /><strong>{plan?.currentVenueName || 'Meetup venue'}</strong><small>{plan?.currentVenueAddress || plan?.cityName || ''}</small></span>
          <span><Clock3 size={14} /><strong>{formatTime(plan?.scheduledStartsAt ?? null)}</strong><small>until {formatTime(plan?.scheduledEndsAt ?? null)}</small></span>
          <span><Users size={14} /><strong>{attendance?.checkedInCount ?? 0}/{attendance?.activeMemberCount ?? members.length} HERE</strong><small>checked into this Signal</small></span>
        </div>
      </header>

      <section className="active-outing-roster">
        <div className="active-outing-section-heading"><strong>YOUR GROUP</strong><span>{members.length} MEMBERS</span></div>
        <div className="active-outing-members">
          {members.map((member) => (
            <div key={member.userId} className="active-outing-member">
              {member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : <span>{member.displayName.charAt(0).toUpperCase()}</span>}
              <small>{member.isMe ? 'YOU' : member.displayName}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="active-outing-capture">
        <div className="active-outing-section-heading"><strong>CAPTURE THE SIGNAL</strong><span>LIVE ONLY</span></div>
        <p>Photos and videos are private to this outing while it’s live. They publish to Moments when the Signal ends.</p>
        <div className="active-outing-capture-actions">
          <label className="active-outing-capture-button primary">
            <Camera size={18} /><span><strong>TAKE PHOTO / VIDEO</strong><small>Open your camera</small></span>
            <input id={cameraInputId} type="file" accept="image/*,video/*" capture="environment" onChange={(event) => { acceptFiles(event.target.files); event.currentTarget.value = '' }} />
          </label>
          <label className="active-outing-capture-button">
            <Upload size={18} /><span><strong>UPLOAD</strong><small>Choose from your device</small></span>
            <input id={uploadInputId} type="file" accept="image/*,video/*" multiple onChange={(event) => { acceptFiles(event.target.files); event.currentTarget.value = '' }} />
          </label>
        </div>

        <div className="active-outing-selection">
          <span><ImagePlus size={15} /> {selectedLabel}</span>
          {files.length > 0 && <button type="button" onClick={() => setFiles([])}><X size={14} /> CLEAR</button>}
        </div>
        {files.length > 0 && (
          <div className="active-outing-file-list">
            {files.map((file, index) => <span key={`${file.name}-${file.size}-${index}`}>{file.type.startsWith('video/') ? 'VIDEO' : 'PHOTO'} · {file.name}</span>)}
          </div>
        )}
        <textarea value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={500} placeholder="Add a caption to this Signal…" />
        <button type="button" className="active-outing-save" disabled={saving || files.length === 0} onClick={() => { void saveMoment() }}>
          <CheckCircle2 size={17} /> {saving ? 'SAVING TO SIGNAL…' : 'SAVE TO THIS SIGNAL'}
        </button>
        {notice && <div className="active-outing-notice" role="status">{notice}</div>}
        {error && <div className="active-outing-error" role="alert">{error}</div>}
      </section>

      <div className="active-outing-footer-actions">
        <button type="button" onClick={() => onOpenChat(planId)}><MessageCircle size={17} /> OPEN GROUP CHAT</button>
        <button type="button" className="danger" disabled={leaving} onClick={() => { void safetyLeave() }}><ShieldAlert size={17} /> {leaving ? 'LEAVING…' : "I DON'T FEEL SAFE — LEAVE NOW"}</button>
      </div>
    </section>
  )
}
