import { postgres_db, schema } from '@rpi-control-center/db-drizzle'

/*
 * Server only: writes lines to `public.logs`, which the Activity logs page
 * shows. Lines starting with `WARNING:` / `ERROR:` get that level there.
 */

async function write(message: string): Promise<void> {
  try {
    await postgres_db.insert(schema.logs).values({ message })
  } catch (error) {
    console.error('Failed to write to logs table:', error)
  }
}

export const logger = {
  info: (message: string) => write(message),
  warn: (message: string) => write(`WARNING: ${message}`),
  error: (message: string) => write(`ERROR: ${message}`),
}
