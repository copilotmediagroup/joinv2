import React, { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Bell,
  ChevronRight,
  Compass,
  MessageCircle,
  Search,
  Sparkles,
  UserRound,
  Zap,
} from 'lucide-react'
import './App.css'
import SignalPlaceStage from './features/signal/SignalPlaceStage'
import SignalTimeStage, {
  type LockedSignalVenue,
} from './features/signal/SignalTimeStage'

type Pulse = {
  id: string
  emoji: string
  label: string
  count: number
  line: string
  image: string
  size: 'hero' | 'wide' | 'medium' | 'small'
  avatars: string[]
}

type BoredSuggestion = {
  id: string
  emoji: string
  title: string
  subtitle: string
  image: string
  people: number
  avatars: string[]
  detail: string
}

const imageUrl = (id: string) =>
  ['https:', '//images.unsplash.com/photo-', id, '?auto=format&fit=crop&w=1400&q=90'].join('')

const avatarUrl = (id: string) =>
  ['https:', '//i.pravatar.cc/100?img=', id].join('')

const pulses: Pulse[] = [
  {
    id: 'drinks',
    emoji: '🍸',
    label: 'DRINKS',
    count: 18,
    line: 'down for drinks',
    image: imageUrl('1515003197210-e0cd71810b5f'),
    size: 'hero',
    avatars: ['47', '45', '12', '32', '11'],
  },
  {
    id: 'sports',
    emoji: '🏀',
    label: 'SPORTS',
    count: 12,
    line: 'ready to play',
    image: imageUrl('1546519638-68e109498ffc'),
    size: 'medium',
    avatars: ['8', '13', '15', '17'],
  },
  {
    id: 'creative',
    emoji: '🎨',
    label: 'CREATIVE',
    count: 8,
    line: 'making something',
    image: imageUrl('1541961017774-22349e4a1262'),
    size: 'medium',
    avatars: ['44', '36', '25', '29'],
  },
  {
    id: 'food',
    emoji: '🍽️',
    label: 'FOOD',
    count: 18,
    line: 'hungry right now',
    image: imageUrl('1414235077428-338989a2e8c0'),
    size: 'wide',
    avatars: ['19', '21', '31', '33'],
  },
  {
    id: 'music',
    emoji: '🎶',
    label: 'LIVE MUSIC',
    count: 11,
    line: 'vibing tonight',
    image: imageUrl('1501386761578-eac5c94b800a'),
    size: 'wide',
    avatars: ['22', '28', '35', '42'],
  },
  {
    id: 'outdoors',
    emoji: '🌴',
    label: 'OUTDOORS',
    count: 9,
    line: 'outside today',
    image: imageUrl('1500530855697-b586d89ba3ee'),
    size: 'small',
    avatars: ['20', '23', '37', '43'],
  },
  {
    id: 'chill',
    emoji: '📺',
    label: 'CHILL',
    count: 6,
    line: 'down to chill',
    image: imageUrl('1489599849927-2ee91cede3ba'),
    size: 'small',
    avatars: ['26', '41', '46'],
  },
  {
    id: 'explore',
    emoji: '🛍️',
    label: 'EXPLORE',
    count: 7,
    line: 'wanna go',
    image: imageUrl('1519501025264-65ba15a82390'),
    size: 'small',
    avatars: ['10', '18', '34'],
  },
  {
    id: 'nightlife',
    emoji: '🌙',
    label: 'NIGHTLIFE',
    count: 26,
    line: 'going out tonight',
    image: imageUrl('1514525253161-7a46d19cd819'),
    size: 'small',
    avatars: ['47', '45', '12', '32'],
  },
]

