import {
  Badge,
  Button,
  Stat,
  StatDescription,
  StatTitle,
  StatValue,
  Stats,
  TooltipProvider,
  cn,
} from '@rpi-control-center/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  CloudUploadIcon,
  CpuIcon,
  Loader2Icon,
  MemoryStickIcon,
  PlayIcon,
  RotateCwIcon,
  SquareIcon,
  ThermometerIcon,
  TimerIcon,
  WifiOffIcon,
} from 'lucide-react'
import type * as React from 'react'
import { toast } from 'sonner'

import { PageNotice, PageSection } from '~/lib/components/PageChrome'
import { HOT_TEMPERATURE_C, formatBytes, formatDuration, formatTemperature } from '~/lib/pi/format'
import { controlScript } from '~/lib/pi/server'
import type { PublicDevice } from '~/lib/pi/types'
import { deviceHealthKey, useDeviceHealth } from '../../-components/queries'
import { LogView } from './LogView'
import type { useDeploy } from './useDeploy'

type Action = 'start' | 'stop' | 'restart'

const ACTION_DONE: Record<Action, string> = {
  start: 'Script started',
  stop: 'Script stopped',
  restart: 'Script restarted',
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-all">{children}</dd>
    </div>
  )
}

export function OverviewTab({
  device,
  deploy,
}: {
  device: PublicDevice
  deploy: ReturnType<typeof useDeploy>
}) {
  const queryClient = useQueryClient()
  const { data: health, isLoading } = useDeviceHealth(device.id)
  const online = health?.online ? health : null

  const control = useMutation({
    mutationFn: (action: Action) => controlScript({ data: { deviceId: device.id, action } }),
    onSuccess: (_status, action) => toast.success(ACTION_DONE[action]),
    onError: (error) => toast.error(error.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: deviceHealthKey(device.id) }),
  })

  const busy = control.isPending || deploy.state === 'running'
  const running = online?.script.running ?? false
  const memUsed =
    online?.memTotalBytes != null && online.memAvailableBytes != null
      ? online.memTotalBytes - online.memAvailableBytes
      : null
  const hot = (online?.temperatureC ?? 0) >= HOT_TEMPERATURE_C

  const scriptActions = (
    <>
      <Button onClick={() => deploy.deploy()} disabled={busy || !online} className="gap-1.5">
        {deploy.state === 'running' ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : (
          <CloudUploadIcon className="size-4" />
        )}
        {deploy.state === 'running' ? 'Deploying...' : 'Deploy'}
      </Button>
      {running ? (
        <>
          <Button
            variant="outline"
            onClick={() => control.mutate('restart')}
            disabled={busy}
            className="gap-1.5"
          >
            <RotateCwIcon
              className={cn(
                'size-4',
                control.variables === 'restart' && control.isPending && 'animate-spin',
              )}
            />
            Restart
          </Button>
          <Button
            variant="outline"
            onClick={() => control.mutate('stop')}
            disabled={busy}
            className="gap-1.5"
          >
            <SquareIcon className="size-4" />
            Stop
          </Button>
        </>
      ) : (
        <Button
          variant="outline"
          onClick={() => control.mutate('start')}
          disabled={busy || !online}
          className="gap-1.5"
        >
          {control.variables === 'start' && control.isPending ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <PlayIcon className="size-4" />
          )}
          Start
        </Button>
      )}
    </>
  )

  return (
    <TooltipProvider delayDuration={150}>
      {health && !health.online ? (
        <PageNotice icon={WifiOffIcon} tone="warning" title={`${device.name} is not reachable`}>
          {health.error}
        </PageNotice>
      ) : null}

      <Stats isLoading={isLoading}>
        <Stat>
          <StatTitle tooltip={`Above ${HOT_TEMPERATURE_C} °C the Pi slows its CPU down`}>
            Temperature
          </StatTitle>
          <StatValue className={cn(hot && 'text-destructive')}>
            <ThermometerIcon className={cn('size-5 text-muted-foreground', hot && 'text-destructive')} />
            {formatTemperature(online?.temperatureC ?? null)}
          </StatValue>
        </Stat>
        <Stat>
          <StatTitle tooltip="Memory in use, of the total">Memory</StatTitle>
          <StatValue>
            <MemoryStickIcon className="size-5 text-muted-foreground" />
            {formatBytes(memUsed)}
          </StatValue>
          <StatDescription>of {formatBytes(online?.memTotalBytes ?? null)}</StatDescription>
        </Stat>
        <Stat>
          <StatTitle tooltip="Processes waiting for the CPU, averaged over 1, 5 and 15 minutes">
            Load
          </StatTitle>
          <StatValue>
            <CpuIcon className="size-5 text-muted-foreground" />
            {online?.load ? online.load[0].toFixed(2) : '-'}
          </StatValue>
          <StatDescription>
            {online?.load ? `5 min ${online.load[1].toFixed(2)} · 15 min ${online.load[2].toFixed(2)}` : ' '}
          </StatDescription>
        </Stat>
        <Stat>
          <StatTitle tooltip="Time since the Pi last booted">Uptime</StatTitle>
          <StatValue>
            <TimerIcon className="size-5 text-muted-foreground" />
            {formatDuration(online?.uptimeSeconds ?? null)}
          </StatValue>
        </Stat>
      </Stats>

      <PageSection
        title={
          <>
            Script
            {online ? (
              running ? (
                <Badge className="bg-brand/10 text-brand">Running</Badge>
              ) : (
                <Badge variant="secondary">Stopped</Badge>
              )
            ) : null}
          </>
        }
        description={
          running && online
            ? `pid ${online.script.pid}, up ${formatDuration(online.script.uptimeSeconds)}, in ~/${device.remotePath}.`
            : `Deploy uploads raspberry-pi-script/ to ~/${device.remotePath}, installs it and starts it.`
        }
        action={scriptActions}
      />

      {deploy.state !== 'idle' ? (
        <section className="flex shrink-0 flex-col border-b">
          <h2
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm font-medium',
              deploy.state === 'failed' && 'text-destructive',
            )}
          >
            {deploy.state === 'running' ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
            {deploy.state === 'running'
              ? 'Deploying...'
              : deploy.state === 'success'
                ? 'Last deploy succeeded'
                : 'Last deploy failed'}
          </h2>
          <LogView lines={deploy.lines} empty="Connecting..." className="max-h-96 border-t" />
        </section>
      ) : null}

      <PageSection title="Device">
        <dl className="grid max-w-4xl grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
          <Fact label="Host">
            <span className="font-mono">
              {device.host}
              {device.port === 22 ? '' : `:${device.port}`}
            </span>
          </Fact>
          <Fact label="User">
            <span className="font-mono">{device.username}</span>
          </Fact>
          <Fact label="Deploy folder">
            <span className="font-mono">~/{device.remotePath}</span>
          </Fact>
          <Fact label="Signs in with">{device.authMethod === 'key' ? 'Private key' : 'Password'}</Fact>
          <Fact label="Hostname">
            <span className="font-mono">{online?.hostname ?? '-'}</span>
          </Fact>
          <Fact label="Model">{online?.model ?? '-'}</Fact>
          <Fact label="Added">{format(new Date(device.createdAt), 'd MMM yyyy')}</Fact>
        </dl>
      </PageSection>
    </TooltipProvider>
  )
}
