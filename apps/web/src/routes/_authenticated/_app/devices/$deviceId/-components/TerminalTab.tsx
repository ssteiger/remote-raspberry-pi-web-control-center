import { Button } from '@rpi-control-center/ui'
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  InfoIcon,
  type LucideIcon,
  RotateCwIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import * as React from 'react'

import { PageNotice, PageToolbar } from '~/lib/components/PageChrome'
import type { PublicDevice } from '~/lib/pi/types'
import { StreamBadge } from './StreamControls'
import type { StreamState } from './useEventStream'
import { type TerminalKey, type TerminalState, useTerminal } from './useTerminal'

const BADGE: Record<TerminalState, { state: StreamState; label: string }> = {
  connecting: { state: 'connecting', label: 'Connecting' },
  live: { state: 'live', label: 'Connected' },
  ended: { state: 'paused', label: 'Ended' },
  error: { state: 'error', label: 'Disconnected' },
}

const TOUCH_KEYS: { key: TerminalKey; label: string; Icon?: LucideIcon }[] = [
  { key: 'escape', label: 'Esc' },
  { key: 'tab', label: 'Tab' },
  { key: 'interrupt', label: 'Ctrl+C' },
  { key: 'up', label: 'Up arrow', Icon: ArrowUpIcon },
  { key: 'down', label: 'Down arrow', Icon: ArrowDownIcon },
  { key: 'left', label: 'Left arrow', Icon: ArrowLeftIcon },
  { key: 'right', label: 'Right arrow', Icon: ArrowRightIcon },
]

/**
 * A login shell on the Pi. It connects the first time the tab is shown and
 * then stays open with the page, so switching tabs leaves it running.
 */
export function TerminalTab({ device, active }: { device: PublicDevice; active: boolean }) {
  const [shown, setShown] = React.useState(active)
  if (active && !shown) setShown(true)

  const target = `${device.username}@${device.host}${device.port === 22 ? '' : `:${device.port}`}`
  const ssh = `ssh ${device.port === 22 ? '' : `-p ${device.port} `}${device.username}@${device.host}`
  const terminal = useTerminal({ deviceId: device.id, target, enabled: shown })
  const badge = BADGE[terminal.state]
  const over = terminal.state === 'ended' || terminal.state === 'error'

  return (
    <>
      <PageNotice icon={InfoIcon}>
        The same login shell as <code>{ssh}</code>. It stays open while you switch tabs. Leaving
        this page ends it and anything still running in it, so start long jobs with{' '}
        <code>nohup</code> or inside <code>tmux</code>.
      </PageNotice>

      <PageToolbar>
        <StreamBadge state={badge.state} label={badge.label} />
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
          {terminal.title ?? target}
        </span>
        {over ? (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto gap-1.5"
            onClick={terminal.reconnect}
          >
            <RotateCwIcon className="size-3.5" />
            Reconnect
          </Button>
        ) : null}
      </PageToolbar>

      {terminal.error ? (
        <PageNotice tone="destructive" icon={TriangleAlertIcon} title="The terminal disconnected">
          {terminal.error}
        </PageNotice>
      ) : null}

      <div className="relative min-h-80 flex-1 bg-muted/40 focus-within:ring-2 focus-within:ring-ring/50 focus-within:ring-inset">
        <div
          ref={terminal.hostRef}
          className="absolute inset-0 [&_.xterm]:h-full [&_.xterm]:px-4 [&_.xterm]:py-3"
        />
      </div>

      <div className="hidden shrink-0 flex-wrap gap-1.5 border-t px-4 py-2 pointer-coarse:flex">
        {TOUCH_KEYS.map(({ key, label, Icon }) => (
          <Button
            key={key}
            size="sm"
            variant="outline"
            className="min-w-10"
            disabled={over}
            aria-label={Icon ? label : undefined}
            // Keeps the focus, and with it the on-screen keyboard, in the terminal.
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => terminal.press(key)}
          >
            {Icon ? <Icon className="size-3.5" /> : label}
          </Button>
        ))}
      </div>
    </>
  )
}
