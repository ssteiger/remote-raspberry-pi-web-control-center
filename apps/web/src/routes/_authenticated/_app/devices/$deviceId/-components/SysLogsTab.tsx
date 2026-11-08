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
  SheetDescription,
  SheetHeader,
  SheetTitle,
  cn,
} from '@rpi-control-center/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import {
  AlertTriangleIcon,
  BugIcon,
  CircleAlertIcon,
  InfoIcon,
  Loader2Icon,
  SparklesIcon,
} from 'lucide-react'
import * as React from 'react'

import { ReplyText } from '~/lib/assistant/ReplyText'
import { type LogEntryToExplain, explainLogEntry, getAssistantStatus } from '~/lib/assistant/server'
import { PageNotice } from '~/lib/components/PageChrome'
import {
  type PublicDevice,
  type SysLogEntry,
  type SysLogFilter,
  type SysLogSource,
  sysLogFilterProblem,
} from '~/lib/pi/types'
import { LogMessage } from './LogMessage'
import { PauseClearButtons, StreamBadge } from './StreamControls'
import { useEventStream } from './useEventStream'

type Level = 'error' | 'warning' | 'info' | 'debug'

interface SysLogRow extends SysLogEntry {
  id: number
  level: Level
  /** `sshd[812]`, or empty when the entry names no program. */
  program: string
  /** How many identical entries in a row this one stands for; `time` is the last one's. */
  count: number
  firstTime: number | null
}

/** How many entries before the one being explained go to the model too. */
const EXPLAIN_EARLIER = 8

/** What the entry details need beyond the row: the device, and the rows around it. */
const SysLogContext = React.createContext<{ deviceId: string; rows: SysLogRow[] } | null>(null)

const PRIORITIES = [
  { value: 7, label: 'Everything' },
  { value: 6, label: 'Info and worse' },
  { value: 4, label: 'Warnings and errors' },
  { value: 3, label: 'Errors only' },
]

const SOURCES: { value: SysLogSource; label: string }[] = [
  { value: 'system', label: 'Whole system' },
  { value: 'kernel', label: 'Kernel (dmesg)' },
  { value: 'unit', label: 'One service' },
]

/** Services worth a click on a Pi. */
const COMMON_UNITS = [
  'ssh',
  'NetworkManager',
  'systemd-networkd',
  'cron',
  'bluetooth',
  'avahi-daemon',
]

/** syslog priorities: 0–3 are errors of rising urgency, 4 warning, 5–6 notice and info, 7 debug. */
function levelOf(priority: number | null): Level {
  if (priority === null) return 'info'
  if (priority <= 3) return 'error'
  if (priority === 4) return 'warning'
  if (priority >= 7) return 'debug'
  return 'info'
}

const LEVEL_ORDER: Record<Level, number> = { error: 0, warning: 1, info: 2, debug: 3 }

const LEVEL_META: Record<
  Level,
  {
    label: string
    variant: 'destructive' | 'secondary' | 'outline'
    className?: string
    Icon: typeof InfoIcon
  }
> = {
  error: { label: 'Error', variant: 'destructive', Icon: CircleAlertIcon },
  warning: {
    label: 'Warning',
    variant: 'secondary',
    className: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
    Icon: AlertTriangleIcon,
  },
  info: { label: 'Info', variant: 'outline', Icon: InfoIcon },
  debug: { label: 'Debug', variant: 'outline', className: 'text-muted-foreground', Icon: BugIcon },
}

function LevelBadge({ level }: { level: Level }) {
  const meta = LEVEL_META[level]
  return (
    <Badge variant={meta.variant} className={cn('gap-1.5', meta.className)}>
      <meta.Icon className="size-3" />
      {meta.label}
    </Badge>
  )
}

function parseEntry(data: string): SysLogEntry | null {
  try {
    return JSON.parse(data) as SysLogEntry
  } catch {
    return null
  }
}

/** Rows in the order the Pi wrote them, with identical neighbours folded into one. */
function toRows(items: { id: number; value: SysLogEntry }[]): SysLogRow[] {
  const rows: SysLogRow[] = []
  for (const { id, value } of items) {
    const program = value.identifier
      ? `${value.identifier}${value.pid ? `[${value.pid}]` : ''}`
      : ''
    const previous = rows.at(-1)
    if (
      previous &&
      previous.program === program &&
      previous.priority === value.priority &&
      previous.message === value.message
    ) {
      previous.count += 1
      previous.time = value.time ?? previous.time
      continue
    }
    rows.push({
      ...value,
      id,
      level: levelOf(value.priority),
      program,
      count: 1,
      firstTime: value.time,
    })
  }
  return rows
}

