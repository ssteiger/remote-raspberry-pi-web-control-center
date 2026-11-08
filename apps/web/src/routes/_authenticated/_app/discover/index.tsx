import {
  Badge,
  Button,
  DataTable,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stat,
  StatTitle,
  StatValue,
  Stats,
  TooltipProvider,
  cn,
} from '@rpi-control-center/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import {
  CheckIcon,
  CpuIcon,
  NetworkIcon,
  PlusIcon,
  RadarIcon,
  SearchIcon,
  TerminalIcon,
  TimerIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Page, PageHeader, PageNotice, PageToolbar } from '~/lib/components/PageChrome'
import { listDevices, scanNetwork } from '~/lib/pi/server'
import {
  type DeviceInput,
  type DiscoveredHost,
  type PublicDevice,
  hostNameProblem,
} from '~/lib/pi/types'
import { AddDeviceDialog } from '../devices/-components/AddDeviceDialog'
import { devicesKey } from '../devices/-components/queries'

interface HostRow extends DiscoveredHost {
  /** 0 for likely Pis, by MAC or by name, 1 for the rest; the scan's own order within each. */
  kind: number
  order: number
  /** Another host answers to the same name. */
  sharedName: boolean
  saved: PublicDevice | undefined
}

/**
 * What to pre-fill when adding a host: its `.local` name when it has one, as
 * that survives the router handing out a new address, unless another host
 * answers to the same name.
 */
function initialFor(host: HostRow): Partial<DeviceInput> {
  const useName = Boolean(host.hostname?.endsWith('.local')) && !host.sharedName
  const base = host.hostname?.replace(/\.(local|lan|home|fritz\.box)$/i, '')
  const label = base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Raspberry Pi'
  return {
    host: useName && host.hostname ? host.hostname : host.ip,
    name: host.sharedName ? `${label} (${host.ip.split('.').pop()})` : label,
  }
}

function toRows(hosts: DiscoveredHost[], devices: PublicDevice[]): HostRow[] {
  return hosts.map((host, order) => {
    const sharedName = hosts.some((o) => o.ip !== host.ip && host.hostname && o.hostname === host.hostname)
    const keys = [host.ip, sharedName ? null : host.hostname]
      .filter(Boolean)
      .map((k) => k?.toLowerCase())
    return {
      ...host,
      kind: host.isRaspberryPi || host.reasons.some((r) => r.startsWith('Answers to')) ? 0 : 1,
      order,
      sharedName,
      saved: devices.find((device) => keys.includes(device.host.toLowerCase())),
    }
  })
}

