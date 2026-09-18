import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  LoaderCircle,
  MapPin,
  Pencil,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import {
  getMyIdentityPhotos,
  getMyProfile,
  removeMyProfileStorageObjects,
  saveMyProfileWithIdentityGallery,
  uploadMyIdentityPhotoStorageObject,
  type MyIdentityPhoto,
  type MyProfile,
} from './profileClient'
import {
  createProfileAvatarSignedUrl,
  uploadMyProfileAvatar,
} from '../onboarding/avatarClient'
import {
  useUpdateSignalCurrentUser,
} from '../onboarding/components/signalCurrentUserContext'
import {
  getMySignalHistorySummary,
  type SignalHistorySummary,
} from './signalHistoryClient'
import SignalPreferencesPanel from './SignalPreferencesPanel'
import BlockedPeoplePanel from '../safety/BlockedPeoplePanel'
import MyConnectionsPanel from './MyConnectionsPanel'
import ProfileSignalLife from './ProfileSignalLife'
import './ProfileView.css'
import { toUserFacingError } from '../../lib/userFacingError'

const BIO_MAX_LENGTH = 120
const MAX_ADDITIONAL_PHOTOS = 5

type DraftProfile = {
  displayName: string
  avatarPath: string
  bio: string
}

type EditGalleryItem =
  | {
      kind: 'existing'
      key: string
      photo: MyIdentityPhoto
    }
  | {
      kind: 'new'
      key: string
      file: File
      previewUrl: string
    }

type ResolvedIdentityPhoto = MyIdentityPhoto & {
  signedUrl: string
}

function isStaleProfileSaveError(error: unknown): boolean {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('code' in error)
  ) {
    return false
  }

  return (
    (error as { code?: unknown }).code === 'P0001'
  )
}

function draftFromProfile(profile: MyProfile): DraftProfile {
  return {
    displayName: profile.displayName ?? '',
    avatarPath: profile.avatarPath ?? '',
    bio: profile.bio ?? '',
  }
}

function profileLocation(profile: MyProfile): string {
  const city = profile.cityName?.trim() ?? ''
  const state = profile.stateCode?.trim() ?? ''

  if (city && state) {
    return `${city}, ${state}`
  }

  return city || state || 'Home city unavailable'
}

function profileAge(profile: MyProfile): number | null {
  if (!profile.birthDate) {
    return null
  }

  const birthDate = new Date(`${profile.birthDate}T00:00:00`)

  if (Number.isNaN(birthDate.getTime())) {
    return null
  }

  const today = new Date()
  let age = today.getFullYear() - birthDate.getFullYear()

  const birthdayHasPassed =
    today.getMonth() > birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() &&
      today.getDate() >= birthDate.getDate())

  if (!birthdayHasPassed) {
    age -= 1
  }

  return age >= 0 ? age : null
}

