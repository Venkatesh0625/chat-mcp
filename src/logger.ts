import _ from 'lodash'

// Minimal logger satisfying Baileys' ILogger, printing through console instead of pulling in pino.
const LEVELS = ['trace', 'debug', 'info', 'warn', 'error'] as const
type Level = (typeof LEVELS)[number]

export type Logger = { level: string; child(bindings: Record<string, unknown>): Logger } & Record<Level, (obj: unknown, msg?: string) => void>

export function createLogger(level: string, bindings: Record<string, unknown> = {}): Logger {
  const min = Math.max(0, LEVELS.indexOf(level as Level))
  const log = (lvl: Level) => (obj: unknown, msg?: string) => {
    if (LEVELS.indexOf(lvl) < min) return
    const [text, extra] = _.isString(obj) ? [obj, undefined] : [msg ?? '', obj]
    const out = lvl === 'error' || lvl === 'warn' ? console.error : console.log
    out(`[baileys:${lvl}]`, text, ..._.compact([_.isEmpty(bindings) ? null : bindings, extra]))
  }
  return {
    level,
    child: extra => createLogger(level, { ...bindings, ...extra }),
    ..._.fromPairs(LEVELS.map(l => [l, log(l)])),
  } as Logger
}