const boredSuggestions: BoredSuggestion[] = [
  {
    id: 'basketball',
    emoji: '🏀',
    title: 'PICKUP BASKETBALL?',
    subtitle: 'Easy run. No league. Just hoop.',
    image: imageUrl('1519861531473-9200262188bf'),
    people: 9,
    avatars: ['8', '13', '15', '17'],
    detail: '4 people want to play tonight',
  },
  {
    id: 'paint',
    emoji: '🎨',
    title: 'PAINT & SIP?',
    subtitle: 'Creative without taking it too seriously.',
    image: imageUrl('1541961017774-22349e4a1262'),
    people: 11,
    avatars: ['44', '36', '25', '29'],
    detail: 'A small creative group is forming',
  },
  {
    id: 'rooftop',
    emoji: '🌙',
    title: 'ROOFTOP TONIGHT?',
    subtitle: 'Drinks, skyline, somewhere with energy.',
    image: imageUrl('1514525253161-7a46d19cd819'),
    people: 16,
    avatars: ['47', '45', '12', '32'],
    detail: '6 people are leaning rooftop',
  },
  {
    id: 'music',
    emoji: '🎶',
    title: 'LIVE MUSIC?',
    subtitle: 'Local spot. Good energy. Nothing overplanned.',
    image: imageUrl('1501386761578-eac5c94b800a'),
    people: 13,
    avatars: ['22', '28', '35', '42'],
    detail: '5 people nearby want music tonight',
  },
]

function AvatarStack({ ids }: { ids: string[] }) {
  return (
    <div className="avatar-stack">
      {ids.map((id) => (
        <img key={id} src={avatarUrl(id)} alt="" />
      ))}
    </div>
  )
}

