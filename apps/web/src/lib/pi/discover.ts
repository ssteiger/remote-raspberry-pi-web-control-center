import { execFile } from 'node:child_process'
import * as dns from 'node:dns/promises'
import * as net from 'node:net'
import * as os from 'node:os'
import { promisify } from 'node:util'

import type { DiscoveredHost, DiscoveryResult, ScannedNetwork } from './types'

/*
 * Server only: looks for Raspberry Pis on the networks of the computer the
 * control center runs on. It probes port 22 on every address of each local
 * /24, reads the ARP table for MAC addresses, and resolves host names, which
 * on macOS and on Linux with Avahi includes `.local` names over mDNS.
 */

/** MAC prefixes registered to the Raspberry Pi Foundation and Raspberry Pi Ltd. */
const RASPBERRY_PI_OUIS = ['b8:27:eb', 'dc:a6:32', 'e4:5f:01', '28:cd:c1', 'd8:3a:dd', '2c:cf:67']

const DEFAULT_NAMES = ['raspberrypi.local']

/** Virtual interfaces that never lead to a Pi: Docker, VPN tunnels, Apple peer-to-peer. */
const SKIPPED_INTERFACES = /^(docker|br-|veth|utun|tun|tap|wg|awdl|llw|lo)/

const CONNECT_TIMEOUT_MS = 700
const BANNER_TIMEOUT_MS = 800
const LOOKUP_TIMEOUT_MS = 1500
const CONCURRENCY = 96
const MAX_HOSTS = 1024

const execFileAsync = promisify(execFile)

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

const toInt = (ip: string) => ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0)
const toIp = (n: number) =>
  [24, 16, 8, 0].map((shift) => Math.floor(n / 2 ** shift) % 256).join('.')

/**
 * The address ranges to probe. Networks wider than /24 are narrowed to the
 * /24 around this computer, so a scan stays at a few seconds.
 */
export function localNetworks(): { network: ScannedNetwork; hosts: string[] }[] {
  const result: { network: ScannedNetwork; hosts: string[] }[] = []
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    if (SKIPPED_INTERFACES.test(name)) continue
    for (const info of addresses ?? []) {
      if (info.family !== 'IPv4' || info.internal || info.address.startsWith('169.254.')) continue
      const prefix = Math.max(Number(info.cidr?.split('/')[1] ?? 24), 24)
      if (prefix >= 31) continue
      const size = 2 ** (32 - prefix)
      const start = Math.floor(toInt(info.address) / size) * size
      const hosts: string[] = []
      for (let n = start + 1; n < start + size - 1; n++) {
        const ip = toIp(n)
        if (ip !== info.address) hosts.push(ip)
      }
      result.push({
        network: { interfaceName: name, address: info.address, range: `${toIp(start)}/${prefix}` },
        hosts,
      })
    }
  }
  return result
}

/** Whether port 22 answers, and the version line the SSH server sends first. */
function probeSsh(ip: string): Promise<{ open: boolean; banner: string | null }> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: ip, port: 22 })
    let open = false
    let settled = false
    const finish = (banner: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve({ open, banner })
    }
    let timer = setTimeout(() => finish(null), CONNECT_TIMEOUT_MS)
    socket.once('connect', () => {
      open = true
      clearTimeout(timer)
      timer = setTimeout(() => finish(null), BANNER_TIMEOUT_MS)
    })
    socket.once('data', (data) => {
      const line = data.toString('utf8').split(/\r?\n/)[0].trim()
      finish(line.startsWith('SSH-') ? line.slice(0, 120) : null)
    })
    socket.once('error', () => finish(null))
  })
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** `0:9:a7:3d:47:3` (macOS) → `00:09:a7:3d:47:03`. */
function normalizeMac(mac: string): string {
  return mac
    .toLowerCase()
    .split(':')
    .map((part) => part.padStart(2, '0'))
    .join(':')
}

/** IP → MAC from the ARP cache, which the probes above have just filled. */
async function readArpTable(): Promise<Map<string, string>> {
  const table = new Map<string, string>()
  const outputs = await Promise.all([
    execFileAsync('arp', ['-an']).then(
      (r) => r.stdout,
      () => '',
    ),
    execFileAsync('ip', ['neigh']).then(
      (r) => r.stdout,
      () => '',
    ),
  ])
  // macOS `arp -an`: `? (192.168.1.5) at b8:27:eb:d7:c:8b on en0 ...`
  // Linux `ip neigh`: `192.168.1.5 dev eth0 lladdr b8:27:eb:d7:0c:8b REACHABLE`
  const pattern =
    /\(?(\d{1,3}(?:\.\d{1,3}){3})\)?.*?\s(?:at|lladdr)\s+([0-9a-f]{1,2}(?::[0-9a-f]{1,2}){5})\b/i
  for (const line of outputs.join('\n').split('\n')) {
    const match = line.match(pattern)
    if (!match) continue
    const mac = normalizeMac(match[2])
    if (mac === 'ff:ff:ff:ff:ff:ff' || mac === '00:00:00:00:00:00') continue
    table.set(match[1], mac)
  }
  return table
}

