import { ArrowLeft, MapPin, MessageCircle, Play, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getPublicProfileConnections, getPublicProfileMoments, getPublicSignalProfile, type PublicProfileConnection, type PublicProfileMoment, type PublicSignalProfile } from './publicProfileClient'
import UserSafetyActions from '../safety/UserSafetyActions'
import './ProfileView.css'

type Tile = { moment: PublicProfileMoment; mediaIndex: number }

export default function PublicProfileView({ userId, onBack, onMessage, onOpenProfile }: {
  userId: string
  onBack: () => void
  onMessage?: () => void
  onOpenProfile?: (userId: string) => void
}) {
  const [profile, setProfile] = useState<PublicSignalProfile | null>(null)
  const [moments, setMoments] = useState<PublicProfileMoment[]>([])
  const [connections, setConnections] = useState<PublicProfileConnection[]>([])
  const [selected, setSelected] = useState<Tile | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void Promise.all([getPublicSignalProfile(userId), getPublicProfileMoments(userId), getPublicProfileConnections(userId)])
      .then(([nextProfile, nextMoments, nextConnections]) => { if (active) { setProfile(nextProfile); setMoments(nextMoments); setConnections(nextConnections) } })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : 'Unable to load profile') })
    return () => { active = false }
  }, [userId])

  const tiles = useMemo(() => moments.flatMap((moment) => moment.media.map((_, mediaIndex) => ({ moment, mediaIndex }))), [moments])

  if (error) return <section className="public-profile-state"><button onClick={onBack}><ArrowLeft size={16}/> BACK</button><p>{error}</p></section>
  if (!profile) return <section className="public-profile-state">Loading profile…</section>

  return <section className="public-profile-view">
    <button type="button" className="public-profile-back" onClick={onBack}><ArrowLeft size={16}/> BACK</button>
    <header className="public-profile-hero">
      {profile.avatarUrl ? <img src={profile.avatarUrl} alt=""/> : <div className="public-profile-avatar-fallback">{profile.displayName[0]}</div>}
      <div className="public-profile-identity">
        <div><h2>{profile.displayName}</h2>{profile.age !== null ? <span>{profile.age}</span> : null}</div>
        {(profile.cityName || profile.stateCode) ? <small><MapPin size={12}/>{[profile.cityName, profile.stateCode].filter(Boolean).join(', ')}</small> : null}
        {profile.bio ? <p>{profile.bio}</p> : null}
      </div>
      <UserSafetyActions userId={profile.userId} displayName={profile.displayName} onBlocked={onBack}/>
    </header>

    <div className="profile-view-clout">
      <div><strong>{profile.signalsJoined}</strong><span>Signals</span></div>
      <div><strong>{profile.completedMeetups}</strong><span>Meetups</span></div>
      <div><strong>{profile.verifiedShowUps}</strong><span>Show-ups</span></div>
    </div>

    {profile.connectionState === 'connected' && onMessage ? <button className="public-profile-message" type="button" onClick={onMessage}><MessageCircle size={15}/> MESSAGE</button> : null}

    <div className="profile-signal-life public-profile-life">
      <header className="profile-signal-life-head"><div><span>⚡ SIGNAL LIFE</span><h3>{profile.displayName}'s Signal Life</h3><p>Real nights. Real places. Their story.</p></div><strong>{tiles.length}<small>MOMENTS</small></strong></header>
      {tiles.length ? <div className="profile-signal-life-grid">
        {tiles.map((tile) => {
          const media = tile.moment.media[tile.mediaIndex]
          return <button type="button" className="profile-signal-tile" key={media.storagePath} onClick={() => setSelected(tile)}>
            {media.mediaKind === 'video' ? <video src={media.url} muted playsInline preload="metadata"/> : <img src={media.url} alt="Signal Moment"/>}
            <span className="profile-signal-tile-shade"/><span className="profile-signal-tile-activity"><Zap size={10}/>{tile.moment.activityName}</span>
            {media.mediaKind === 'video' ? <Play className="profile-signal-video" size={19} fill="currentColor"/> : null}
          </button>
        })}
      </div> : <div className="profile-signal-life-empty"><Zap size={22}/><strong>No published Signal Moments yet.</strong></div>}
    </div>

    <section className="public-profile-connections">
      <header><div><span>CONNECTIONS</span><h3>People SIGNAL introduced them to</h3></div><strong>{connections.length}</strong></header>
      {connections.length ? <div className="public-profile-connection-row">{connections.map((connection) => <button type="button" key={connection.userId} onClick={() => onOpenProfile?.(connection.userId)}><span>{connection.avatarUrl ? <img src={connection.avatarUrl} alt=""/> : connection.displayName.slice(0,1).toUpperCase()}</span><small>{connection.displayName}</small></button>)}</div> : <p>No SIGNAL connections yet.</p>}
    </section>

    {selected ? <div className="profile-signal-life-viewer" role="dialog" aria-modal="true" onClick={() => setSelected(null)}><article onClick={(event) => event.stopPropagation()}>
      <button type="button" className="profile-signal-viewer-close" onClick={() => setSelected(null)}>×</button>
      <div className="profile-signal-viewer-media">{selected.moment.media[selected.mediaIndex].mediaKind === 'video' ? <video src={selected.moment.media[selected.mediaIndex].url} controls autoPlay playsInline/> : <img src={selected.moment.media[selected.mediaIndex].url} alt="Signal Moment"/>}</div>
      <div className="profile-signal-viewer-copy"><span><Zap size={12}/>{selected.moment.activityName.toUpperCase()} · {selected.moment.cityName}, {selected.moment.stateCode}</span><h4>{selected.moment.venueName ?? 'SIGNAL meetup'}</h4>{selected.moment.caption ? <p>{selected.moment.caption}</p> : null}<div><span><Zap size={13}/>{selected.moment.signalCount} SIGNALS</span><span><MessageCircle size={13}/>{selected.moment.commentCount} COMMENTS</span></div></div>
    </article></div> : null}
  </section>
}
