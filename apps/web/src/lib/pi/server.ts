import { and, asc, desc, eq, postgres_db, schema } from '@rpi-control-center/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import type { Client } from 'ssh2'

import { requireSignedInUser } from '~/lib/utils/supabase/server'
import { encryptSecret } from './crypto'
import { getOwnedDevice, toPublicDevice, toSshTarget } from './devices'
import { discoverPis } from './discover'
import { readPins, writePin } from './gpio'
import { readHealth } from './health'
import { logger } from './logger'
import { restartScript, startScript, stopScript } from './process'
import { exec, withSharedSsh, withSsh } from './ssh'
import { writeToShell } from './terminal'
import {
  type DeploymentSummary,
  type DeviceHealth,
  type DeviceInput,
  type DiscoveryResult,
  type GpioLevel,
  type GpioPinState,
  MAX_TERMINAL_INPUT,
  type PublicDevice,
  type ScriptStatus,
  type TerminalSize,
  deviceInputProblem,
  hostNameProblem,
  isValidGpioPin,
  normalizeRemotePath,
  terminalSizeProblem,
} from './types'

/*
 * Server functions behind the device pages. Each one checks the user is
 * signed in and owns the device before touching it or opening SSH.
 */

const requireUser = () => requireSignedInUser('Sign in to manage your devices')

function cleanInput(data: DeviceInput): DeviceInput {
  return {
    name: String(data.name ?? '').trim(),
    host: String(data.host ?? '').trim(),
    port: Number(data.port),
    username: String(data.username ?? '').trim(),
    authMethod: data.authMethod === 'key' ? 'key' : 'password',
    secret: String(data.secret ?? ''),
    remotePath: normalizeRemotePath(String(data.remotePath ?? '')),
  }
}

function validated(data: DeviceInput, requireSecret: boolean): DeviceInput {
  const input = cleanInput(data)
  const problem = deviceInputProblem(input, { requireSecret })
  if (problem) throw new Error(problem)
  return input
}

/** Runs `fn` on the shared SSH connection of a device the signed-in user owns. */
async function onDevice<T>(
  deviceId: string,
  fn: (ctx: { conn: Client; remotePath: string; name: string }) => Promise<T>,
) {
  const user = await requireUser()
  const device = await getOwnedDevice(deviceId, user.id)
  return withSharedSsh(toSshTarget(device), (conn) =>
    fn({ conn, remotePath: device.remote_path, name: device.name }),
  )
}

// ---------------------------------------------------------------------------
// Devices

export const listDevices = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PublicDevice[]> => {
    const user = await requireUser()
    const rows = await postgres_db
      .select()
      .from(schema.devices)
      .where(eq(schema.devices.owner_id, user.id))
      .orderBy(asc(schema.devices.created_at))
    return rows.map(toPublicDevice)
  },
)

export const getDevice = createServerFn({ method: 'GET' })
  .inputValidator((data: { deviceId: string }) => data)
  .handler(async ({ data }): Promise<PublicDevice> => {
    const user = await requireUser()
    return toPublicDevice(await getOwnedDevice(data.deviceId, user.id))
  })

export const createDevice = createServerFn({ method: 'POST' })
  .inputValidator((data: DeviceInput) => validated(data, true))
  .handler(async ({ data }): Promise<PublicDevice> => {
    const user = await requireUser()
    const [row] = await postgres_db
      .insert(schema.devices)
      .values({
        owner_id: user.id,
        name: data.name,
        host: data.host,
        port: data.port,
        username: data.username,
        auth_method: data.authMethod,
        secret_encrypted: encryptSecret(data.secret),
        remote_path: data.remotePath,
      })
      .returning()
    await logger.info(`Device "${data.name}" (${data.username}@${data.host}) was added`)
    return toPublicDevice(row)
  })

export const updateDevice = createServerFn({ method: 'POST' })
  .inputValidator((data: { deviceId: string; device: DeviceInput }) => ({
    deviceId: data.deviceId,
    device: validated(data.device, false),
  }))
  .handler(async ({ data }): Promise<PublicDevice> => {
    const user = await requireUser()
    const existing = await getOwnedDevice(data.deviceId, user.id)
    const input = data.device
    if (input.authMethod !== existing.auth_method && !input.secret) {
      throw new Error(
        input.authMethod === 'key'
          ? 'Paste the private key to switch to key login'
          : 'Enter the password to switch to password login',
      )
    }
    const [row] = await postgres_db
      .update(schema.devices)
      .set({
        name: input.name,
        host: input.host,
        port: input.port,
        username: input.username,
        auth_method: input.authMethod,
        remote_path: input.remotePath,
        ...(input.secret ? { secret_encrypted: encryptSecret(input.secret) } : {}),
      })
      .where(eq(schema.devices.id, existing.id))
      .returning()
    await logger.info(`Device "${input.name}" was updated`)
    return toPublicDevice(row)
  })