const isRaspberryPiMac = (mac: string | null) =>
  Boolean(mac && RASPBERRY_PI_OUIS.some((oui) => mac.startsWith(oui)))

async function reverseName(ip: string): Promise<string | null> {
  const result = await withTimeout(
    dns.lookupService(ip, 22).then((r) => r.hostname),
    LOOKUP_TIMEOUT_MS,
    null,
  )
  return result && result !== ip ? result : null
}

async function resolveName(name: string): Promise<string[]> {
  const found = await withTimeout(dns.lookup(name, { all: true, family: 4 }), LOOKUP_TIMEOUT_MS, [])
  return [...new Set(found.map((entry) => entry.address))]
}

/** Plain names like `garden-pi` are tried as `garden-pi.local`, which is how Pis announce themselves. */
function expandName(name: string): string {
  const trimmed = name.trim().toLowerCase()
  return trimmed.includes('.') ? trimmed : `${trimmed}.local`
}

function describeBanner(banner: string): string | null {
  if (/raspbian/i.test(banner)) return 'Its SSH server says Raspbian'
  if (/debian/i.test(banner)) return 'Its SSH server runs on Debian, like Raspberry Pi OS'
  if (/ubuntu/i.test(banner)) return 'Its SSH server runs on Ubuntu'
  return null
}

/** Pis first, then hosts found by name, then the rest with SSH open; by address within each. */
function rank(host: DiscoveredHost): number {
  if (host.isRaspberryPi) return 0
  if (host.reasons.some((r) => r.startsWith('Answers to'))) return 1
  if (host.sshBanner && describeBanner(host.sshBanner)) return 2
  return 3
}

export async function discoverPis(extraNames: string[] = []): Promise<DiscoveryResult> {
  const started = Date.now()
  const networks = localNetworks()
  const names = [...new Set([...DEFAULT_NAMES, ...extraNames.map(expandName)])]

  const [nameResults, probes] = await Promise.all([
    Promise.all(names.map(async (name) => ({ name, addresses: await resolveName(name) }))),
    (async () => {
      const ips = [...new Set(networks.flatMap((n) => n.hosts))].slice(0, MAX_HOSTS)
      const results = await mapLimit(ips, CONCURRENCY, probeSsh)
      return new Map(ips.map((ip, i) => [ip, results[i]]))
    })(),
  ])

  // Hosts that answered to a name but sit outside the scanned ranges get probed too.
  for (const { addresses } of nameResults) {
    for (const ip of addresses) {
      if (!probes.has(ip)) probes.set(ip, await probeSsh(ip))
    }
  }

  const arp = await readArpTable()
  const candidates = [...probes.keys()].filter((ip) => {
    const byName = nameResults.some((r) => r.addresses.includes(ip))
    return probes.get(ip)?.open || isRaspberryPiMac(arp.get(ip) ?? null) || byName
  })

  const hosts = await Promise.all(
    candidates.map(async (ip): Promise<DiscoveredHost> => {
      const probe = probes.get(ip) ?? { open: false, banner: null }
      const mac = arp.get(ip) ?? null
      const matchedNames = nameResults.filter((r) => r.addresses.includes(ip)).map((r) => r.name)
      const hostname = matchedNames[0] ?? (await reverseName(ip))
      const reasons: string[] = []
      if (isRaspberryPiMac(mac)) reasons.push('Its network card is made by Raspberry Pi')
      for (const name of matchedNames) reasons.push(`Answers to ${name}`)
      if (probe.open) reasons.push('SSH is open on port 22')
      else reasons.push('SSH is not open yet: enable it, or wait for the Pi to finish booting')
      const bannerNote = probe.banner ? describeBanner(probe.banner) : null
      if (bannerNote) reasons.push(bannerNote)
      return {
        ip,
        hostname,
        mac,
        isRaspberryPi: isRaspberryPiMac(mac),
        sshOpen: probe.open,
        sshBanner: probe.banner,
        reasons,
      }
    }),
  )

  for (const host of hosts) {
    const twins = hosts.filter(
      (other) => other !== host && host.hostname && other.hostname === host.hostname,
    )
    if (twins.length) {
      host.reasons.push(
        `${twins.map((t) => t.ip).join(', ')} also ${twins.length === 1 ? 'answers' : 'answer'} to ${host.hostname}, so the name can reach either. Use the address, or give each Pi its own host name (sudo raspi-config → System → Hostname).`,
      )
    }
  }

  hosts.sort((a, b) => rank(a) - rank(b) || toInt(a.ip) - toInt(b.ip))

  return {
    networks: networks.map((n) => n.network),
    hosts,
    names: nameResults,
    scannedCount: probes.size,
    durationMs: Date.now() - started,
  }
}
