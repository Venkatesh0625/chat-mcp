// bun run grants            -> list connected agents and the chats each can see
// bun run grants revoke <id> -> cut off a connection immediately
import { db, listGrantChats } from './db'

const [cmd, id] = process.argv.slice(2)

if (cmd === 'revoke' && id) {
  const { changes } = db.run('UPDATE grants SET revoked_at = unixepoch() WHERE id = ? AND revoked_at IS NULL', [id])
  db.run('DELETE FROM tokens WHERE grant_id = ?', [id])
  console.log(changes ? `Revoked ${id}` : `No active grant ${id}`)
} else {
  const grants = db
    .query<{ id: string; client: string | null; can_send: number; created_at: number }, []>(
      `SELECT g.id, c.name AS client, g.can_send, g.created_at FROM grants g JOIN oauth_clients c ON c.id = g.client_id
       WHERE g.revoked_at IS NULL AND EXISTS (SELECT 1 FROM tokens t WHERE t.grant_id = g.id)
       ORDER BY g.created_at DESC`,
    )
    .all()
  if (!grants.length) console.log('No active connections.')
  for (const g of grants) {
    console.log(`${g.id}  ${g.client ?? 'unknown client'}  ${new Date(g.created_at * 1000).toLocaleString()}${g.can_send ? '  [can send]' : ''}`)
    for (const c of listGrantChats(g.id)) console.log(`    ${c.kind.padEnd(10)} ${c.name ?? ''}  (${c.id})`)
  }
}
