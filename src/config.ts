export const DATA_DIR = process.env.DATA_DIR ?? 'data'
export const PORT = Number(process.env.PORT ?? 3000)
export const HOST = process.env.HOST ?? '127.0.0.1'
/** Public origin MCP clients reach this server at (set this when behind a tunnel / reverse proxy). */
export const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, '')
export const MCP_URL = `${PUBLIC_URL}/mcp`

