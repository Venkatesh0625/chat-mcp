import makeWASocket, {
  Browsers,
  BufferJSON,
  DisconnectReason,
  getContentType,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  isLidUser,
  isPnUser,
  jidNormalizedUser,
  normalizeMessageContent,
  proto,
  toNumber,
  useMultiFileAuthState,
  type BaileysEventMap,
  type WAMessage,
  type WASocket,
} from 'baileys'
import { $ } from 'bun'
import QRCode from 'qrcode'
import { DATA_DIR } from './config'
import * as store from './db'
import { createLogger } from './logger'

const logger = createLogger(process.env.LOG_LEVEL ?? 'warn')
const AUTH_DIR = `${DATA_DIR}/auth`
// WhatsApp only accepts logins with the same client type used when pairing, so remember it.
const DESKTOP_MARKER = `${DATA_DIR}/paired-as-desktop`

let sock: WASocket | undefined

// ---------- connection state (drives the QR step of the consent flow) ----------

export type WaStatus = 'starting' | 'qr' | 'open' | 'reconnecting'

const state = {
  status: 'starting' as WaStatus,
  qr: null as string | null,
  me: null as { id: string; name: string | null } | null,
  lastHistoryAt: 0,
  historyProgress: null as number | null,
}

export function getWaState() {
  return {
    status: state.status,
    qr: state.status === 'qr' ? state.qr : null,
    me: state.me,
    // History arrives in chunks for a while after linking; treat it as ongoing until chunks stop.
    syncing: state.status === 'open' && Date.now() - state.lastHistoryAt < 20_000,
    progress: state.historyProgress,
  }
}

export function getSocket() {
  if (!sock?.user) throw new Error('WhatsApp is not connected')
  return sock
}

// ---------- normalisation ----------

function chatKind(jid: string): store.ChatKind {
  if (isJidGroup(jid)) return 'group'
  if (isJidNewsletter(jid)) return 'newsletter'
  if (isJidStatusBroadcast(jid)) return 'status'
  if (isJidBroadcast(jid)) return 'broadcast'
  return 'dm'
}

/** One ID per person: prefer the phone-number JID over the anonymous @lid when we know the mapping. */
function canonical(jid: string, alt?: string | null): string {
  const id = jidNormalizedUser(jid)
  if (!isLidUser(id)) return id
  if (alt && isPnUser(alt)) store.addAlias(id, jidNormalizedUser(alt))
  return store.pnForLid(id) ?? id
}

function learnAlias(a?: string | null, b?: string | null) {
  if (!a || !b) return
  const [x, y] = [jidNormalizedUser(a), jidNormalizedUser(b)]
  if (isLidUser(x) && isPnUser(y)) store.addAlias(x, y)
  else if (isLidUser(y) && isPnUser(x)) store.addAlias(y, x)
}

function textOf(content: proto.IMessage): string | null {
  return (
    content.conversation ??
    content.extendedTextMessage?.text ??
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    content.documentMessage?.caption ??
    content.documentMessage?.fileName ??
    content.documentWithCaptionMessage?.message?.documentMessage?.caption ??
    content.templateMessage?.hydratedTemplate?.hydratedContentText ??
    content.interactiveMessage?.body?.text ??
    content.buttonsMessage?.contentText ??
    content.listMessage?.description ??
    content.pollCreationMessage?.name ??
    content.pollCreationMessageV3?.name ??
    content.contactMessage?.displayName ??
    content.locationMessage?.name ??
    content.locationMessage?.address ??
    content.reactionMessage?.text ??
    null
  )
}

function quotedIdOf(content: proto.IMessage, type: string): string | null {
  if (type === 'reactionMessage') return content.reactionMessage?.key?.id ?? null
  const inner = (content as Record<string, any>)[type]
  return inner?.contextInfo?.stanzaId ?? null
}

// ---------- ingestion ----------