export default function ProfileView({ onOpenDirectConversation }: { onOpenDirectConversation?: (conversationId: string) => void }) {
  const updateCurrentUser = useUpdateSignalCurrentUser()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const galleryInputRef = useRef<HTMLInputElement | null>(null)
  const stagedAvatarPreviewUrlRef = useRef<string | null>(null)
  const stagedGalleryPreviewUrlsRef = useRef<Set<string>>(
    new Set(),
  )

  const [profile, setProfile] = useState<MyProfile | null>(null)
  const [draft, setDraft] = useState<DraftProfile | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)

  const [identityPhotos, setIdentityPhotos] =
    useState<MyIdentityPhoto[]>([])
  const [editGalleryItems, setEditGalleryItems] =
    useState<EditGalleryItem[]>([])
  const [expectedGalleryObjectPaths, setExpectedGalleryObjectPaths] =
    useState<string[]>([])
  const [stagedAvatarFile, setStagedAvatarFile] =
    useState<File | null>(null)
  const [stagedAvatarPreviewUrl, setStagedAvatarPreviewUrl] =
    useState<string | null>(null)
  const [resolvedIdentityPhotos, setResolvedIdentityPhotos] =
    useState<ResolvedIdentityPhoto[]>([])
  const [galleryLoading, setGalleryLoading] = useState(true)
  const [uploadingGalleryPhoto, setUploadingGalleryPhoto] =
    useState(false)
  const [viewerIndex, setViewerIndex] =
    useState<number | null>(null)

  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [signalHistory, setSignalHistory] =
    useState<SignalHistorySummary | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadSignalHistory = async () => {
      try {
        const summary = await getMySignalHistorySummary()
        if (!cancelled) setSignalHistory(summary)
      } catch {
        if (!cancelled) setSignalHistory(null)
      }
    }

    void loadSignalHistory()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const stagedGalleryPreviewUrls =
      stagedGalleryPreviewUrlsRef.current

    return () => {
      if (stagedAvatarPreviewUrlRef.current) {
        URL.revokeObjectURL(
          stagedAvatarPreviewUrlRef.current,
        )
        stagedAvatarPreviewUrlRef.current = null
      }

      stagedGalleryPreviewUrls.forEach(
        (previewUrl) => {
          URL.revokeObjectURL(previewUrl)
        },
      )
      stagedGalleryPreviewUrls.clear()
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadProfile = async () => {
      setLoading(true)
      setGalleryLoading(true)
      setError(null)

      try {
        const [profileResult, galleryResult] = await Promise.all([
          getMyProfile(),
          getMyIdentityPhotos(),
        ])

        if (cancelled) {
          return
        }

        setProfile(profileResult)
        setDraft(draftFromProfile(profileResult))
        setIdentityPhotos(galleryResult)
        setEditGalleryItems(
          galleryResult.map((photo) => ({
            kind: 'existing' as const,
            key: photo.id,
            photo,
          })),
        )
        setExpectedGalleryObjectPaths(
          galleryResult.map((photo) => photo.objectPath),
        )
      } catch (loadError) {
        if (!cancelled) {
          setError(
            toUserFacingError(loadError, 'Unable to load your profile right now.'),
          )
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
          setGalleryLoading(false)
        }
      }
    }

    void loadProfile()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    if (editing && stagedAvatarPreviewUrl) {
      queueMicrotask(() => {
        if (!cancelled) {
          setAvatarUrl(stagedAvatarPreviewUrl)
        }
      })

      return () => {
        cancelled = true
      }
    }

    const avatarPath =
      editing
        ? draft?.avatarPath.trim() ?? ''
        : profile?.avatarPath?.trim() ?? ''

    if (!avatarPath) {
      queueMicrotask(() => {
        if (!cancelled) {
          setAvatarUrl(null)
        }
      })

      return () => {
        cancelled = true
      }
    }

    const resolveAvatar = async () => {
      try {
        const signedUrl =
          await createProfileAvatarSignedUrl(avatarPath)

        if (!cancelled) {
          setAvatarUrl(signedUrl)
        }
      } catch {
        if (!cancelled) {
          setAvatarUrl(null)
        }
      }
    }

    void resolveAvatar()

    return () => {
      cancelled = true
    }
  }, [
    draft?.avatarPath,
    editing,
    profile?.avatarPath,
    stagedAvatarPreviewUrl,
  ])

  useEffect(() => {
    let cancelled = false

    const resolveIdentityPhotos = async () => {
      const sourcePhotos = editing
        ? editGalleryItems
            .filter(
              (
                item,
              ): item is Extract<
                EditGalleryItem,
                { kind: 'existing' }
              > => item.kind === 'existing',
            )
            .map((item) => item.photo)
        : identityPhotos

      if (sourcePhotos.length === 0) {
        setResolvedIdentityPhotos([])
        return
      }

      try {
        const resolved = await Promise.all(
          sourcePhotos.map(async (photo) => ({
            ...photo,
            signedUrl:
              await createProfileAvatarSignedUrl(photo.objectPath),
          })),
        )

        if (!cancelled) {
          setResolvedIdentityPhotos(resolved)
        }
      } catch {
        if (!cancelled) {
          setResolvedIdentityPhotos([])
          setError('Unable to load your additional photos.')
        }
      }
    }

    void resolveIdentityPhotos()

    return () => {
      cancelled = true
    }
  }, [editGalleryItems, editing, identityPhotos])

  useEffect(() => {
    if (viewerIndex === null) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setViewerIndex(null)
        return
      }

      if (event.key === 'ArrowLeft') {
        setViewerIndex((current) => {
          if (current === null) {
            return null
          }

          const count = 1 + resolvedIdentityPhotos.length

          return (current - 1 + count) % count
        })
      }

      if (event.key === 'ArrowRight') {
        setViewerIndex((current) => {
          if (current === null) {
            return null
          }

          const count = 1 + resolvedIdentityPhotos.length

          return (current + 1) % count
        })
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [viewerIndex, resolvedIdentityPhotos.length])

  const beginEditing = () => {
    if (!profile) {
      return
    }

    setDraft(draftFromProfile(profile))
    setEditGalleryItems(
      identityPhotos.map((photo) => ({
        kind: 'existing' as const,
        key: photo.id,
        photo,
      })),
    )
    setExpectedGalleryObjectPaths(
      identityPhotos.map((photo) => photo.objectPath),
    )
    setStagedAvatarFile(null)
    setStagedAvatarPreviewUrl(null)
    setSaveMessage(null)
    setError(null)
    setEditing(true)
  }

  const cancelEditing = () => {
    if (
      !profile ||
      saving ||
      uploadingAvatar ||
      uploadingGalleryPhoto
    ) {
      return
    }

    editGalleryItems.forEach((item) => {
      if (item.kind === 'new') {
        URL.revokeObjectURL(item.previewUrl)
        stagedGalleryPreviewUrlsRef.current.delete(
          item.previewUrl,
        )
      }
    })

    if (stagedAvatarPreviewUrl) {
      URL.revokeObjectURL(stagedAvatarPreviewUrl)
      stagedAvatarPreviewUrlRef.current = null
    }

    setDraft(draftFromProfile(profile))
    setEditGalleryItems(
      identityPhotos.map((photo) => ({
        kind: 'existing' as const,
        key: photo.id,
        photo,
      })),
    )
    setExpectedGalleryObjectPaths(
      identityPhotos.map((photo) => photo.objectPath),
    )
    setStagedAvatarFile(null)
    setStagedAvatarPreviewUrl(null)
    setSaveMessage(null)
    setError(null)
    setEditing(false)
  }

  const handleAvatarSelection = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''

    if (!file || !draft) {
      return
    }

    setSaveMessage(null)
    setError(null)

    if (stagedAvatarPreviewUrl) {
      URL.revokeObjectURL(stagedAvatarPreviewUrl)
      stagedAvatarPreviewUrlRef.current = null
    }

    const previewUrl = URL.createObjectURL(file)
    stagedAvatarPreviewUrlRef.current = previewUrl
    setStagedAvatarFile(file)
    setStagedAvatarPreviewUrl(previewUrl)
  }

  const handleGallerySelection = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''

    if (files.length === 0) {
      return
    }

    const remaining =
      MAX_ADDITIONAL_PHOTOS - editGalleryItems.length

    if (remaining <= 0) {
      setError(
        'Your identity gallery already has five additional photos.',
      )
      return
    }

    const selected = files.slice(0, remaining)

    const staged: EditGalleryItem[] = selected.map(
      (file) => {
        const previewUrl = URL.createObjectURL(file)
        stagedGalleryPreviewUrlsRef.current.add(previewUrl)

        return {
          kind: 'new',
          key: crypto.randomUUID(),
          file,
          previewUrl,
        }
      },
    )

    setEditGalleryItems((current) => [
      ...current,
      ...staged,
    ])
    setSaveMessage(null)
    setError(null)
  }

  const removeEditGalleryItem = (key: string) => {
    if (
      saving ||
      uploadingAvatar ||
      uploadingGalleryPhoto
    ) {
      return
    }

    setEditGalleryItems((current) => {
      const target = current.find((item) => item.key === key)

      if (target?.kind === 'new') {
        URL.revokeObjectURL(target.previewUrl)
        stagedGalleryPreviewUrlsRef.current.delete(
          target.previewUrl,
        )
      }

      return current.filter((item) => item.key !== key)
    })

    setSaveMessage(null)
    setError(null)
  }

  const moveEditGalleryItem = (
    index: number,
    direction: -1 | 1,
  ) => {
    if (
      saving ||
      uploadingAvatar ||
      uploadingGalleryPhoto
    ) {
      return
    }

    setEditGalleryItems((current) => {
      const targetIndex = index + direction

      if (
        index < 0 ||
        index >= current.length ||
        targetIndex < 0 ||
        targetIndex >= current.length
      ) {
        return current
      }

      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(targetIndex, 0, item)
      return next
    })

    setSaveMessage(null)
    setError(null)
  }

  const saveProfile = async () => {
    if (
      !draft ||
      !profile ||
      saving ||
      uploadingAvatar ||
      uploadingGalleryPhoto
    ) {
      return
    }

    setSaving(true)
    setSaveMessage(null)
    setError(null)

    const uploadedObjectPaths: string[] = []
    let committed = false

    try {
      let avatarPath = draft.avatarPath

      if (stagedAvatarFile) {
        setUploadingAvatar(true)

        try {
          avatarPath =
            await uploadMyProfileAvatar(stagedAvatarFile)
          uploadedObjectPaths.push(avatarPath)
        } finally {
          setUploadingAvatar(false)
        }
      }

      const uploadedGalleryPathsByKey =
        new Map<string, string>()

      const newGalleryItems = editGalleryItems.filter(
        (
          item,
        ): item is Extract<
          EditGalleryItem,
          { kind: 'new' }
        > => item.kind === 'new',
      )

      if (newGalleryItems.length > 0) {
        setUploadingGalleryPhoto(true)

        try {
          for (const item of newGalleryItems) {
            const objectPath =
              await uploadMyIdentityPhotoStorageObject(
                item.file,
              )

            uploadedObjectPaths.push(objectPath)
            uploadedGalleryPathsByKey.set(
              item.key,
              objectPath,
            )
          }
        } finally {
          setUploadingGalleryPhoto(false)
        }
      }

      const desiredGalleryObjectPaths =
        editGalleryItems.map((item) => {
          if (item.kind === 'existing') {
            return item.photo.objectPath
          }

          const objectPath =
            uploadedGalleryPathsByKey.get(item.key)

          if (!objectPath) {
            throw new Error(
              'A staged profile photo was not uploaded.',
            )
          }

          return objectPath
        })

      const result =
        await saveMyProfileWithIdentityGallery({
          displayName: draft.displayName,
          avatarPath,
          bio: draft.bio,
          expectedGalleryObjectPaths,
          galleryObjectPaths:
            desiredGalleryObjectPaths,
        })

      committed = true

      const oldAvatarPath =
        profile.avatarPath?.trim() ?? ''

      const cleanupPaths = [
        ...result.removedObjectPaths,
        ...(oldAvatarPath &&
        oldAvatarPath !== result.profile.avatarPath
          ? [oldAvatarPath]
          : []),
      ]

      if (cleanupPaths.length > 0) {
        try {
          await removeMyProfileStorageObjects(
            cleanupPaths,
          )
        } catch (cleanupError) {
          console.error(
            'Profile saved but old Storage cleanup failed.',
            cleanupError,
          )
        }
      }

      editGalleryItems.forEach((item) => {
        if (item.kind === 'new') {
          URL.revokeObjectURL(item.previewUrl)
          stagedGalleryPreviewUrlsRef.current.delete(
            item.previewUrl,
          )
        }
      })

      if (stagedAvatarPreviewUrl) {
        URL.revokeObjectURL(stagedAvatarPreviewUrl)
        stagedAvatarPreviewUrlRef.current = null
      }

      setProfile(result.profile)
      setDraft(draftFromProfile(result.profile))
      setIdentityPhotos(result.identityPhotos)
      setEditGalleryItems(
        result.identityPhotos.map((photo) => ({
          kind: 'existing' as const,
          key: photo.id,
          photo,
        })),
      )
      setExpectedGalleryObjectPaths(
        result.identityPhotos.map(
          (photo) => photo.objectPath,
        ),
      )
      setStagedAvatarFile(null)
      setStagedAvatarPreviewUrl(null)
      updateCurrentUser(result.profile)
      setEditing(false)
      setSaveMessage('Profile updated.')
    } catch (saveError) {
      if (
        !committed &&
        uploadedObjectPaths.length > 0
      ) {
        try {
          await removeMyProfileStorageObjects(
            uploadedObjectPaths,
          )
        } catch (cleanupError) {
          console.error(
            'Unable to clean failed profile-save uploads.',
            cleanupError,
          )
        }
      }

      if (!committed && isStaleProfileSaveError(saveError)) {
        try {
          const [profileResult, galleryResult] =
            await Promise.all([
              getMyProfile(),
              getMyIdentityPhotos(),
            ])

          editGalleryItems.forEach((item) => {
            if (item.kind === 'new') {
              URL.revokeObjectURL(item.previewUrl)
              stagedGalleryPreviewUrlsRef.current.delete(
                item.previewUrl,
              )
            }
          })

          if (stagedAvatarPreviewUrl) {
            URL.revokeObjectURL(stagedAvatarPreviewUrl)
            stagedAvatarPreviewUrlRef.current = null
          }

          setProfile(profileResult)
          setDraft(draftFromProfile(profileResult))
          setIdentityPhotos(galleryResult)
          setEditGalleryItems(
            galleryResult.map((photo) => ({
              kind: 'existing' as const,
              key: photo.id,
              photo,
            })),
          )
          setExpectedGalleryObjectPaths(
            galleryResult.map(
              (photo) => photo.objectPath,
            ),
          )
          setStagedAvatarFile(null)
          setStagedAvatarPreviewUrl(null)
          updateCurrentUser(profileResult)

          setError(
            'Your profile changed elsewhere. We refreshed it—please review and try again.',
          )
          return
        } catch (refreshError) {
          console.error(
            'Unable to refresh profile after stale save.',
            refreshError,
          )
          setError(
            'Your profile changed elsewhere, but we could not refresh it. Please reload and try again.',
          )
          return
        }
      }

      setError(
        toUserFacingError(saveError, 'Unable to update your profile right now.'),
      )
    } finally {
      setSaving(false)
      setUploadingAvatar(false)
      setUploadingGalleryPhoto(false)
    }
  }

  if (loading) {
    return (
      <section className="profile-view profile-view-state">
        <LoaderCircle
          className="profile-view-spinner"
          size={28}
          aria-hidden="true"
        />
        <h1>Loading profile</h1>
        <p>Getting your SIGNAL identity.</p>
      </section>
    )
  }

  if (!profile || !draft) {
    return (
      <section className="profile-view profile-view-state">
        <UserRound size={34} aria-hidden="true" />
        <h1>Profile unavailable</h1>
        <p>{error ?? 'Your profile could not be loaded.'}</p>
      </section>
    )
  }

  const age = profileAge(profile)

  const viewerPhotos = [
    ...(avatarUrl
      ? [
          {
            id: 'primary',
            signedUrl: avatarUrl,
            label: 'Primary profile photo',
          },
        ]
      : []),
    ...resolvedIdentityPhotos.map((photo) => ({
      id: photo.id,
      signedUrl: photo.signedUrl,
      label: `Profile photo ${photo.position + 1}`,
    })),
  ]

  const activeViewerPhoto =
    viewerIndex !== null
      ? viewerPhotos[viewerIndex] ?? null
      : null

  const moveViewer = (direction: -1 | 1) => {
    if (viewerPhotos.length <= 1) {
      return
    }

    setViewerIndex((current) => {
      if (current === null) {
        return null
      }

      return (
        (current + direction + viewerPhotos.length) %
        viewerPhotos.length
      )
    })
  }

  return (
    <section className="profile-view">
      <header className="profile-view-heading">
        <div>
          <span className="profile-view-eyebrow">YOUR SIGNAL</span>
          <h1>Profile</h1>
          <p>
            The version of you people see before they decide to join the vibe.
          </p>
        </div>

        {!editing ? (
          <button
            type="button"
            className="profile-view-edit-button"
            onClick={beginEditing}
          >
            <Pencil size={16} aria-hidden="true" />
            Edit profile
          </button>
        ) : null}
      </header>

      <div className="profile-view-card">
        {!editing ? (
          <button type="button" className="profile-view-edit-button profile-view-edit-overlay" onClick={beginEditing}>
            <Pencil size={14} aria-hidden="true" /> Edit
          </button>
        ) : null}
        <div className="profile-view-identity">
          <div className="profile-view-avatar-shell">
            <button
              type="button"
              className="profile-view-avatar-viewer-button"
              onClick={() => {
                if (avatarUrl) {
                  setViewerIndex(0)
                }
              }}
              disabled={!avatarUrl}
              aria-label={
                viewerPhotos.length > 1
                  ? `Open profile photos, 1 of ${viewerPhotos.length}`
                  : 'Open profile photo'
              }
            >
              {avatarUrl ? (
                <img
                  className="profile-view-avatar"
                  src={avatarUrl}
                  alt={profile.displayName ?? 'Profile photo'}
                />
              ) : (
                <div className="profile-view-avatar profile-view-avatar-fallback">
                  <UserRound size={42} aria-hidden="true" />
                </div>
              )}

              {viewerPhotos.length > 1 ? (
                <span className="profile-view-avatar-count">
                  1/{viewerPhotos.length}
                </span>
              ) : null}
            </button>

            {editing ? (
              <>
                <button
                  type="button"
                  className="profile-view-avatar-action"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={
                    uploadingAvatar ||
                    saving ||
                    uploadingGalleryPhoto
                  }
                  aria-label="Choose a new profile photo"
                >
                  {uploadingAvatar ? (
                    <LoaderCircle
                      className="profile-view-spinner"
                      size={17}
                      aria-hidden="true"
                    />
                  ) : (
                    <Camera size={17} aria-hidden="true" />
                  )}
                </button>

                <input
                  ref={fileInputRef}
                  className="profile-view-file-input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleAvatarSelection}
                />
              </>
            ) : null}
          </div>

          <div className="profile-view-identity-copy">
            {editing ? (
              <label className="profile-view-field">
                <span>Display name</span>
                <input
                  value={draft.displayName}
                  maxLength={80}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      displayName: event.target.value,
                    })
                  }
                  disabled={saving}
                />
              </label>
            ) : (
              <>
                <div className="profile-view-name-line">
                  <h2>{profile.displayName}</h2>
                  {age !== null ? <span>{age}</span> : null}
                </div>

                <div className="profile-view-location">
                  <MapPin size={15} aria-hidden="true" />
                  <span>{profileLocation(profile)}</span>
                </div>
              </>
            )}

            <div className="profile-view-identity-bio">
              {editing ? (
                <>
                  <textarea value={draft.bio} maxLength={BIO_MAX_LENGTH} rows={2} placeholder="A quick line about you." onChange={(event) => setDraft({ ...draft, bio: event.target.value })} disabled={saving} />
                  <small>{draft.bio.length}/{BIO_MAX_LENGTH}</small>
                </>
              ) : <p>{profile.bio ?? 'Add a short bio.'}</p>}
            </div>
          </div>
        </div>

        {signalHistory ? (
          <div className="profile-view-clout" aria-label="Signal history">
            <div><strong>{signalHistory.signalsJoined}</strong><span>Signals</span></div>
            <div><strong>{signalHistory.completedMeetups}</strong><span>Meetups</span></div>
            <div><strong>{signalHistory.verifiedShowUps}</strong><span>Show-ups</span></div>
          </div>
        ) : null}

        <div className="profile-view-section profile-view-signal-life-section">
          <ProfileSignalLife />
        </div>

        {editing ? (<>
        <div className="profile-view-divider" />
        <div className="profile-view-section profile-view-gallery-section">
          <div className="profile-view-section-heading">
            <div>
              <span>THIS IS ME</span>
              <h3>More of you</h3>
            </div>

            <span className="profile-view-gallery-count">
              {editing
                ? editGalleryItems.length
                : identityPhotos.length}/{MAX_ADDITIONAL_PHOTOS}
            </span>
          </div>

          <p className="profile-view-gallery-copy">
            A few more photos help the group know who they’re meeting.
          </p>

          {galleryLoading ? (
            <div className="profile-view-gallery-loading">
              <LoaderCircle
                className="profile-view-spinner"
                size={18}
                aria-hidden="true"
              />
              Loading photos
            </div>
          ) : (
            <div className="profile-view-gallery-strip">
              {!editing
                ? resolvedIdentityPhotos.map((photo, index) => (
                    <div
                      className="profile-view-gallery-item"
                      key={photo.id}
                    >
                      <button
                        type="button"
                        className="profile-view-gallery-photo-button"
                        onClick={() =>
                          setViewerIndex(
                            avatarUrl ? index + 1 : index,
                          )
                        }
                        aria-label={`Open profile photo ${index + 2}`}
                      >
                        <img
                          src={photo.signedUrl}
                          alt={`Additional profile photo ${photo.position}`}
                        />
                      </button>
                    </div>
                  ))
                : editGalleryItems.map((item, index) => {
                    const existingResolved =
                      item.kind === 'existing'
                        ? resolvedIdentityPhotos.find(
                            (photo) =>
                              photo.id === item.photo.id,
                          )
                        : null

                    const imageUrl =
                      item.kind === 'new'
                        ? item.previewUrl
                        : existingResolved?.signedUrl ?? null

                    return (
                      <div
                        className="profile-view-gallery-item"
                        key={item.key}
                      >
                        <div className="profile-view-gallery-photo-button">
                          {imageUrl ? (
                            <img
                              src={imageUrl}
                              alt={`Additional profile photo ${index + 1}`}
                            />
                          ) : (
                            <div className="profile-view-gallery-loading">
                              <LoaderCircle
                                className="profile-view-spinner"
                                size={18}
                                aria-hidden="true"
                              />
                            </div>
                          )}
                        </div>

                        <div className="profile-view-gallery-order-actions">
                          <button
                            type="button"
                            className="profile-view-gallery-order-button"
                            onClick={() =>
                              moveEditGalleryItem(index, -1)
                            }
                            disabled={
                              index === 0 ||
                              saving ||
                              uploadingGalleryPhoto ||
                              uploadingAvatar
                            }
                            aria-label={`Move profile photo ${index + 1} left`}
                          >
                            <ChevronLeft size={14} aria-hidden="true" />
                          </button>

                          <button
                            type="button"
                            className="profile-view-gallery-order-button"
                            onClick={() =>
                              moveEditGalleryItem(index, 1)
                            }
                            disabled={
                              index ===
                                editGalleryItems.length - 1 ||
                              saving ||
                              uploadingGalleryPhoto ||
                              uploadingAvatar
                            }
                            aria-label={`Move profile photo ${index + 1} right`}
                          >
                            <ChevronRight size={14} aria-hidden="true" />
                          </button>
                        </div>

                        <button
                          type="button"
                          className="profile-view-gallery-remove"
                            onClick={() =>
                              removeEditGalleryItem(item.key)
                            }
                            disabled={
                              saving ||
                              uploadingGalleryPhoto ||
                              uploadingAvatar
                            }
                            aria-label={`Remove profile photo ${index + 1}`}
                          >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </div>
                    )
                  })}

              {editing &&
              editGalleryItems.length <
                MAX_ADDITIONAL_PHOTOS ? (
                <button
                  type="button"
                  className="profile-view-gallery-add"
                  onClick={() =>
                    galleryInputRef.current?.click()
                  }
                  disabled={
                    uploadingGalleryPhoto ||
                    saving ||
                    uploadingAvatar
                  }
                >
                  {uploadingGalleryPhoto ? (
                    <LoaderCircle
                      className="profile-view-spinner"
                      size={20}
                      aria-hidden="true"
                    />
                  ) : (
                    <ImagePlus size={22} aria-hidden="true" />
                  )}
                  <span>Add photo</span>
                </button>
              ) : null}

              {!editing &&
              resolvedIdentityPhotos.length === 0 ? (
                <div className="profile-view-gallery-empty">
                  <ImagePlus size={22} aria-hidden="true" />
                  <span>
                    Add more photos when you edit your profile.
                  </span>
                </div>
              ) : null}
            </div>
          )}

          <input
            ref={galleryInputRef}
            className="profile-view-file-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={handleGallerySelection}
          />
        </div>
        </>) : null}

        {editing ? (<>
          <div className="profile-view-divider" />
          <div className="profile-view-section profile-view-private-matching">
            <SignalPreferencesPanel />
          </div>
        </>) : null}

        <div className="profile-view-divider" />
        <div className="profile-view-section">
          <MyConnectionsPanel onOpenDirectConversation={onOpenDirectConversation} />
        </div>

        <div className="profile-view-divider" />
        <div className="profile-view-section">
          <BlockedPeoplePanel />
        </div>

        {error ? (
          <div className="profile-view-feedback profile-view-feedback-error">
            {error}
          </div>
        ) : null}

        {saveMessage ? (
          <div className="profile-view-feedback profile-view-feedback-success">
            <Check size={16} aria-hidden="true" />
            {saveMessage}
          </div>
        ) : null}

        {editing ? (
          <div className="profile-view-actions">
            <button
              type="button"
              className="profile-view-secondary-button"
              onClick={cancelEditing}
              disabled={
                saving ||
                uploadingAvatar ||
                uploadingGalleryPhoto
              }
            >
              Cancel
            </button>

            <button
              type="button"
              className="profile-view-primary-button"
              onClick={() => void saveProfile()}
              disabled={
                saving ||
                uploadingAvatar ||
                uploadingGalleryPhoto
              }
            >
              {saving ? (
                <>
                  <LoaderCircle
                    className="profile-view-spinner"
                    size={17}
                    aria-hidden="true"
                  />
                  Saving
                </>
              ) : (
                'Save changes'
              )}
            </button>
          </div>
        ) : null}
      </div>

      <p className="profile-view-protected-note">
        Age, gender, and home city are protected account details and are not
        changed from this profile editor.
      </p>

      {activeViewerPhoto ? (
        <div
          className="profile-view-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Profile photos"
        >
          <button
            type="button"
            className="profile-view-lightbox-backdrop"
            onClick={() => setViewerIndex(null)}
            aria-label="Close profile photos"
          />

          <div className="profile-view-lightbox-panel">
            <button
              type="button"
              className="profile-view-lightbox-close"
              onClick={() => setViewerIndex(null)}
              aria-label="Close profile photos"
            >
              <X size={21} aria-hidden="true" />
            </button>

            <img
              className="profile-view-lightbox-image"
              src={activeViewerPhoto.signedUrl}
              alt={activeViewerPhoto.label}
            />

            {viewerPhotos.length > 1 ? (
              <>
                <button
                  type="button"
                  className="profile-view-lightbox-nav profile-view-lightbox-nav-left"
                  onClick={() => moveViewer(-1)}
                  aria-label="Previous profile photo"
                >
                  <ChevronLeft size={25} aria-hidden="true" />
                </button>

                <button
                  type="button"
                  className="profile-view-lightbox-nav profile-view-lightbox-nav-right"
                  onClick={() => moveViewer(1)}
                  aria-label="Next profile photo"
                >
                  <ChevronRight size={25} aria-hidden="true" />
                </button>

                <div className="profile-view-lightbox-count">
                  {(viewerIndex ?? 0) + 1}/{viewerPhotos.length}
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}