function columnsFor(onAdd: (host: HostRow) => void): ColumnDef<HostRow>[] {
  return [
    {
      accessorKey: 'order',
      header: 'Host',
      size: 220,
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-mono text-sm font-medium">{row.original.hostname ?? row.original.ip}</span>
          {row.original.hostname ? (
            <span className="font-mono text-xs text-muted-foreground">{row.original.ip}</span>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: 'kind',
      header: 'Kind',
      size: 130,
      cell: ({ row }) =>
        row.original.isRaspberryPi ? (
          <Badge className="bg-brand/10 text-brand">Raspberry Pi</Badge>
        ) : row.original.kind === 0 ? (
          <Badge variant="outline">By name</Badge>
        ) : (
          <span className="text-sm text-muted-foreground">Other</span>
        ),
    },
    {
      accessorKey: 'sshOpen',
      header: 'SSH',
      size: 110,
      cell: ({ row }) =>
        row.original.sshOpen ? (
          <Badge
            variant="outline"
            className="text-emerald-700 dark:text-emerald-300"
            title={row.original.sshBanner ?? undefined}
          >
            Open
          </Badge>
        ) : (
          <Badge variant="secondary">Closed</Badge>
        ),
    },
    {
      accessorKey: 'mac',
      header: 'MAC',
      size: 150,
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.mac ?? '—'}</span>
      ),
    },
    {
      id: 'why',
      header: 'Why it is listed',
      size: 460,
      enableSorting: false,
      accessorFn: (row) => row.reasons.join(' '),
      cell: ({ row }) => (
        <ul className="flex flex-col gap-0.5 text-sm text-muted-foreground">
          {row.original.reasons.map((reason) => (
            <li
              key={reason}
              className={cn(reason.includes('also answer') && 'text-amber-700 dark:text-amber-300')}
            >
              {reason}
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: 'action',
      header: '',
      size: 150,
      enableSorting: false,
      meta: { align: 'right' },
      cell: ({ row }) =>
        row.original.saved ? (
          <Button size="sm" variant="outline" asChild className="gap-1.5">
            <Link to="/devices/$deviceId" params={{ deviceId: row.original.saved.id }}>
              <CheckIcon className="size-3.5" />
              {row.original.saved.name}
            </Link>
          </Button>
        ) : (
          <Button
            size="sm"
            variant={row.original.isRaspberryPi ? 'default' : 'outline'}
            className="gap-1.5"
            onClick={() => onAdd(row.original)}
          >
            <PlusIcon className="size-3.5" />
            Add device
          </Button>
        ),
    },
  ]
}

function NothingFound() {
  return (
    <PageNotice icon={TriangleAlertIcon} tone="warning" title="No Raspberry Pi found">
      <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5">
        <li>The Pi has to be on the same network as this computer, e.g. the same Wi-Fi.</li>
        <li>A freshly flashed Pi needs a minute or two to boot and join the network.</li>
        <li>
          SSH must be enabled: in Raspberry Pi Imager under OS customisation → Services, or later
          with <code>sudo raspi-config</code>.
        </li>
        <li>Wi-Fi details set in the Imager must match your network; a network cable rules that out.</li>
        <li>Your router’s list of connected devices shows the Pi’s address too.</li>
        <li>Gave it another host name in the Imager? Look it up by name below.</li>
      </ul>
    </PageNotice>
  )
}

function DiscoverPage() {
  const [nameInput, setNameInput] = React.useState('')
  const [names, setNames] = React.useState<string[]>([])
  const [show, setShow] = React.useState<'all' | 'pis'>('all')
  const [adding, setAdding] = React.useState<HostRow | null>(null)

  const scan = useQuery({
    queryKey: ['discover', names],
    queryFn: () => scanNetwork({ data: { names } }),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    retry: false,
  })
  const { data: devices = [] } = useQuery({ queryKey: devicesKey, queryFn: () => listDevices() })

  const rows = React.useMemo(() => toRows(scan.data?.hosts ?? [], devices), [scan.data, devices])
  const visible = show === 'pis' ? rows.filter((row) => row.kind === 0) : rows
  const columns = React.useMemo(() => columnsFor(setAdding), [])

  const lookUp = (event: React.FormEvent) => {
    event.preventDefault()
    const next = nameInput
      .split(/[\s,]+/)
      .map((name) => name.trim())
      .filter(Boolean)
    const invalid = next.find((name) => hostNameProblem(name))
    if (invalid) {
      toast.error(`“${invalid}”: ${hostNameProblem(invalid)}`)
      return
    }
    if (next.join() === names.join()) scan.refetch()
    else setNames(next)
  }

  const result = scan.data
  const piCount = rows.filter((row) => row.kind === 0).length
  const stats = [
    {
      title: 'Addresses probed',
      value: result ? result.scannedCount.toLocaleString() : '—',
      hint: 'Every address of each local network, on SSH port 22',
      Icon: NetworkIcon,
    },
    {
      title: 'Raspberry Pis',
      value: result ? String(piCount) : '—',
      hint: 'Recognised by their network card or by name',
      Icon: CpuIcon,
      accent: piCount ? 'text-brand' : undefined,
    },
    {
      title: 'SSH open',
      value: result ? String(rows.filter((row) => row.sshOpen).length) : '—',
      hint: 'Hosts that accept SSH, which the control center needs',
      Icon: TerminalIcon,
    },
    {
      title: 'Scan took',
      value: result ? `${(result.durationMs / 1000).toFixed(1)} s` : '—',
      hint: 'Probes run in parallel with a short timeout',
      Icon: TimerIcon,
    },
  ]

  return (
    <TooltipProvider delayDuration={150}>
      <Page>
        <PageHeader
          title="Find a Pi"
          description="Looks for Raspberry Pis on the networks of the computer running the control center: by name, by the maker of their network card, and by an open SSH port."
          updatedAt={scan.dataUpdatedAt || null}
          actions={
            <Button
              size="sm"
              onClick={() => scan.refetch()}
              disabled={scan.isFetching}
              className="gap-1.5"
            >
              <RadarIcon className={scan.isFetching ? 'size-3.5 animate-pulse' : 'size-3.5'} />
              {scan.isFetching ? 'Scanning...' : 'Scan again'}
            </Button>
          }
        />

        <Stats isLoading={scan.isLoading}>
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

        {result ? (
          <PageToolbar className="gap-x-6 gap-y-1 py-2 text-sm text-muted-foreground">
            <span>
              {result.networks.length
                ? `Scanned ${result.networks.map((n) => `${n.interfaceName} (${n.range})`).join(', ')}`
                : 'This computer is on no local network'}
            </span>
            {result.names.map(({ name, addresses }) => (
              <span key={name}>
                <code className="text-xs">{name}</code>{' '}
                {addresses.length ? `→ ${addresses.join(', ')}` : 'does not answer'}
              </span>
            ))}
          </PageToolbar>
        ) : null}

        {scan.error ? (
          <PageNotice tone="destructive" icon={TriangleAlertIcon} title="The scan failed">
            {scan.error.message}
          </PageNotice>
        ) : null}
        {result && !piCount ? <NothingFound /> : null}

        <DataTable
          fill
          data={visible}
          columns={columns}
          isLoading={scan.isLoading}
          showSelectColumn={false}
          showActionsColumn={false}
          showToolbar={false}
          paginate={false}
          getRowId={(row) => row.ip}
          defaultSort={[{ id: 'order', desc: false }]}
          toolbar={
            <>
              <Select value={show} onValueChange={(v) => setShow(v as 'all' | 'pis')}>
                <SelectTrigger className="w-44" aria-label="Show">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everything with SSH</SelectItem>
                  <SelectItem value="pis">Raspberry Pis only</SelectItem>
                </SelectContent>
              </Select>
              <form onSubmit={lookUp} className="flex items-center gap-2">
                <Input
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Look up a name, e.g. garden-pi"
                  aria-label="Host names to look up"
                  className="w-60"
                  autoCapitalize="off"
                  spellCheck={false}
                />
                <Button type="submit" size="sm" variant="outline" disabled={scan.isFetching} className="gap-1.5">
                  <SearchIcon className="size-3.5" />
                  Look up
                </Button>
              </form>
            </>
          }
          emptyState={{
            title: scan.isFetching ? 'Scanning...' : 'Nothing found',
            subtitle: scan.isFetching
              ? 'This usually takes a few seconds.'
              : 'No host on your network has SSH open or a Raspberry Pi network card.',
          }}
        />
      </Page>

      <AddDeviceDialog
        key={adding?.ip}
        open={Boolean(adding)}
        onOpenChange={(open) => !open && setAdding(null)}
        initial={adding ? initialFor(adding) : undefined}
      />
    </TooltipProvider>
  )
}

export const Route = createFileRoute('/_authenticated/_app/discover/')({
  component: DiscoverPage,
})
