import { createFileRoute } from '@tanstack/react-router'

import { deviceCommandStream } from '~/lib/pi/sse'
import { sysLogCommand, sysLogEvent } from '~/lib/pi/syslog'
import { type SysLogFilter, type SysLogSource, sysLogFilterProblem } from '~/lib/pi/types'

/*
 * GET ?source=system|kernel|unit&unit=ssh&priority=0-7: server-sent events
 * following the device's systemd journal.
 */
export const Route = createFileRoute('/api/devices/$deviceId/syslog')({
  server: {
    handlers: {
      GET: ({ params, request }) => {
        const query = new URL(request.url).searchParams
        const filter: SysLogFilter = {
          source: (query.get('source') ?? 'system') as SysLogSource,
          unit: query.get('unit') ?? '',
          priority: Number(query.get('priority') ?? 7),
        }
        const problem = sysLogFilterProblem(filter)
        if (problem) return new Response(problem, { status: 400 })
        return deviceCommandStream({
          request,
          deviceId: params.deviceId,
          signInMessage: 'Sign in to see system logs',
          command: () => sysLogCommand(filter),
          toEvent: sysLogEvent,
        })
      },
    },
  },
})
