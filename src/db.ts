import { $ } from 'bun'
import { Database } from 'bun:sqlite'
import _ from 'lodash'
import { DATA_DIR } from './config'

await $`mkdir -p ${DATA_DIR}`

export const db = new Database(`${DATA_DIR}/whatsapp.db`, { create: true, strict: true })
db.run('PRAGMA journal_mode = WAL')
db.run('PRAGMA foreign_keys = ON')

db.run(`
  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,            -- dm | group | newsletter | status | broadcast
    name TEXT,
    last_message_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    saved_name TEXT,               -- name in your address book
    push_name TEXT                 -- name the contact set for themselves
  );
  CREATE TABLE IF NOT EXISTS messages (
    chat_id TEXT NOT NULL,
    id TEXT NOT NULL,
    sender_id TEXT,
    sender_name TEXT,
    from_me INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    type TEXT,
    text TEXT,
    quoted_id TEXT,
    edited INTEGER NOT NULL DEFAULT 0,
    deleted INTEGER NOT NULL DEFAULT 0,
    raw TEXT,
    PRIMARY KEY (chat_id, id)
  );
  CREATE INDEX IF NOT EXISTS messages_chat_ts ON messages (chat_id, ts);
  CREATE TABLE IF NOT EXISTS jid_aliases (
    lid TEXT PRIMARY KEY,
    pn TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS oauth_clients (
    id TEXT PRIMARY KEY,
    name TEXT,
    redirect_uris TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS grants (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES oauth_clients(id),
    can_send INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS grant_chats (
    grant_id TEXT NOT NULL REFERENCES grants(id),
    chat_id TEXT NOT NULL,
    PRIMARY KEY (grant_id, chat_id)
  );
  CREATE TABLE IF NOT EXISTS auth_codes (
    code_hash TEXT PRIMARY KEY,
    grant_id TEXT NOT NULL REFERENCES grants(id),
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tokens (
    token_hash TEXT PRIMARY KEY,
    grant_id TEXT NOT NULL REFERENCES grants(id),
    kind TEXT NOT NULL,            -- access | refresh
    expires_at INTEGER NOT NULL
  );
`)

