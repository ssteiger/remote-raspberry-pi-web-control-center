import { type Device, and, eq, postgres_db, schema } from '@rpi-control-center/db-drizzle'

import { decryptSecret } from './crypto'
import type { SshTarget } from './ssh'
import type { PublicDevice } from './types'

/* Server only: loading devices for the signed-in user. */

export async function getOwnedDevice(deviceId: string, ownerId: string): Promise<Device> {
  if (!/^[0-9a-f-]{36}$/i.test(deviceId)) throw new Error('Device not found')
  const [device] = await postgres_db
    .select()
    .from(schema.devices)
    .where(and(eq(schema.devices.id, deviceId), eq(schema.devices.owner_id, ownerId)))
    .limit(1)
  if (!device) throw new Error('Device not found')
  return device
}

export function toSshTarget(device: Device): SshTarget {
  return {
    host: device.host,
    port: device.port,
    username: device.username,
    authMethod: device.auth_method,
    secret: decryptSecret(device.secret_encrypted),
  }
}

export function toPublicDevice(device: Device): PublicDevice {
  return {
    id: device.id,
    name: device.name,
    host: device.host,
    port: device.port,
    username: device.username,
    authMethod: device.auth_method,
    remotePath: device.remote_path,
    gpioPins: device.gpio_pins,
    createdAt: device.created_at,
  }
}
