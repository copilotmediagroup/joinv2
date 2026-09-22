import { MessageCircle, Play, Zap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getMyProfileSignalMoments, type ProfileSignalMoment } from './profileSignalMomentsClient'

type Tile = { moment: ProfileSignalMoment; mediaIndex: number }

export default function ProfileSignalLife() {
  const [moments, setMoments] = useState<ProfileSignalMoment[]>([])
  const [selected, setSelected] = useState<Tile | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const pageRequestRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    pageRequestRef.current = true
    void getMyProfileSignalMoments().then((page) => {
      if (!cancelled) { setMoments(page.moments); setHasMore(page.hasMore) }
    }).catch(() => { if (!cancelled) setMoments([]) })
      .finally(() => {
        pageRequestRef.current = false
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  async function loadMore() {
    const last = moments[moments.length - 1]
    if (!last || pageRequestRef.current || !hasMore) return
    pageRequestRef.current = true
    setLoadingMore(true)
    try {
      const page = await getMyProfileSignalMoments({ publishedAt: last.publishedAt, momentId: last.momentId })
      setMoments((current) => [...current, ...page.moments.filter((next) => !current.some((item) => item.momentId === next.momentId))])
      setHasMore(page.hasMore)
    } finally {
      pageRequestRef.current = false
      setLoadingMore(false)
    }
  }

  const tiles = useMemo(() => moments.flatMap((moment) =>
    moment.media.map((_, mediaIndex) => ({ moment, mediaIndex }))), [moments])

  if (loading) return <section className="profile-signal-life"><div className="profile-signal-life-empty">Loading your Signal Life…</div></section>

  return <section className="profile-signal-life">
    <header className="profile-signal-life-head">
      <div><span>⚡ SIGNAL LIFE</span><h3>Your Signal Life</h3><p>Real nights. Real places. Your story.</p></div>
      <strong>{tiles.length}<small>MOMENTS</small></strong>
    </header>

    {tiles.length ? <div className="profile-signal-life-grid">
      {tiles.map((tile, index) => {
        const media = tile.moment.media[tile.mediaIndex]
        return <button type="button" className={index % 7 === 0 ? 'profile-signal-tile feature' : 'profile-signal-tile'} key={media.storagePath} onClick={() => setSelected(tile)}>
          {media.mediaKind === 'video' ? <video src={media.url} muted playsInline preload="metadata"/> : <img src={media.url} alt="Signal Moment"/>}
          <span className="profile-signal-tile-shade"/>
          <span className="profile-signal-tile-activity"><Zap size={10}/>{tile.moment.activityName}</span>
          {media.mediaKind === 'video' ? <Play className="profile-signal-video" size={19} fill="currentColor"/> : null}
          <span className="profile-signal-tile-social"><Zap size={10}/>{tile.moment.signalCount} <MessageCircle size={10}/>{tile.moment.commentCount}</span>
        </button>
      })}
    </div> : <div className="profile-signal-life-empty"><Zap size={23}/><strong>Your Signal Life starts when you show up.</strong><span>Photos and videos you capture during SIGNALs will build your visual history here.</span></div>}
    {hasMore ? <button type="button" className="profile-signal-life-load-more" disabled={loadingMore} onClick={() => { void loadMore() }}>{loadingMore ? 'LOADING…' : 'LOAD MORE SIGNAL LIFE'}</button> : null}

    {selected ? <div className="profile-signal-life-viewer" role="dialog" aria-modal="true" onClick={() => setSelected(null)}>
      <article onClick={(event) => event.stopPropagation()}>
        <button type="button" className="profile-signal-viewer-close" onClick={() => setSelected(null)}>×</button>
        <div className="profile-signal-viewer-media">
          {selected.moment.media[selected.mediaIndex].mediaKind === 'video'
            ? <video src={selected.moment.media[selected.mediaIndex].url} controls autoPlay playsInline/>
            : <img src={selected.moment.media[selected.mediaIndex].url} alt="Signal Moment"/>}
        </div>
        <div className="profile-signal-viewer-copy">
          <span><Zap size={12}/>{selected.moment.activityName.toUpperCase()} · {selected.moment.cityName}, {selected.moment.stateCode}</span>
          <h4>{selected.moment.venueName ?? 'SIGNAL meetup'}</h4>

          {selected.moment.caption ? <p>{selected.moment.caption}</p> : null}
          <div><span><Zap size={13}/>{selected.moment.signalCount} SIGNALS</span><span><MessageCircle size={13}/>{selected.moment.commentCount} COMMENTS</span></div>
        </div>
      </article>
    </div> : null}
  </section>
}
