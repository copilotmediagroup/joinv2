import { Ban, Flag, ShieldAlert, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toUserFacingError } from '../../lib/userFacingError'
import { blockUser, reportUser, type UserReportReason } from './userSafetyClient'

const reasons: Array<{ value: UserReportReason; label: string }> = [
  { value: 'harassment', label: 'Harassment' },
  { value: 'threats', label: 'Threats' },
  { value: 'hate', label: 'Hate' },
  { value: 'sexual', label: 'Sexual content' },
  { value: 'spam', label: 'Spam' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'privacy', label: 'Privacy' },
  { value: 'other', label: 'Other' },
]

type Props = {
  userId: string
  displayName: string
  onBlocked?: () => void
  disabled?: boolean
  onBusyChange?: (busy: boolean) => void
}

export default function UserSafetyActions({ userId, displayName, onBlocked, disabled = false, onBusyChange }: Props) {
  const [mode, setMode] = useState<'closed' | 'report' | 'block'>('closed')
  const [reason, setReason] = useState<UserReportReason>('harassment')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const actionRequestRef = useRef(false)
  const actionEpochRef = useRef(0)

  useEffect(() => () => { actionEpochRef.current += 1 }, [userId])

  const submitReport = async () => {
    if (actionRequestRef.current || disabled) return
    const actionEpoch = actionEpochRef.current
    const requestedUserId = userId
    actionRequestRef.current = true
    setBusy(true); onBusyChange?.(true); setError(null); setMessage(null)
    try {
      await reportUser(requestedUserId, reason, details.trim() || null)
      if (actionEpoch !== actionEpochRef.current || requestedUserId !== userId) return
      setMessage('Report sent. SIGNAL will review it.')
      setMode('closed'); setDetails('')
    } catch (value) {
      if (actionEpoch !== actionEpochRef.current || requestedUserId !== userId) return
      setError(toUserFacingError(value, 'Unable to send this report right now.'))
    } finally {
      actionRequestRef.current = false
      if (actionEpoch === actionEpochRef.current && requestedUserId === userId) { setBusy(false); onBusyChange?.(false) }
    }
  }

  const confirmBlock = async () => {
    if (actionRequestRef.current || disabled) return
    const actionEpoch = actionEpochRef.current
    const requestedUserId = userId
    actionRequestRef.current = true
    setBusy(true); onBusyChange?.(true); setError(null); setMessage(null)
    try {
      await blockUser(requestedUserId)
      if (actionEpoch !== actionEpochRef.current || requestedUserId !== userId) return
      setMessage(`${displayName} is blocked.`)
      setMode('closed')
      onBlocked?.()
    } catch (value) {
      if (actionEpoch !== actionEpochRef.current || requestedUserId !== userId) return
      setError(toUserFacingError(value, 'Unable to block this person right now.'))
    } finally {
      actionRequestRef.current = false
      if (actionEpoch === actionEpochRef.current && requestedUserId === userId) { setBusy(false); onBusyChange?.(false) }
    }
  }

  return <div className="user-safety-actions">
    <div className="user-safety-buttons">
      <button type="button" disabled={busy || disabled} onClick={() => setMode(mode === 'report' ? 'closed' : 'report')}><Flag size={13}/> REPORT</button>
      <button type="button" disabled={busy || disabled} onClick={() => setMode(mode === 'block' ? 'closed' : 'block')}><Ban size={13}/> BLOCK</button>
    </div>
    {mode === 'report' ? <div className="user-safety-sheet">
      <header><span><ShieldAlert size={14}/> REPORT {displayName.toUpperCase()}</span><button type="button" disabled={busy || disabled} onClick={() => setMode('closed')}><X size={14}/></button></header>
      <select disabled={busy || disabled} value={reason} onChange={(event) => setReason(event.target.value as UserReportReason)}>{reasons.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
      <textarea disabled={busy || disabled} maxLength={2000} value={details} placeholder="What happened? (optional)" onChange={(event) => setDetails(event.target.value)} />
      <button type="button" disabled={busy || disabled} onClick={() => void submitReport()}>{busy ? 'SENDING…' : 'SEND REPORT'}</button>
    </div> : null}
    {mode === 'block' ? <div className="user-safety-sheet user-safety-block">
      <strong>Block {displayName}?</strong>
      <span>You’ll disconnect, private messages will close, and they won’t be able to reconnect while blocked.</span>
      <div><button type="button" disabled={busy || disabled} onClick={() => setMode('closed')}>CANCEL</button><button type="button" disabled={busy || disabled} onClick={() => void confirmBlock()}>{busy ? 'BLOCKING…' : 'BLOCK'}</button></div>
    </div> : null}
    {message ? <p className="user-safety-message">{message}</p> : null}
    {error ? <p className="user-safety-error" role="alert">{error}</p> : null}
  </div>
}
