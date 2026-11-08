import { Badge, Button, cn } from '@rpi-control-center/ui'
import { PauseIcon, PlayIcon, Trash2Icon } from 'lucide-react'

import type { StreamState } from './useEventStream'

const LABEL: Record<StreamState, string> = {
  live: 'Live',
  paused: 'Paused',
  error: 'Stopped',
  connecting: 'Connecting',
}

export function StreamBadge({ state, label }: { state: StreamState; label?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1.5',
        state === 'live' && 'text-emerald-700 dark:text-emerald-300',
        state === 'error' && 'text-destructive',
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full bg-muted-foreground/50',
          state === 'live' && 'animate-pulse bg-emerald-500',
          state === 'error' && 'bg-destructive',
        )}
      />
      {label ?? LABEL[state]}
    </Badge>
  )
}

export function PauseClearButtons({
  paused,
  onTogglePaused,
  onClear,
}: {
  paused: boolean
  onTogglePaused: () => void
  onClear: () => void
}) {
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" className="gap-1.5" onClick={onTogglePaused}>
        {paused ? <PlayIcon className="size-3.5" /> : <PauseIcon className="size-3.5" />}
        {paused ? 'Resume' : 'Pause'}
      </Button>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={onClear}>
        <Trash2Icon className="size-3.5" />
        Clear
      </Button>
    </div>
  )
}
