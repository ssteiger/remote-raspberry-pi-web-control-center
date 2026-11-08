import type { ITheme } from '@xterm/xterm'
import * as React from 'react'

import { type TerminalSession, openTerminalSession } from './terminalSession'

export type TerminalState = 'connecting' | 'live' | 'ended' | 'error'

/** Keys a phone keyboard lacks. */
export type TerminalKey = 'escape' | 'tab' | 'interrupt' | 'up' | 'down' | 'left' | 'right'

/** The 16 ANSI colours, picked to read at 4.5:1 or better on each theme's console surface. */
const ANSI_LIGHT: ITheme = {
  black: '#1f2127',
  red: '#c42b31',
  green: '#2c7a39',
  yellow: '#8a5d00',
  blue: '#3d4fd1',
  magenta: '#9c3aa6',
  cyan: '#0b7285',
  white: '#c9ccd4',
  brightRed: '#c4303a',
  brightGreen: '#2b7d3c',
  brightYellow: '#8f6200',
  brightBlue: '#4555d9',
  brightMagenta: '#a23fae',
  brightCyan: '#0c768a',
  brightWhite: '#e6e8ec',
}

const ANSI_DARK: ITheme = {
  black: '#30333b',
  red: '#f0716f',
  green: '#7fcf86',
  yellow: '#e3bd6a',
  blue: '#8b95f7',
  magenta: '#d08be0',
  cyan: '#62c6d6',
  white: '#c5c8d0',
  brightRed: '#ff8f8c',
  brightGreen: '#9de2a3',
  brightYellow: '#f2d38e',
  brightBlue: '#a9b1ff',
  brightMagenta: '#e2a8ef',
  brightCyan: '#86d9e6',
  brightWhite: '#ffffff',
}

/** Output xterm may have waiting to be drawn before the stream is held back. */
const WRITE_HIGH_WATER = 256 * 1024

/**
 * Undoes what a full-screen program cut off mid-run (htop, nano) leaves on:
 * the alternate screen, mouse reporting, a hidden cursor. Keeps the scrollback.
 */
const RESTORE_MODES = '\x1b[?1049l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[!p'

const note = (text: string) => `\x1b[90m${text}\x1b[0m\r\n`

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const ARROW = { up: 'A', down: 'B', right: 'C', left: 'D' } as const

function keySequence(key: TerminalKey, applicationCursorKeys: boolean): string {
  if (key === 'escape') return '\x1b'
  if (key === 'tab') return '\t'
  if (key === 'interrupt') return '\x03'
  return `\x1b${applicationCursorKeys ? 'O' : '['}${ARROW[key]}`
}

interface Look {
  theme: ITheme
  fontFamily: string
  fontSize: number
  cursorBlink: boolean
}

/** The app's tokens as xterm options. They are oklch, which xterm cannot parse, so they are painted and read back. */
function readLook(): Look {
  const root = document.documentElement
  const style = getComputedStyle(root)
  const token = (name: string) => style.getPropertyValue(name).trim()
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const paint = (layers: [color: string, alpha: number][], opacity = 1) => {
    if (!ctx) return layers[layers.length - 1][0]
    ctx.clearRect(0, 0, 1, 1)
    for (const [color, alpha] of layers) {
      ctx.globalAlpha = alpha
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 1, 1)
    }
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    if (opacity < 1) return `rgba(${r}, ${g}, ${b}, ${opacity})`
    return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
  }

  // The bg-muted/40 surface the terminal sits on, made opaque so xterm can keep text contrast against it.
  const background = paint([
    [token('--background'), 1],
    [token('--muted'), 0.4],
  ])
  const foreground = paint([[token('--foreground'), 1]])
  const highlight = token('--highlight')
  const quiet = token('--muted-foreground')
  const motion = root.dataset.motion
  return {
    fontFamily: token('--font-mono') || 'monospace',
    // text-sm, so the app's text size setting scales the terminal too.
    fontSize: Math.round(Number.parseFloat(style.fontSize) * 0.8125),
    cursorBlink:
      motion === 'full' ||
      (motion !== 'reduce' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches),
    theme: {
      ...(root.classList.contains('dark') ? ANSI_DARK : ANSI_LIGHT),
      background,
      foreground,
      cursor: paint([[token('--brand'), 1]]),
      cursorAccent: background,
      selectionBackground: paint([[highlight, 1]]),
      selectionForeground: foreground,
      selectionInactiveBackground: paint([
        [background, 1],
        [highlight, 0.5],
      ]),
      brightBlack: paint([[quiet, 1]]),
      scrollbarSliderBackground: paint([[quiet, 1]], 0.4),
      scrollbarSliderHoverBackground: paint([[quiet, 1]], 0.6),
      scrollbarSliderActiveBackground: paint([[quiet, 1]], 0.7),
    },
  }
}

/** xterm measures the font once when it opens, so it has to be loaded by then. */
async function loadFont({ fontFamily, fontSize }: Look) {
  try {
    await Promise.race([
      // The box-drawing subset too: htop and raspi-config draw with it.
      document.fonts.load(`${fontSize}px ${fontFamily}`, 'M─'),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ])
  } catch {
    // xterm measures whatever face the browser falls back to.
  }
}

