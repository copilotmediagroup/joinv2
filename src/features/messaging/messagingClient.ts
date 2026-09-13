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

type MessageRow = {
  id: unknown
  conversation_id: unknown
  sender_user_id: unknown
  body: unknown
  sent_at: unknown
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

function parseMessageRow(
  row: MessageRow,
): PlanMessage {
  return {
    messageId: requireString(
      row.id,
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

const PLAN_MESSAGE_WINDOW = 200

export async function getPlanMessages(
  conversationId: string,
): Promise<PlanMessage[]> {
  if (
    typeof conversationId !== 'string' ||
    conversationId.trim().length === 0
  ) {
    throw new Error(
      'A conversation is required to load messages.',
    )
  }

  const {
    data,
    error,
  } = await supabase
    .from('messages')
    .select(
      'id, conversation_id, sender_user_id, body, sent_at',
    )
    .eq(
      'conversation_id',
      conversationId,
    )
    .order('sent_at', {
      ascending: false,
    })
    .order('id', {
      ascending: false,
    })
    .limit(PLAN_MESSAGE_WINDOW)

  if (error) {
    throw new Error(
      error.message ||
        'Unable to load messages.',
    )
  }

  if (!Array.isArray(data)) {
    throw new Error(
      'Invalid messages response.',
    )
  }

  return data
    .map((row) =>
      parseMessageRow(
        row as MessageRow,
      ),
    )
    .reverse()
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

  const {
    data,
    error,
  } = await supabase.rpc(
    'send_plan_message',
    {
      p_conversation_id:
        conversationId,
      p_body:
        normalizedBody,
    },
  )

  if (error) {
    throw new Error(
      error.message ||
        'Unable to send message.',
    )
  }

  if (
    !Array.isArray(data) ||
    data.length !== 1 ||
    data[0] === null ||
    typeof data[0] !== 'object'
  ) {
    throw new Error(
      'Invalid send message response.',
    )
  }

  return parseSendPlanMessageRow(
    data[0] as SendPlanMessageRpcRow,
  )
}
