import { randomBytes } from 'node:crypto'
import type { Device } from '@rpi-control-center/db-drizzle'
import type { Client, ClientChannel } from 'ssh2'

import { requireSignedInUser } from '~/lib/utils/supabase/server'
import { getOwnedDevice, toSshTarget } from './devices'
import { formatDuration } from './format'
import { logger } from './logger'
import { connect, openShell } from './ssh'
import { type TerminalEvent, type TerminalSize, terminalSizeProblem } from './types'

/*
 * Server only: interactive login shells on a device. A POST to the terminal
 * route opens one and streams its output back as TerminalEvent lines. What
 * the browser types, and its size changes, come in through `writeToShell`,
 * addressed by the session id the stream started with. Closing the response
 * ends the shell, and the shell ending closes the response.
 */

interface Shell {
  ownerId: string
  deviceId: string
  channel: ClientChannel
}

const shells = new Map<string, Shell>()

const HEARTBEAT_MS = 15_000

/** Notices a Pi that went away (unplugged, off the Wi-Fi) within about 45 seconds. */
const KEEPALIVE = { keepaliveInterval: 15_000, keepaliveCountMax: 3 }

/** Output chunks held for a browser that reads slowly before the Pi is asked to wait. */
const QUEUED_CHUNKS = 32

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function openTerminal({
  request,
  deviceId,
}: {
  request: Request
  deviceId: string
}): Promise<Response> {
  let ownerId: string
  let device: Device
  try {
    const user = await requireSignedInUser('Sign in to open a terminal')
    ownerId = user.id
    device = await getOwnedDevice(deviceId, user.id)
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Not allowed', { status: 403 })
  }

  const body = (await request.json().catch(() => ({}))) as Partial<TerminalSize>
  const size = { cols: Number(body.cols), rows: Number(body.rows) }
  const problem = terminalSizeProblem(size)
  if (problem) return new Response(problem, { status: 400 })

  const id = randomBytes(24).toString('base64url')
  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array>
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let conn: Client | undefined
  let channel: ClientChannel | undefined
  let openedAt: number | undefined
  let closed = false

  const line = (event: TerminalEvent) => encoder.encode(`${JSON.stringify(event)}\n`)
  const push = (chunk: Uint8Array) => {
    if (closed) return
    try {
      controller.enqueue(chunk)
    } catch {
      close()
    }
  }

  const close = (last?: TerminalEvent) => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    shells.delete(id)
    conn?.end()
    try {
      if (last) controller.enqueue(line(last))
      controller.close()
    } catch {
      // The browser already went away.
    }
    if (openedAt === undefined) {
      if (last?.type === 'error') {
        void logger.error(`Terminal on "${device.name}" could not connect: ${last.message}`)
      }
      return
    }
    const after = formatDuration((Date.now() - openedAt) / 1000)
    if (last?.type === 'error') {
      void logger.warn(`Terminal on "${device.name}" was cut off after ${after}: ${last.message}`)
    } else {
      void logger.info(`Terminal on "${device.name}" closed after ${after}`)
    }
  }

  const run = async () => {
    let shell: ClientChannel
    try {
      conn = await connect(toSshTarget(device), KEEPALIVE)
      shell = await openShell(conn, size)
    } catch (error) {
      conn?.end()
      close({ type: 'error', message: messageOf(error) })
      return
    }
    if (closed) {
      conn.end()
      return
    }
    channel = shell
    shells.set(id, { ownerId, deviceId: device.id, channel: shell })
    openedAt = Date.now()
    push(line({ type: 'ready', session: id }))
    void logger.info(`Terminal opened on "${device.name}"`)

    const forward = (decoder: TextDecoder) => (chunk: Buffer) => {
      const data = decoder.decode(chunk, { stream: true })
      if (data) push(line({ type: 'output', data }))
      if ((controller.desiredSize ?? 0) <= 0) shell.pause()
    }
    shell.on('data', forward(new TextDecoder()))
    shell.stderr.on('data', forward(new TextDecoder()))
    let exitCode: number | null = null
    shell.on('exit', (code: number | null) => {
      exitCode = code
    })
    shell.on('close', () => close({ type: 'exit', code: exitCode }))
    conn.on('error', (error) =>
      close({ type: 'error', message: `Lost the connection to ${device.name}: ${error.message}` }),
    )
    conn.on('close', () =>
      close({ type: 'error', message: `${device.name} closed the connection` }),
    )
  }

  const stream = new ReadableStream<Uint8Array>(
    {
      start(c) {
        controller = c
        const blank = encoder.encode('\n')
        heartbeat = setInterval(() => push(blank), HEARTBEAT_MS)
        void run()
      },
      pull() {
        channel?.resume()
      },
      cancel() {
        close()
      },
    },
    { highWaterMark: QUEUED_CHUNKS },
  )
  request.signal.addEventListener('abort', () => close(), { once: true })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

/** Types `input` into, or resizes, a shell that `ownerId` opened on `deviceId`. */
export function writeToShell(
  sessionId: string,
  ownerId: string,
  deviceId: string,
  { input, size }: { input?: string; size?: TerminalSize },
) {
  const shell = shells.get(sessionId)
  if (!shell || shell.ownerId !== ownerId || shell.deviceId !== deviceId) {
    throw new Error('This terminal session has ended')
  }
  if (size) shell.channel.setWindow(size.rows, size.cols, 0, 0)
  if (input) shell.channel.write(input)
}
