import type { Client } from 'ssh2'

import { exec } from './ssh'
import { type GpioLevel, type GpioPinState, isValidGpioPin } from './types'

/*
 * Server only: reads and drives pins with `pinctrl` (Raspberry Pi OS
 * Bookworm and later) or `raspi-gpio` (older releases). Both take the same
 * `set <pin> op dh|dl` arguments; users in the `gpio` group need no sudo.
 */

const TOOL = `tool=$(command -v pinctrl || command -v raspi-gpio) || { echo "Neither pinctrl nor raspi-gpio is installed on the Pi" >&2; exit 127; }`

function assertPins(pins: number[]) {
  for (const pin of pins) {
    if (!isValidGpioPin(pin)) throw new Error(`GPIO ${pin} is not a valid pin (0–27)`)
  }
}

/**
 * pinctrl:    ` 6: op dh pd | hi // GPIO6 = output`
 * raspi-gpio: `GPIO 6: level=1 fsel=1 func=OUTPUT pull=DOWN`
 */
function parseLine(line: string): GpioPinState | null {
  const pinctrl = line.match(/^\s*(\d+):\s*(\w+).*\|\s*(hi|lo)\b/)
  if (pinctrl) {
    return {
      pin: Number(pinctrl[1]),
      mode: pinctrl[2],
      level: pinctrl[3] === 'hi' ? 1 : 0,
    }
  }
  const raspiGpio = line.match(/^GPIO\s+(\d+):\s*level=(\d).*func=(\w+)/)
  if (raspiGpio) {
    const func = raspiGpio[3]
    return {
      pin: Number(raspiGpio[1]),
      mode: func === 'OUTPUT' ? 'op' : func === 'INPUT' ? 'ip' : func.toLowerCase(),
      level: raspiGpio[2] === '1' ? 1 : 0,
    }
  }
  return null
}

export async function readPins(conn: Client, pins: number[]): Promise<GpioPinState[]> {
  assertPins(pins)
  if (!pins.length) return []
  const { stdout, stderr, code } = await exec(
    conn,
    `${TOOL}; for pin in ${pins.join(' ')}; do "$tool" get "$pin"; done`,
  )
  if (code !== 0) throw new Error(stderr.trim() || 'Could not read the GPIO pins')
  const states = new Map<number, GpioPinState>()
  for (const line of stdout.split('\n')) {
    const state = parseLine(line)
    if (state) states.set(state.pin, state)
  }
  return pins.map((pin) => states.get(pin) ?? { pin, mode: 'unknown', level: null })
}

export async function writePin(conn: Client, pin: number, level: GpioLevel): Promise<GpioPinState> {
  assertPins([pin])
  const { stderr, code } = await exec(
    conn,
    `${TOOL}; "$tool" set ${pin} op ${level === 1 ? 'dh' : 'dl'}`,
  )
  if (code !== 0) throw new Error(stderr.trim() || `Could not set GPIO ${pin}`)
  const [state] = await readPins(conn, [pin])
  return state
}
