import { sendToTerminal } from '~/lib/pi/server'
import { MAX_TERMINAL_INPUT, type TerminalEvent, type TerminalSize } from '~/lib/pi/types'

export interface TerminalSession {
  /** Types keystrokes or pasted text into the shell. */
  write: (data: string) => void
  resize: (size: TerminalSize) => void
  /** Ends the shell without reporting it through `onEnd`. */
  close: () => void
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Opens a login shell on the device. Output goes to `onOutput`, which can
 * return a promise to hold the stream back while it catches up. Input waits
 * until the shell is ready, then goes one request at a time so it arrives in
 * order. `onEnd` gets null when the shell exited and the reason otherwise.
 */
export function openTerminalSession(
  deviceId: string,
  size: TerminalSize,
  handlers: {
    onReady: () => void
    onOutput: (data: string) => Promise<void> | undefined
    onEnd: (error: string | null) => void
  },
): TerminalSession {
  const abort = new AbortController()
  let sessionId: string | null = null
  let input = ''
  let resize: TerminalSize | undefined
  let sending = false
  let ended = false

  const end = (error: string | null) => {
    if (ended) return
    ended = true
    abort.abort()
    handlers.onEnd(error)
  }

  const flush = async () => {
    if (sending || ended || !sessionId || (!input && !resize)) return
    sending = true
    const chunk = input.slice(0, MAX_TERMINAL_INPUT)
    input = input.slice(chunk.length)
    const nextSize = resize
    resize = undefined
    try {
      await sendToTerminal({
        data: { deviceId, sessionId, input: chunk || undefined, size: nextSize },
      })
    } catch (error) {
      end(messageOf(error))
    }
    sending = false
    void flush()
  }

  const read = async (): Promise<string | null> => {
    const response = await fetch(`/api/devices/${deviceId}/terminal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(size),
      signal: abort.signal,
    })
    if (!response.ok || !response.body) {
      throw new Error((await response.text()) || `Could not open a terminal (${response.status})`)
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let rest = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return 'The connection to the server was lost'
      const lines = (rest + value).split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) {
        if (!line) continue
        const event = JSON.parse(line) as TerminalEvent
        if (event.type === 'output') {
          await handlers.onOutput(event.data)
        } else if (event.type === 'ready') {
          sessionId = event.session
          handlers.onReady()
          void flush()
        } else {
          return event.type === 'error' ? event.message : null
        }
      }
    }
  }

  read().then(end, (error) => end(messageOf(error)))

  return {
    write: (data) => {
      input += data
      void flush()
    },
    resize: (next) => {
      resize = next
      void flush()
    },
    close: () => {
      ended = true
      abort.abort()
    },
  }
}
