/* Client-safe: how device numbers read on screen. */

export function formatBytes(bytes: number | null): string {
  if (bytes == null) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return '-'
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${minutes}m`
  if (minutes) return `${minutes}m`
  return `${Math.floor(seconds)}s`
}

export function formatTemperature(celsius: number | null): string {
  return celsius == null ? '-' : `${celsius.toFixed(1)} °C`
}

/** Above this the Pi starts to throttle its CPU. */
export const HOT_TEMPERATURE_C = 70
