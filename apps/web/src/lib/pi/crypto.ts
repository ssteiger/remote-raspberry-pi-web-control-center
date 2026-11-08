import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/*
 * Server only: device passwords and private keys are stored as AES-256-GCM
 * ciphertext, keyed by DEVICE_SECRET_KEY. Format: `v1:<iv>:<tag>:<data>`, base64.
 */

const VERSION = 'v1'

function secretKey(): Buffer {
  const raw = process.env.DEVICE_SECRET_KEY
  if (!raw) {
    throw new Error(
      'DEVICE_SECRET_KEY is not set. Add it to apps/web/.env (e.g. `openssl rand -base64 32`).',
    )
  }
  return createHash('sha256').update(raw).digest()
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':')
}

export function decryptSecret(encoded: string): string {
  const [version, iv, tag, data] = encoded.split(':')
  if (version !== VERSION || !iv || !tag || !data) {
    throw new Error('The saved device credentials are in an unknown format')
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(iv, 'base64'))
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString(
      'utf8',
    )
  } catch {
    throw new Error(
      'The saved device credentials cannot be decrypted. Was DEVICE_SECRET_KEY changed? Re-enter the password or key in the device settings.',
    )
  }
}
