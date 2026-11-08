/*
 * Client-safe: what the app can be searched for. Add a page here when you add
 * a route, and it shows up in the header search (⌘K).
 */

/** Every page the search can jump to. The router checks these against its routes. */
export type AppPath =
  | '/devices'
  | '/discover'
  | '/activity-logs'
  | '/settings'
  | '/settings/account'

export interface PageEntry {
  to: AppPath
  title: string
  /** What the page is for, shown beside the title. */
  detail: string
  /** Other words that should find it, beyond the title and the detail. */
  keywords: string
}

export const PAGES: PageEntry[] = [
  {
    to: '/devices',
    title: 'Devices',
    detail: 'Your Raspberry Pis: deploy, output, GPIO, health',
    keywords: 'raspberry pi deploy script start stop restart gpio pins temperature ssh add device',
  },
  {
    to: '/discover',
    title: 'Find a Pi',
    detail: 'Scan your network for Raspberry Pis',
    keywords: 'discover scan network search find ip address raspberrypi.local mdns lan wifi',
  },
  {
    to: '/activity-logs',
    title: 'Activity logs',
    detail: 'Deploys, script starts and stops, pin changes',
    keywords: 'logs errors warnings info events history',
  },
  {
    to: '/settings',
    title: 'General settings',
    detail: 'Theme, text size, motion',
    keywords: 'preferences appearance dark light mode font size animations',
  },
  {
    to: '/settings/account',
    title: 'Account',
    detail: 'Who is signed in, sign out, reset choices',
    keywords: 'profile email logout sign out user reset',
  },
]

/**
 * How well `name` answers the query, lower being better; null when it does
 * not. An exact name beats one that starts with it, which beats a match on
 * a later word, which beats a match anywhere in the name or in `extra`.
 */
export function rankMatch(name: string, extra: string, query: string): number | null {
  const q = query.trim().toLowerCase()
  if (!q) return null
  const n = name.toLowerCase()
  if (n === q) return 0
  if (n.startsWith(q)) return 1
  if (n.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(q))) return 2
  if (n.includes(q)) return 3
  return extra.toLowerCase().includes(q) ? 4 : null
}
