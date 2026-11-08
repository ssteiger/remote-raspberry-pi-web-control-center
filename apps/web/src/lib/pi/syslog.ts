import type { StreamEvent } from './sse'
import { sh } from './ssh'
import type { SysLogEntry, SysLogFilter } from './types'

/*
 * Server only: follows the Pi's systemd journal as JSON, one entry per line.
 * Without journalctl it falls back to tailing /var/log/syslog unfiltered.
 */

const NO_JOURNAL = '::no-journal'
const HISTORY = 200

export function sysLogCommand(filter: SysLogFilter): string {
  const args = ['--no-pager', '--output=json', `--lines=${HISTORY}`, '--follow']
  if (filter.source === 'kernel') args.push('--dmesg')
  if (filter.source === 'unit') args.push(`--unit=${sh(filter.unit.trim())}`)
  if (filter.priority < 7) args.push(`--priority=${filter.priority}`)
  return [
    'if command -v journalctl >/dev/null 2>&1; then',
    `  journalctl ${args.join(' ')} 2>&1`,
    'else',
    `  echo "${NO_JOURNAL}"`,
    '  f=/var/log/syslog; [ -r "$f" ] || f=/var/log/messages',
    `  tail -n ${HISTORY} -F "$f" 2>&1`,
    'fi',
  ].join('\n')
}

/** journald sends MESSAGE as an array of bytes when it is not valid UTF-8. */
function text(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return Buffer.from(value as number[]).toString('utf8')
  return null
}

function parseEntry(line: string): SysLogEntry | null {
  if (!line.startsWith('{')) return null
  try {
    const raw = JSON.parse(line) as Record<string, unknown>
    const micros = Number(raw.__REALTIME_TIMESTAMP)
    const priority = Number(raw.PRIORITY)
    return {
      time: Number.isFinite(micros) ? Math.round(micros / 1000) : null,
      priority: Number.isInteger(priority) ? priority : null,
      identifier:
        text(raw.SYSLOG_IDENTIFIER) ??
        text(raw._COMM) ??
        (raw._TRANSPORT === 'kernel' ? 'kernel' : null),
      pid: text(raw._PID) ?? text(raw.SYSLOG_PID),
      message: text(raw.MESSAGE) ?? '',
    }
  } catch {
    return null
  }
}

/**
 * Journal entries become `message` events carrying a SysLogEntry as JSON.
 * journalctl's own remarks (no permission, no entries, unknown unit) become
 * `notice` events.
 */
export function sysLogEvent(line: string): StreamEvent | null {
  if (!line.trim()) return null
  if (line === NO_JOURNAL) {
    return {
      event: 'notice',
      data: 'journalctl is not installed, so this shows /var/log/syslog without filters.',
    }
  }
  const entry = parseEntry(line)
  if (entry) return { event: null, data: JSON.stringify(entry) }
  if (/not seeing messages from other users and the system/i.test(line)) {
    return { event: 'notice', data: 'no-permission' }
  }
  if (/^Hint:|^\s+Users in groups|^\s+Pass -q to turn off|-- No entries --/i.test(line)) {
    return null
  }
  if (/^(No journal files|Failed to|Invalid|Unknown)/i.test(line)) {
    return { event: 'notice', data: line }
  }
  const plain: SysLogEntry = {
    time: null,
    priority: null,
    identifier: null,
    pid: null,
    message: line,
  }
  return { event: null, data: JSON.stringify(plain) }
}
