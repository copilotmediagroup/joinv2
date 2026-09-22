import { MapPin, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toUserFacingError } from '../../lib/userFacingError'
import { searchSignalProfiles, type SignalProfileSearchResult } from './profileSearchClient'

export default function ProfileSearchPanel({
  onClose,
  onOpenProfile,
}: {
  onClose: () => void
  onOpenProfile: (userId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SignalProfileSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestEpochRef = useRef(0)

  useEffect(() => {
    const normalized = query.trim()
    if (normalized.length < 2) return

    let cancelled = false
    const requestEpoch = ++requestEpochRef.current
    const timer = window.setTimeout(() => {
      void searchSignalProfiles(normalized)
        .then((next) => {
          if (!cancelled && requestEpoch === requestEpochRef.current) setResults(next)
        })
        .catch((value) => {
          if (!cancelled && requestEpoch === requestEpochRef.current) {
            setError(toUserFacingError(value, 'Unable to search SIGNAL right now.'))
          }
        })
        .finally(() => {
          if (!cancelled && requestEpoch === requestEpochRef.current) setLoading(false)
        })
    }, 250)

    return () => {
      cancelled = true
      requestEpochRef.current += 1
      window.clearTimeout(timer)
    }
  }, [query])

  const updateQuery = (next: string) => {
    requestEpochRef.current += 1
    setQuery(next)
    setError(null)
    setResults([])
    setLoading(next.trim().length >= 2)
  }

  return (
    <div className="profile-search-overlay" role="dialog" aria-modal="true" aria-label="Search SIGNAL people" onClick={onClose}>
      <section className="profile-search-panel" onClick={(event) => event.stopPropagation()}>
        <header>
          <div><span>FIND PEOPLE</span><h2>Search SIGNAL</h2></div>
          <button type="button" aria-label="Close search" onClick={onClose}><X size={18}/></button>
        </header>
        <label className="profile-search-input">
          <Search size={17}/>
          <input autoFocus maxLength={80} value={query} onChange={(event) => updateQuery(event.target.value)} placeholder="Search by display name" aria-label="Search by display name"/>
        </label>
        <div className="profile-search-results">
          {query.trim().length < 2 ? <p>Type at least 2 characters to find people.</p>
            : loading ? <p>Searching…</p>
              : error ? <p role="alert">{error}</p>
                : results.length === 0 ? <p>No visible SIGNAL profiles found.</p>
                  : results.map((person) => (
                    <button type="button" key={person.userId} onClick={() => onOpenProfile(person.userId)}>
                      <span className="profile-search-avatar">{person.avatarUrl ? <img src={person.avatarUrl} alt=""/> : person.displayName.slice(0, 1).toUpperCase()}</span>
                      <span><strong>{person.displayName}</strong>{person.cityName || person.stateCode ? <small><MapPin size={11}/>{[person.cityName, person.stateCode].filter(Boolean).join(', ')}</small> : <small>SIGNAL MEMBER</small>}</span>
                      <b>›</b>
                    </button>
                  ))}
        </div>
      </section>
    </div>
  )
}
