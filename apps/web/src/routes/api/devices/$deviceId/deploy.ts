import { and, eq, gt, postgres_db, schema } from '@rpi-control-center/db-drizzle'
import { createFileRoute } from '@tanstack/react-router'

import { deployScript } from '~/lib/pi/deploy'
import { getOwnedDevice, toSshTarget } from '~/lib/pi/devices'
import { logger } from '~/lib/pi/logger'
import { withSsh } from '~/lib/pi/ssh'
import { DEPLOY_RESULT_PREFIX } from '~/lib/pi/types'
import { requireSignedInUser } from '~/lib/utils/supabase/server'

/** A deploy still marked running after this long is treated as abandoned. */
const STALE_DEPLOY_MS = 15 * 60 * 1000

/*
 * POST: uploads raspberry-pi-script/ to the device, installs and starts it,
 * streaming progress as text lines. The deploy carries on if the browser
 * goes away, and its output is saved to `deployments` either way.
 */
export const Route = createFileRoute('/api/devices/$deviceId/deploy')({
  server: {
    handlers: {
      POST: async ({ params }) => {
        let user: Awaited<ReturnType<typeof requireSignedInUser>>
        let device: Awaited<ReturnType<typeof getOwnedDevice>>
        try {
          user = await requireSignedInUser('Sign in to deploy')
          device = await getOwnedDevice(params.deviceId, user.id)
        } catch (error) {
          return new Response(error instanceof Error ? error.message : 'Not allowed', {
            status: 403,
          })
        }

        const [active] = await postgres_db
          .select({ id: schema.deployments.id })
          .from(schema.deployments)
          .where(
            and(
              eq(schema.deployments.device_id, device.id),
              eq(schema.deployments.status, 'running'),
              gt(
                schema.deployments.started_at,
                new Date(Date.now() - STALE_DEPLOY_MS).toISOString(),
              ),
            ),
          )
          .limit(1)
        if (active) {
          return new Response(`Deploy #${active.id} to ${device.name} is still running`, {
            status: 409,
          })
        }

        const [deployment] = await postgres_db
          .insert(schema.deployments)
          .values({ device_id: device.id, triggered_by: user.email ?? user.id })
          .returning({ id: schema.deployments.id })

        const encoder = new TextEncoder()
        const output: string[] = []
        let controller: ReadableStreamDefaultController<Uint8Array> | null = null
        const send = (line: string) => {
          try {
            controller?.enqueue(encoder.encode(`${line}\n`))
          } catch {
            controller = null
          }
        }
        const log = (line: string) => {
          output.push(line)
          send(line)
        }

        const run = async () => {
          const started = Date.now()
          log(`Deploy #${deployment.id} to ${device.name} (${device.username}@${device.host})`)
          await logger.info(`Deploy #${deployment.id} to "${device.name}" started`)
          let status: 'success' | 'failed' = 'success'
          let reason = ''
          try {
            await withSsh(toSshTarget(device), (conn) =>
              deployScript(conn, device.remote_path, log),
            )
            log(`Done in ${((Date.now() - started) / 1000).toFixed(1)} s.`)
          } catch (error) {
            status = 'failed'
            reason = error instanceof Error ? error.message : String(error)
            log(`Error: ${reason}`)
          }
          await postgres_db
            .update(schema.deployments)
            .set({ status, output: output.join('\n'), finished_at: new Date().toISOString() })
            .where(eq(schema.deployments.id, deployment.id))
          if (status === 'success') {
            await logger.info(`Deploy #${deployment.id} to "${device.name}" succeeded`)
          } else {
            await logger.error(
              `Deploy #${deployment.id} to "${device.name}" failed: ${reason.split('\n')[0]}`,
            )
          }
          send(`${DEPLOY_RESULT_PREFIX}${status}${reason ? ` ${reason.split('\n')[0]}` : ''}`)
          try {
            controller?.close()
          } catch {
            // The browser already went away.
          }
        }

        const body = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c
            void run()
          },
          cancel() {
            controller = null
          },
        })

        return new Response(body, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'X-Content-Type-Options': 'nosniff',
          },
        })
      },
    },
  },
})
