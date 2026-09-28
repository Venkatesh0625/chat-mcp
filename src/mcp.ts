import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { getMessages, listGrantChats, searchMessages, type MessageRow } from './db'
import type { Grant } from './oauth'
import { backfill, sendText } from './whatsapp'

const iso = (ts: number) => new Date(ts * 1000).toISOString()
const toTs = (s?: string) => (s ? Math.floor(new Date(s).getTime() / 1000) : undefined)

function formatMessage(m: MessageRow) {
  return {
    id: m.id,
    chat_id: m.chat_id,
    time: iso(m.ts),
    sender: m.sender,
    type: m.type,
    text: m.deleted ? '[deleted]' : m.text,
    ...(m.quoted_id ? { reply_to: m.quoted_id } : {}),
    ...(m.edited ? { edited: true } : {}),
  }
}

const result = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] })
const error = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true })

/** Builds an MCP server whose tools can only see the chats in this grant. */
function buildServer(grant: Grant) {
  const server = new McpServer({ name: 'whatsapp', version: '1.0.0' })
  // Re-read on every call so the scope reflects lid→phone merges and revocations.
  const allowed = () => new Set(listGrantChats(grant.id).map(c => c.id))

  server.registerTool(
    'list_chats',
    {
      title: 'List chats',
      description: 'List the WhatsApp chats (DMs, groups, channels) this connection is allowed to read.',
      annotations: { readOnlyHint: true },
    },
    async () =>
      result(
        listGrantChats(grant.id).map(c => ({
          chat_id: c.id,
          name: c.name ?? c.id.split('@')[0],
          kind: c.is_business ? 'business' : c.kind,
          messages_stored: c.message_count,
          last_message: c.last_message_at ? iso(c.last_message_at) : null,
        })),
      ),
  )

  server.registerTool(
    'get_messages',
    {
      title: 'Get messages',
      description: 'Read messages from one chat, oldest first. Returns the most recent `limit` messages in the time window.',
      inputSchema: {
        chat_id: z.string().describe('chat_id from list_chats'),
        limit: z.number().int().min(1).max(500).default(50),
        before: z.string().optional().describe('ISO timestamp; only messages before this'),
        after: z.string().optional().describe('ISO timestamp; only messages after this'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ chat_id, limit, before, after }) => {
      if (!allowed().has(chat_id)) return error(`Unknown chat_id: ${chat_id}. Use list_chats.`)
      await backfill(chat_id, { waitMs: 8000 }) // first read of a sparse chat: pull recent history from the phone
      return result(getMessages(chat_id, { limit, before: toTs(before), after: toTs(after) }).map(formatMessage))
    },
  )

  server.registerTool(
    'search_messages',
    {
      title: 'Search messages',
      description: 'Case-insensitive text search across the allowed chats (or one chat), newest first.',
      inputSchema: {
        query: z.string().min(1),
        chat_id: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(30),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, chat_id, limit }) => {
      const scope = allowed()
      if (chat_id && !scope.has(chat_id)) return error(`Unknown chat_id: ${chat_id}. Use list_chats.`)
      if (chat_id) await backfill(chat_id, { waitMs: 8000 })
      return result(searchMessages(chat_id ? [chat_id] : [...scope], query, limit).map(formatMessage))
    },
  )

  if (grant.canSend) {
    server.registerTool(
      'send_message',
      {
        title: 'Send message',
        description: 'Send a text message to one of the allowed chats, as the account owner.',
        inputSchema: { chat_id: z.string(), text: z.string().min(1).max(4000) },
        annotations: { destructiveHint: false, openWorldHint: true },
      },
      async ({ chat_id, text }) => {
        if (!allowed().has(chat_id)) return error(`Unknown chat_id: ${chat_id}. Use list_chats.`)
        try {
          return result({ sent: true, id: await sendText(chat_id, text) })
        } catch (err) {
          return error(`Failed to send: ${(err as Error).message}`)
        }
      },
    )
  }

  return server
}

export async function handleMcp(req: Request, grant: Grant) {
  // Stateless: a fresh server per request, scoped to the caller's grant.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  const server = buildServer(grant)
  await server.connect(transport)
  return transport.handleRequest(req)
}