function whenWritten(item: SysLogRow): string {
  if (!item.time) return 'No timestamp'
  if (item.count === 1 || !item.firstTime)
    return format(item.time, 'EEE, d MMM yyyy · HH:mm:ss.SSS')
  return `${format(item.firstTime, 'EEE, d MMM yyyy · HH:mm:ss')} to ${format(item.time, 'HH:mm:ss')} · ${item.count} times`
}

function streamUrl(deviceId: string, filter: SysLogFilter): string {
  const query = new URLSearchParams({ source: filter.source, priority: String(filter.priority) })
  if (filter.source === 'unit') query.set('unit', filter.unit.trim())
  return `/api/devices/${deviceId}/syslog?${query}`
}

const columns: ColumnDef<SysLogRow>[] = [
  {
    accessorKey: 'time',
    header: 'Time',
    size: 150,
    sortingFn: (a, b) =>
      (a.original.time ?? a.original.id) - (b.original.time ?? b.original.id) ||
      a.original.id - b.original.id,
    cell: ({ row }) => {
      const time = row.original.time
      return time ? (
        <span
          className="font-mono text-xs whitespace-nowrap tabular-nums text-muted-foreground"
          title={format(time, 'EEE, d MMM yyyy · HH:mm:ss.SSS')}
        >
          {format(time, 'MMM d HH:mm:ss')}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      )
    },
  },
  {
    accessorKey: 'level',
    header: 'Level',
    size: 110,
    sortingFn: (a, b) => LEVEL_ORDER[a.original.level] - LEVEL_ORDER[b.original.level],
    cell: ({ row }) => <LevelBadge level={row.original.level} />,
  },
  {
    accessorKey: 'program',
    header: 'Program',
    size: 180,
    cell: ({ row }) => (
      <span className="font-mono text-xs whitespace-nowrap">{row.original.program || '—'}</span>
    ),
  },
  {
    accessorKey: 'message',
    header: 'Message',
    size: 700,
    enableSorting: false,
    cell: ({ row }) => (
      <div className="flex items-start gap-2">
        {row.original.count > 1 ? (
          <Badge
            variant="secondary"
            className="px-1.5 py-0 font-mono tabular-nums"
            title={`Repeated ${row.original.count} times in a row`}
          >
            ×{row.original.count}
          </Badge>
        ) : null}
        <span
          className={cn(
            'line-clamp-3 font-mono text-xs break-words whitespace-pre-wrap',
            row.original.level === 'error' && 'text-destructive',
          )}
        >
          <LogMessage text={row.original.message} />
        </span>
      </div>
    ),
  },
]

function forModel(row: SysLogRow): LogEntryToExplain {
  return {
    time: row.time,
    priority: row.priority,
    program: row.program,
    message: row.message,
    count: row.count,
  }
}

