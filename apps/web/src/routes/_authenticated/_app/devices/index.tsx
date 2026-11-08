import {
  Button,
  DataTable,
  Stat,
  StatTitle,
  StatValue,
  Stats,
  TooltipProvider,
  cn,
} from '@rpi-control-center/ui'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import {
  CircleIcon,
  CpuIcon,
  PlayIcon,
  PlusIcon,
  RadarIcon,
  ThermometerIcon,
  WifiIcon,
} from 'lucide-react'
import * as React from 'react'

import { EmptyState, Page, PageHeader } from '~/lib/components/PageChrome'
import { HOT_TEMPERATURE_C, formatDuration, formatTemperature } from '~/lib/pi/format'
import { getDeviceHealth, listDevices } from '~/lib/pi/server'
import type { DeviceHealth, PublicDevice } from '~/lib/pi/types'
import { AddDeviceDialog } from './-components/AddDeviceDialog'
import { OnlineBadge, ScriptBadge } from './-components/StatusBadges'
import { HEALTH_REFRESH_MS, deviceHealthKey, devicesKey } from './-components/queries'

interface DeviceRow extends PublicDevice {
  health: DeviceHealth | undefined
  checking: boolean
  /** Sort keys; null while checking or offline. */
  online: number
  temperatureC: number | null
  load: number | null
  uptimeSeconds: number | null
}

/** Nulls sort last whichever way the column is sorted. */
const nullsLast =
  (key: 'temperatureC' | 'load' | 'uptimeSeconds') =>
  (a: { original: DeviceRow }, b: { original: DeviceRow }) => {
    const x = a.original[key]
    const y = b.original[key]
    if (x === null && y === null) return 0
    if (x === null) return 1
    if (y === null) return -1
    return x - y
  }

const columns: ColumnDef<DeviceRow>[] = [
  {
    accessorKey: 'name',
    header: 'Device',
    size: 260,
    cell: ({ row }) => (
      <div className="flex flex-col">
        <Link
          to="/devices/$deviceId"
          params={{ deviceId: row.original.id }}
          className="font-medium hover:underline"
        >
          {row.original.name}
        </Link>
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.username}@{row.original.host}
          {row.original.port === 22 ? '' : `:${row.original.port}`}
        </span>
      </div>
    ),
  },
  {
    accessorKey: 'online',
    header: 'Status',
    size: 120,
    cell: ({ row }) => <OnlineBadge health={row.original.health} isLoading={row.original.checking} />,
  },
  {
    id: 'script',
    header: 'Script',
    size: 140,
    accessorFn: (row) => (row.health?.online ? (row.health.script.running ? 1 : 0) : -1),
    cell: ({ row }) =>
      row.original.health?.online ? (
        <ScriptBadge health={row.original.health} />
      ) : (
        <span className="text-sm text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: 'temperatureC',
    header: 'Temperature',
    size: 120,
    sortingFn: nullsLast('temperatureC'),
    cell: ({ row }) => (
      <span
        className={cn(
          'tabular-nums',
          (row.original.temperatureC ?? 0) >= HOT_TEMPERATURE_C && 'text-destructive',
        )}
      >
        {formatTemperature(row.original.temperatureC)}
      </span>
    ),
  },
  {
    accessorKey: 'load',
    header: 'Load',
    size: 90,
    sortingFn: nullsLast('load'),
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.load?.toFixed(2) ?? '—'}</span>
    ),
  },
  {
    accessorKey: 'uptimeSeconds',
    header: 'Uptime',
    size: 100,
    sortingFn: nullsLast('uptimeSeconds'),
    cell: ({ row }) => (
      <span className="tabular-nums">{formatDuration(row.original.uptimeSeconds)}</span>
    ),
  },
  {
    id: 'problem',
    header: 'Note',
    size: 320,
    enableSorting: false,
    cell: ({ row }) =>
      row.original.health && !row.original.health.online ? (
        <span className="line-clamp-2 text-sm text-muted-foreground">{row.original.health.error}</span>
      ) : null,
  },
]