function ingest(msg: WAMessage) {
  const { key } = msg
  if (!key.remoteJid || !key.id) return
  const content = normalizeMessageContent(msg.message)
  if (!content) return // stubs: joins, missed calls, etc.

  learnAlias(key.remoteJid, key.remoteJidAlt)
  learnAlias(key.participant, key.participantAlt)
  const chatId = canonical(key.remoteJid, key.remoteJidAlt)
  const type = getContentType(content)
  if (!type || type === 'senderKeyDistributionMessage') return

  if (type === 'protocolMessage') {
    const p = content.protocolMessage!
    const target = p.key?.id
    if (!target) return
    if (p.type === proto.Message.ProtocolMessage.Type.REVOKE) store.deleteMessage(chatId, target)
    if (p.type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT && p.editedMessage) {
      store.editMessage(chatId, target, textOf(normalizeMessageContent(p.editedMessage) ?? {}))
    }
    return
  }

  const kind = chatKind(chatId)
  const shortType = type.replace(/Message$/, '')
  const senderId = key.fromMe
    ? null
    : key.participant
      ? canonical(key.participant, key.participantAlt)
      : kind === 'dm'
        ? chatId
        : null
  if (senderId && (msg.pushName || msg.verifiedBizName)) {
    store.upsertContact(senderId, null, msg.pushName, msg.verifiedBizName)
  }

  store.saveMessage(
    {
      chatId,
      id: key.id,
      senderId,
      senderName: key.fromMe ? null : (msg.pushName ?? null),
      fromMe: !!key.fromMe,
      ts: toNumber(msg.messageTimestamp) || Math.floor(Date.now() / 1000),
      type: shortType,
      text: textOf(content),
      quotedId: quotedIdOf(content, type),
      raw: JSON.stringify(msg, BufferJSON.replacer),
    },
    kind,
  )
  if (kind === 'dm' && !key.fromMe && store.BUSINESS_MESSAGE_TYPES.includes(shortType)) store.markBusiness(chatId)
}

function safely(label: string, fn: () => void) {
  try {
    fn()
  } catch (err) {
    console.error(`Failed to store ${label}:`, err)
  }
}

export function storeHistory({ chats, contacts, messages, lidPnMappings }: BaileysEventMap['messaging-history.set']) {
  for (const { lid, pn } of lidPnMappings ?? []) safely('lid mapping', () => learnAlias(lid, pn))
  for (const c of contacts) {
    safely('contact', () => {
      learnAlias(c.lid, c.phoneNumber)
      store.upsertContact(canonical(c.id, c.phoneNumber), c.name, c.notify, c.verifiedName)
    })
  }
  for (const c of chats) {
    safely('chat', () => {
      if (!c.id) return
      const id = canonical(c.id, c.pnJid)
      store.upsertChat(id, chatKind(id), c.name)
    })
  }
  for (const m of messages) safely('message', () => ingest(m))
}

async function syncGroupNames(s: WASocket) {
  try {
    const groups = await s.groupFetchAllParticipating()
    for (const g of Object.values(groups)) store.upsertChat(g.id, 'group', g.subject)
  } catch (err) {
    logger.warn({ err }, 'could not fetch group names')
  }
}

// ---------- socket lifecycle ----------

