import { TriangleAlertIcon } from 'lucide-react'

import { PageNotice, PageToolbar } from '~/lib/components/PageChrome'
import type { PublicDevice } from '~/lib/pi/types'
import { LogView } from './LogView'
import { PauseClearButtons, StreamBadge } from './StreamControls'
import { useEventStream } from './useEventStream'

const asLine = (data: string) => data

/** Follows the script's `app.log` on the Pi for as long as the tab is open. */
export function OutputTab({ device }: { device: PublicDevice }) {
  const stream = useEventStream(`/api/devices/${device.id}/output`, asLine)
  const lines = stream.items.map((item) => item.value)

  return (
    <>
      <PageToolbar>
        <StreamBadge state={stream.state} />
        <span className="text-sm text-muted-foreground">
          <code className="rounded bg-muted px-1 py-0.5 text-xs">~/{device.remotePath}/app.log</code>,
          last 200 lines and everything new
        </span>
        <div className="ml-auto">
          <PauseClearButtons
            paused={stream.paused}
            onTogglePaused={stream.togglePaused}
            onClear={stream.clear}
          />
        </div>
      </PageToolbar>
      {stream.error ? (
        <PageNotice tone="destructive" icon={TriangleAlertIcon} title="The output stream stopped">
          {stream.error}
        </PageNotice>
      ) : null}
      <LogView
        lines={lines}
        empty={
          stream.state === 'live'
            ? 'No output yet. Deploy or start the script to see what it prints.'
            : 'Connecting to the Pi...'
        }
        className="min-h-80 flex-1"
      />
    </>
  )
}
