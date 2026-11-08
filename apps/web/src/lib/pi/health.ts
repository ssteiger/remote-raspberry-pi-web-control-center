import type { Client } from 'ssh2'

import { getScriptStatus } from './process'
import { exec } from './ssh'
import type { DeviceHealth } from './types'

/*
 * Server only: one round trip that reads the Pi's vitals. `vcgencmd` exists
 * on Raspberry Pi OS; other boards fall back to the kernel's thermal zone.
 */

const HEALTH_COMMAND = [
  `echo "hostname=$(hostname)"`,
  `echo "model=$(tr -d '\\0' < /proc/device-tree/model 2>/dev/null)"`,
  `echo "temp=$(vcgencmd measure_temp 2>/dev/null || cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null)"`,
  `echo "uptime=$(cut -d' ' -f1 /proc/uptime)"`,
  `echo "load=$(cut -d' ' -f1-3 /proc/loadavg)"`,
  `grep -E '^(MemTotal|MemAvailable):' /proc/meminfo`,
].join('; ')

function parseTemperature(raw: string | undefined): number | null {
  if (!raw) return null
  const match = raw.match(/(-?\d+(?:\.\d+)?)/)
  if (!match) return null
  const value = Number(match[1])
  // /sys/class/thermal reports millidegrees.
  return raw.includes("'C") || value < 1000 ? value : value / 1000
}

function parseKb(raw: string | undefined): number | null {
  const kb = raw ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isFinite(kb) ? kb * 1024 : null
}

export async function readHealth(conn: Client, remotePath: string): Promise<DeviceHealth> {
  const [{ stdout }, script] = await Promise.all([
    exec(conn, HEALTH_COMMAND),
    getScriptStatus(conn, remotePath),
  ])
  const values: Record<string, string> = {}
  for (const line of stdout.split('\n')) {
    const match = line.match(/^([A-Za-z]+)[=:]\s*(.*)$/)
    if (match) values[match[1]] = match[2].trim()
  }
  const load = values.load?.split(/\s+/).map(Number)
  const uptime = Number(values.uptime)
  return {
    online: true,
    hostname: values.hostname || null,
    model: values.model || null,
    temperatureC: parseTemperature(values.temp),
    memTotalBytes: parseKb(values.MemTotal),
    memAvailableBytes: parseKb(values.MemAvailable),
    uptimeSeconds: Number.isFinite(uptime) ? Math.round(uptime) : null,
    load: load?.length === 3 && load.every(Number.isFinite) ? [load[0], load[1], load[2]] : null,
    script,
  }
}
