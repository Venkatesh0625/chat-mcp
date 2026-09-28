# WhatsApp MCP server

Links to your WhatsApp account through Baileys (as a linked device), saves every message it receives in SQLite, and makes them available over MCP. When you connect an agent, you choose which DMs, groups, and channels it can see.

```bash
bun install
cp .env.example .env   # set PORT and PUBLIC_URL
bun start
```

Connect an MCP client to `$PUBLIC_URL/mcp` (or `http://localhost:$PORT/mcp` on this machine). The connect page has two steps:

1. **Link WhatsApp**: shown only if the server isn't linked yet. Scan the QR code from WhatsApp > Settings > Linked devices.
2. **Choose chats**: tabs for Chats, Groups, Businesses and Channels. The agent can only see the chats you tick.

The server pairs as a desktop app, so the phone sends your full history. If you unlink it from your phone, the next connect shows a fresh QR code; stored messages are kept.

- Data lives in `data/`: `whatsapp.db` (messages), `auth/` (WhatsApp session, which gives full access to your account).
- `bun run grants` lists connected agents and what they can see; `bun run grants revoke <id>` cuts one off.

Env: `PORT`, `HOST` (default `127.0.0.1`), `PUBLIC_URL` (set when exposing through a tunnel), `DATA_DIR`. The server listens on localhost; `sudo tailscale serve --bg $PORT` publishes it over HTTPS to your tailnet (MCP clients require HTTPS for non-localhost OAuth), and `.env` sets `PUBLIC_URL` to that address. There is no password: anyone on your tailnet can open the connect page. Disable with `sudo tailscale serve --https=443 off`.
