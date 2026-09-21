import { ArrowLeft, MapPin, MessageCircle, Play, Zap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getPublicProfileConnectionCount, getPublicProfileConnections, getPublicProfileMoments, getPublicSignalProfile, type PublicProfileConnection, type PublicProfileMoment, type PublicSignalProfile } from './publicProfileClient'
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
  const [connectionCount, setConnectionCount] = useState(0)
  const [selected, setSelected] = useState<Tile | null>(null)
  const [connectionsOpen, setConnectionsOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [momentsHaveMore, setMomentsHaveMore] = useState(false)
  const [momentsLoadingMore, setMomentsLoadingMore] = useState(false)
  const [connectionsHaveMore, setConnectionsHaveMore] = useState(false)
  const [connectionsLoadingMore, setConnectionsLoadingMore] = useState(false)
  const activeUserIdRef = useRef(userId)
  const momentsPageRequestRef = useRef(false)
  const connectionsPageRequestRef = useRef(false)

  useEffect(() => {
    activeUserIdRef.current = userId
  }, [userId])

  useEffect(() => {
    let active = true
    void Promise.all([getPublicSignalProfile(userId), getPublicProfileMoments(userId), getPublicProfileConnections(userId), getPublicProfileConnectionCount(userId)])
      .then(([nextProfile, momentPage, connectionPage, nextConnectionCount]) => {
        if (active) {
          setProfile(nextProfile); setMoments(momentPage.moments); setMomentsHaveMore(momentPage.hasMore)
          setConnections(connectionPage.connections); setConnectionsHaveMore(connectionPage.hasMore); setConnectionCount(nextConnectionCount)
        }
      })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : 'Unable to load profile') })
    return () => { active = false }
  }, [userId])

  async function loadMoreMoments() {
    const requestedUserId = userId
    const last = moments[moments.length - 1]
    if (!last || momentsPageRequestRef.current || !momentsHaveMore) return
    momentsPageRequestRef.current = true
    setMomentsLoadingMore(true)
    try {
      const page = await getPublicProfileMoments(requestedUserId, { publishedAt: last.publishedAt, momentId: last.momentId })
      if (requestedUserId !== activeUserIdRef.current) return
      setMoments((current) => [...current, ...page.moments])
      setMomentsHaveMore(page.hasMore)
    } finally {
      momentsPageRequestRef.current = false
      if (requestedUserId === activeUserIdRef.current) setMomentsLoadingMore(false)
    }
  }

  async function loadMoreConnections() {
    const requestedUserId = userId
    const last = connections[connections.length - 1]
    if (!last || connectionsPageRequestRef.current || !connectionsHaveMore) return
    connectionsPageRequestRef.current = true
    setConnectionsLoadingMore(true)
    try {
      const page = await getPublicProfileConnections(requestedUserId, { connectedAt: last.connectedAt, connectionId: last.connectionId })
      if (requestedUserId !== activeUserIdRef.current) return
      setConnections((current) => [...current, ...page.connections])
      setConnectionsHaveMore(page.hasMore)
    } finally {
      connectionsPageRequestRef.current = false
      if (requestedUserId === activeUserIdRef.current) setConnectionsLoadingMore(false)
    }
  }

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
        <button type="button" className="public-profile-connections-link" onClick={() => setConnectionsOpen(true)}>{connectionCount} {connectionCount === 1 ? 'Connection' : 'Connections'}</button>
      </div>
      <UserSafetyActions userId={profile.userId} displayName={profile.displayName} onBlocked={onBack}/>
    </header>

    <div className="profile-view-clout">
      <div><strong>{profile.signalsJoined}</strong><span>Signals</span></div>
      <div><strong>{profile.completedMeetups}</strong><span>Meet ups</span></div>
      <div><strong>{profile.verifiedShowUps}</strong><span>Verified showups</span></div>
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
      {momentsHaveMore ? <button type="button" className="profile-signal-life-load-more" disabled={momentsLoadingMore} onClick={() => { void loadMoreMoments() }}>{momentsLoadingMore ? 'LOADING…' : 'LOAD MORE SIGNAL LIFE'}</button> : null}
    </div>

    {connectionsOpen ? <div className="public-profile-connections-dialog" role="dialog" aria-modal="true" aria-label={`${profile.displayName} connections`} onClick={() => setConnectionsOpen(false)}><article onClick={(event) => event.stopPropagation()}>
      <header><div><span>⚡ SIGNAL CONNECTIONS</span><h3>{profile.displayName}'s Connections</h3><p>People they actually met through SIGNAL.</p></div><button type="button" aria-label="Close connections" onClick={() => setConnectionsOpen(false)}>×</button></header>
      <div className="public-profile-connections-dialog-list">
        {connections.length ? connections.map((connection) => <button type="button" key={connection.connectionId} onClick={() => { setConnectionsOpen(false); onOpenProfile?.(connection.userId) }}><span>{connection.avatarUrl ? <img src={connection.avatarUrl} alt=""/> : connection.displayName.slice(0,1).toUpperCase()}<i/></span><div><strong>{connection.displayName}</strong><small>SIGNAL CONNECTION</small></div><b>›</b></button>) : <p>No SIGNAL connections yet.</p>}
        {connectionsHaveMore ? <button type="button" className="public-profile-connections-load-more" disabled={connectionsLoadingMore} onClick={() => { void loadMoreConnections() }}>{connectionsLoadingMore ? 'LOADING…' : 'LOAD MORE CONNECTIONS'}</button> : null}
      </div>
    </article></div> : null}

    {selected ? <div className="profile-signal-life-viewer" role="dialog" aria-modal="true" onClick={() => setSelected(null)}><article onClick={(event) => event.stopPropagation()}>
      <button type="button" className="profile-signal-viewer-close" onClick={() => setSelected(null)}>×</button>
      <div className="profile-signal-viewer-media">{selected.moment.media[selected.mediaIndex].mediaKind === 'video' ? <video src={selected.moment.media[selected.mediaIndex].url} controls autoPlay playsInline/> : <img src={selected.moment.media[selected.mediaIndex].url} alt="Signal Moment"/>}</div>
      <div className="profile-signal-viewer-copy"><span><Zap size={12}/>{selected.moment.activityName.toUpperCase()} · {selected.moment.cityName}, {selected.moment.stateCode}</span><h4>{selected.moment.venueName ?? 'SIGNAL meetup'}</h4>{selected.moment.caption ? <p>{selected.moment.caption}</p> : null}<div><span><Zap size={13}/>{selected.moment.signalCount} SIGNALS</span><span><MessageCircle size={13}/>{selected.moment.commentCount} COMMENTS</span></div></div>
    </article></div> : null}
  </section>
}
