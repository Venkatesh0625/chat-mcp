import _ from 'lodash'
import QRCode from 'qrcode'
import { MCP_URL, PUBLIC_URL } from './config'
import { renderConsentPage, renderDonePage, type PageProps } from './consent-page'
import { db, isShareableChat, listPickerChats, syncStats } from './db'
import { checkCsrf, csrfToken, getSession, sessionCookie } from './session'
import { randomToken, sha256 } from './util'
import { backfillAll, getWaState } from './whatsapp'

const ACCESS_TTL = 60 * 60 // 1 hour
const REFRESH_TTL = 30 * 24 * 60 * 60 // 30 days
const CODE_TTL = 5 * 60

const now = () => Math.floor(Date.now() / 1000)
const token = () => randomToken(32)

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } })
const oauthError = (error: string, description: string, status = 400) =>
  json({ error, error_description: description }, status)

// ---------- discovery ----------

export const resourceMetadataUrl = `${PUBLIC_URL}/.well-known/oauth-protected-resource/mcp`

export function protectedResourceMetadata() {
  return json({
    resource: MCP_URL,
    authorization_servers: [PUBLIC_URL],
    bearer_methods_supported: ['header'],
    resource_name: 'WhatsApp',
  })
}

export function authorizationServerMetadata() {
  return json({
    issuer: PUBLIC_URL,
    authorization_endpoint: `${PUBLIC_URL}/authorize`,
    token_endpoint: `${PUBLIC_URL}/token`,
    registration_endpoint: `${PUBLIC_URL}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  })
}

// ---------- dynamic client registration (RFC 7591) ----------

function isAllowedRedirect(uri: string) {
  try {
    const u = new URL(uri)
    if (u.hash) return false
    if (u.protocol === 'https:') return true
    if (u.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
    // Native apps may use private-use schemes (e.g. cursor://)
    return !['javascript:', 'data:', 'file:', 'vbscript:'].includes(u.protocol)
  } catch {
    return false
  }
}

export async function register(req: Request) {
  const body = (await req.json().catch(() => null)) as { redirect_uris?: unknown; client_name?: unknown } | null
  const uris = body?.redirect_uris
  if (!Array.isArray(uris) || !uris.length || !uris.every(u => typeof u === 'string' && isAllowedRedirect(u))) {
    return oauthError('invalid_redirect_uri', 'redirect_uris must be https, http://localhost, or an app scheme')
  }
  const name = typeof body?.client_name === 'string' ? body.client_name.slice(0, 100) : null
  const id = crypto.randomUUID()
  db.run('INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)', [
    id,
    name,
    JSON.stringify(uris),
    now(),
  ])
  return json(
    {
      client_id: id,
      client_id_issued_at: now(),
      client_name: name ?? undefined,
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    201,
  )
}

// ---------- authorization + consent page ----------

type AuthParams = {
  client_id: string
  redirect_uri: string
  state: string
  code_challenge: string
  code_challenge_method: string
  response_type: string
}

type Client = { id: string; name: string | null; redirect_uris: string }

/** Validates the request. Errors before the redirect_uri is trusted must not redirect. */
function validate(p: AuthParams): { client: Client } | { error: Response } {
  const client = db.query<Client, [string]>('SELECT id, name, redirect_uris FROM oauth_clients WHERE id = ?').get(p.client_id)
  if (!client) return { error: new Response('Unknown client_id. Remove and re-add the connector.', { status: 400 }) }
  if (!(JSON.parse(client.redirect_uris) as string[]).includes(p.redirect_uri)) {
    return { error: new Response('redirect_uri does not match the registered client', { status: 400 }) }
  }
  const fail = (error: string, description: string) => ({ error: redirect(p.redirect_uri, { error, error_description: description, state: p.state }) })
  if (p.response_type !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported')
  if (!p.code_challenge || p.code_challenge_method !== 'S256') return fail('invalid_request', 'PKCE with S256 is required')
  return { client }
}

function withParams(uri: string, params: Record<string, string>) {
  const u = new URL(uri)
  _.forOwn(_.pickBy(params), (v, k) => u.searchParams.set(k, v))
  return u
}

function redirect(uri: string, params: Record<string, string>) {
  return Response.redirect(withParams(uri, params).toString(), 302)
}

const LOOPBACK = ['localhost', '127.0.0.1', '[::1]']

/**
 * Completes the flow. CLI clients (Claude Code etc.) listen on a loopback port on *their* machine, but the
 * browser may be on another one (e.g. over Tailscale/SSH), where that redirect goes nowhere. When the client
 * runs on this server's machine we can deliver the callback ourselves; otherwise fall back to the redirect.
 */
async function finish(uri: string, params: Record<string, string>, client: Client) {
  const target = withParams(uri, params)
  if (target.protocol === 'http:' && LOOPBACK.includes(target.hostname)) {
    const hosts = target.hostname === 'localhost' ? ['localhost', '127.0.0.1', '[::1]'] : [target.hostname]
    for (const host of hosts) {
      const attempt = new URL(target)
      attempt.hostname = host
      try {
        await fetch(attempt, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
        return html(renderDonePage(client.name ?? 'your MCP client', !params.error))
      } catch {
        // nothing listening on this host/port here: the client lives elsewhere
      }
    }
  }
  return Response.redirect(target.toString(), 302)
}


function readParams(src: { get(key: string): unknown }): AuthParams {
  const get = (k: string) => String(src.get(k) ?? '')
  return {
    client_id: get('client_id'),
    redirect_uri: get('redirect_uri'),
    state: get('state'),
    code_challenge: get('code_challenge'),
    code_challenge_method: get('code_challenge_method'),
    response_type: get('response_type'),
  }
}

function page(props: Omit<PageProps, 'params' | 'clientName'> & { params: AuthParams; client: Client }, status = 200) {
  return html(renderConsentPage({ ...props, params: props.params, clientName: props.client.name ?? 'An MCP client' }), status)
}

export function authorizePage(req: Request) {
  const params = readParams(new URL(req.url).searchParams)
  const v = validate(params)
  if ('error' in v) return v.error
  // The cookie only ties the form token to this browser (CSRF protection); it is issued to anyone who opens the page.
  const existing = getSession(req)
  const fresh = existing ? null : sessionCookie()
  const res = page({ step: getWaState().status === 'open' ? 'choose' : 'link', params, client: v.client, csrf: csrfToken(existing ?? fresh!.id) })
  if (fresh) res.headers.set('set-cookie', fresh.header)
  return res
}

export async function authorizeStatus(req: Request) {
  if (!getSession(req)) return json({ error: 'unauthorized' }, 401)
  const s = getWaState()
  const qrSvg = s.qr ? await QRCode.toString(s.qr, { type: 'svg', margin: 0, errorCorrectionLevel: 'L' }) : null
  return json({ status: s.status, qrSvg, me: s.me, syncing: s.syncing, progress: s.progress, stats: syncStats() })
}

export function authorizeChats(req: Request) {
  if (!getSession(req)) return json({ error: 'unauthorized' }, 401)
  if (getWaState().status !== 'open') return json([])
  return json(listPickerChats())
}

export async function authorizeSubmit(req: Request) {
  const form = await req.formData()
  const params = readParams(form)
  const v = validate(params)
  if ('error' in v) return v.error

  const session = getSession(req)
  if (!session || !checkCsrf(session, String(form.get('csrf') ?? ''))) {
    // Stale page (e.g. the server restarted): send the browser back to a fresh consent page.
    const back = new URL(`${PUBLIC_URL}/authorize`)
    _.forOwn(params, (val, k) => back.searchParams.set(k, val))
    return Response.redirect(back.toString(), 303)
  }
  if (form.get('action') !== 'approve') {
    return finish(params.redirect_uri, { error: 'access_denied', error_description: 'The user denied access', state: params.state }, v.client)
  }

  const chats = _.uniq(form.getAll('chat').map(String)).filter(isShareableChat)
  if (!chats.length) {
    return page({ step: 'choose', params, client: v.client, csrf: csrfToken(session), error: 'Select at least one chat.' }, 400)
  }
  const canSend = form.get('can_send') === 'on'

  const grantId = crypto.randomUUID()
  const code = token()
  db.transaction(() => {
    db.run('INSERT INTO grants (id, client_id, can_send, created_at) VALUES (?, ?, ?, ?)', [grantId, v.client.id, canSend ? 1 : 0, now()])
    const add = db.prepare('INSERT INTO grant_chats (grant_id, chat_id) VALUES (?, ?)')
    for (const c of chats) add.run(grantId, c)
    db.run('INSERT INTO auth_codes (code_hash, grant_id, redirect_uri, code_challenge, expires_at) VALUES (?, ?, ?, ?, ?)', [
      sha256(code),
      grantId,
      params.redirect_uri,
      params.code_challenge,
      now() + CODE_TTL,
    ])
  })()
  backfillAll(chats) // pull recent history for newly shared chats in the background
  return finish(params.redirect_uri, { code, state: params.state }, v.client)
}

// ---------- token endpoint ----------

function issueTokens(grantId: string) {
  const access = token()
  const refresh = token()
  const add = db.prepare('INSERT INTO tokens (token_hash, grant_id, kind, expires_at) VALUES (?, ?, ?, ?)')
  add.run(sha256(access), grantId, 'access', now() + ACCESS_TTL)
  add.run(sha256(refresh), grantId, 'refresh', now() + REFRESH_TTL)
  db.run('DELETE FROM tokens WHERE expires_at < ?', [now()])
  return json({ access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token: refresh })
}

export async function tokenEndpoint(req: Request) {
  const type = req.headers.get('content-type') ?? ''
  const body = type.includes('application/json')
    ? new URLSearchParams((await req.json().catch(() => ({}))) as Record<string, string>)
    : new URLSearchParams(await req.text())
  const clientId = body.get('client_id') ?? ''

  if (body.get('grant_type') === 'authorization_code') {
    const codeHash = sha256(body.get('code') ?? '')
    const row = db.query<{ grant_id: string; redirect_uri: string; code_challenge: string; expires_at: number; client_id: string }, [string]>(
      `SELECT a.grant_id, a.redirect_uri, a.code_challenge, a.expires_at, g.client_id
       FROM auth_codes a JOIN grants g ON g.id = a.grant_id WHERE a.code_hash = ?`,
    ).get(codeHash)
    db.run('DELETE FROM auth_codes WHERE code_hash = ? OR expires_at < ?', [codeHash, now()]) // single use
    if (!row || row.expires_at < now()) return oauthError('invalid_grant', 'Invalid or expired code')
    if (row.client_id !== clientId) return oauthError('invalid_grant', 'Code was issued to another client')
    if (row.redirect_uri !== body.get('redirect_uri')) return oauthError('invalid_grant', 'redirect_uri mismatch')
    if (sha256(body.get('code_verifier') ?? '') !== row.code_challenge) return oauthError('invalid_grant', 'PKCE verification failed')
    return issueTokens(row.grant_id)
  }

  if (body.get('grant_type') === 'refresh_token') {
    const hash = sha256(body.get('refresh_token') ?? '')
    const row = db.query<{ grant_id: string; client_id: string }, [string, number]>(
      `SELECT t.grant_id, g.client_id FROM tokens t JOIN grants g ON g.id = t.grant_id
       WHERE t.token_hash = ? AND t.kind = 'refresh' AND t.expires_at > ? AND g.revoked_at IS NULL`,
    ).get(hash, now())
    if (!row || row.client_id !== clientId) return oauthError('invalid_grant', 'Invalid refresh token')
    db.run('DELETE FROM tokens WHERE token_hash = ?', [hash]) // rotate
    return issueTokens(row.grant_id)
  }

  return oauthError('unsupported_grant_type', 'Use authorization_code or refresh_token')
}

// ---------- bearer auth for /mcp ----------

export type Grant = { id: string; canSend: boolean }

export function authenticate(req: Request): Grant | null {
  const header = req.headers.get('authorization') ?? ''
  const match = /^Bearer (.+)$/i.exec(header)
  if (!match) return null
  const row = db.query<{ id: string; can_send: number }, [string, number]>(
    `SELECT g.id, g.can_send FROM tokens t JOIN grants g ON g.id = t.grant_id
     WHERE t.token_hash = ? AND t.kind = 'access' AND t.expires_at > ? AND g.revoked_at IS NULL`,
  ).get(sha256(match[1]!), now())
  return row ? { id: row.id, canSend: !!row.can_send } : null
}

export function unauthorized() {
  return json({ error: 'invalid_token', error_description: 'Missing or invalid access token' }, 401, {
    'www-authenticate': `Bearer resource_metadata="${resourceMetadataUrl}"`,
  })
}

// ---------- HTML ----------

const html = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:; frame-ancestors 'none'",
    },
  })
