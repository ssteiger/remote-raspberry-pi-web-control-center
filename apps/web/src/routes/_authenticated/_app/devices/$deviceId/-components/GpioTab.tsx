import { Badge, Button, Input, Skeleton, Switch } from '@rpi-control-center/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { InfoIcon, PlusIcon, RefreshCwIcon, TriangleAlertIcon, XIcon } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { EmptyState, PageNotice, PageToolbar } from '~/lib/components/PageChrome'
import { getGpioState, setGpioLevel, setGpioPins } from '~/lib/pi/server'
import {
  type GpioPinState,
  MAX_GPIO,
  MIN_GPIO,
  type PublicDevice,
  isValidGpioPin,
} from '~/lib/pi/types'
import { deviceKey, gpioKey } from '../../-components/queries'

const MODE_LABEL: Record<string, string> = {
  op: 'Output',
  ip: 'Input',
  no: 'Unset',
  unknown: 'Unknown',
}

function PinRow({
  device,
  state,
  onRemove,
}: {
  device: PublicDevice
  state: GpioPinState
  onRemove: () => void
}) {
  const queryClient = useQueryClient()
  const set = useMutation({
    mutationFn: (level: 0 | 1) =>
      setGpioLevel({ data: { deviceId: device.id, pin: state.pin, level } }),
    onSuccess: (next) => {
      queryClient.setQueryData<GpioPinState[]>(gpioKey(device.id), (current) =>
        current?.map((pin) => (pin.pin === next.pin ? next : pin)),
      )
    },
    onError: (error) => toast.error(error.message),
  })
  const level = set.isPending ? set.variables : state.level
  const id = `gpio-${state.pin}`
  return (
    <div className="flex items-center justify-between gap-4 border-b px-4 py-3">
      <label htmlFor={id} className="flex flex-col gap-0.5">
        <span className="font-mono text-sm font-medium">GPIO {state.pin}</span>
        <span className="text-xs text-muted-foreground">
          {MODE_LABEL[state.mode] ?? `Alternate (${state.mode})`}
          {state.level != null ? ` · reads ${state.level ? 'high' : 'low'}` : ''}
        </span>
      </label>
      <div className="flex items-center gap-3">
        <Badge variant="outline" className="w-12 justify-center tabular-nums">
          {level == null ? '—' : level ? 'High' : 'Low'}
        </Badge>
        <Switch
          id={id}
          checked={level === 1}
          disabled={set.isPending}
          onCheckedChange={(checked) => set.mutate(checked ? 1 : 0)}
        />
        <Button
          size="icon"
          variant="ghost"
          onClick={onRemove}
          aria-label={`Remove GPIO ${state.pin}`}
        >
          <XIcon className="size-4" />
        </Button>
      </div>
    </div>
  )
}

export function GpioTab({ device }: { device: PublicDevice }) {
  const queryClient = useQueryClient()
  const [newPin, setNewPin] = React.useState('')
  const pins = useQuery({
    queryKey: gpioKey(device.id),
    queryFn: () => getGpioState({ data: { deviceId: device.id } }),
  })

  const savePins = useMutation({
    mutationFn: (next: number[]) => setGpioPins({ data: { deviceId: device.id, pins: next } }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(deviceKey(device.id), updated)
      await queryClient.invalidateQueries({ queryKey: gpioKey(device.id) })
    },
    onError: (error) => toast.error(error.message),
  })

  const addPin = (event: React.FormEvent) => {
    event.preventDefault()
    const pin = Number(newPin)
    if (!newPin || !isValidGpioPin(pin)) {
      toast.error(`Enter a GPIO number from ${MIN_GPIO} to ${MAX_GPIO}`)
      return
    }
    if (device.gpioPins.includes(pin)) {
      toast.error(`GPIO ${pin} is already listed`)
      return
    }
    savePins.mutate([...device.gpioPins, pin])
    setNewPin('')
  }

  return (
    <>
      <PageNotice icon={InfoIcon}>
        Switching a pin makes it an output and drives it high or low with <code>pinctrl</code>.
        BCM numbering, as in the script: GPIO 6 is physical pin 31. If your script drives the same
        pin, the two fight over it, so stop the script first.
      </PageNotice>

      <PageToolbar>
        <form onSubmit={addPin} className="flex items-center gap-2">
          <Input
            type="number"
            min={MIN_GPIO}
            max={MAX_GPIO}
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
            placeholder="GPIO number, e.g. 17"
            className="w-48"
            aria-label="GPIO number to add"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={savePins.isPending}
          >
            <PlusIcon className="size-3.5" />
            Add pin
          </Button>
        </form>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto gap-1.5"
          onClick={() => pins.refetch()}
          disabled={pins.isFetching}
        >
          <RefreshCwIcon className={pins.isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} />
          Read pins
        </Button>
      </PageToolbar>

      {pins.isLoading ? (
        <div className="flex flex-col gap-3 p-4">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : pins.error ? (
        <PageNotice tone="destructive" icon={TriangleAlertIcon} title="The pins could not be read">
          {pins.error.message}
        </PageNotice>
      ) : pins.data?.length ? (
        <div className="flex shrink-0 flex-col">
          {pins.data.map((state) => (
            <PinRow
              key={state.pin}
              device={device}
              state={state}
              onRemove={() => savePins.mutate(device.gpioPins.filter((pin) => pin !== state.pin))}
            />
          ))}
        </div>
      ) : (
        <EmptyState title="No pins listed yet" className="m-4">
          Add the GPIO numbers you want to switch from here.
        </EmptyState>
      )}
    </>
  )
}
