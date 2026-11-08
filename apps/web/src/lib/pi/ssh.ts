import { createHash } from 'node:crypto'
import { Client, type ClientChannel, type ConnectConfig, type SFTPWrapper } from 'ssh2'

/*
 * Server only: thin promise wrappers around ssh2. Most requests share one
 * connection per device through `withSharedSsh`, because every new
 * connection is a login the Pi writes to its journal, and health is re-read
 * every ten seconds. `withSsh` opens a connection of its own and always
 * closes it again.
 */

export interface SshTarget {
  host: string
  port: number
  username: string
  authMethod: 'password' | 'key'
  /** The plain password or private key (PEM / OpenSSH format). */
  secret: string
}

export interface ExecResult {
  stdout: string
  stderr: string
  code: number | null
}

const CONNECT_TIMEOUT_MS = 5000

/**
 * Non-interactive SSH sessions skip `.bashrc`, so Node installed through nvm
 * is not on the PATH. Load it when it exists.
 */
const NODE_PATH_PREFIX = '[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"; '

export function connect(target: SshTarget, options: Partial<ConnectConfig> = {}): Promise<Client> {
  const config: ConnectConfig = {
    host: target.host,
    port: target.port,
    username: target.username,
    readyTimeout: CONNECT_TIMEOUT_MS,
    ...(target.authMethod === 'key' ? { privateKey: target.secret } : { password: target.secret }),
    ...options,
  }
  return new Promise((resolve, reject) => {
    const conn = new Client()
    conn.once('ready', () => resolve(conn))
    conn.once('error', (err) => reject(describeConnectError(err, target)))
    conn.connect(config)
  })
}

function describeConnectError(err: Error & { level?: string; code?: string }, target: SshTarget) {
  const where = `${target.username}@${target.host}:${target.port}`
  if (err.level === 'client-authentication') {
    return new Error(
      `Authentication failed for ${where}. Check the username and ${target.authMethod}.`,
    )
  }
  if (err.code === 'ENOTFOUND')
    return new Error(`Host ${target.host} was not found on the network.`)
  if (err.code === 'ECONNREFUSED')
    return new Error(`${where} refused the connection. Is SSH enabled?`)
  if (err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH') {
    return new Error(`${target.host} is unreachable from this machine.`)
  }
  if (/timed out/i.test(err.message)) return new Error(`Timed out connecting to ${where}.`)
  return new Error(`Could not connect to ${where}: ${err.message}`)
}

export async function withSsh<T>(target: SshTarget, fn: (conn: Client) => Promise<T>): Promise<T> {
  const conn = await connect(target)
  try {
    return await fn(conn)
  } finally {
    conn.end()
  }
}

/** How long a shared connection stays open after its last command. */
const SHARED_IDLE_MS = 60_000

/** Notices a Pi that went away (unplugged, off the Wi-Fi) within about 15 seconds. */
const SHARED_KEEPALIVE = { keepaliveInterval: 5_000, keepaliveCountMax: 2 }

/** The connection is gone, or the Pi refused another channel on it (sshd's MaxSessions). */
const LOST_CONNECTION =
  /^(Not connected|No response from server|Keepalive timeout|Channel is not open|\(SSH\) Channel open failure)/

interface SharedConnection {
  key: string
  ready: Promise<Client>
  users: number
  idleTimer?: ReturnType<typeof setTimeout>
  retired: boolean
}

const sharedConnections = new Map<string, SharedConnection>()

/** New credentials make a new key, so a device edited in Settings gets a new connection. */
function sharedKey(target: SshTarget): string {
  return createHash('sha256')
    .update(
      [target.host, target.port, target.username, target.authMethod, target.secret].join('\n'),
    )
    .digest('base64url')
}

function endWhenUnused(shared: SharedConnection) {
  if (shared.users > 0) return
  shared.ready.then(
    (conn) => conn.end(),
    () => {},
  )
}

