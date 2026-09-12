import {
  CalendarClock,
  Clock3,
  RefreshCw,
  Radio,
  Users,
  Zap,
} from 'lucide-react'
import { motion } from 'framer-motion'
import type { ActivityItem } from './activityClient'
import './ActivityView.css'

type ActivityViewProps = {
  items: ActivityItem[]
  loading: boolean
  error: string | null
  onRefresh: () => void | Promise<void>
}

function formatState(value: string): string {
  return value
    .replaceAll('_', ' ')
    .toUpperCase()
}

function formatDateTime(value: string | null): string | null {
  if (!value) return null

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function getPrimaryTime(item: ActivityItem): string | null {
  return formatDateTime(
    item.itemType === 'plan'
      ? item.scheduledStartsAt
      : item.startsAt,
  )
}

function getItemLabel(item: ActivityItem): string {
  return item.itemType === 'signal'
    ? 'LIVE SIGNAL'
    : 'SIGNAL PLAN'
}

function getMembershipLabel(item: ActivityItem): string {
  if (item.itemType === 'signal' && item.isActiveCore) {
    return 'ACTIVE CORE'
  }

  if (item.itemType === 'plan' && item.isActiveCore) {
    return 'LOCKED MEMBER'
  }

  return formatState(item.membershipState)
}

function ActivityCard({
  item,
  index,
}: {
  item: ActivityItem
  index: number
}) {
  const primaryTime = getPrimaryTime(item)

  return (
    <motion.article
      className={`activity-card activity-card-${item.itemType}`}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.045 }}
    >
      <div className="activity-card-rail" aria-hidden="true">
        <span />
      </div>

      <div className="activity-card-top">
        <span className="activity-kind">
          {item.itemType === 'signal' ? (
            <Radio size={13} />
          ) : (
            <Zap size={13} fill="currentColor" />
          )}
          {getItemLabel(item)}
        </span>

        <span className="activity-state">
          {formatState(item.lifecycleState)}
        </span>
      </div>

      <div className="activity-card-main">
        <div className="activity-bolt" aria-hidden="true">
          <Zap size={18} fill="currentColor" />
        </div>

        <div className="activity-card-copy">
          <h2>{item.activityName}</h2>

          <div className="activity-membership">
            <Users size={14} />
            <span>{getMembershipLabel(item)}</span>
          </div>
        </div>
      </div>

      <div className="activity-card-meta">
        {primaryTime ? (
          <div>
            <Clock3 size={15} />
            <span>{primaryTime}</span>
          </div>
        ) : (
          <div>
            <CalendarClock size={15} />
            <span>TIME NOT LOCKED YET</span>
          </div>
        )}
      </div>
    </motion.article>
  )
}

export default function ActivityView({
  items,
  loading,
  error,
  onRefresh,
}: ActivityViewProps) {
  return (
    <section className="activity-view">
      <header className="activity-view-header">
        <div>
          <span className="activity-eyebrow">
            <Zap size={13} fill="currentColor" />
            ACTIVITY
          </span>

          <h1>Your Signal</h1>

          <p>
            What you’re part of right now.
          </p>
        </div>

        <button
          type="button"
          className="activity-refresh"
          onClick={() => void onRefresh()}
          disabled={loading}
          aria-label="Refresh Activity"
        >
          <RefreshCw
            size={17}
            className={loading ? 'is-spinning' : undefined}
          />
        </button>
      </header>

      {loading && items.length === 0 ? (
        <div className="activity-status-card">
          <div className="activity-status-bolt">
            <Zap size={19} fill="currentColor" />
          </div>
          <strong>CHECKING YOUR SIGNAL…</strong>
          <span>Finding what you’re part of right now.</span>
        </div>
      ) : null}

      {error ? (
        <div
          className="activity-status-card activity-status-error"
          role="status"
        >
          <strong>ACTIVITY COULDN’T LOAD</strong>
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void onRefresh()}
          >
            TRY AGAIN
          </button>
        </div>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <div className="activity-status-card activity-status-empty">
          <div className="activity-status-bolt">
            <Zap size={19} fill="currentColor" />
          </div>
          <strong>NO ACTIVE SIGNAL YET</strong>
          <span>
            When you join a Signal or lock a Plan, it’ll live here.
          </span>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="activity-list">
          {items.map((item, index) => (
            <ActivityCard
              key={`${item.itemType}-${item.itemId}`}
              item={item}
              index={index}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}
