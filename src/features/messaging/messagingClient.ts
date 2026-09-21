import { supabase } from '../../lib/supabaseClient'

export type PlanConversation = {
  conversationId: string
  planId: string
  createdAt: string
}

export type PlanMessage = {
  messageId: string
  conversationId: string
  senderUserId: string
  body: string
  sentAt: string
}

type SendPlanMessageRpcRow = {
  message_id: unknown
  conversation_id: unknown
  sender_user_id: unknown
  body: unknown
  sent_at: unknown
}

function requireString(
  value: unknown,
  field: string,
): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0
  ) {
    throw new Error(
      `Invalid messaging response: ${field}`,
    )
  }

  return value
}

function parseSendPlanMessageRow(
  row: SendPlanMessageRpcRow,
): PlanMessage {
  return {
    messageId: requireString(
      row.message_id,
      'message id',
    ),
    conversationId: requireString(
      row.conversation_id,
      'conversation id',
    ),
    senderUserId: requireString(
      row.sender_user_id,
      'sender user id',
    ),
    body: requireString(
      row.body,
      'message body',
    ),
    sentAt: requireString(
      row.sent_at,
      'message sent at',
    ),
  }
}

export const PLAN_CONVERSATION_PAGE_SIZE = 30

type PlanConversationCursor = {
  createdAt: string
  conversationId: string
}

function parseConversationRpcRow(row: Record<string, unknown>): PlanConversation {
  return {
    conversationId: requireString(row.conversation_id, 'conversation id'),
    planId: requireString(row.plan_id, 'plan id'),
    createdAt: requireString(row.created_at, 'conversation created at'),
  }
}

export async function getMyPlanConversationsPage(
  cursor: PlanConversationCursor | null = null,
): Promise<PlanConversation[]> {
  const { data, error } = await supabase.rpc('get_my_plan_conversations_page', {
    p_after_created_at: cursor?.createdAt ?? null,
    p_after_conversation_id: cursor?.conversationId ?? null,
    p_limit: PLAN_CONVERSATION_PAGE_SIZE,
  })

  if (error) throw new Error(error.message || 'Unable to load conversations.')
  if (!Array.isArray(data)) throw new Error('Invalid conversations response.')
  return (data as Record<string, unknown>[]).map(parseConversationRpcRow)
}

export async function getMyPlanConversation(planId: string): Promise<PlanConversation | null> {
  const { data, error } = await supabase.rpc('get_my_plan_conversation', { p_plan_id: planId })
  if (error) throw new Error(error.message || 'Unable to load Plan conversation.')
  const row = Array.isArray(data) ? data[0] : null
  return row ? parseConversationRpcRow(row as Record<string, unknown>) : null
}

export const PLAN_MESSAGE_PAGE_SIZE = 50
export type PlanMessageCursor = { sentAt: string; messageId: string }
export type PlanMessagePage = { messages: PlanMessage[]; hasOlder: boolean }

export async function getPlanMessagesPage(
  conversationId: string,
  cursor: PlanMessageCursor | null = null,
): Promise<PlanMessagePage> {
  if (typeof conversationId !== 'string' || conversationId.trim().length === 0) {
    throw new Error('A conversation is required to load messages.')
  }
  const { data, error } = await supabase.rpc('get_my_plan_messages_page', {
    p_conversation_id: conversationId,
    p_before_sent_at: cursor?.sentAt ?? null,
    p_before_id: cursor?.messageId ?? null,
    p_limit: PLAN_MESSAGE_PAGE_SIZE + 1,
  })
  if (error) throw new Error(error.message || 'Unable to load messages.')
  if (!Array.isArray(data)) throw new Error('Invalid messages response.')
  const rows = data as SendPlanMessageRpcRow[]
  const hasOlder = rows.length > PLAN_MESSAGE_PAGE_SIZE
  const visibleRows = hasOlder ? rows.slice(1) : rows
  return { messages: visibleRows.map(parseSendPlanMessageRow), hasOlder }
}

export async function getPlanMessages(conversationId: string): Promise<PlanMessage[]> {
  return (await getPlanMessagesPage(conversationId)).messages
}

const MESSAGE_SEND_TIMEOUT_MS = 12_000
const MESSAGE_SEND_RETRY_DELAY_MS = 250
const MESSAGE_SEND_MAX_ATTEMPTS = 2

function messageSendDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

export async function sendPlanMessage(
  conversationId: string,
  body: string,
): Promise<PlanMessage> {
  if (
    typeof conversationId !== 'string' ||
    conversationId.trim().length === 0
  ) {
    throw new Error(
      'A conversation is required to send a message.',
    )
  }

  if (typeof body !== 'string') {
    throw new Error(
      'A message is required.',
    )
  }

  const normalizedBody = body.trim()

  if (normalizedBody.length === 0) {
    throw new Error(
      'A message is required.',
    )
  }

  if (normalizedBody.length > 4000) {
    throw new Error(
      'Messages cannot exceed 4000 characters.',
    )
  }

  const clientMessageId = crypto.randomUUID()
  let lastMessage = 'Unable to send message.'

  for (let attempt = 0; attempt < MESSAGE_SEND_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), MESSAGE_SEND_TIMEOUT_MS)

    try {
      const { data, error, status } = await supabase
        .rpc('send_plan_message_v2', {
          p_conversation_id: conversationId,
          p_body: normalizedBody,
          p_client_message_id: clientMessageId,
        })
        .abortSignal(controller.signal)

      if (!error) {
        if (!Array.isArray(data) || data.length !== 1 || !data[0] || typeof data[0] !== 'object') {
          throw new Error('Invalid send message response.')
        }
        return parseSendPlanMessageRow(data[0] as SendPlanMessageRpcRow)
      }

      lastMessage = error.message || lastMessage
      const retryable = status === 0 || status >= 500
      if (!retryable || attempt + 1 >= MESSAGE_SEND_MAX_ATTEMPTS) break
    } finally {
      window.clearTimeout(timeoutId)
    }

    await messageSendDelay(MESSAGE_SEND_RETRY_DELAY_MS)
  }

  throw new Error(lastMessage)
}