/** Whether the shell may take the focus when it is ready: not while the user is busy elsewhere. */
function mayTakeFocus(host: HTMLElement): boolean {
  const active = document.activeElement
  return (
    !active ||
    active === document.body ||
    host.contains(active) ||
    active.matches('[role="tab"]:not(:focus-visible)')
  )
}

/**
 * An xterm.js terminal in `hostRef`, connected to a login shell on the device
 * while `enabled`. It follows the app's theme and text size.
 */
export function useTerminal({
  deviceId,
  target,
  enabled,
}: {
  deviceId: string
  /** `user@host`, as the terminal shows it while connecting. */
  target: string
  enabled: boolean
}) {
  const hostRef = React.useRef<HTMLDivElement>(null)
  const controls = React.useRef<{
    reconnect: () => void
    press: (key: TerminalKey) => void
  } | null>(null)
  const [status, setStatus] = React.useState<{ state: TerminalState; error: string | null }>({
    state: 'connecting',
    error: null,
  })
  const [title, setTitle] = React.useState<string | null>(null)
  const [attempt, setAttempt] = React.useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new attempt loads the terminal again
  React.useEffect(() => {
    const host = hostRef.current
    if (!enabled || !host) return
    let disposed = false
    let dispose = () => {}

    const setup = async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ])
      const look = readLook()
      await loadFont(look)
      if (disposed) return

      const term = new Terminal({
        ...look,
        lineHeight: 1.2,
        scrollback: 5000,
        minimumContrastRatio: 4.5,
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(host)
      term.textarea?.setAttribute('aria-label', `Shell on ${target}`)
      fit.fit()

      let frame = 0
      const refit = () => {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => fit.fit())
      }

      let session: TerminalSession | undefined
      let state: TerminalState = 'connecting'
      const report = (next: TerminalState, error: string | null = null) => {
        state = next
        setStatus({ state: next, error })
      }

      let unwritten = 0
      const output = (data: string) => {
        unwritten += data.length
        const written = new Promise<void>((resolve) =>
          term.write(data, () => {
            unwritten -= data.length
            resolve()
          }),
        )
        return unwritten > WRITE_HIGH_WATER ? written : undefined
      }

      const connect = () => {
        session?.close()
        setTitle(null)
        report('connecting')
        term.write(note(`Connecting to ${target}...`))
        session = openTerminalSession(
          deviceId,
          { cols: term.cols, rows: term.rows },
          {
            onReady: () => {
              report('live')
              if (mayTakeFocus(host)) term.focus()
            },
            onOutput: output,
            onEnd: (error) => {
              report(error ? 'error' : 'ended', error)
              setTitle(null)
              const message = error
                ? 'Disconnected. Press Enter to reconnect.'
                : 'Session ended. Press Enter to start a new one.'
              term.write(RESTORE_MODES, () => {
                const newLine = term.buffer.active.cursorX > 0 ? '\r\n' : ''
                term.write(newLine + note(message))
              })
            },
          },
        )
      }

      term.onData((data) => {
        if (state === 'ended' || state === 'error') {
          if (data === '\r') connect()
          return
        }
        session?.write(data)
      })
      term.onResize((size) => session?.resize(size))
      term.onTitleChange((next) => setTitle(next || null))

      if (!/Mac|iPhone|iPad/.test(navigator.userAgent)) {
        // As in Windows Terminal: with text selected Ctrl+C copies, and Ctrl+V pastes.
        // Returning false leaves both to the browser.
        term.attachCustomKeyEventHandler((event) => {
          const ctrlOnly = event.ctrlKey && !event.altKey && !event.metaKey
          if (event.type !== 'keydown' || !ctrlOnly) return true
          const key = event.key.toLowerCase()
          return !(key === 'v' || (key === 'c' && term.hasSelection()))
        })
      }

      const resizer = new ResizeObserver(refit)
      resizer.observe(host)
      const restyle = new MutationObserver(() => {
        const next = readLook()
        term.options.theme = next.theme
        term.options.cursorBlink = next.cursorBlink
        if (term.options.fontSize !== next.fontSize) {
          term.options.fontSize = next.fontSize
          refit()
        }
      })
      restyle.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'data-text', 'data-motion'],
      })

      controls.current = {
        reconnect: () => {
          connect()
          term.focus()
        },
        press: (key) => term.input(keySequence(key, term.modes.applicationCursorKeysMode)),
      }
      connect()

      dispose = () => {
        controls.current = null
        session?.close()
        resizer.disconnect()
        restyle.disconnect()
        cancelAnimationFrame(frame)
        term.dispose()
      }
    }

    setup().catch((error: unknown) => {
      if (!disposed) {
        setStatus({ state: 'error', error: `Could not load the terminal: ${messageOf(error)}` })
      }
    })
    return () => {
      disposed = true
      dispose()
    }
  }, [deviceId, target, enabled, attempt])

  return {
    hostRef,
    state: status.state,
    error: status.error,
    /** What the shell calls its window, e.g. `pi@raspberrypi: ~`. */
    title,
    reconnect: () => {
      if (controls.current) controls.current.reconnect()
      else setAttempt((n) => n + 1)
    },
    press: (key: TerminalKey) => controls.current?.press(key),
  }
}