// Columns added after the first release
function addColumn(table: string, column: string, def: string) {
  const cols = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all()
  if (!cols.some(c => c.name === column)) db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`)
}
addColumn('chats', 'is_business', 'INTEGER NOT NULL DEFAULT 0')
addColumn('contacts', 'verified_name', 'TEXT')

/** Message types only WhatsApp Business accounts can send. */
export const BUSINESS_MESSAGE_TYPES = ['template', 'interactive', 'buttons', 'list', 'highlyStructured', 'product', 'order', 'invoice']
db.run(
  `UPDATE chats SET is_business = 1 WHERE kind = 'dm' AND is_business = 0 AND id IN (
     SELECT chat_id FROM messages WHERE from_me = 0 AND type IN (${BUSINESS_MESSAGE_TYPES.map(t => `'${t}'`).join(',')}))`,
)

export type ChatKind = 'dm' | 'group' | 'newsletter' | 'status' | 'broadcast'

export type StoredMessage = {
  chatId: string
  id: string
  senderId: string | null
  senderName: string | null
  fromMe: boolean
  ts: number
  type: string | null
  text: string | null
  quotedId: string | null
  raw: string
}

const insertMessage = db.prepare(`
  INSERT INTO messages (chat_id, id, sender_id, sender_name, from_me, ts, type, text, quoted_id, raw)
  VALUES ($chatId, $id, $senderId, $senderName, $fromMe, $ts, $type, $text, $quotedId, $raw)
  ON CONFLICT (chat_id, id) DO UPDATE SET
    sender_name = COALESCE(excluded.sender_name, sender_name),
    type = excluded.type, text = excluded.text, quoted_id = excluded.quoted_id, raw = excluded.raw
`)

const touchChat = db.prepare(`
  INSERT INTO chats (id, kind, last_message_at) VALUES ($id, $kind, $ts)
  ON CONFLICT (id) DO UPDATE SET last_message_at = MAX(COALESCE(last_message_at, 0), excluded.last_message_at)
`)

export function saveMessage(m: StoredMessage, kind: ChatKind) {
  insertMessage.run({ ...m, fromMe: m.fromMe ? 1 : 0 })
  touchChat.run({ id: m.chatId, kind, ts: m.ts })
}

export function editMessage(chatId: string, id: string, text: string | null) {
  db.run('UPDATE messages SET text = ?, edited = 1 WHERE chat_id = ? AND id = ?', [text, chatId, id])
}

export function deleteMessage(chatId: string, id: string) {
  db.run('UPDATE messages SET deleted = 1 WHERE chat_id = ? AND id = ?', [chatId, id])
}

export function upsertChat(id: string, kind: ChatKind, name?: string | null) {
  db.run(
    `INSERT INTO chats (id, kind, name) VALUES (?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET name = COALESCE(excluded.name, name)`,
    [id, kind, name ?? null],
  )
}

export function upsertContact(id: string, savedName?: string | null, pushName?: string | null, verifiedName?: string | null) {
  db.run(
    `INSERT INTO contacts (id, saved_name, push_name, verified_name) VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       saved_name = COALESCE(excluded.saved_name, saved_name),
       push_name = COALESCE(excluded.push_name, push_name),
       verified_name = COALESCE(excluded.verified_name, verified_name)`,
    [id, savedName ?? null, pushName ?? null, verifiedName ?? null],
  )
  if (verifiedName) markBusiness(id)
}

export function markBusiness(chatId: string) {
  db.run(`INSERT INTO chats (id, kind, is_business) VALUES (?, 'dm', 1) ON CONFLICT (id) DO UPDATE SET is_business = 1`, [chatId])
}

export function pnForLid(lid: string): string | null {
  return db.query<{ pn: string }, [string]>('SELECT pn FROM jid_aliases WHERE lid = ?').get(lid)?.pn ?? null
}

/** Record that a @lid and a phone-number JID are the same person, and fold any rows stored under the lid. */
export const addAlias = db.transaction((lid: string, pn: string) => {
  const { changes } = db.run('INSERT OR IGNORE INTO jid_aliases (lid, pn) VALUES (?, ?)', [lid, pn])
  if (!changes) return

  const lidChat = db.query<{ kind: ChatKind; name: string | null; last_message_at: number | null; is_business: number }, [string]>(
    'SELECT kind, name, last_message_at, is_business FROM chats WHERE id = ?',
  ).get(lid)
  if (lidChat) {
    db.run(
      `INSERT INTO chats (id, kind, name, last_message_at, is_business) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name = COALESCE(name, excluded.name),
         last_message_at = MAX(COALESCE(last_message_at, 0), COALESCE(excluded.last_message_at, 0)),
         is_business = MAX(is_business, excluded.is_business)`,
      [pn, lidChat.kind, lidChat.name, lidChat.last_message_at, lidChat.is_business],
    )
    db.run('DELETE FROM chats WHERE id = ?', [lid])
  }
  db.run('UPDATE OR IGNORE messages SET chat_id = ? WHERE chat_id = ?', [pn, lid])
  db.run('DELETE FROM messages WHERE chat_id = ?', [lid])
  db.run('UPDATE messages SET sender_id = ? WHERE sender_id = ?', [pn, lid])
  db.run('UPDATE OR IGNORE grant_chats SET chat_id = ? WHERE chat_id = ?', [pn, lid])
  db.run('DELETE FROM grant_chats WHERE chat_id = ?', [lid])

  const lidContact = db.query<{ saved_name: string | null; push_name: string | null; verified_name: string | null }, [string]>(
    'SELECT saved_name, push_name, verified_name FROM contacts WHERE id = ?',
  ).get(lid)
  if (lidContact) {
    upsertContact(pn, lidContact.saved_name, lidContact.push_name, lidContact.verified_name)
    db.run('DELETE FROM contacts WHERE id = ?', [lid])
  }
})

// ---- read side (used by the consent page and MCP tools) ----

export type ChatRow = {
  id: string
  kind: ChatKind
  is_business: number
  name: string | null
  last_message_at: number | null
  message_count: number
}

const chatSelect = `
  SELECT c.id, c.kind, c.is_business,
         COALESCE(ct.saved_name, c.name, ct.verified_name, ct.push_name) AS name,
         c.last_message_at,
         (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) AS message_count
  FROM chats c LEFT JOIN contacts ct ON ct.id = c.id`

export type PickerChat = ChatRow & { last_text: string | null; last_from_me: number | null }

/** Chats offered on the consent page (status updates and broadcast lists are never shareable). */
export function listPickerChats(): PickerChat[] {
  return db.query<PickerChat, []>(
    `SELECT x.*, lm.text AS last_text, lm.from_me AS last_from_me
     FROM (${chatSelect} WHERE c.kind IN ('dm', 'group', 'newsletter')) x
     LEFT JOIN messages lm ON lm.rowid = (
       SELECT rowid FROM messages WHERE chat_id = x.id AND deleted = 0 ORDER BY ts DESC LIMIT 1)
     ORDER BY x.last_message_at DESC NULLS LAST, x.name`,
  ).all()
}

export function isShareableChat(id: string): boolean {
  return !!db.query("SELECT 1 FROM chats WHERE id = ? AND kind IN ('dm', 'group', 'newsletter')").get(id)
}

export function syncStats() {
  return db.query<{ chats: number; messages: number }, []>(
    "SELECT (SELECT COUNT(*) FROM chats WHERE kind IN ('dm', 'group', 'newsletter')) AS chats, (SELECT COUNT(*) FROM messages) AS messages",
  ).get()!
}

export function listGrantChats(grantId: string): ChatRow[] {
  return db.query<ChatRow, [string]>(
    `${chatSelect} JOIN grant_chats g ON g.chat_id = c.id AND g.grant_id = ?
     ORDER BY c.last_message_at DESC NULLS LAST, name`,
  ).all(grantId)
}

export type MessageRow = {
  id: string
  chat_id: string
  sender: string | null
  from_me: number
  ts: number
  type: string | null
  text: string | null
  quoted_id: string | null
  edited: number
  deleted: number
}

const messageSelect = `
  SELECT m.id, m.chat_id,
         CASE WHEN m.from_me THEN 'me' ELSE COALESCE(ct.saved_name, m.sender_name, ct.push_name, m.sender_id) END AS sender,
         m.from_me, m.ts, m.type, m.text, m.quoted_id, m.edited, m.deleted
  FROM messages m LEFT JOIN contacts ct ON ct.id = m.sender_id`

export function getMessages(chatId: string, opts: { limit: number; before?: number; after?: number }): MessageRow[] {
  const rows = db.query<MessageRow, [string, number, number, number]>(
    `${messageSelect} WHERE m.chat_id = ? AND m.ts < ? AND m.ts > ? ORDER BY m.ts DESC LIMIT ?`,
  ).all(chatId, opts.before ?? Number.MAX_SAFE_INTEGER, opts.after ?? -1, opts.limit)
  return rows.reverse()
}

export function searchMessages(chatIds: string[], query: string, limit: number): MessageRow[] {
  if (!chatIds.length) return []
  const placeholders = _.times(chatIds.length, _.constant('?')).join(',')
  const pattern = `%${query.replace(/[\\%_]/g, c => `\\${c}`)}%`
  return db.query<MessageRow, string[]>(
    `${messageSelect} WHERE m.chat_id IN (${placeholders}) AND m.text LIKE ? ESCAPE '\\' AND m.deleted = 0
     ORDER BY m.ts DESC LIMIT ${Number(limit)}`,
  ).all(...chatIds, pattern)
}

// ---- backfill support ----

export function messageCount(chatId: string): number {
  return db.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?').get(chatId)!.n
}

/** Oldest stored message, with the key exactly as WhatsApp sent it (the phone needs its own JIDs as an anchor). */
export function oldestMessage(chatId: string): { id: string; fromMe: boolean; ts: number; remoteJid: string } | null {
  const row = db
    .query<{ id: string; from_me: number; ts: number; raw: string | null }, [string]>(
      'SELECT id, from_me, ts, raw FROM messages WHERE chat_id = ? ORDER BY ts ASC LIMIT 1',
    )
    .get(chatId)
  if (!row) return null
  const remoteJid = _.attempt(() => JSON.parse(row.raw ?? '{}').key?.remoteJid)
  return { id: row.id, fromMe: !!row.from_me, ts: row.ts, remoteJid: _.isString(remoteJid) ? remoteJid : chatId }
}

export function chatKindOf(chatId: string): ChatKind | null {
  return db.query<{ kind: ChatKind }, [string]>('SELECT kind FROM chats WHERE id = ?').get(chatId)?.kind ?? null
}

/** Chats shared with at least one active agent connection. */
export function grantedChatIds(): string[] {
  return db
    .query<{ chat_id: string }, []>(
      'SELECT DISTINCT gc.chat_id FROM grant_chats gc JOIN grants g ON g.id = gc.grant_id WHERE g.revoked_at IS NULL',
    )
    .all()
    .map(r => r.chat_id)
}
