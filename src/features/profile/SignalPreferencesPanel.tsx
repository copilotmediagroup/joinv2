import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Pencil, Sparkles } from 'lucide-react'
import {
  getMySignalPreferences,
  updateMySignalPreferences,
  type SignalPreferences,
} from './signalPreferencesClient'
import './SignalPreferencesPanel.css'
import { toUserFacingError } from '../../lib/userFacingError'

type PreferenceKey = keyof SignalPreferences

type PreferenceGroup = {
  key: PreferenceKey
  label: string
  options: Array<{ value: string; label: string }>
}

const GROUPS: PreferenceGroup[] = [
  { key: 'socialEnergy', label: 'SOCIAL ENERGY', options: [
    { value: 'life_of_party', label: 'Life of the party' },
    { value: 'social', label: 'Social' },
    { value: 'laid_back', label: 'Laid-back' },
    { value: 'reserved_at_first', label: 'Reserved at first' },
    { value: 'go_with_flow', label: 'Go with the flow' },
  ] },
  { key: 'goingOutStyle', label: 'GOING OUT', options: [
    { value: 'dress_up', label: 'Dress up' },
    { value: 'casual', label: 'Casual' },
    { value: 'either', label: 'Either' },
  ] },
  { key: 'nightTiming', label: 'TIMING', options: [
    { value: 'early_evening', label: 'Early evening' },
    { value: 'late_night', label: 'Late night' },
    { value: 'either', label: 'Either' },
  ] },
  { key: 'venueEnergy', label: 'MY KIND OF NIGHT', options: [
    { value: 'rooftop', label: 'Rooftop' },
    { value: 'nightclub', label: 'Nightclub' },
    { value: 'either', label: 'Either' },
  ] },
  { key: 'barStyle', label: 'BAR VIBE', options: [
    { value: 'sports_bar', label: 'Sports bar' },
    { value: 'cocktail_bar', label: 'Cocktail bar' },
    { value: 'either', label: 'Either' },
  ] },
  { key: 'restaurantStyle', label: 'FOOD VIBE', options: [
    { value: 'nice_restaurant', label: 'Nice restaurant' },
    { value: 'hidden_gem', label: 'Hidden gem' },
    { value: 'either', label: 'Either' },
  ] },
  { key: 'planningStyle', label: 'PACE', options: [
    { value: 'planned', label: 'Planned' },
    { value: 'spontaneous', label: 'Spontaneous' },
    { value: 'either', label: 'Either' },
  ] },
  { key: 'groupSize', label: 'GROUP SIZE', options: [
    { value: 'small_group', label: 'Small group' },
    { value: 'big_group', label: 'Big group' },
    { value: 'either', label: 'Either' },
  ] },
]

const EMPTY: SignalPreferences = {
  socialEnergy: null,
  goingOutStyle: null,
  nightTiming: null,
  venueEnergy: null,
  barStyle: null,
  restaurantStyle: null,
  planningStyle: null,
  groupSize: null,
}

export default function SignalPreferencesPanel() {
  const [saved, setSaved] = useState<SignalPreferences>(EMPTY)
  const [draft, setDraft] = useState<SignalPreferences>(EMPTY)
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const saveRequestRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    void getMySignalPreferences()
      .then((next) => {
        if (!cancelled) {
          setSaved(next)
          setDraft(next)
        }
      })
      .catch((loadError) => {
        if (!cancelled) setError(toUserFacingError(loadError, 'Unable to load energy preferences right now.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const selectedLabels = useMemo(() => GROUPS.flatMap((group) => {
    const value = saved[group.key]
    if (!value) return []
    const option = group.options.find((entry) => entry.value === value)
    return option ? [option.label] : []
  }), [saved])

  const save = async () => {
    if (saveRequestRef.current) return
    saveRequestRef.current = true
    setSaving(true)
    setError(null)
    try {
      const next = await updateMySignalPreferences(draft)
      setSaved(next)
      setDraft(next)
      setEditing(false)
    } catch (saveError) {
      setError(toUserFacingError(saveError, 'Unable to save energy preferences right now.'))
    } finally {
      saveRequestRef.current = false
      setSaving(false)
    }
  }

  if (loading) return null

  return (
    <div className="signal-preferences">
      <div className="signal-preferences-heading">
        <div>
          <span><Sparkles size={13} /> MY ENERGY</span>
          <h3>My kind of night</h3>
        </div>
        <button type="button" onClick={() => { setDraft(saved); setEditing((current) => !current) }} disabled={saving}>
          <Pencil size={13} /> {editing ? 'CLOSE' : 'EDIT'}
        </button>
      </div>

      {!editing ? (
        selectedLabels.length > 0 ? (
          <div className="signal-preferences-summary">
            {selectedLabels.map((label) => <span key={label}>{label}</span>)}
          </div>
        ) : (
          <p className="signal-preferences-empty">Add a few quick preferences so SIGNAL can understand the experience you usually enjoy.</p>
        )
      ) : (
        <div className="signal-preferences-editor">
          {GROUPS.map((group) => (
            <div className="signal-preferences-group" key={group.key}>
              <small>{group.label}</small>
              <div>
                {group.options.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={draft[group.key] === option.value ? 'active' : ''}
                    disabled={saving}
                    onClick={() => setDraft((current) => ({
                      ...current,
                      [group.key]: current[group.key] === option.value ? null : option.value,
                    }))}
                  >
                    {draft[group.key] === option.value && <Check size={12} />}
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button type="button" className="signal-preferences-save" onClick={() => { void save() }} disabled={saving}>
            {saving ? 'SAVING…' : 'SAVE MY ENERGY'}
          </button>
        </div>
      )}

      {error && <p className="signal-preferences-error" role="alert">{error}</p>}
    </div>
  )
}
