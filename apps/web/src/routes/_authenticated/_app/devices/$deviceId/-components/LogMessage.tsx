export type TokenKind = 'name' | 'quoted' | 'address' | 'path' | 'key' | 'problem'

export interface Token {
  kind: TokenKind | null
  text: string
}

/** Earlier alternatives win when two start at the same place. */
const TOKEN = new RegExp(
  [
    // What the message is about: `apt-daily.service:`, `dhcp4 (wlan0):`, `pam_unix(cron:session):`
    String.raw`(?<subject>^[\w.@-]+(?: ?\([^()\s]*\))?:(?=\s))`,
    String.raw`(?<quoted>"(?:[^"\\\n]|\\.)*"|(?<![\w'])'[^'\n]+'(?![\w']))`,
    String.raw`(?<address>\b(?:https?|ftp)://[^\s"'<>]*[^\s"'<>.,;:!?)\]]|\b(?:\d{1,3}\.){3}\d{1,3}\b|\b[\da-f]{2}(?::[\da-f]{2}){5}\b)`,
    // Path segments don't end in a dot, so a full stop after a path stays out of it.
    String.raw`(?<path>(?<![\w.:/~-])~?(?:/[\w.@%+-]*[\w@%+-])+/?)`,
    String.raw`(?<unit>\b[\w@.\\-]+\.(?:service|socket|timer|target|mount|automount|swap|path|slice|scope|device)\b)`,
    String.raw`(?<key>\b[a-z_][\w.-]*(?==))`,
    String.raw`(?<problem>\b(?:fail(?:ed|ure|s)?|errors?|denied|refused|timed out|timeout|unable|cannot|invalid|not found)\b)`,
  ].join('|'),
  'gi',
)

const KIND: Record<string, TokenKind> = {
  subject: 'name',
  unit: 'name',
  quoted: 'quoted',
  address: 'address',
  path: 'path',
  key: 'key',
  problem: 'problem',
}

/** Splits a journal message into plain text and the parts worth picking out. */
export function tokenizeLogMessage(text: string): Token[] {
  const tokens: Token[] = []
  let last = 0
  for (const match of text.matchAll(TOKEN)) {
    const group = Object.entries(match.groups ?? {}).find(([, value]) => value !== undefined)
    if (!group || !match[0]) continue
    if (match.index > last) tokens.push({ kind: null, text: text.slice(last, match.index) })
    tokens.push({ kind: KIND[group[0]], text: match[0] })
    last = match.index + match[0].length
  }
  if (last < text.length) tokens.push({ kind: null, text: text.slice(last) })
  return tokens
}

const TOKEN_CLASS: Record<TokenKind, string> = {
  name: 'font-medium',
  quoted: 'text-emerald-700 dark:text-emerald-300',
  address: 'text-sky-700 dark:text-sky-300',
  path: 'text-violet-700 dark:text-violet-300',
  key: 'text-muted-foreground',
  problem: 'text-destructive',
}

/** A journal message with service names, addresses, paths and failures picked out. */
export function LogMessage({ text }: { text: string }) {
  return tokenizeLogMessage(text).map((token, i) =>
    token.kind ? (
      // Tokens of one message never reorder.
      // biome-ignore lint/suspicious/noArrayIndexKey: see above
      <span key={i} className={TOKEN_CLASS[token.kind]}>
        {token.text}
      </span>
    ) : (
      token.text
    ),
  )
}