function DevicesPage() {
  const [adding, setAdding] = React.useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: devices, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: devicesKey,
    queryFn: () => listDevices(),
  })

  const healths = useQueries({
    queries: (devices ?? []).map((device) => ({
      queryKey: deviceHealthKey(device.id),
      queryFn: () => getDeviceHealth({ data: { deviceId: device.id } }),
      refetchInterval: HEALTH_REFRESH_MS,
    })),
    combine: (results) => results.map((r) => ({ data: r.data, isLoading: r.isLoading })),
  })

  const rows = React.useMemo<DeviceRow[]>(
    () =>
      (devices ?? []).map((device, index) => {
        const health = healths[index]?.data
        const online = health?.online ? health : null
        return {
          ...device,
          health,
          checking: healths[index]?.isLoading ?? true,
          online: health ? (health.online ? 1 : 0) : -1,
          temperatureC: online?.temperatureC ?? null,
          load: online?.load?.[0] ?? null,
          uptimeSeconds: online?.uptimeSeconds ?? null,
        }
      }),
    [devices, healths],
  )

  const onlineCount = rows.filter((row) => row.health?.online).length
  const runningCount = rows.filter((row) => row.health?.online && row.health.script.running).length
  const warmest = rows.reduce<number | null>(
    (max, row) => (row.temperatureC !== null && (max === null || row.temperatureC > max) ? row.temperatureC : max),
    null,
  )
  const stillChecking = rows.some((row) => row.checking)

  const stats = [
    { title: 'Devices', value: String(rows.length), hint: 'Pis saved in the control center', Icon: CpuIcon },
    {
      title: 'Online',
      value: stillChecking && !onlineCount ? '...' : `${onlineCount} of ${rows.length}`,
      hint: 'Answered over SSH in the last ten seconds',
      Icon: WifiIcon,
      accent: onlineCount ? 'text-emerald-500' : undefined,
    },
    {
      title: 'Scripts running',
      value: String(runningCount),
      hint: 'Devices whose deployed script is running',
      Icon: PlayIcon,
      accent: runningCount ? 'text-brand' : undefined,
    },
    {
      title: 'Warmest',
      value: formatTemperature(warmest),
      hint: `The hottest CPU. Above ${HOT_TEMPERATURE_C} °C a Pi slows down.`,
      Icon: ThermometerIcon,
      accent: (warmest ?? 0) >= HOT_TEMPERATURE_C ? 'text-destructive' : undefined,
    },
  ]

  const actions = (
    <>
      <Button size="sm" variant="outline" asChild className="gap-1.5">
        <Link to="/discover">
          <RadarIcon className="size-3.5" />
          Find on network
        </Link>
      </Button>
      <Button size="sm" onClick={() => setAdding(true)} className="gap-1.5">
        <PlusIcon className="size-3.5" />
        Add device
      </Button>
    </>
  )

  return (
    <TooltipProvider delayDuration={150}>
      <Page>
        <PageHeader
          title="Devices"
          description="Your Raspberry Pis. Open one to deploy your script, watch its output and switch its pins."
          updatedAt={dataUpdatedAt || null}
          isFetching={isFetching}
          onRefresh={() => {
            refetch()
            queryClient.invalidateQueries({ queryKey: ['device-health'] })
          }}
          actions={actions}
        />

        <Stats isLoading={isLoading}>
          {stats.map(({ title, value, hint, Icon, accent }) => (
            <Stat key={title}>
              <StatTitle tooltip={hint}>{title}</StatTitle>
              <StatValue>
                <Icon className={cn('size-5 text-muted-foreground', accent)} />
                {value}
              </StatValue>
            </Stat>
          ))}
        </Stats>

        {!isLoading && !rows.length ? (
          <EmptyState title="No devices yet" className="m-4">
            <p>
              Add your Raspberry Pi with its host name and SSH login, or let the control center
              look for it on your network.
            </p>
            <div className="mt-4 flex justify-center gap-2">{actions}</div>
          </EmptyState>
        ) : (
          <DataTable
            fill
            data={rows}
            columns={columns}
            isLoading={isLoading}
            showSelectColumn={false}
            showActionsColumn={false}
            showToolbar={false}
            paginate={rows.length > 100}
            getRowId={(row) => row.id}
            defaultSort={[{ id: 'name', desc: false }]}
            onRowClick={(row) => navigate({ to: '/devices/$deviceId', params: { deviceId: row.id } })}
            toolbar={
              <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                <CircleIcon className="size-2 fill-emerald-500 text-emerald-500" />
                Health re-read every {HEALTH_REFRESH_MS / 1000} s
              </span>
            }
            emptyState={{ title: 'Nothing matches', subtitle: 'Try another search.' }}
          />
        )}
      </Page>

      <AddDeviceDialog open={adding} onOpenChange={setAdding} />
    </TooltipProvider>
  )
}

export const Route = createFileRoute('/_authenticated/_app/devices/')({
  component: DevicesPage,
})
