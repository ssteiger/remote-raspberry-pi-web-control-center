import { createFileRoute } from '@tanstack/react-router'

import { LOG_FILE } from '~/lib/pi/process'
import { deviceCommandStream } from '~/lib/pi/sse'
import { sh } from '~/lib/pi/ssh'

/* GET: server-sent events of the script's `app.log` on the device, one line per `message`. */
export const Route = createFileRoute('/api/devices/$deviceId/output')({
  server: {
    handlers: {
      GET: ({ params, request }) =>
        deviceCommandStream({
          request,
          deviceId: params.deviceId,
          signInMessage: 'Sign in to see device output',
          command: (device) => `tail -n 200 -F ${sh(device.remote_path)}/${LOG_FILE} 2>/dev/null`,
        }),
    },
  },
})
