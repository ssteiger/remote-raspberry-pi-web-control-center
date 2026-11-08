/*
 * Client-safe: the shapes the device pages and the server functions share,
 * and the validation both sides run on device input.
 */

export type AuthMethod = 'password' | 'key'

/** A device as the browser sees it: everything except the secret. */
export interface PublicDevice {
  id: string
  name: string
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  remotePath: string
  gpioPins: number[]
  createdAt: string
}

export interface DeviceInput {
  name: string
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  /** Required when creating; when editing, empty keeps the saved one. */
  secret: string
  remotePath: string
}

export interface ScriptStatus {
  running: boolean
  pid: number | null
  /** Seconds since the script was started, when it is running. */
  uptimeSeconds: number | null
}

export type DeviceHealth =
  | {
      online: true
      hostname: string | null
      model: string | null
      temperatureC: number | null
      memTotalBytes: number | null
      memAvailableBytes: number | null
      uptimeSeconds: number | null
      load: [number, number, number] | null
      script: ScriptStatus
    }
  | { online: false; error: string }

export type GpioLevel = 0 | 1

export interface GpioPinState {
  pin: number
  /** `op` (output), `ip` (input), `a0`–`a5` (alternate function) or `no` (unset). */
  mode: string
  level: GpioLevel | null
}

export interface DeploymentSummary {
  id: number
  status: 'running' | 'success' | 'failed'
  startedAt: string
  finishedAt: string | null
  triggeredBy: string | null
}

export type SysLogSource = 'system' | 'kernel' | 'unit'

export interface SysLogFilter {
  source: SysLogSource
  /** The systemd unit when `source` is `unit`, e.g. `ssh.service`. */
  unit: string
  /** Show this syslog priority and more severe: 3 errors, 4 warnings, 6 info, 7 everything. */
  priority: number
}

/** One journal entry, as the system-logs stream sends it. */
export interface SysLogEntry {
  /** Milliseconds since the epoch; null for plain syslog lines. */
  time: number | null
  /** 0 (emergency) to 7 (debug); null when unknown. */
  priority: number | null
  /** The program, e.g. `sshd` or `kernel`. */
  identifier: string | null
  pid: string | null
  message: string
}

export function sysLogFilterProblem(filter: SysLogFilter): string | null {
  if (!['system', 'kernel', 'unit'].includes(filter.source)) return 'Unknown log source'
  if (!Number.isInteger(filter.priority) || filter.priority < 0 || filter.priority > 7) {
    return 'The priority must be 0 to 7'
  }
  if (filter.source === 'unit') {
    if (!filter.unit.trim()) return 'Enter a service name, e.g. ssh'
    if (!/^[A-Za-z0-9@._:-]{1,100}$/.test(filter.unit.trim())) {
      return 'A service name has letters, numbers and @ . _ : - only'
    }
  }
  return null
}

export interface ScannedNetwork {
  interfaceName: string
  /** This computer's address on it. */
  address: string
  /** The range that was probed, e.g. `192.168.1.0/24`. */
  range: string
}

export interface DiscoveredHost {
  ip: string
  /** From the name lookup or the reverse lookup, when there is one. */
  hostname: string | null
  mac: string | null
  /** The network card is one Raspberry Pi Ltd makes (by its MAC prefix). */
  isRaspberryPi: boolean
  sshOpen: boolean
  /** What the SSH server says first, e.g. `SSH-2.0-OpenSSH_9.2p1 Debian-2+deb12u3`. */
  sshBanner: string | null
  /** Why it is listed, one short sentence each. */
  reasons: string[]
}

export interface DiscoveryResult {
  networks: ScannedNetwork[]
  hosts: DiscoveredHost[]
  /** Host names that were looked up and what they resolved to. */
  names: { name: string; addresses: string[] }[]
  scannedCount: number
  durationMs: number
}

/** `raspberrypi.local` and anything else worth trying by name; plain names get `.local`. */
export function hostNameProblem(value: string): string | null {
  const name = value.trim()
  if (!name) return 'Enter a host name'
  if (
    !/^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/.test(
      name,
    )
  ) {
    return 'Use letters, numbers, dashes and dots only'
  }
  return null
}

/**
 * The deploy route streams progress as plain text lines; its last line is
 * `::result success` or `::result failed <reason>`.
 */
export const DEPLOY_RESULT_PREFIX = '::result '

export interface TerminalSize {
  cols: number
  rows: number
}

/**
 * The terminal route streams these as JSON, one per line. `ready` comes first
 * once the shell is open, and either `exit` or `error` comes last.
 */
export type TerminalEvent =
  | { type: 'ready'; session: string }
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number | null }
  | { type: 'error'; message: string }

/** The most text one request may type into a shell; longer pastes go in parts. */
export const MAX_TERMINAL_INPUT = 64 * 1024

export function terminalSizeProblem(size: TerminalSize): string | null {
  if (!Number.isInteger(size.cols) || size.cols < 2 || size.cols > 500) {
    return 'The terminal must be 2 to 500 columns wide'
  }
  if (!Number.isInteger(size.rows) || size.rows < 1 || size.rows > 200) {
    return 'The terminal must be 1 to 200 rows high'
  }
  return null
}

export const MIN_GPIO = 0
export const MAX_GPIO = 27

export function isValidGpioPin(pin: number): boolean {
  return Number.isInteger(pin) && pin >= MIN_GPIO && pin <= MAX_GPIO
}

/**
 * The deploy folder is wiped before every upload, so it must be a plain
 * relative path inside the Pi user's home directory: no `/` at the start, no
 * `.` or `..` parts.
 */
export function remotePathProblem(value: string): string | null {
  const path = value.trim().replace(/^~\//, '')
  if (!path) return 'Enter a folder name'
  if (path.startsWith('/')) return 'Use a folder inside the home directory, without a leading /'
  if (!/^[A-Za-z0-9._\-/]+$/.test(path))
    return 'Use letters, numbers, dots, dashes and slashes only'
  if (path.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    return 'Leave out empty, . and .. parts'
  }
  return null
}

export function normalizeRemotePath(value: string): string {
  return value.trim().replace(/^~\//, '')
}

/** Returns the first problem with `input`, or null when it can be saved. */
export function deviceInputProblem(
  input: DeviceInput,
  { requireSecret }: { requireSecret: boolean },
) {
  if (!input.name.trim()) return 'Give the device a name'
  if (!input.host.trim()) return 'Enter the host name or IP address'
  if (!/^[A-Za-z0-9.\-:[\]]+$/.test(input.host.trim()))
    return 'The host contains invalid characters'
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    return 'The port must be between 1 and 65535'
  }
  if (!input.username.trim()) return 'Enter the SSH username'
  if (!/^[a-z_][a-z0-9_-]*$/i.test(input.username.trim())) return 'The username is not valid'
  if (input.authMethod !== 'password' && input.authMethod !== 'key') return 'Pick password or key'
  if (requireSecret && !input.secret) {
    return input.authMethod === 'key' ? 'Paste the private key' : 'Enter the password'
  }
  return remotePathProblem(input.remotePath)
}
