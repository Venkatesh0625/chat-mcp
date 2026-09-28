import _ from 'lodash'
import { HOST, MCP_URL, PORT, PUBLIC_URL } from './config'
import { handleMcp } from './mcp'
import * as oauth from './oauth'
import { getWaState, startWhatsApp } from './whatsapp'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'access-control-expose-headers': 'www-authenticate, mcp-session-id',
}

function withCors(res: Response) {
  _.forOwn(cors, (v, k) => res.headers.set(k, v))
  return res
}

Bun.serve({
  hostname: HOST,
  port: PORT,
  routes: {
    // Landing page: the consent flow itself is reached through an MCP client, not directly.
    '/': () => {
      const wa = getWaState()
      const status = wa.status === 'open' ? `connected as ${wa.me?.name ?? wa.me?.id ?? 'unknown'}` : 'not linked yet (you will be shown a QR code when you connect)'
      return new Response(
        `<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>WhatsApp MCP</title>
<body style="font:15px/1.5 system-ui,sans-serif;max-width:560px;margin:3rem auto;padding:0 1rem">
<h1 style="font-size:1.3rem">WhatsApp MCP server</h1>
<p>WhatsApp: <b>${Bun.escapeHTML(status)}</b></p>
<p>Add this URL as an MCP server in your client. It will open the connect page, where you choose which chats the agent can see:</p>
<pre style="padding:.8rem;border-radius:8px;background:#8881;overflow:auto">${Bun.escapeHTML(MCP_URL)}</pre>
<pre style="padding:.8rem;border-radius:8px;background:#8881;overflow:auto">claude mcp add --transport http whatsapp ${Bun.escapeHTML(MCP_URL)}</pre>`,
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      )
    },
    '/.well-known/oauth-protected-resource': () => withCors(oauth.protectedResourceMetadata()),
    '/.well-known/oauth-protected-resource/mcp': () => withCors(oauth.protectedResourceMetadata()),
    '/.well-known/oauth-authorization-server': () => withCors(oauth.authorizationServerMetadata()),
    '/.well-known/openid-configuration': () => withCors(oauth.authorizationServerMetadata()),
    '/register': { POST: async req => withCors(await oauth.register(req)), OPTIONS: () => new Response(null, { headers: cors }) },
    '/token': { POST: async req => withCors(await oauth.tokenEndpoint(req)), OPTIONS: () => new Response(null, { headers: cors }) },
    '/authorize': { GET: oauth.authorizePage, POST: oauth.authorizeSubmit },
    '/authorize/status': { GET: oauth.authorizeStatus },
    '/authorize/chats': { GET: oauth.authorizeChats },
    '/mcp': async req => {
      if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
      const grant = oauth.authenticate(req)
      if (!grant) return withCors(oauth.unauthorized())
      return withCors(await handleMcp(req, grant))
    },
  },
  fetch: () => new Response('Not found', { status: 404 }),
})

console.log(`MCP server: ${MCP_URL}  (listening on ${HOST}:${PORT}, public URL ${PUBLIC_URL})`)
startWhatsApp()
