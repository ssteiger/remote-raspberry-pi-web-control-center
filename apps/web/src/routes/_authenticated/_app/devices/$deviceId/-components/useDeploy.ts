import { useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { toast } from 'sonner'

import { DEPLOY_RESULT_PREFIX } from '~/lib/pi/types'
import { deploymentsKey, deviceHealthKey } from '../../-components/queries'

export type DeployState = 'idle' | 'running' | 'success' | 'failed'

/** Starts a deploy and collects its progress lines as the server streams them. */
export function useDeploy(deviceId: string) {
  const queryClient = useQueryClient()
  const [lines, setLines] = React.useState<string[]>([])
  const [state, setState] = React.useState<DeployState>('idle')

  const deploy = React.useCallback(async () => {
    setLines([])
    setState('running')
    const push = (line: string) => setLines((current) => [...current, line])
    let result: DeployState = 'failed'
    let reason = 'The connection to the server was lost'
    try {
      const response = await fetch(`/api/devices/${deviceId}/deploy`, { method: 'POST' })
      if (!response.ok || !response.body) {
        throw new Error((await response.text()) || `Deploy failed (${response.status})`)
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      let rest = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        const parts = (rest + value).split('\n')
        rest = parts.pop() ?? ''
        for (const line of parts) {
          if (line.startsWith(DEPLOY_RESULT_PREFIX)) {
            const [status, ...message] = line.slice(DEPLOY_RESULT_PREFIX.length).split(' ')
            result = status === 'success' ? 'success' : 'failed'
            reason = message.join(' ')
          } else {
            push(line)
          }
        }
      }
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error)
      push(`Error: ${reason}`)
    }
    setState(result)
    if (result === 'success') toast.success('Deployed and running')
    else toast.error(`Deploy failed: ${reason}`)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: deviceHealthKey(deviceId) }),
      queryClient.invalidateQueries({ queryKey: deploymentsKey(deviceId) }),
    ])
  }, [deviceId, queryClient])

  return { deploy, lines, state }
}
