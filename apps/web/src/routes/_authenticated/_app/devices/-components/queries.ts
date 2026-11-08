import { useQuery } from '@tanstack/react-query'

import { getDeviceHealth } from '~/lib/pi/server'

export const HEALTH_REFRESH_MS = 10_000

export const devicesKey = ['devices'] as const
export const deviceKey = (deviceId: string) => ['devices', deviceId] as const
export const deviceHealthKey = (deviceId: string) => ['device-health', deviceId] as const
export const deploymentsKey = (deviceId: string) => ['deployments', deviceId] as const
export const gpioKey = (deviceId: string) => ['gpio', deviceId] as const

/** The device's vitals and script state, re-read every ten seconds over SSH. */
export function useDeviceHealth(deviceId: string) {
  return useQuery({
    queryKey: deviceHealthKey(deviceId),
    queryFn: () => getDeviceHealth({ data: { deviceId } }),
    refetchInterval: HEALTH_REFRESH_MS,
  })
}
