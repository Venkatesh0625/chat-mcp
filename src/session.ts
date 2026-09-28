import { PUBLIC_URL } from './config'
import { randomToken } from './util'

// Signed, stateless cookie identifying a browser, used to bind form tokens to it (CSRF protection).
// The key is per-process, so restarting the server invalidates open consent pages.
const KEY = crypto.getRandomValues(new Uint8Array(32))
const COOKIE = 'wa_mcp_session'
const TTL = 12 * 60 * 60

const sign = (data: string) => new Bun.CryptoHasher('sha256', KEY).update(data).digest('base64url')

function safeEqual(a: string, b: string) {
  const [x, y] = [Buffer.from(sign(`cmp:${a}`)), Buffer.from(sign(`cmp:${b}`))]
  return crypto.timingSafeEqual(x, y)
}

/** Returns the session id if the request carries a valid session cookie. */
export function getSession(req: Request): string | null {
  const cookie = req.headers.get('cookie') ?? ''
  const raw = cookie.split(/;\s*/).find(c => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1)
  if (!raw) return null
  const [id, exp, mac] = raw.split('.')
  if (!id || !exp || !mac || Number(exp) < Date.now() / 1000) return null
  return safeEqual(mac, sign(`${id}.${exp}`)) ? id : null
}

export function sessionCookie() {
  const id = randomToken(16)
  const exp = Math.floor(Date.now() / 1000) + TTL
  const secure = PUBLIC_URL.startsWith('https:') ? '; Secure' : ''
  return { id, header: `${COOKIE}=${id}.${exp}.${sign(`${id}.${exp}`)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL}${secure}` }
}

/** Per-session token embedded in forms, so other sites can't submit them on your behalf. */
export const csrfToken = (sessionId: string) => sign(`csrf:${sessionId}`)
export const checkCsrf = (sessionId: string, token: string) => safeEqual(token, csrfToken(sessionId))
