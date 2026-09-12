import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import {
  completeMyOnboarding,
  type OnboardingState,
} from '../onboardingClient'
import {
  uploadMyProfileAvatar,
} from '../avatarClient'
import {
  searchOnboardingCities,
  type OnboardingCityOption,
} from '../cityClient'

type Gender = 'male' | 'female'

type OnboardingGateViewProps = {
  initialState: OnboardingState | null
  onComplete: (
    state: OnboardingState,
  ) => void | Promise<void>
}

export function OnboardingGateView({
  initialState,
  onComplete,
}: OnboardingGateViewProps) {
  const [displayName, setDisplayName] = useState(
    initialState?.displayName ?? '',
  )
  const [birthDate, setBirthDate] = useState(
    initialState?.birthDate ?? '',
  )
  const [gender, setGender] = useState<Gender | ''>(
    initialState?.gender ?? '',
  )

  const [cityQuery, setCityQuery] = useState(() => {
    if (!initialState?.cityName) return ''

    return initialState.stateCode
      ? `${initialState.cityName}, ${initialState.stateCode}`
      : initialState.cityName
  })

  const [selectedCity, setSelectedCity] =
    useState<OnboardingCityOption | null>(() => {
      if (
        !initialState?.homeCityId ||
        !initialState.cityName ||
        !initialState.stateCode ||
        !initialState.stateName
      ) {
        return null
      }

      return {
        id: initialState.homeCityId,
        cityName: initialState.cityName,
        citySlug: initialState.citySlug ?? '',
        stateCode: initialState.stateCode,
        stateName: initialState.stateName,
      }
    })

  const [cityResults, setCityResults] = useState<
    OnboardingCityOption[]
  >([])
  const [citySearching, setCitySearching] = useState(false)

  const [avatarFile, setAvatarFile] =
    useState<File | null>(null)
  const [avatarPreviewUrl, setAvatarPreviewUrl] =
    useState<string | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const citySearchSequence = useRef(0)

  useEffect(() => {
    return () => {
      if (avatarPreviewUrl) {
        URL.revokeObjectURL(avatarPreviewUrl)
      }
    }
  }, [avatarPreviewUrl])

  useEffect(() => {
    const query = cityQuery.trim()

    if (
      selectedCity &&
      query ===
        `${selectedCity.cityName}, ${selectedCity.stateCode}`
    ) {
      citySearchSequence.current += 1
      return
    }

    if (query.length < 2) {
      citySearchSequence.current += 1
      return
    }

    const sequence = ++citySearchSequence.current

    const timer = window.setTimeout(async () => {
      setCitySearching(true)

      try {
        const results = await searchOnboardingCities(query)

        if (sequence === citySearchSequence.current) {
          setCityResults(results)
        }
      } catch (error) {
        if (sequence === citySearchSequence.current) {
          setCityResults([])
          setMessage(
            error instanceof Error
              ? error.message
              : 'City search is unavailable right now.',
          )
        }
      } finally {
        if (sequence === citySearchSequence.current) {
          setCitySearching(false)
        }
      }
    }, 250)

    return () => window.clearTimeout(timer)
  }, [cityQuery, selectedCity])

  const selectedCityLabel = useMemo(() => {
    if (!selectedCity) return null

    return `${selectedCity.cityName}, ${selectedCity.stateCode}`
  }, [selectedCity])

  function handleAvatarChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0] ?? null

    if (!file) return

    try {
      const allowedTypes = new Set([
        'image/jpeg',
        'image/png',
        'image/webp',
      ])

      if (!allowedTypes.has(file.type)) {
        throw new Error(
          'Avatar must be a JPEG, PNG, or WebP image.',
        )
      }

      if (file.size <= 0) {
        throw new Error('Avatar file is empty.')
      }

      if (file.size > 5 * 1024 * 1024) {
        throw new Error('Avatar must be 5 MB or smaller.')
      }

      if (avatarPreviewUrl) {
        URL.revokeObjectURL(avatarPreviewUrl)
      }

      setAvatarFile(file)
      setAvatarPreviewUrl(URL.createObjectURL(file))
      setMessage(null)
    } catch (error) {
      event.target.value = ''
      setAvatarFile(null)

      if (avatarPreviewUrl) {
        URL.revokeObjectURL(avatarPreviewUrl)
      }

      setAvatarPreviewUrl(null)
      setMessage(
        error instanceof Error
          ? error.message
          : 'Choose a valid profile photo.',
      )
    }
  }

  function chooseCity(city: OnboardingCityOption) {
    citySearchSequence.current += 1
    setSelectedCity(city)
    setCityQuery(`${city.cityName}, ${city.stateCode}`)
    setCityResults([])
    setCitySearching(false)
    setMessage(null)
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    if (submitting) return

    if (!selectedCity) {
      setMessage('Choose your city.')
      return
    }

    if (!gender) {
      setMessage('Choose your gender.')
      return
    }

    setSubmitting(true)
    setMessage(null)

    try {
      let avatarPath = initialState?.avatarPath ?? null

      if (avatarFile) {
        avatarPath = await uploadMyProfileAvatar(
          avatarFile,
        )
      }

      if (!avatarPath) {
        throw new Error('Add a profile photo.')
      }

      const completed = await completeMyOnboarding({
        displayName,
        avatarPath,
        birthDate,
        gender,
        homeCityId: selectedCity.id,
      })

      await onComplete(completed)
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'SIGNAL could not finish your profile.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="signal-access-shell">
      <section className="signal-access-card signal-onboarding-card">
        <div className="signal-access-brand">
          <div className="signal-access-mark" aria-hidden="true">
            ⚡
          </div>

          <div>
            <div className="signal-access-kicker">
              YOUR SIGNAL
            </div>
            <h1>Set your home base.</h1>
            <p>
              A few details help SIGNAL put you with the right
              crowd in your city.
            </p>
          </div>
        </div>

        <form
          className="signal-access-form"
          onSubmit={handleSubmit}
        >
          <div className="signal-avatar-setup">
            <label className="signal-avatar-picker">
              {avatarPreviewUrl ? (
                <img
                  src={avatarPreviewUrl}
                  alt="Profile preview"
                />
              ) : (
                <span aria-hidden="true">+</span>
              )}

              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={submitting}
                onChange={handleAvatarChange}
              />
            </label>

            <div>
              <strong>Profile photo</strong>
              <span>JPEG, PNG or WebP · up to 5 MB</span>
            </div>
          </div>

          <label className="signal-access-field">
            <span>What should we call you?</span>
            <input
              type="text"
              autoComplete="name"
              maxLength={80}
              value={displayName}
              disabled={submitting}
              onChange={(event) =>
                setDisplayName(event.target.value)
              }
              placeholder="Display name"
              required
            />
          </label>

          <label className="signal-access-field">
            <span>Birthday</span>
            <input
              type="date"
              value={birthDate}
              disabled={submitting}
              onChange={(event) =>
                setBirthDate(event.target.value)
              }
              required
            />
          </label>

          <fieldset className="signal-choice-field">
            <legend>Gender</legend>

            <div className="signal-choice-grid">
              <button
                type="button"
                className={
                  gender === 'male'
                    ? 'signal-choice is-active'
                    : 'signal-choice'
                }
                disabled={submitting}
                onClick={() => setGender('male')}
              >
                Male
              </button>

              <button
                type="button"
                className={
                  gender === 'female'
                    ? 'signal-choice is-active'
                    : 'signal-choice'
                }
                disabled={submitting}
                onClick={() => setGender('female')}
              >
                Female
              </button>
            </div>
          </fieldset>

          <div className="signal-city-field">
            <label className="signal-access-field">
              <span>Home city</span>
              <input
                type="search"
                autoComplete="off"
                value={cityQuery}
                disabled={submitting}
                onChange={(event) => {
                  citySearchSequence.current += 1
                  setCityQuery(event.target.value)
                  setSelectedCity(null)
                  setCityResults([])
                  if (event.target.value.trim().length < 2) {
                    setCitySearching(false)
                  }
                  setMessage(null)
                }}
                placeholder="Start typing your city"
                required
              />
            </label>

            {citySearching ? (
              <div className="signal-city-status">
                Finding cities…
              </div>
            ) : null}

            {cityResults.length > 0 ? (
              <div
                className="signal-city-results"
                role="listbox"
                aria-label="City results"
              >
                {cityResults.map((city) => (
                  <button
                    key={city.id}
                    type="button"
                    role="option"
                    aria-selected={
                      selectedCity?.id === city.id
                    }
                    onClick={() => chooseCity(city)}
                  >
                    <strong>{city.cityName}</strong>
                    <span>
                      {city.stateName} · {city.stateCode}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            {selectedCityLabel ? (
              <div className="signal-city-selected">
                <span aria-hidden="true">⚡</span>
                {selectedCityLabel}
              </div>
            ) : null}
          </div>

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
              ? 'SETTING YOUR SIGNAL…'
              : 'ENTER SIGNAL'}
          </button>
        </form>
      </section>
    </main>
  )
}