export async function startWhatsApp() {
  // Sessions linked before full-history support were paired as a browser tab and must keep logging in as one.
  const legacyBrowserPairing = (await Bun.file(`${AUTH_DIR}/creds.json`).exists()) && !(await Bun.file(DESKTOP_MARKER).exists())
  const { state: auth, saveCreds } = await useMultiFileAuthState(AUTH_DIR)

  const s = (sock = makeWASocket({
    auth,
    logger,
    // Pair as a desktop app so the phone sends full history, like WhatsApp Desktop does.
    browser: Browsers.macOS('Desktop'),
    syncFullHistory: !legacyBrowserPairing,
    shouldSyncHistoryMessage: () => true,
    markOnlineOnConnect: false,
  }))

  s.ev.on('creds.update', saveCreds)

  s.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      state.status = 'qr'
      state.qr = qr
      console.log('Scan this QR in WhatsApp > Linked devices > Link a device (or open the MCP connect page):')
      console.log(await QRCode.toString(qr, { type: 'terminal', small: true }))
    }
    if (connection === 'open') {
      state.status = 'open'
      state.qr = null
      state.me = s.user ? { id: jidNormalizedUser(s.user.id), name: s.user.name ?? s.user.notify ?? null } : null
      console.log(`WhatsApp connected as ${s.user?.id}`)
      if (legacyBrowserPairing) {
        console.log('This link was made in browser mode, so only recent history is synced. Unlink it on your phone to re-pair with full history.')
      } else if (!(await Bun.file(DESKTOP_MARKER).exists())) {
        await Bun.write(DESKTOP_MARKER, new Date().toISOString())
      }
      syncGroupNames(s)
      backfillAll(store.grantedChatIds())
    }
    if (connection === 'close') {
      const code = (lastDisconnect?.error as any)?.output?.statusCode
      state.me = null
      if (code === DisconnectReason.loggedOut) {
        // Unlinked from the phone: forget the session and offer a fresh QR. Stored messages are kept.
        console.log('WhatsApp session was unlinked. Starting a new pairing.')
        await $`rm -rf ${AUTH_DIR} ${DESKTOP_MARKER}`
        state.status = 'starting'
        setTimeout(startWhatsApp, 1000)
        return
      }
      state.status = 'reconnecting'
      console.log(`WhatsApp connection closed (${code}), reconnecting...`)
      setTimeout(startWhatsApp, 3000)
    }
  })

  s.ev.on('messaging-history.set', data => {
    const type = proto.HistorySync.HistorySyncType[data.syncType ?? -1] ?? data.syncType
    console.log(`History (${type}): ${data.chats.length} chats, ${data.messages.length} messages, ${data.contacts.length} contacts`)
    state.lastHistoryAt = Date.now()
    if (typeof data.progress === 'number') state.historyProgress = data.progress
    storeHistory(data)
  })

  s.ev.on('lid-mapping.update', ({ lid, pn }) => safely('lid mapping', () => learnAlias(lid, pn)))

  s.ev.on('contacts.upsert', contacts => {
    for (const c of contacts) {
      safely('contact', () => {
        learnAlias(c.lid, c.phoneNumber)
        store.upsertContact(canonical(c.id, c.phoneNumber), c.name, c.notify, c.verifiedName)
      })
    }
  })
  s.ev.on('contacts.update', contacts => {
    for (const c of contacts) {
      safely('contact', () => {
        if (c.id) store.upsertContact(canonical(c.id, c.phoneNumber), c.name, c.notify, c.verifiedName)
      })
    }
  })

  s.ev.on('chats.upsert', chats => {
    for (const c of chats) {
      safely('chat', () => {
        if (!c.id) return
        const id = canonical(c.id, c.pnJid)
        store.upsertChat(id, chatKind(id), c.name)
      })
    }
  })

  s.ev.on('groups.upsert', groups => safely('groups', () => groups.forEach(g => store.upsertChat(g.id, 'group', g.subject))))
  s.ev.on('groups.update', groups =>
    safely('groups', () => groups.forEach(g => g.id && g.subject && store.upsertChat(g.id, 'group', g.subject))),
  )

  s.ev.on('messages.upsert', ({ messages }) => {
    for (const m of messages) safely('message', () => ingest(m))
  })

  s.ev.on('messages.update', updates => {
    for (const { key, update } of updates) {
      safely('message update', () => {
        if (!key.remoteJid || !key.id) return
        if (update.messageStubType === proto.WebMessageInfo.StubType.REVOKE) {
          store.deleteMessage(canonical(key.remoteJid, key.remoteJidAlt), key.id)
        }
      })
    }
  })
}

// ---------- on-demand history backfill ----------

export const BACKFILL_TARGET = 20
const REQUEST_COOLDOWN_MS = 5 * 60_000
const lastRequested = new Map<string, number>()

/**
 * Asks the phone for older messages in a chat that has fewer than `target` stored. The reply arrives
 * asynchronously through `messaging-history.set` (ON_DEMAND) and is stored like any other history.
 * If `waitMs` is set, resolves once new messages land or the wait runs out.
 */
export async function backfill(chatId: string, { target = BACKFILL_TARGET, waitMs = 0 } = {}) {
  const before = store.messageCount(chatId)
  if (before >= target || !sock?.user) return
  if (Date.now() - (lastRequested.get(chatId) ?? 0) < REQUEST_COOLDOWN_MS) return
  lastRequested.set(chatId, Date.now())

  const kind = store.chatKindOf(chatId)
  if (kind !== 'dm' && kind !== 'group') return // channels use a different API; not supported yet

  // Anchor on the oldest message we have, or on "now" to get the most recent messages.
  const oldest = store.oldestMessage(chatId)
  const key = oldest ? { remoteJid: oldest.remoteJid, id: oldest.id, fromMe: oldest.fromMe } : { remoteJid: chatId, id: '', fromMe: false }
  const tsMs = oldest ? oldest.ts * 1000 : Date.now()
  try {
    await sock.fetchMessageHistory(target - before, key, tsMs)
    console.log(`Requested ${target - before} older messages for ${chatId}`)
  } catch (err) {
    console.error(`History request failed for ${chatId}:`, err)
    return
  }

  const deadline = Date.now() + waitMs
  while (Date.now() < deadline && store.messageCount(chatId) === before) await Bun.sleep(400)
}

/** Backfill several chats one after another, spaced out so the phone isn't flooded with requests. */
export async function backfillAll(chatIds: string[]) {
  for (const id of chatIds) {
    await backfill(id)
    await Bun.sleep(1500)
  }
}

export async function sendText(chatId: string, text: string) {
  const sent = await getSocket().sendMessage(chatId, { text })
  if (sent) safely('sent message', () => ingest(sent))
  return sent?.key.id ?? null
}