export const setGpioPins = createServerFn({ method: 'POST' })
  .inputValidator((data: { deviceId: string; pins: number[] }) => {
    const pins = [...new Set(data.pins.map(Number))].sort((a, b) => a - b)
    const invalid = pins.find((pin) => !isValidGpioPin(pin))
    if (invalid !== undefined) throw new Error(`GPIO ${invalid} is not a valid pin (0–27)`)
    return { deviceId: data.deviceId, pins }
  })
  .handler(async ({ data }): Promise<PublicDevice> => {
    const user = await requireUser()
    const existing = await getOwnedDevice(data.deviceId, user.id)
    const [row] = await postgres_db
      .update(schema.devices)
      .set({ gpio_pins: data.pins })
      .where(eq(schema.devices.id, existing.id))
      .returning()
    return toPublicDevice(row)
  })

export const deleteDevice = createServerFn({ method: 'POST' })
  .inputValidator((data: { deviceId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser()
    const existing = await getOwnedDevice(data.deviceId, user.id)
    await postgres_db.delete(schema.devices).where(eq(schema.devices.id, existing.id))
    await logger.info(`Device "${existing.name}" was removed`)
    return { success: true }
  })

// ---------------------------------------------------------------------------
// Finding Pis on the network

export const scanNetwork = createServerFn({ method: 'POST' })
  .inputValidator((data: { names?: string[] }) => {
    const names = (data.names ?? []).map((name) => String(name).trim()).filter(Boolean)
    if (names.length > 5) throw new Error('Look up at most 5 names at a time')
    const invalid = names.find((name) => hostNameProblem(name))
    if (invalid) throw new Error(`“${invalid}”: ${hostNameProblem(invalid)}`)
    return { names }
  })
  .handler(async ({ data }): Promise<DiscoveryResult> => {
    await requireUser()
    return discoverPis(data.names)
  })

// ---------------------------------------------------------------------------
// Connection test

export interface ConnectionTestResult {
  ok: boolean
  message: string
}

/**
 * Tries the details in the form before they are saved. When editing with the
 * secret left empty, `deviceId` supplies the saved one.
 */
export const testConnection = createServerFn({ method: 'POST' })
  .inputValidator((data: { device: DeviceInput; deviceId?: string }) => ({
    deviceId: data.deviceId,
    device: validated(data.device, !data.deviceId),
  }))
  .handler(async ({ data }): Promise<ConnectionTestResult> => {
    const user = await requireUser()
    const input = data.device
    let secret = input.secret
    if (!secret && data.deviceId) {
      secret = toSshTarget(await getOwnedDevice(data.deviceId, user.id)).secret
    }
    try {
      return await withSsh(
        {
          host: input.host,
          port: input.port,
          username: input.username,
          authMethod: input.authMethod,
          secret,
        },
        async (conn) => {
          const { stdout } = await exec(
            conn,
            'echo "$(hostname) · $(node -v 2>/dev/null || echo no-node)"',
          )
          const [hostname, node] = stdout.trim().split(' · ')
          if (node === 'no-node') {
            return {
              ok: true,
              message: `Connected to ${hostname}, but Node.js is not installed there yet. Deploys need it.`,
            }
          }
          return { ok: true, message: `Connected to ${hostname} (Node.js ${node}).` }
        },
      )
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

// ---------------------------------------------------------------------------
// Health and the script process

export const getDeviceHealth = createServerFn({ method: 'GET' })
  .inputValidator((data: { deviceId: string }) => data)
  .handler(async ({ data }): Promise<DeviceHealth> => {
    const user = await requireUser()
    const device = await getOwnedDevice(data.deviceId, user.id)
    try {
      return await withSharedSsh(toSshTarget(device), (conn) =>
        readHealth(conn, device.remote_path),
      )
    } catch (error) {
      return { online: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

type ScriptAction = 'start' | 'stop' | 'restart'

export const controlScript = createServerFn({ method: 'POST' })
  .inputValidator((data: { deviceId: string; action: ScriptAction }) => {
    if (!['start', 'stop', 'restart'].includes(data.action)) throw new Error('Unknown action')
    return data
  })
  .handler(async ({ data }): Promise<ScriptStatus> => {
    return onDevice(data.deviceId, async ({ conn, remotePath, name }) => {
      try {
        let status: ScriptStatus
        if (data.action === 'stop') {
          await stopScript(conn, remotePath)
          status = { running: false, pid: null, uptimeSeconds: null }
        } else {
          status =
            data.action === 'start'
              ? await startScript(conn, remotePath)
              : await restartScript(conn, remotePath)
          if (!status.running) {
            throw new Error('The script exited right after starting. See the Output tab for why.')
          }
        }
        await logger.info(
          `Script on "${name}": ${data.action} (${status.running ? `running, pid ${status.pid}` : 'stopped'})`,
        )
        return status
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await logger.error(`Script on "${name}": ${data.action} failed: ${message}`)
        throw error
      }
    })
  })

// ---------------------------------------------------------------------------
// GPIO

export const getGpioState = createServerFn({ method: 'GET' })
  .inputValidator((data: { deviceId: string }) => data)
  .handler(async ({ data }): Promise<GpioPinState[]> => {
    const user = await requireUser()
    const device = await getOwnedDevice(data.deviceId, user.id)
    return withSharedSsh(toSshTarget(device), (conn) => readPins(conn, device.gpio_pins))
  })

export const setGpioLevel = createServerFn({ method: 'POST' })
  .inputValidator((data: { deviceId: string; pin: number; level: GpioLevel }) => {
    if (!isValidGpioPin(data.pin)) throw new Error(`GPIO ${data.pin} is not a valid pin (0–27)`)
    return { deviceId: data.deviceId, pin: data.pin, level: (data.level ? 1 : 0) as GpioLevel }
  })
  .handler(async ({ data }): Promise<GpioPinState> => {
    return onDevice(data.deviceId, async ({ conn, name }) => {
      const state = await writePin(conn, data.pin, data.level)
      await logger.info(`GPIO ${data.pin} on "${name}" set ${data.level ? 'high' : 'low'}`)
      return state
    })
  })

// ---------------------------------------------------------------------------
// Terminal

/** What the browser types into a shell the terminal route opened, and its size changes. */
export const sendToTerminal = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: { deviceId: string; sessionId: string; input?: string; size?: TerminalSize }) => {
      const input = data.input === undefined ? undefined : String(data.input)
      if (input && input.length > MAX_TERMINAL_INPUT) throw new Error('Too much input at once')
      const size = data.size && { cols: Number(data.size.cols), rows: Number(data.size.rows) }
      const problem = size ? terminalSizeProblem(size) : null
      if (problem) throw new Error(problem)
      return { deviceId: String(data.deviceId), sessionId: String(data.sessionId), input, size }
    },
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    writeToShell(data.sessionId, user.id, data.deviceId, data)
  })

// ---------------------------------------------------------------------------
// Deployments

export const listDeployments = createServerFn({ method: 'GET' })
  .inputValidator((data: { deviceId: string }) => data)
  .handler(async ({ data }): Promise<DeploymentSummary[]> => {
    const user = await requireUser()
    const device = await getOwnedDevice(data.deviceId, user.id)
    const rows = await postgres_db
      .select({
        id: schema.deployments.id,
        status: schema.deployments.status,
        startedAt: schema.deployments.started_at,
        finishedAt: schema.deployments.finished_at,
        triggeredBy: schema.deployments.triggered_by,
      })
      .from(schema.deployments)
      .where(eq(schema.deployments.device_id, device.id))
      .orderBy(desc(schema.deployments.started_at))
      .limit(100)
    return rows
  })

export const getDeploymentOutput = createServerFn({ method: 'GET' })
  .inputValidator((data: { deviceId: string; deploymentId: number }) => data)
  .handler(async ({ data }): Promise<string> => {
    const user = await requireUser()
    const device = await getOwnedDevice(data.deviceId, user.id)
    const [row] = await postgres_db
      .select({ output: schema.deployments.output })
      .from(schema.deployments)
      .where(
        and(
          eq(schema.deployments.id, Number(data.deploymentId)),
          eq(schema.deployments.device_id, device.id),
        ),
      )
      .limit(1)
    if (!row) throw new Error('Deployment not found')
    return row.output
  })
