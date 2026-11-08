import { Button, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@rpi-control-center/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'

import { Page, PageHeader } from '~/lib/components/PageChrome'
import { getDevice } from '~/lib/pi/server'
import { OnlineBadge, ScriptBadge } from '../-components/StatusBadges'
import { deviceKey, useDeviceHealth } from '../-components/queries'
import { DeploymentsTab } from './-components/DeploymentsTab'
import { GpioTab } from './-components/GpioTab'
import { OutputTab } from './-components/OutputTab'
import { OverviewTab } from './-components/OverviewTab'
import { SettingsTab } from './-components/SettingsTab'
import { SysLogsTab } from './-components/SysLogsTab'
import { TerminalTab } from './-components/TerminalTab'
import { useDeploy } from './-components/useDeploy'

const TABS = [
  'overview',
  'output',
  'system-logs',
  'gpio',
  'terminal',
  'deployments',
  'settings',
] as const
type Tab = (typeof TABS)[number]

function DevicePage() {
  const { deviceId } = Route.useParams()
  const { tab = 'overview' } = Route.useSearch()
  const navigate = Route.useNavigate()
  const deploy = useDeploy(deviceId)
  const { data: health, isLoading: healthLoading } = useDeviceHealth(deviceId)
  const { data: device, error } = useQuery({
    queryKey: deviceKey(deviceId),
    queryFn: () => getDevice({ data: { deviceId } }),
  })

  if (error) {
    return (
      <Page>
        <PageHeader
          title="Device not found"
          description={error.message}
          actions={
            <Button size="sm" variant="outline" asChild>
              <Link to="/devices">Back to devices</Link>
            </Button>
          }
        />
      </Page>
    )
  }

  return (
    <Page>
      <div className="flex shrink-0 flex-col gap-2 border-b p-4">
        <Link
          to="/devices"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          Devices
        </Link>
      </div>

      {device ? (
        <Tabs
          value={tab}
          onValueChange={(value) =>
            navigate({ search: value === 'overview' ? {} : { tab: value as Tab }, replace: true })
          }
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <div className="flex shrink-0 items-center gap-4 overflow-x-auto border-b px-4 py-2">
            <div className="text-sm">
            {device?.name} - {' '}
            <span className="font-mono text-sm">
                {device.username}@{device.host}
                {device.port === 22 ? '' : `:${device.port}`}
              </span>
            </div>
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="output">Output</TabsTrigger>
              <TabsTrigger value="system-logs">System logs</TabsTrigger>
              <TabsTrigger value="gpio">GPIO</TabsTrigger>
              <TabsTrigger value="terminal">Terminal</TabsTrigger>
              <TabsTrigger value="deployments">Deployments</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>
            <div className="ml-auto flex items-center gap-2">
              <ScriptBadge health={health} />
              <OnlineBadge health={health} isLoading={healthLoading} />
            </div>
          </div>
          <TabsContent value="overview" className={TAB_PANEL}>
            <OverviewTab device={device} deploy={deploy} />
          </TabsContent>
          <TabsContent value="output" className={TAB_PANEL}>
            <OutputTab device={device} />
          </TabsContent>
          <TabsContent value="system-logs" className={TAB_PANEL}>
            <SysLogsTab device={device} />
          </TabsContent>
          <TabsContent value="gpio" className={TAB_PANEL}>
            <GpioTab device={device} />
          </TabsContent>
          {/* Mounted while hidden, so the shell survives switching tabs. */}
          <TabsContent
            value="terminal"
            forceMount
            className={`${TAB_PANEL} data-[state=inactive]:hidden`}
          >
            <TerminalTab key={device.id} device={device} active={tab === 'terminal'} />
          </TabsContent>
          <TabsContent value="deployments" className={TAB_PANEL}>
            <DeploymentsTab device={device} />
          </TabsContent>
          <TabsContent value="settings" className={TAB_PANEL}>
            <SettingsTab device={device} />
          </TabsContent>
        </Tabs>
      ) : (
        <Skeleton className="m-4 h-64" />
      )}
    </Page>
  )
}

/** Each tab is a flat page body: strips stacked under the tab bar, or one table filling it. */
const TAB_PANEL = 'flex min-h-0 flex-1 flex-col'

export const Route = createFileRoute('/_authenticated/_app/devices/$deviceId/')({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } =>
    TABS.includes(search.tab as Tab) && search.tab !== 'overview' ? { tab: search.tab as Tab } : {},
  component: DevicePage,
})