/** Hands out no more commands on `shared`; it closes once the running ones finish. */
function retire(shared: SharedConnection) {
  if (shared.retired) return
  shared.retired = true
  clearTimeout(shared.idleTimer)
  if (sharedConnections.get(shared.key) === shared) sharedConnections.delete(shared.key)
  endWhenUnused(shared)
}

function acquire(target: SshTarget): SharedConnection {
  const key = sharedKey(target)
  let shared = sharedConnections.get(key)
  if (!shared) {
    const created: SharedConnection = {
      key,
      ready: connect(target, SHARED_KEEPALIVE),
      users: 0,
      retired: false,
    }
    created.ready.then(
      (conn) => {
        // A later error with no listener would crash the server; 'close' follows it.
        conn.on('error', () => {})
        conn.on('close', () => retire(created))
      },
      () => retire(created),
    )
    sharedConnections.set(key, created)
    shared = created
  }
  shared.users += 1
  clearTimeout(shared.idleTimer)
  return shared
}

function release(shared: SharedConnection) {
  shared.users -= 1
  if (shared.users > 0) return
  if (shared.retired) endWhenUnused(shared)
  else shared.idleTimer = setTimeout(() => retire(shared), SHARED_IDLE_MS)
}

/**
 * Runs `fn` on the device's shared connection, connecting first when there is
 * none. If that connection turns out to be dead or full, `fn` runs once more
 * on a new one, so it must be safe to repeat.
 */
export async function withSharedSsh<T>(
  target: SshTarget,
  fn: (conn: Client) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const shared = acquire(target)
    try {
      return await fn(await shared.ready)
    } catch (error) {
      const lost = error instanceof Error && LOST_CONNECTION.test(error.message)
      if (!lost || attempt > 1) throw error
      retire(shared)
    } finally {
      release(shared)
    }
  }
}

export function exec(conn: Client, command: string): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    conn.exec(NODE_PATH_PREFIX + command, (err, stream) => {
      if (err) return reject(err)
      let stdout = ''
      let stderr = ''
      stream.on('data', (data: Buffer) => {
        stdout += data.toString()
      })
      stream.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })
      stream.on('close', (code: number | null) => resolve({ stdout, stderr, code }))
      stream.on('error', reject)
    })
  })
}

/** Runs `command`, handing every output line to `onLine`, and resolves with the exit code. */
export function execStream(
  conn: Client,
  command: string,
  onLine: (line: string) => void,
  options: { pty?: boolean; signal?: AbortSignal } = {},
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    conn.exec(NODE_PATH_PREFIX + command, { pty: options.pty ?? false }, (err, stream) => {
      if (err) return reject(err)
      const splitter = () => {
        let rest = ''
        return {
          push(data: Buffer) {
            const lines = (rest + data.toString()).split(/\r?\n/)
            rest = lines.pop() ?? ''
            for (const line of lines) onLine(line.replace(/\r/g, ''))
          },
          flush() {
            if (rest) onLine(rest.replace(/\r/g, ''))
            rest = ''
          },
        }
      }
      const out = splitter()
      const errOut = splitter()
      stream.on('data', (data: Buffer) => out.push(data))
      stream.stderr.on('data', (data: Buffer) => errOut.push(data))
      stream.on('close', (code: number | null) => {
        out.flush()
        errOut.flush()
        resolve(code)
      })
      stream.on('error', reject)
      if (options.signal?.aborted) stream.close()
      else options.signal?.addEventListener('abort', () => stream.close(), { once: true })
    })
  })
}

/** Starts the user's login shell in a pty of `size` characters. */
export function openShell(
  conn: Client,
  size: { cols: number; rows: number },
): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    conn.shell({ term: 'xterm-256color', cols: size.cols, rows: size.rows }, (err, channel) =>
      err ? reject(err) : resolve(channel),
    )
  })
}

export function openSftp(conn: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)))
  })
}

/** Quotes `value` for a POSIX shell. */
export function sh(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
