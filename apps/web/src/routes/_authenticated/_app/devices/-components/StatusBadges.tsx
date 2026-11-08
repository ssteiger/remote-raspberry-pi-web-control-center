import { Badge, cn } from '@rpi-control-center/ui'
import { CircleIcon, Loader2Icon } from 'lucide-react'

import type { DeviceHealth } from '~/lib/pi/types'

export function OnlineBadge({ health, isLoading }: { health?: DeviceHealth; isLoading?: boolean }) {
  if (isLoading || !health) {
    return (
      <Badge variant="outline" className="gap-1.5 text-muted-foreground">
        <Loader2Icon className="size-3 animate-spin" />
        Checking
      </Badge>
    )
  }
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1.5',
        health.online ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground',
      )}
      title={health.online ? undefined : health.error}
    >
      <CircleIcon
        className={cn(
          'size-2',
          health.online
            ? 'fill-emerald-500 text-emerald-500'
            : 'fill-muted-foreground/40 text-muted-foreground/40',
        )}
      />
      {health.online ? 'Online' : 'Offline'}
    </Badge>
  )
}

export function ScriptBadge({ health }: { health?: DeviceHealth }) {
  if (!health?.online) return null
  return health.script.running ? (
    <Badge className="gap-1.5 bg-brand/10 text-brand">Script running</Badge>
  ) : (
    <Badge variant="secondary">Script stopped</Badge>
  )
}