function App() {
  const [active, setActive] = useState('drinks')
  const [bored, setBored] = useState(false)
  const [suggestionIndex, setSuggestionIndex] = useState(0)
  const [accepted, setAccepted] = useState(false)
  const [formationCount, setFormationCount] = useState(0)
  const [signalThreshold, setSignalThreshold] = useState(false)
  const [signalRoomStage, setSignalRoomStage] = useState<
    'arrival' | 'places' | 'time'
  >('arrival')

  const [lockedSignalVenue, setLockedSignalVenue] =
    useState<LockedSignalVenue | null>(null)

  const [signalPlanSetVisible, setSignalPlanSetVisible] =
    useState(false)

  const suggestion = boredSuggestions[suggestionIndex]

  useEffect(() => {
    if (!accepted) {
      setFormationCount(0)
      return
    }

    setFormationCount(0)

    const timers = [1, 2, 3, 4, 5, 6].map((count) =>
      window.setTimeout(() => {
        setFormationCount(count)
      }, count * 1400)
    )

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [accepted, suggestionIndex])

  const formationMessage =
    formationCount === 0
      ? 'Scanning nearby Signals...'
      : formationCount <= 2
        ? 'Finding your people...'
        : formationCount === 3
          ? 'Momentum building...'
          : formationCount === 4
            ? "Something's forming..."
            : formationCount === 5
              ? 'Almost there...'
              : 'SIGNAL FORMED'

  const nextSuggestion = () => {
    setAccepted(false)
    setSuggestionIndex((current) => (current + 1) % boredSuggestions.length)
  }

  const boredStatus = useMemo(() => {
    if (!bored) return 'idle'
    if (accepted && formationCount >= 6) return 'locked'
    if (accepted) return 'forming'
    return 'searching'
  }, [bored, accepted, formationCount])

  return (
    <main className="app">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />

      <header className="topbar">
        <div className="profile-wrap">
          <img src={avatarUrl('8')} alt="" />
          <span className="online-dot" />
        </div>

        <div className="brand">
          <Zap size={17} fill="currentColor" />
          <span>SIGNAL</span>
        </div>

        <div className="top-actions">
          <button>
            <Search size={18} />
          </button>
          <button>
            <Bell size={18} />
          </button>
        </div>
      </header>

      <section className="intro">
        <span className="eyebrow">
          <Sparkles size={13} />
          DISCOVER
        </span>

        <h1>What are you feeling?</h1>
        <p>Don’t think about it. Pick a vibe.</p>
      </section>

      <AnimatePresence mode="wait">
        {!bored ? (
          <motion.section
            key="pulse-array"
            className="pulse-array"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -8 }}
          >
            {pulses.map((pulse, index) => (
              <motion.button
                key={pulse.id}
                className={`pulse-card ${pulse.size} ${active === pulse.id ? 'active' : ''}`}
                onClick={() => setActive(pulse.id)}
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
                    {pulse.count} ACTIVE
                  </span>
                </div>

                <div className="pulse-content">
                  <h2>
                    <span>{pulse.emoji}</span>
                    {pulse.label}
                  </h2>

                  <div className="pulse-status">
                    <strong>{pulse.count}</strong>
                    <span>{pulse.line}</span>
                  </div>

                  <AvatarStack ids={pulse.avatars} />
                </div>

                <span className="enter">
                  Enter Signal
                  <ChevronRight size={14} />
                </span>
              </motion.button>
            ))}
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
                key={`${suggestion.id}-${accepted}`}
                className={accepted ? 'suggestion-card accepted' : 'suggestion-card'}
                initial={{ opacity: 0, x: 30, scale: 0.985 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -30, scale: 0.985 }}
                transition={{ duration: 0.32 }}
              >
                <img src={suggestion.image} alt="" />
                <div className="suggestion-shade" />

                <div className="suggestion-content">
                  {!accepted ? (
                    <>
                      <span className="suggestion-kicker">
                        {suggestion.emoji} SIGNAL FOUND SOMETHING
                      </span>

                      <h2>{suggestion.title}</h2>
                      <p>{suggestion.subtitle}</p>

                      <div className="suggestion-social">
                        <AvatarStack ids={suggestion.avatars} />
                        <div>
                          <strong>{suggestion.people} people nearby</strong>
                          <span>{suggestion.detail}</span>
                        </div>
                      </div>

                      <div className="suggestion-actions">
                        <motion.button
                          className="down-button"
                          onClick={() => setAccepted(true)}
                          whileTap={{ scale: 0.98 }}
                        >
                          <Zap size={18} fill="currentColor" />
                          I'M DOWN
                        </motion.button>

                        <button
                          className="next-button"
                          onClick={nextSuggestion}
                        >
                          NEXT
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="forming-state">
                      <span className="forming-kicker">MATCHING SIGNALS</span>

                      <h2>{suggestion.emoji} {suggestion.title.replace('?', '')}</h2>

                      <p>
                        SIGNAL is looking for the best-fit people around you now.
                      </p>

                      <div className="forming-people arrival-list">
                        {suggestion.avatars.slice(0, Math.min(formationCount, 4)).map((id, index) => (
                          <motion.div
                            className="arrival-person pulse-connected"
                            key={id}
                            initial={{ opacity: 0, x: -16, scale: 0.92 }}
                            animate={{ opacity: 1, x: 0, scale: 1 }}
                            transition={{
                              delay: index * 0.42,
                              duration: 0.32,
                            }}
                          >
                            <div className="arrival-avatar-wrap">
                              <span className="arrival-lock-pulse" />
                              <img src={avatarUrl(id)} alt="" />
                            </div>

                            <span>
                              <strong>
                                {['Maya', 'Chris', 'Jordan', 'Nia'][index] || 'Someone nearby'}
                              </strong>
                              <small>
                                {[
                                  'Nightlife · Rooftops · 2.1 mi',
                                  'Drinks · Live music · Tonight',
                                  'Sports · Social · 3.0 mi',
                                  'Food · Nightlife · 1.7 mi',
                                ][index] || 'Compatible Signal'}
                              </small>
                            </span>

                            <em>+ JOINED</em>
                          </motion.div>
                        ))}
                      </div>

                      <AnimatePresence>
                        {formationCount >= 5 && (
                          <motion.div
                            className="aligned-overflow"
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.32 }}
                          >
                            <div className="aligned-overflow-avatars">
                              <motion.span
                                className="aligned-avatar"
                                initial={{ opacity: 0, scale: 0.72 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{
                                  type: 'spring',
                                  stiffness: 220,
                                  damping: 16,
                                }}
                              >
                                <img src={avatarUrl('52')} alt="Andre" />
                              </motion.span>

                              {formationCount >= 6 && (
                                <motion.span
                                  className="aligned-avatar"
                                  initial={{ opacity: 0, scale: 0.72, x: -8 }}
                                  animate={{ opacity: 1, scale: 1, x: 0 }}
                                  transition={{
                                    type: 'spring',
                                    stiffness: 220,
                                    damping: 16,
                                  }}
                                >
                                  <img src={avatarUrl('33')} alt="Alexis" />
                                </motion.span>
                              )}
                            </div>

                            <span className="aligned-overflow-copy">
                              <strong>
                                +{formationCount >= 6 ? 2 : 1} ALIGNED
                              </strong>
                              <small>
                                {formationCount >= 6
                                  ? 'Andre + Alexis joined the Signal'
                                  : 'Andre joined the Signal'}
                              </small>
                            </span>

                            <span className="aligned-overflow-more">
                              {formationCount >= 6 ? '6 PEOPLE' : '5 PEOPLE'}
                            </span>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <div className="formation-payoff">
                        <div className="formation-count">
                          <strong>{formationCount} / 6</strong>
                          <span>{formationMessage}</span>
                        </div>

                        <div className="formation-track">
                          <motion.div
                            initial={{ width: '0%' }}
                            animate={{ width: `${(formationCount / 6) * 100}%` }}
                            transition={{ duration: 0.55, ease: 'easeOut' }}
                          />
                        </div>

                        <AnimatePresence>
                          {formationCount === 6 && (
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
                                <strong>6 / 6 · SIGNAL FORMED</strong>
                                <small>
                                  6 people aligned · 92% group fit
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
          if (boredStatus === 'locked') {
            setSignalThreshold(true)
            return
          }

          setBored((value) => !value)
          setAccepted(false)
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
            {boredStatus === 'locked'
              ? 'SIGNAL LOCKED'
              : boredStatus === 'forming'
                ? 'SIGNAL IS FORMING...'
                : boredStatus === 'searching'
                  ? 'SIGNAL IS SEARCHING...'
                  : "I'M BORED"}
          </strong>

          <small>
            {boredStatus === 'locked'
              ? '6 people aligned · VIEW SIGNAL'
              : bored
                ? accepted
                  ? 'Compatible people are coming together.'
                  : 'React to whatever feels right.'
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
              {['8', '13', '15', '17', '22', '28'].map((id, index) => (
                <motion.img
                  key={id}
                  src={avatarUrl(id)}
                  alt=""
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
                />
              ))}
            </div>

            <motion.div
              className={[
                'threshold-copy',
                signalRoomStage !== 'arrival'
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
              <strong>6 PEOPLE · ONE PLAN</strong>
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

                <h2>{suggestion.emoji} {suggestion.title}</h2>

                <p>6 aligned · 92% group fit</p>

                <div className="room-avatar-row">
                  {['8', '13', '15', '17', '22', '28'].map((id) => (
                    <img
                      key={id}
                      src={avatarUrl(id)}
                      alt=""
                    />
                  ))}
                </div>

                <AnimatePresence mode="wait">
                  {signalRoomStage === 'arrival' ? (
                    <motion.div
                      key="signal-arrival"
                      className="room-next"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8, scale: 0.985 }}
                      transition={{ duration: 0.35 }}
                      onClick={() => setSignalRoomStage('places')}
                    >
                      <small>NEXT</small>
                      <strong>PICK THE PLACE</strong>
                      <span>→</span>
                    </motion.div>
                  ) : signalRoomStage === 'places' ? (
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
                      <SignalPlaceStage
                        signalId={suggestion.id}
                        signalLabel={suggestion.title}
                        onVenueLocked={(venue) => {
                          setLockedSignalVenue(venue)

                          window.setTimeout(() => {
                            setSignalRoomStage('time')
                          }, 5000)
                        }}
                      />
                    </motion.div>
                  ) : lockedSignalVenue ? (
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
                        signalLabel={suggestion.title}
                        venue={lockedSignalVenue}
                        onFindAnotherPlace={() => {
                          setLockedSignalVenue(null)
                          setSignalRoomStage('places')
                        }}
                        onPlanSetChange={setSignalPlanSetVisible}
                      />
                    </motion.div>
                  ) : null}
                </AnimatePresence>

                {!signalPlanSetVisible && (
                  <button
                    className="threshold-back"
                    onClick={() => {
                      setSignalThreshold(false)
                      setSignalRoomStage('arrival')
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

      <nav className="bottom-nav">
        <button className="nav-item active">
          <Compass size={20} />
          <span>Discover</span>
        </button>

        <button className="nav-item">
          <Sparkles size={20} />
          <span>Activity</span>
        </button>

        <button className="signal-center">
          <Zap size={27} fill="currentColor" />
        </button>

        <button className="nav-item">
          <MessageCircle size={20} />
          <span>Messages</span>
        </button>

        <button className="nav-item">
          <UserRound size={20} />
          <span>Profile</span>
        </button>
      </nav>
    </main>
  )
}

export default App
