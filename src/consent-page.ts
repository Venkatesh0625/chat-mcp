// The OAuth consent screen: link WhatsApp (QR, only if needed) → choose chats.
// Rendered once by the server; the link/choose steps are driven client-side
// from /authorize/status and /authorize/chats so the page never loses your selection.
// Visual language: Claude-style warm neutrals, serif display type, clay accent.

import _ from 'lodash'

export type Step = 'link' | 'choose'

export type PageProps = {
  step: Step
  clientName: string
  params: Record<string, string>
  csrf?: string
  error?: string
}

const esc = (s: unknown) => Bun.escapeHTML(String(s ?? ''))


export function renderConsentPage(p: PageProps) {
  const hidden = _.map(p.params, (v, k) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('')
  const initial = (p.clientName.trim()[0] ?? '?').toUpperCase()
  const client = esc(p.clientName)

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Authorize ${client} · WhatsApp</title>
<style>${BASE_CSS}${CSS}</style>
</head><body>
<div class="shell">
  <header class="brand"><span class="brand-mark">${WA_ICON}</span>WhatsApp MCP</header>

  <section class="intro">
    <div class="glyph" aria-hidden="true">
      <div class="tile ink">${esc(initial)}</div>
      <div class="bridge"><span class="lock">${LOCK_ICON}</span></div>
      <div class="tile wa">${WA_ICON}</div>
    </div>
    <p class="eyebrow" id="eyebrow">Authorization request</p>
    <h1><span class="client">${client}</span> would like to access your&nbsp;WhatsApp</h1>
    <p class="lede">Choose the conversations it can read. Everything else stays private.</p>
  </section>

  ${p.error ? `<div class="alert" role="alert">${esc(p.error)}</div>` : ''}

  <section class="card" id="link-pane" hidden>
    <div class="link">
      <div class="qr-frame"><div class="qr" id="qr"><div class="spinner"></div></div></div>
      <div class="link-copy">
        <h2>Link your WhatsApp</h2>
        <ol class="how">
          <li><span>1</span><div>Open <b>WhatsApp</b> on your phone</div></li>
          <li><span>2</span><div>Go to <b>Settings</b> → <b>Linked devices</b></div></li>
          <li><span>3</span><div>Tap <b>Link a device</b> and point your camera at this code</div></li>
        </ol>
      </div>
    </div>
    <div class="status" id="link-status"><i class="pulse"></i><span>Connecting to WhatsApp…</span></div>
  </section>

  <form class="card" id="choose-pane" method="post" action="/authorize" hidden>
    ${hidden}
    <input type="hidden" name="csrf" value="${esc(p.csrf ?? '')}">
    <div id="selected-inputs"></div>

    <div class="section">
      <h2 class="section-title">${client} will be able to</h2>
      <ul class="perms">
        <li><span class="perm-icon yes">${CHECK_ICON}</span><div><b>Read and search messages</b><small>Only in the conversations you select below</small></div></li>
        <li><span class="perm-icon no">${CROSS_ICON}</span><div><b>No access to anything else</b><small>Other chats, and chats you start later, stay invisible</small></div></li>
        <li class="perm-toggle">
          <span class="perm-icon send">${SEND_ICON}</span>
          <label for="can-send"><b>Send messages as you</b><small>Optional. Off unless you turn it on</small></label>
          <label class="switch"><input type="checkbox" name="can_send" id="can-send"><span class="track"><span class="thumb"></span></span></label>
        </li>
      </ul>
    </div>

    <div class="section chats">
      <div class="section-head">
        <h2 class="section-title">Conversations</h2>
        <span class="selected-count" id="selected-count">None selected</span>
      </div>
      <div class="sync" id="sync" hidden><div class="bar"><i id="sync-bar"></i></div><span id="sync-text"></span></div>
      <div class="segmented" role="tablist" id="tabs"></div>
      <div class="toolbar">
        <label class="search">${SEARCH_ICON}<input type="search" id="q" placeholder="Search by name, number or message" autocomplete="off"></label>
        <button type="button" class="text-btn" id="toggle-all">Select all</button>
      </div>
      <ul class="list" id="list" role="listbox" aria-multiselectable="true"></ul>
    </div>

    <div class="actions">
      <button class="btn secondary" name="action" value="deny" formnovalidate>Cancel</button>
      <button class="btn primary" name="action" value="approve" id="approve" disabled>Allow access</button>
    </div>
  </form>

  <footer class="fine">
    <div id="account" class="account"></div>
  </footer>
</div>
<script>${JS}</script>
</body></html>`
}

/** Shown when the server delivered the callback to a client on this machine itself. */
export function renderDonePage(clientName: string, approved: boolean) {
  const client = esc(clientName)
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${approved ? 'Connected' : 'Access denied'} · WhatsApp</title>
<style>${BASE_CSS}${DONE_CSS}</style>
</head><body>
<div class="shell done">
  <div class="seal ${approved ? 'ok' : 'denied'}">${approved ? CHECK_ICON : CROSS_ICON}</div>
  <p class="eyebrow">${approved ? 'Access granted' : 'Access denied'}</p>
  <h1>${approved ? `<span class="client">${client}</span> is connected to your&nbsp;WhatsApp` : `<span class="client">${client}</span> was not given access`}</h1>
  <p class="lede">You can close this tab and return to ${client}.</p>
</div>
</body></html>`
}

// ---------- icons ----------

const WA_ICON = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21c5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2Zm5.8 14.03c-.24.68-1.42 1.3-1.95 1.34-.5.05-.97.23-3.28-.68-2.78-1.1-4.54-3.95-4.68-4.13-.13-.18-1.12-1.49-1.12-2.84 0-1.36.71-2.02.96-2.3.25-.27.55-.34.73-.34l.52.01c.17 0 .39-.06.61.47.24.55.8 1.92.87 2.06.07.14.11.3.02.48-.09.18-.14.3-.27.46l-.41.48c-.14.14-.28.29-.12.56.16.28.71 1.17 1.53 1.9 1.05.94 1.94 1.23 2.21 1.37.28.14.44.11.6-.07.17-.18.69-.8.87-1.08.18-.27.37-.23.62-.14.25.09 1.6.76 1.87.9.28.13.46.2.53.32.07.12.07.68-.17 1.36Z"/></svg>`
const SEARCH_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`
const LOCK_ICON = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`
const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`
const CROSS_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>`
const SEND_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 3 10 14"/><path d="m21 3-7 18-4-7-7-4 18-7Z"/></svg>`

// ---------- styles ----------

const BASE_CSS = `
:root{
  --bg:#F5F4EE; --surface:#FFFFFF; --surface-2:#FAF9F5; --ink:#141413; --text:#3D3D3A; --muted:#83827D; --faint:#B7B5AC;
  --line:#E8E6DC; --line-strong:#D6D3C7; --clay:#C96442; --clay-strong:#B5573A; --clay-soft:#F6E8E1; --selected:#FBF3EE;
  --ok:#5A8C5A; --ok-soft:#E7F0E4; --wa:#25D366;
  --serif:"Tiempos Headline","Copernicus","Iowan Old Style","Palatino Linotype",ui-serif,Georgia,serif;
  --sans:"Styrene B","Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --shadow:0 1px 2px rgba(20,20,19,.04),0 8px 28px -12px rgba(20,20,19,.12);
}
@media (prefers-color-scheme:dark){:root{
  --bg:#1F1E1D; --surface:#262624; --surface-2:#2B2A27; --ink:#F5F4EE; --text:#DEDCD1; --muted:#9C9A92; --faint:#6E6C66;
  --line:#34332F; --line-strong:#45443F; --clay:#D97757; --clay-strong:#E08A6D; --clay-soft:#3A2A23; --selected:#312A25;
  --ok:#8DBA8A; --ok-soft:#27332A; --shadow:0 1px 2px rgba(0,0,0,.2),0 12px 32px -12px rgba(0,0,0,.5);
}}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font:15px/1.5 var(--sans)}
.shell{max-width:600px;margin:0 auto;padding:28px 20px 48px}
.eyebrow{margin:0 0 10px;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
h1{font:400 32px/1.18 var(--serif);letter-spacing:-.01em;color:var(--ink);margin:0 0 12px;text-wrap:balance}
h1 .client{font-weight:600}
.lede{margin:0;color:var(--muted);font-size:16px;text-wrap:pretty}
code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--surface-2);border:1px solid var(--line);padding:1px 6px;border-radius:6px;color:var(--text)}
`

const CSS = `
.brand{display:flex;align-items:center;justify-content:center;gap:8px;font-size:13px;font-weight:600;color:var(--muted);margin-bottom:44px}
.brand-mark{width:22px;height:22px;border-radius:7px;background:var(--ink);color:var(--bg);display:grid;place-items:center}
.brand-mark svg{width:14px;height:14px}
.intro{margin-bottom:28px;text-align:center}
.glyph{display:flex;align-items:center;justify-content:center;margin-bottom:26px}
.tile{width:52px;height:52px;border-radius:16px;display:grid;place-items:center;flex:none}
.tile.ink{background:var(--ink);color:var(--bg);font:500 24px var(--serif)}
.tile.wa{background:var(--surface);border:1px solid var(--line);color:var(--wa);box-shadow:var(--shadow)}
.tile.wa svg{width:28px;height:28px}
.bridge{width:56px;height:1px;background:repeating-linear-gradient(90deg,var(--line-strong) 0 4px,transparent 4px 8px);position:relative}
.lock{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:24px;height:24px;border-radius:50%;
  background:var(--bg);border:1px solid var(--line-strong);color:var(--muted);display:grid;place-items:center}

.alert{margin:0 0 16px;padding:12px 16px;border-radius:12px;background:var(--clay-soft);color:var(--clay-strong);font-size:14px;border:1px solid color-mix(in srgb,var(--clay) 25%,transparent)}

.card{background:var(--surface);border:1px solid var(--line);border-radius:20px;box-shadow:var(--shadow);overflow:clip}
.section{padding:22px 24px}
.section + .section{border-top:1px solid var(--line)}
.section-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.section-title{font:500 13px var(--sans);letter-spacing:.02em;color:var(--muted);margin:0 0 14px}
.selected-count{font-size:13px;color:var(--muted)}
.selected-count.on{color:var(--clay);font-weight:600}

.perms{list-style:none;margin:0;padding:0;display:grid;gap:14px}
.perms li{display:flex;gap:14px;align-items:flex-start}
.perms b{display:block;font-weight:600;color:var(--ink);font-size:14.5px}
.perms small{display:block;color:var(--muted);font-size:13px;margin-top:1px}
.perm-icon{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;flex:none}
.perm-icon svg{width:15px;height:15px}
.perm-icon.yes{background:var(--ok-soft);color:var(--ok)}
.perm-icon.no{background:var(--surface-2);color:var(--muted);border:1px solid var(--line)}
.perm-icon.send{background:var(--clay-soft);color:var(--clay)}
.perm-toggle{padding-top:14px;border-top:1px dashed var(--line);align-items:center!important}
.perm-toggle label[for]{flex:1;cursor:pointer}
.switch{position:relative;cursor:pointer}
.switch input{position:absolute;opacity:0;width:1px;height:1px}
.track{display:block;width:40px;height:24px;border-radius:999px;background:var(--line-strong);position:relative;transition:background .18s}
.thumb{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .18s}
.switch input:checked + .track{background:var(--clay)}
.switch input:checked + .track .thumb{transform:translateX(16px)}
.switch input:focus-visible + .track{outline:2px solid var(--clay);outline-offset:3px}

.sync{display:flex;align-items:center;gap:12px;font-size:12.5px;color:var(--muted);margin:-4px 0 14px}
.sync .bar{flex:1;height:3px;border-radius:3px;background:var(--line);overflow:hidden}
.sync .bar i{display:block;height:100%;width:30%;background:var(--clay);border-radius:3px;transition:width .4s}
.sync .bar i.indeterminate{animation:slide 1.3s ease-in-out infinite}
@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(340%)}}

.segmented{display:flex;gap:2px;padding:3px;background:var(--surface-2);border:1px solid var(--line);border-radius:12px;overflow-x:auto}
.seg{flex:1;font:inherit;font-size:13.5px;font-weight:500;color:var(--muted);background:none;border:0;border-radius:9px;padding:7px 10px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;transition:background .15s,color .15s}
.seg:hover{color:var(--text)}
.seg[aria-selected=true]{background:var(--surface);color:var(--ink);box-shadow:0 1px 2px rgba(20,20,19,.08),0 0 0 1px var(--line)}
.seg .n{font-size:12px;color:var(--faint);font-variant-numeric:tabular-nums}
.seg .dot{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--clay);color:#fff;font-size:11px;font-weight:700;display:grid;place-items:center}

.toolbar{display:flex;gap:12px;align-items:center;margin:14px 0 8px}
.search{flex:1;display:flex;align-items:center;gap:8px;padding:0 12px;border:1px solid var(--line);border-radius:11px;color:var(--faint);background:var(--surface);transition:border-color .15s,box-shadow .15s}
.search:focus-within{border-color:var(--clay);box-shadow:0 0 0 3px color-mix(in srgb,var(--clay) 15%,transparent)}
.search input{flex:1;border:0;outline:0;background:none;font:inherit;font-size:14px;color:var(--ink);padding:9px 0}
.search input::placeholder{color:var(--faint)}
.text-btn{font:inherit;font-size:13.5px;font-weight:600;color:var(--clay);background:none;border:0;cursor:pointer;padding:6px 2px}
.text-btn:disabled{color:var(--faint);cursor:default}

.list{list-style:none;margin:0 -12px;padding:0;max-height:min(46vh,420px);overflow-y:auto;scrollbar-width:thin}
.row{display:flex;align-items:center;gap:13px;padding:10px 12px;border-radius:12px;cursor:pointer;user-select:none;transition:background .12s}
.row:hover{background:var(--surface-2)}
.row[aria-selected=true]{background:var(--selected)}
.avatar{width:40px;height:40px;border-radius:50%;flex:none;display:grid;place-items:center;font:500 15px var(--serif)}
.body{flex:1;min-width:0}
.title{display:flex;gap:8px;align-items:center}
.name{font-weight:600;color:var(--ink);font-size:14.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tag{font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:0 5px;flex:none}
.preview{color:var(--muted);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px}
.when{font-size:12px;color:var(--faint);flex:none;font-variant-numeric:tabular-nums}
.box{width:20px;height:20px;border-radius:6px;border:1.5px solid var(--line-strong);display:grid;place-items:center;flex:none;color:#fff;transition:background .12s,border-color .12s}
.box svg{width:13px;height:13px;opacity:0;transform:scale(.6);transition:.12s}
.row[aria-selected=true] .box{background:var(--clay);border-color:var(--clay)}
.row[aria-selected=true] .box svg{opacity:1;transform:none}
.empty{text-align:center;color:var(--muted);padding:36px 12px;font-size:14px}

.actions{position:sticky;bottom:0;display:flex;gap:10px;justify-content:flex-end;padding:16px 24px;border-top:1px solid var(--line);
  background:color-mix(in srgb,var(--surface) 92%,transparent);backdrop-filter:blur(8px)}
.btn{font:inherit;font-size:14.5px;font-weight:600;border-radius:11px;padding:10px 20px;cursor:pointer;border:1px solid transparent;transition:background .15s,opacity .15s,transform .05s}
.btn:active{transform:translateY(1px)}
.btn.secondary{background:var(--surface);border-color:var(--line-strong);color:var(--text)}
.btn.secondary:hover{background:var(--surface-2)}
.btn.primary{background:var(--ink);color:var(--bg);min-width:170px}
.btn.primary:hover{opacity:.9}
.btn.primary:disabled{opacity:.35;cursor:not-allowed;transform:none}

.link{display:flex;gap:28px;align-items:center;padding:26px 24px 20px;flex-wrap:wrap}
.qr-frame{padding:10px;border-radius:18px;border:1px solid var(--line);background:var(--surface-2)}
.qr{width:212px;height:212px;border-radius:10px;background:#fff;padding:12px;display:grid;place-items:center}
.qr svg{width:100%;height:100%}
.link-copy{flex:1;min-width:220px}
.link-copy h2{font:400 22px/1.2 var(--serif);color:var(--ink);margin:0 0 16px}
.how{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.how li{display:flex;gap:12px;align-items:flex-start;font-size:14.5px}
.how span{width:22px;height:22px;border-radius:50%;border:1px solid var(--line-strong);display:grid;place-items:center;font:500 12px var(--serif);color:var(--muted);flex:none;margin-top:1px}
.how b{color:var(--ink);font-weight:600}
.status{display:flex;align-items:center;gap:10px;padding:14px 24px;border-top:1px solid var(--line);font-size:13.5px;color:var(--muted);background:var(--surface-2)}
.status.ok{color:var(--ok)}
.pulse{width:8px;height:8px;border-radius:50%;background:var(--clay);box-shadow:0 0 0 0 color-mix(in srgb,var(--clay) 50%,transparent);animation:pulse 1.6s infinite}
.status.ok .pulse{background:var(--ok);animation:none}
@keyframes pulse{70%{box-shadow:0 0 0 8px transparent}100%{box-shadow:0 0 0 0 transparent}}
.spinner{width:26px;height:26px;border-radius:50%;border:2.5px solid #E8E6DC;border-top-color:#C96442;animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(1turn)}}

.fine{margin-top:22px;display:grid;gap:6px;font-size:12.5px;color:var(--muted);text-align:center}
.account{display:flex;align-items:center;justify-content:center;gap:6px}
.account .on{width:7px;height:7px;border-radius:50%;background:var(--ok)}
.account b{color:var(--text);font-weight:600}

@media (max-width:520px){
  h1{font-size:26px} .brand{margin-bottom:28px} .section{padding:18px} .actions{padding:14px 18px}
  .btn.primary{flex:1;min-width:0} .qr{width:190px;height:190px} .link{justify-content:center}
}
`

const DONE_CSS = `
.done{min-height:90vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.seal{width:60px;height:60px;border-radius:50%;display:grid;place-items:center;margin-bottom:24px}
.seal svg{width:28px;height:28px}
.seal.ok{background:var(--ok-soft);color:var(--ok)}
.seal.denied{background:var(--clay-soft);color:var(--clay)}
`

// ---------- behaviour ----------

const JS = `
const $ = s => document.querySelector(s)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c])
const TABS = [
  { key: 'dm', label: 'People', match: c => c.kind === 'dm' && !c.is_business },
  { key: 'group', label: 'Groups', match: c => c.kind === 'group' },
  { key: 'business', label: 'Businesses', match: c => c.kind === 'dm' && !!c.is_business },
  { key: 'newsletter', label: 'Channels', match: c => c.kind === 'newsletter' },
]
// Soft tinted avatars: [background, ink] pairs in warm, muted tones.
const TINTS = [['#F3E3DA','#9A4A2F'],['#E5ECDF','#4F6B45'],['#E1E8EF','#3F5A73'],['#ECE3EE','#6B4A72'],['#F1EAD6','#7A6326'],['#E0ECEA','#3E6A64'],['#F0E0E0','#8A3F3F'],['#E8E6DC','#55534C']]
const DARK_TINTS = [['#4A3027','#F0B79F'],['#2F3A2B','#B5D3A8'],['#2B3540','#A9C3DB'],['#3A2E3D','#D3B3DA'],['#3D3623','#E3CC8B'],['#263A37','#9FD0C7'],['#402B2B','#E6A9A9'],['#34332F','#C9C6BB']]
const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
const dark = matchMedia('(prefers-color-scheme: dark)')

let chats = [], tab = 'dm', query = '', meId = null, linkedHere = false
const selected = new Set()

function phone(id) {
  const [user, server] = id.split('@')
  return server === 's.whatsapp.net' ? '+' + user : null
}
function title(c) {
  if (c.id === meId) return 'Message yourself'
  if (c.id === '0@s.whatsapp.net') return 'WhatsApp'
  return c.name || phone(c.id) || (c.kind === 'group' ? 'Unnamed group' : c.kind === 'newsletter' ? 'Channel' : 'Hidden number')
}
function initials(c) {
  if (c.id === meId) return 'Me'
  const parts = (c.name || '').replace(/[^\\p{L}\\p{N} ]/gu, '').trim().split(/\\s+/).filter(Boolean)
  if (!parts.length) return c.kind === 'group' ? 'G' : c.kind === 'newsletter' ? 'C' : '#'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}
function tint(id) {
  let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const set = dark.matches ? DARK_TINTS : TINTS
  return set[h % set.length]
}
function when(ts) {
  if (!ts) return ''
  const d = new Date(ts * 1000), now = new Date()
  const days = Math.floor((new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5)
  if (days === 0) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (days === 1) return 'Yesterday'
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
}
function preview(c) {
  if (c.last_text) return (c.last_from_me ? 'You: ' : '') + c.last_text.replace(/\\s+/g, ' ')
  const p = phone(c.id)
  if (c.name && p) return p
  if (c.id === '0@s.whatsapp.net') return 'Official WhatsApp notices'
  return c.message_count ? c.message_count + (c.message_count === 1 ? ' message stored' : ' messages stored') : 'No messages stored yet'
}

function visible() {
  const t = TABS.find(t => t.key === tab)
  const q = query.toLowerCase()
  return chats.filter(t.match).filter(c => !q || (title(c) + ' ' + c.id + ' ' + (c.last_text || '')).toLowerCase().includes(q))
}

function renderTabs() {
  // Land on the first non-empty tab the first time chats arrive.
  if (!chats.some(TABS.find(t => t.key === tab).match)) {
    const first = TABS.find(t => chats.some(t.match)); if (first) tab = first.key
  }
  $('#tabs').innerHTML = TABS.map(t => {
    const all = chats.filter(t.match)
    if (!all.length && t.key === 'newsletter') return ''
    const picked = all.filter(c => selected.has(c.id)).length
    return '<button type="button" role="tab" class="seg" data-tab="' + t.key + '" aria-selected="' + (t.key === tab) + '">' + t.label +
      (picked ? '<span class="dot">' + picked + '</span>' : '<span class="n">' + all.length + '</span>') + '</button>'
  }).join('')
}

function renderList() {
  const rows = visible()
  $('#list').innerHTML = rows.length ? rows.map(c => {
    const on = selected.has(c.id)
    const [bg, fg] = tint(c.id)
    const tag = c.is_business ? '<span class="tag">Business</span>' : c.kind === 'newsletter' ? '<span class="tag">Channel</span>' : ''
    return '<li class="row" role="option" data-id="' + esc(c.id) + '" aria-selected="' + on + '">' +
      '<div class="avatar" style="background:' + bg + ';color:' + fg + '">' + esc(initials(c)) + '</div>' +
      '<div class="body"><div class="title"><span class="name">' + esc(title(c)) + '</span>' + tag + '</div>' +
      '<div class="preview">' + esc(preview(c)) + '</div></div>' +
      '<span class="when">' + esc(when(c.last_message_at)) + '</span><span class="box">' + CHECK + '</span></li>'
  }).join('') : '<li class="empty">' + (query ? 'No conversations match “' + esc(query) + '”' : 'Nothing here yet') + '</li>'
  const allOn = rows.length && rows.every(c => selected.has(c.id))
  $('#toggle-all').textContent = allOn ? 'Clear' : 'Select all'
  $('#toggle-all').disabled = !rows.length
}

function renderSelection() {
  $('#selected-inputs').innerHTML = [...selected].map(id => '<input type="hidden" name="chat" value="' + esc(id) + '">').join('')
  const n = selected.size
  const label = n + (n === 1 ? ' conversation' : ' conversations')
  $('#approve').disabled = !n
  $('#approve').textContent = n ? 'Allow access to ' + label : 'Allow access'
  $('#selected-count').textContent = n ? label + ' selected' : 'None selected'
  $('#selected-count').classList.toggle('on', !!n)
}

function render() { renderTabs(); renderList(); renderSelection() }

$('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; render() } })
$('#q').addEventListener('input', e => { query = e.target.value; renderList() })
$('#list').addEventListener('click', e => {
  const row = e.target.closest('.row'); if (!row) return
  const id = row.dataset.id
  selected.has(id) ? selected.delete(id) : selected.add(id)
  render()
})
$('#toggle-all').addEventListener('click', () => {
  const rows = visible(), allOn = rows.every(c => selected.has(c.id))
  rows.forEach(c => allOn ? selected.delete(c.id) : selected.add(c.id))
  render()
})
dark.addEventListener('change', renderList)

async function getJSON(url) {
  const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' })
  if (r.status === 401) { location.reload(); return new Promise(() => {}) } // server restarted: reload for a fresh session
  return r.json()
}

async function refreshChats() { chats = await getJSON('/authorize/chats'); render() }

function showSync(s) {
  $('#sync').hidden = !s.syncing
  if (!s.syncing) return
  const bar = $('#sync-bar')
  const pct = typeof s.progress === 'number' ? s.progress : null
  bar.classList.toggle('indeterminate', pct === null)
  bar.style.width = pct === null ? '30%' : Math.max(4, pct) + '%'
  $('#sync-text').textContent = 'Importing history · ' + s.stats.chats.toLocaleString() + ' chats, ' + s.stats.messages.toLocaleString() + ' messages'
}

function setStatus(text, ok) {
  $('#link-status').className = 'status' + (ok ? ' ok' : '')
  $('#link-status span').textContent = text
}

async function choose(status) {
  $('#eyebrow').textContent = linkedHere ? 'Step 2 of 2 · Choose conversations' : 'Authorization request'
  $('#link-pane').hidden = true
  $('#choose-pane').hidden = false
  const me = status.me
  meId = me?.id ?? null
  if (me) $('#account').innerHTML = '<span class="on"></span>Connected as <b>' + esc(me.name || phone(me.id) || '') + '</b>' + (me.name && phone(me.id) ? ' · ' + esc(phone(me.id)) : '')
  await refreshChats()
  // Keep the list fresh while history is still streaming in; selections persist across refreshes.
  let s = status
  while (true) {
    showSync(s)
    await new Promise(r => setTimeout(r, s.syncing ? 3000 : 10000))
    s = await getJSON('/authorize/status')
    if (s.status !== 'open') return link()
    await refreshChats()
  }
}

async function link() {
  linkedHere = true
  $('#eyebrow').textContent = 'Step 1 of 2 · Link WhatsApp'
  $('#choose-pane').hidden = true
  $('#link-pane').hidden = false
  let lastQr = null
  while (true) {
    const s = await getJSON('/authorize/status')
    if (s.status === 'open') {
      setStatus('Linked. Loading your conversations…', true)
      await new Promise(r => setTimeout(r, 600))
      return choose(s)
    }
    if (s.qrSvg && s.qrSvg !== lastQr) { $('#qr').innerHTML = s.qrSvg; lastQr = s.qrSvg }
    setStatus(s.status === 'qr' ? 'Waiting for you to scan. The code refreshes automatically.' : 'Connecting to WhatsApp…')
    await new Promise(r => setTimeout(r, 1500))
  }
}

getJSON('/authorize/status').then(s => s.status === 'open' ? choose(s) : link())
`
