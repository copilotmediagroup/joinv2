import { useRef, useState, type FormEvent } from 'react'
import {
  signInWithPassword,
  signUpWithPassword,
} from '../../auth/authClient'
import { toUserFacingError } from '../../../lib/userFacingError'

type AuthMode = 'sign-in' | 'sign-up'

type AuthGateViewProps = {
  onAuthSuccess?: () => void | Promise<void>
}

export function AuthGateView({
  onAuthSuccess,
}: AuthGateViewProps) {
  const [mode, setMode] = useState<AuthMode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const submitRequestRef = useRef(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (submitRequestRef.current) return

    const normalizedEmail = email.trim()

    if (!normalizedEmail || !password) {
      setMessage('Enter your email and password.')
      return
    }

    submitRequestRef.current = true
    setSubmitting(true)
    setMessage(null)

    try {
      if (mode === 'sign-in') {
        await signInWithPassword(normalizedEmail, password)
        await onAuthSuccess?.()
        return
      }

      const result = await signUpWithPassword(
        normalizedEmail,
        password,
      )

      if (result.session) {
        await onAuthSuccess?.()
        return
      }

      setMessage(
        'Check your email to finish creating your account.',
      )
    } catch (error) {
      setMessage(
        toUserFacingError(error, 'SIGNAL could not complete that request. Please try again.'),
      )
    } finally {
      submitRequestRef.current = false
      setSubmitting(false)
    }
  }

  function switchMode(nextMode: AuthMode) {
    if (submitting) return

    setMode(nextMode)
    setMessage(null)
  }

  return (
    <main className="signal-access-shell">
      <section className="signal-access-card">
        <div className="signal-access-brand">
          <div className="signal-access-mark" aria-hidden="true">
            ⚡
          </div>

          <div>
            <div className="signal-access-kicker">SIGNAL</div>
            <h1>What are you feeling?</h1>
            <p>
              Choose the energy. SIGNAL figures out your crowd.
            </p>
          </div>
        </div>

        <div
          className="signal-access-tabs"
          role="tablist"
          aria-label="Account access"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'sign-in'}
            className={
              mode === 'sign-in'
                ? 'signal-access-tab is-active'
                : 'signal-access-tab'
            }
            onClick={() => switchMode('sign-in')}
          >
            Sign in
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={mode === 'sign-up'}
            className={
              mode === 'sign-up'
                ? 'signal-access-tab is-active'
                : 'signal-access-tab'
            }
            onClick={() => switchMode('sign-up')}
          >
            Create account
          </button>
        </div>

        <form
          className="signal-access-form"
          onSubmit={handleSubmit}
        >
          <label className="signal-access-field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              disabled={submitting}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>

          <label className="signal-access-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={
                mode === 'sign-in'
                  ? 'current-password'
                  : 'new-password'
              }
              value={password}
              disabled={submitting}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Your password"
              minLength={6}
              required
            />
          </label>

          {message ? (
            <div
              className="signal-access-message"
              role="status"
            >
              {message}
            </div>
          ) : null}

          <button
            type="submit"
            className="signal-access-primary"
            disabled={submitting}
          >
            {submitting
              ? 'Working…'
              : mode === 'sign-in'
                ? 'ENTER SIGNAL'
                : 'CREATE ACCOUNT'}
          </button>
        </form>

        <p className="signal-access-footnote">
          Real plans. Real people. Real life.
        </p>
      </section>
    </main>
  )
}
