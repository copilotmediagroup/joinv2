import { useEffect, useState } from 'react'
import { Heart, LoaderCircle } from 'lucide-react'
import {
  getMyChillDatingPreferences,
  updateMyChillDatingPreferences,
  type ChillDatingPreferences,
} from './chillDatingPreferencesClient'
import type { ProfileGender } from './profileClient'
import { toUserFacingError } from '../../lib/userFacingError'
import './ChillDatingPreferencesPanel.css'

export default function ChillDatingPreferencesPanel({ gender }: { gender: ProfileGender | null }) {
  const [preferences, setPreferences] = useState<ChillDatingPreferences | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getMyChillDatingPreferences()
      .then((value) => { if (!cancelled) setPreferences(value) })
      .catch((value) => { if (!cancelled) setError(toUserFacingError(value, 'Unable to load Chill preferences.')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading || !gender) return null

  const oppositeGender: ProfileGender = gender === 'male' ? 'female' : 'male'
  const draft = preferences ?? {
    seekingGender: oppositeGender,
    minAge: 18,
    maxAge: 80,
    isEnabled: false,
  }

  const save = async (next: ChillDatingPreferences) => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      setPreferences(await updateMyChillDatingPreferences(next))
    } catch (value) {
      setError(toUserFacingError(value, 'Unable to save Chill preferences.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="chill-dating-preferences">
      <div className="chill-dating-heading">
        <span><Heart size={14} /> CHILL</span>
        <h3>Dating mode</h3>
        <p>One person. Mutual match. SIGNAL handles the meetup.</p>
      </div>

      <div className="chill-dating-identity">
        <span>Your profile</span>
        <strong>{gender === 'female' ? 'Woman' : 'Man'}</strong>
      </div>

      <div className="chill-dating-seeking">
        <strong>Looking to meet</strong>
        <div className="chill-dating-gender-options">
          {(['male', 'female'] as ProfileGender[]).map((option) => {
            const isAllowed = option !== gender
            const isSelected = draft.seekingGender === option
            return (
              <button
                key={option}
                type="button"
                className={isSelected ? 'active' : ''}
                disabled={saving || !isAllowed}
                title={isAllowed ? undefined : 'Chill currently matches men with women and women with men.'}
                onClick={() => setPreferences({ ...draft, seekingGender: option })}
              >
                {option === 'male' ? 'MEN' : 'WOMEN'}
              </button>
            )
          })}
        </div>
      </div>

      <div className="chill-dating-row">
        <div>
          <strong>Dating mode</strong>
          <small>{draft.isEnabled ? 'Available for reciprocal Chill matches' : 'Not matching right now'}</small>
        </div>
        <button
          type="button"
          className={draft.isEnabled ? 'active' : ''}
          disabled={saving}
          onClick={() => void save({ ...draft, isEnabled: !draft.isEnabled })}
        >
          {saving ? <LoaderCircle size={14} className="chill-dating-spinner" /> : draft.isEnabled ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className="chill-dating-age">
        <strong>Age range</strong>
        <div>
          <label>MIN<input type="number" min="18" max="80" value={draft.minAge} disabled={saving || !draft.isEnabled}
            onChange={(event) => setPreferences({ ...draft, minAge: Math.max(18, Math.min(80, Number(event.target.value) || 18)) })} /></label>
          <span>—</span>
          <label>MAX<input type="number" min="18" max="80" value={draft.maxAge} disabled={saving || !draft.isEnabled}
            onChange={(event) => setPreferences({ ...draft, maxAge: Math.max(18, Math.min(80, Number(event.target.value) || 80)) })} /></label>
          <button type="button" disabled={saving || !draft.isEnabled || draft.minAge > draft.maxAge}
            onClick={() => void save(draft)}>SAVE</button>
        </div>
      </div>

      <p className="chill-dating-private">Your dating preference is private. Chill only forms when both people fit each other.</p>
      {error ? <p className="chill-dating-error" role="alert">{error}</p> : null}
    </div>
  )
}
