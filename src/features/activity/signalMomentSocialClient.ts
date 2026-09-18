import { supabase } from '../../lib/supabaseClient'
import { createProfileAvatarSignedUrl } from '../onboarding/avatarClient'

export type SignalMomentComment = {
  commentId: string
  parentCommentId: string | null
  authorUserId: string
  authorDisplayName: string
  authorAvatarUrl: string | null
  body: string
  createdAt: string
  isMine: boolean
}

type CommentRow = {
  comment_id: unknown
  parent_comment_id: unknown
  author_user_id: unknown
  author_display_name: unknown
  author_avatar_path: unknown
  body: unknown
  created_at: unknown
  is_mine: unknown
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid Moment social response: ${field}`)
  return value
}

export async function toggleMomentSignal(momentId: string) {
  const { data, error } = await supabase.rpc('toggle_signal_moment_signal', { p_moment_id: momentId })
  if (error) throw new Error(error.message || 'Unable to Signal this Moment.')
  const row = Array.isArray(data) ? data[0] : null
  if (!row || typeof row.signaled !== 'boolean' || typeof row.signal_count !== 'number') {
    throw new Error('Invalid Moment Signal response.')
  }
  return { signaled: row.signaled, signalCount: row.signal_count }
}

export async function addMomentComment(momentId: string, body: string, parentCommentId: string | null = null) {
  const { error } = await supabase.rpc('add_signal_moment_comment', {
    p_moment_id: momentId, p_body: body, p_parent_comment_id: parentCommentId,
  })
  if (error) throw new Error(error.message || 'Unable to add comment.')
}

export async function deleteMyMomentComment(commentId: string) {
  const { error } = await supabase.rpc('delete_my_signal_moment_comment', { p_comment_id: commentId })
  if (error) throw new Error(error.message || 'Unable to delete comment.')
}

export async function getMomentComments(momentId: string): Promise<SignalMomentComment[]> {
  const { data, error } = await supabase.rpc('get_signal_moment_comments', { p_moment_id: momentId })
  if (error) throw new Error(error.message || 'Unable to load comments.')
  if (!Array.isArray(data)) throw new Error('Invalid Moment comments response.')
  return Promise.all(data.map(async (raw) => {
    const row = raw as CommentRow
    const avatarPath = row.author_avatar_path === null ? null : text(row.author_avatar_path, 'avatar')
    return {
      commentId: text(row.comment_id, 'comment_id'),
      parentCommentId: row.parent_comment_id === null ? null : text(row.parent_comment_id, 'parent_comment_id'),
      authorUserId: text(row.author_user_id, 'author_user_id'),
      authorDisplayName: text(row.author_display_name, 'author_display_name'),
      authorAvatarUrl: avatarPath ? await createProfileAvatarSignedUrl(avatarPath).catch(() => null) : null,
      body: text(row.body, 'body'),
      createdAt: text(row.created_at, 'created_at'),
      isMine: row.is_mine === true,
    }
  }))
}