/** Asks the configured language model what the entry means, on request. */
function Explanation({ item }: { item: SysLogRow }) {
  const context = React.useContext(SysLogContext)
  const status = useQuery({
    queryKey: ['assistant', 'status'],
    queryFn: () => getAssistantStatus(),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const explain = useMutation({
    mutationFn: () => {
      const rows = context?.rows ?? []
      const index = rows.findIndex((row) => row.id === item.id)
      const earlier = index > 0 ? rows.slice(Math.max(0, index - EXPLAIN_EARLIER), index) : []
      return explainLogEntry({
        data: {
          deviceId: context?.deviceId ?? '',
          entry: forModel(item),
          earlier: earlier.map(forModel),
        },
      })
    },
  })
  const enabled = status.data?.enabled ?? false

  if (explain.data) {
    return (
      <div className="flex flex-col gap-3 px-4 text-sm leading-relaxed">
        <ReplyText text={explain.data} />
        <p className="text-xs text-muted-foreground">
          Written by {status.data?.model ?? 'a language model'}. It can be wrong, so check what
          matters.
        </p>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-start gap-2 px-4 text-sm">
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={!enabled || explain.isPending}
        onClick={() => explain.mutate()}
      >
        {explain.isPending ? (
          <Loader2Icon className="size-3.5 animate-spin" />
        ) : (
          <SparklesIcon className="size-3.5" />
        )}
        {explain.isPending ? 'Explaining...' : 'Explain this entry'}
      </Button>
      {explain.error ? <p className="text-destructive">{explain.error.message}</p> : null}
      {status.data && !enabled ? (
        <p className="text-xs text-muted-foreground">
          Explanations need a language model. The assistant (⌘J) shows how to set one up.
        </p>
      ) : null}
      {enabled ? (
        <p className="text-xs text-muted-foreground">
          Sends this entry and the few before it to {status.data?.model}.
        </p>
      ) : null}
    </div>
  )
}

function EntryDetails({ item }: { item: SysLogRow }) {
  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <LevelBadge level={item.level} />
          <span className="font-mono text-sm">{item.program || 'Log entry'}</span>
        </SheetTitle>
        <SheetDescription>
          {whenWritten(item)}
          {item.priority !== null ? ` · priority ${item.priority}` : ''}
        </SheetDescription>
      </SheetHeader>
      <pre className="overflow-auto border-y bg-muted/40 px-4 py-3 font-mono text-xs whitespace-pre-wrap break-words">
        <LogMessage text={item.message} />
      </pre>
      <Explanation key={item.id} item={item} />
    </>
  )
}

/** Follows the Pi's systemd journal: the whole system, the kernel, or one service. */
export function SysLogsTab({ device }: { device: PublicDevice }) {
  const [filter, setFilter] = React.useState<SysLogFilter>({
    source: 'system',
    unit: '',
    priority: 6,
  })
  const [unitInput, setUnitInput] = React.useState('ssh')
  const problem = sysLogFilterProblem(filter)
  const stream = useEventStream(problem ? null : streamUrl(device.id, filter), parseEntry)

  const rows = React.useMemo(() => toRows(stream.items), [stream.items])
  const details = React.useMemo(() => ({ deviceId: device.id, rows }), [device.id, rows])

  const applyUnit = (unit: string) => {
    setUnitInput(unit)
    setFilter((current) => ({ ...current, source: 'unit', unit }))
  }

  const noPermission = stream.notices.includes('no-permission')
  const otherNotices = stream.notices.filter((notice) => notice !== 'no-permission')
  const state = problem ? 'paused' : stream.state

  const toolbar = (
    <div className="flex flex-1 flex-wrap items-center gap-2">
      <Select
        value={filter.source}
        onValueChange={(value) =>
          setFilter((current) => ({
            ...current,
            source: value as SysLogSource,
            unit: value === 'unit' ? unitInput : '',
          }))
        }
      >
        <SelectTrigger className="w-40" aria-label="Log source">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SOURCES.map((source) => (
            <SelectItem key={source.value} value={source.value}>
              {source.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {filter.source === 'unit' ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            applyUnit(unitInput.trim())
          }}
        >
          <Input
            value={unitInput}
            onChange={(e) => setUnitInput(e.target.value)}
            onBlur={() => applyUnit(unitInput.trim())}
            placeholder="ssh"
            className="w-40 font-mono"
            aria-label="Service name"
            list="syslog-units"
            autoCapitalize="off"
            spellCheck={false}
          />
          <datalist id="syslog-units">
            {COMMON_UNITS.map((unit) => (
              <option key={unit} value={unit} />
            ))}
          </datalist>
          <Button type="submit" size="sm" variant="outline">
            Show
          </Button>
        </form>
      ) : null}
      <Select
        value={String(filter.priority)}
        onValueChange={(value) => setFilter((current) => ({ ...current, priority: Number(value) }))}
      >
        <SelectTrigger className="w-48" aria-label="Severity">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRIORITIES.map((priority) => (
            <SelectItem key={priority.value} value={String(priority.value)}>
              {priority.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="ml-auto flex items-center gap-2">
        <StreamBadge state={state} />
        <PauseClearButtons
          paused={stream.paused}
          onTogglePaused={stream.togglePaused}
          onClear={stream.clear}
        />
      </div>
    </div>
  )

  return (
    <>
      {noPermission ? (
        <PageNotice
          icon={InfoIcon}
          tone="warning"
          title={`Only ${device.username}’s own entries are visible`}
        >
          To read the whole system journal, add the user to the <code>adm</code> group on the Pi and
          reconnect:{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
            sudo usermod -aG adm {device.username}
          </code>
        </PageNotice>
      ) : null}
      {otherNotices.map((notice) => (
        <PageNotice key={notice} icon={InfoIcon}>
          {notice}
        </PageNotice>
      ))}
      {problem && filter.source === 'unit' ? (
        <PageNotice icon={CircleAlertIcon} tone="destructive">
          {problem}
        </PageNotice>
      ) : null}
      {stream.error ? (
        <PageNotice icon={CircleAlertIcon} tone="destructive" title="The log stream stopped">
          {stream.error}
        </PageNotice>
      ) : null}

      <SysLogContext.Provider value={details}>
        <DataTable
          fill
          data={rows}
          columns={columns}
          isLoading={state === 'connecting' && !rows.length}
          showSelectColumn={false}
          showActionsColumn={false}
          showToolbar={false}
          getRowId={(row) => String(row.id)}
          defaultSort={[{ id: 'time', desc: true }]}
          rowViewerContent={EntryDetails}
          toolbar={toolbar}
          emptyState={{
            title: 'No matching entries yet',
            subtitle:
              'The last 200 matching journal entries load first, then new ones appear at the top as the Pi writes them.',
          }}
        />
      </SysLogContext.Provider>
    </>
  )
}
