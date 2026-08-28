import {
  ArrowLeft,
  Clock3,
  MapPin,
  MessageCircle,
  Send,
  Users,
  Zap,
} from 'lucide-react'
import './SignalPlanExperience.css'

export type SignalPlanView = 'plan' | 'chat'

export type SignalPlanExperienceProps = {
  view: SignalPlanView
  signalLabel: string
  venueName: string
  venueAddress: string
  venuePhotoUrl: string | null
  meetupTime: string
  onOpenPlan: () => void
  onOpenChat: () => void
}

const members = [
  { id: '8', name: 'YOU' },
  { id: '13', name: 'MAYA' },
  { id: '15', name: 'JORDAN' },
  { id: '17', name: 'CHRIS' },
  { id: '22', name: 'ALEX' },
  { id: '28', name: 'TAYLOR' },
]

const avatarUrl = (id: string) =>
  `https://i.pravatar.cc/100?img=${id}`

export default function SignalPlanExperience({
  view,
  signalLabel,
  venueName,
  venueAddress,
  venuePhotoUrl,
  meetupTime,
  onOpenPlan,
  onOpenChat,
}: SignalPlanExperienceProps) {
  if (view === 'chat') {
    return (
      <section className="signal-post-shell">
        <header className="signal-post-header">
          <button
            type="button"
            className="signal-post-back"
            onClick={onOpenPlan}
          >
            <ArrowLeft size={17} />
            PLAN
          </button>

          <div>
            <span>⚡ SIGNAL GROUP</span>
            <strong>{venueName}</strong>
          </div>

          <div className="signal-post-live">
            <span />
            LIVE
          </div>
        </header>

        <div className="signal-chat-members">
          {members.slice(0, 4).map((member) => (
            <img
              key={member.id}
              src={avatarUrl(member.id)}
              alt=""
            />
          ))}
          <span>+2</span>
        </div>

        <div className="signal-chat-feed">
          <div className="signal-chat-system">
            <Zap size={15} fill="currentColor" />
            <div>
              <strong>YOUR SIGNAL IS LOCKED</strong>
              <span>
                {venueName} · {meetupTime}
              </span>
            </div>
          </div>

          <div className="signal-chat-message">
            <img src={avatarUrl('13')} alt="" />
            <div>
              <small>MAYA</small>
              <p>See everybody there ⚡</p>
            </div>
          </div>

          <div className="signal-chat-message">
            <img src={avatarUrl('17')} alt="" />
            <div>
              <small>CHRIS</small>
              <p>I’m heading out in a few.</p>
            </div>
          </div>
        </div>

        <div className="signal-chat-compose">
          <input
            aria-label="Message group"
            placeholder="Message the group..."
          />
          <button type="button" aria-label="Send message">
            <Send size={18} />
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="signal-post-shell">
      <header className="signal-post-header">
        <div
          className="signal-post-back signal-post-locked-origin"
          aria-label="Signal plan locked"
        >
          <Zap size={15} fill="currentColor" />
          PLAN LOCKED
        </div>

        <div>
          <span>⚡ SIGNAL PLAN</span>
          <strong>{signalLabel}</strong>
        </div>

        <div className="signal-post-live">
          <span />
          LOCKED
        </div>
      </header>

      {venuePhotoUrl && (
        <div className="signal-plan-hero">
          <img src={venuePhotoUrl} alt={venueName} />
          <div className="signal-plan-hero-shade" />
          <div className="signal-plan-hero-copy">
            <span>⚡ IT’S HAPPENING</span>
            <h2>{venueName}</h2>
            <p>{venueAddress}</p>
          </div>
        </div>
      )}

      <div className="signal-plan-facts">
        <div>
          <MapPin size={18} />
          <span>
            <small>PLACE</small>
            <strong>{venueName}</strong>
          </span>
        </div>

        <div>
          <Clock3 size={18} />
          <span>
            <small>MEETUP</small>
            <strong>{meetupTime}</strong>
          </span>
        </div>

        <div>
          <Users size={18} />
          <span>
            <small>GROUP</small>
            <strong>6 PEOPLE</strong>
          </span>
        </div>
      </div>

      <div className="signal-plan-rail">
        <div className="signal-plan-rail-heading">
          <span>⚡ SIGNAL LIVE</span>
          <strong>WHO’S IN</strong>
        </div>

        {members.slice(0, 4).map((member, index) => (
          <div
            className="signal-plan-person"
            key={member.id}
            style={{ '--rail-index': index } as React.CSSProperties}
          >
            <img src={avatarUrl(member.id)} alt="" />
            <div>
              <strong>{member.name}</strong>
              <span>LOCKED IN</span>
            </div>
            <Zap size={14} fill="currentColor" />
          </div>
        ))}

        <div className="signal-plan-overflow">
          <img src={avatarUrl('22')} alt="" />
          <img src={avatarUrl('28')} alt="" />
          <strong>+2</strong>
          <span>MORE ARE IN</span>
        </div>
      </div>

      <button
        type="button"
        className="signal-plan-chat-action"
        onClick={onOpenChat}
      >
        <MessageCircle size={18} />
        OPEN GROUP CHAT
      </button>
    </section>
  )
}
