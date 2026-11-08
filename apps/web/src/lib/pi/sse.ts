import type { Device } from '@rpi-control-center/db-drizzle'

import { requireSignedInUser } from '~/lib/utils/supabase/server'
import { getOwnedDevice, toSshTarget } from './devices'
import { execStream, withSharedSsh } from './ssh'

/*
 * Server only: a server-sent events response that runs a long-lived command
 * on a device (`tail -F`, `journalctl -f`) and forwards its output. A
 * connection problem is sent as a `failure` event. The command runs in a pty
 * on the device's shared connection, so closing its channel when the browser
 * disconnects sends it SIGHUP.
 */

const HEARTBEAT_MS = 15_000

export interface StreamEvent {
  /** Null for the default `message` event. */
  event: string | null
  data: string
}

export async function deviceCommandStream({
  request,
  deviceId,
  signInMessage,
  command,
  toEvent = (line) => ({ event: null, data: line }),
}: {
  request: Request
  deviceId: string
  signInMessage: string
  command: (device: Device) => string
  /** Turns an output line into the event to send, or null to drop it. */
  toEvent?: (line: string) => StreamEvent | null
}): Promise<Response> {
  let device: Device
  try {
    const user = await requireSignedInUser(signInMessage)
    device = await getOwnedDevice(deviceId, user.id)
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Not allowed', { status: 403 })
  }

  const encoder = new TextEncoder()
  const abort = new AbortController()
  request.signal.addEventListener('abort', () => abort.abort(), { once: true })

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => {
        if (abort.signal.aborted) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          abort.abort()
        }
      }
      const send = ({ event, data }: StreamEvent) => {
        const lines = data.split('\n').map((line) => `data: ${line}`)
        write(`${event ? `event: ${event}\n` : ''}${lines.join('\n')}\n\n`)
      }
      const heartbeat = setInterval(() => write(': keep-alive\n\n'), HEARTBEAT_MS)
      write('retry: 5000\n\n')

      try {
        await withSharedSsh(toSshTarget(device), (conn) =>
          execStream(
            conn,
            command(device),
            (line) => {
              const event = toEvent(line)
              if (event) send(event)
            },
            { pty: true, signal: abort.signal },
          ),
        )
      } catch (error) {
        send({ event: 'failure', data: error instanceof Error ? error.message : String(error) })
      } finally {
        clearInterval(heartbeat)
        try {
          controller.close()
        } catch {
          // Already closed by the browser going away.
        }
      }
    },
    cancel() {
      abort.abort()
    },
  })

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
