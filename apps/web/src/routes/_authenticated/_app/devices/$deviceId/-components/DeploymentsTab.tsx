import {
  Badge,
  DataTable,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Stat,
  StatTitle,
  StatValue,
  Stats,
  TooltipProvider,
  cn,
} from '@rpi-control-center/ui'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { format, formatDistanceStrict, formatDistanceToNow } from 'date-fns'
import { CircleAlertIcon, CircleCheckIcon, CloudUploadIcon, HistoryIcon } from 'lucide-react'
import * as React from 'react'

import { EmptyState, PageNotice } from '~/lib/components/PageChrome'
import { getDeploymentOutput, listDeployments } from '~/lib/pi/server'
import type { DeploymentSummary, PublicDevice } from '~/lib/pi/types'
import { deploymentsKey } from '../../-components/queries'
import { LogView } from './LogView'

const STATUS_ORDER: Record<DeploymentSummary['status'], number> = { failed: 0, running: 1, success: 2 }

function StatusBadge({ status }: { status: DeploymentSummary['status'] }) {
  if (status === 'success') {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-800 dark:text-emerald-200">Succeeded</Badge>
    )
  }
  if (status === 'failed') return <Badge variant="destructive">Failed</Badge>
  return <Badge variant="secondary">Running</Badge>
}

const columns: ColumnDef<DeploymentSummary>[] = [
  {
    accessorKey: 'id',
    header: '#',
    size: 80,
    cell: ({ row }) => (
      <span className="font-mono text-xs text-muted-foreground tabular-nums">#{row.original.id}</span>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    size: 120,
    sortingFn: (a, b) => STATUS_ORDER[a.original.status] - STATUS_ORDER[b.original.status],
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: 'startedAt',
    header: 'Started',
    size: 180,
    cell: ({ row }) => (
      <span
        className="text-sm tabular-nums"
        title={format(new Date(row.original.startedAt), 'EEE, d MMM yyyy · HH:mm:ss')}
      >
        {formatDistanceToNow(new Date(row.original.startedAt), { addSuffix: true })}
      </span>
    ),
  },
  {
    id: 'duration',
    header: 'Took',
    size: 120,
    accessorFn: (row) =>
      row.finishedAt ? new Date(row.finishedAt).getTime() - new Date(row.startedAt).getTime() : -1,
    cell: ({ row }) => (
      <span className="text-sm tabular-nums">
        {row.original.finishedAt
          ? formatDistanceStrict(new Date(row.original.finishedAt), new Date(row.original.startedAt))
          : '—'}
      </span>
    ),
  },
  {
    accessorKey: 'triggeredBy',
    header: 'By',
    size: 240,
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">{row.original.triggeredBy ?? '—'}</span>
    ),
  },
]

/** The side panel a row opens: that deploy's full output. */
function deploymentViewer(deviceId: string) {
  return function DeploymentOutput({ item }: { item: DeploymentSummary }) {
    const output = useQuery({
      queryKey: ['deployment-output', deviceId, item.id],
      queryFn: () => getDeploymentOutput({ data: { deviceId, deploymentId: item.id } }),
    })
    return (
      <>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            Deploy #{item.id}
            <StatusBadge status={item.status} />
          </SheetTitle>
          <SheetDescription>
            {format(new Date(item.startedAt), 'EEE, d MMM yyyy · HH:mm:ss')}
            {item.triggeredBy ? ` by ${item.triggeredBy}` : null}
          </SheetDescription>
        </SheetHeader>
        {output.isLoading ? (
          <Skeleton className="mx-4 h-64" />
        ) : output.error ? (
          <p className="px-4 text-sm text-destructive">{output.error.message}</p>
        ) : (
          <LogView lines={(output.data ?? '').split('\n')} className="min-h-0 flex-1 border-y" />
        )}
      </>
    )
  }
}

export function DeploymentsTab({ device }: { device: PublicDevice }) {
  const deployments = useQuery({
    queryKey: deploymentsKey(device.id),
    queryFn: () => listDeployments({ data: { deviceId: device.id } }),
  })
  const Viewer = React.useMemo(() => deploymentViewer(device.id), [device.id])

  const rows = deployments.data ?? []
  const succeeded = rows.filter((d) => d.status === 'success').length
  const failed = rows.filter((d) => d.status === 'failed').length
  const last = rows[0]

  const stats = [
    { title: 'Deploys', value: String(rows.length), hint: 'The newest 100 to this device', Icon: HistoryIcon },
    {
      title: 'Succeeded',
      value: String(succeeded),
      hint: 'Uploaded, installed and started',
      Icon: CircleCheckIcon,
      accent: succeeded ? 'text-emerald-500' : undefined,
    },
    {
      title: 'Failed',
      value: String(failed),
      hint: 'Stopped with an error; open one to see why',
      Icon: CircleAlertIcon,
      accent: failed ? 'text-destructive' : undefined,
    },
    {
      title: 'Last deploy',
      value: last ? formatDistanceToNow(new Date(last.startedAt), { addSuffix: true }) : '—',
      hint: last ? format(new Date(last.startedAt), 'EEE, d MMM yyyy · HH:mm') : 'Nothing deployed yet',
      Icon: CloudUploadIcon,
    },
  ]

  return (
    <TooltipProvider delayDuration={150}>
      <Stats isLoading={deployments.isLoading}>
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

      {deployments.error ? (
        <PageNotice tone="destructive" icon={CircleAlertIcon} title="The deploy history could not be loaded">
          {deployments.error.message}
        </PageNotice>
      ) : !deployments.isLoading && !rows.length ? (
        <EmptyState title="No deploys yet" className="m-4">
          Press Deploy on the Overview tab to send your script.
        </EmptyState>
      ) : (
        <DataTable
          fill
          data={rows}
          columns={columns}
          isLoading={deployments.isLoading}
          showSelectColumn={false}
          showActionsColumn={false}
          showToolbar={false}
          getRowId={(row) => String(row.id)}
          defaultSort={[{ id: 'startedAt', desc: true }]}
          rowViewerContent={Viewer}
          emptyState={{ title: 'Nothing matches', subtitle: 'Try another search.' }}
        />
      )}
    </TooltipProvider>
  )
}
