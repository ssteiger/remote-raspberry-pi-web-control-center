import { createFileRoute } from '@tanstack/react-router'

import { openTerminal } from '~/lib/pi/terminal'

/*
 * POST { cols, rows }: opens a login shell on the device and streams it as
 * TerminalEvent lines for as long as the request stays open. Keystrokes go
 * back through the `sendToTerminal` server function.
 */
export const Route = createFileRoute('/api/devices/$deviceId/terminal')({
  server: {
    handlers: {
      POST: ({ params, request }) => openTerminal({ request, deviceId: params.deviceId }),
    },
  },
})
