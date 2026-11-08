import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@rpi-control-center/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'

import { createDevice } from '~/lib/pi/server'
import type { DeviceInput } from '~/lib/pi/types'
import { DeviceForm } from './DeviceForm'
import { devicesKey } from './queries'

/** Adds a Pi and opens its page. `initial` pre-fills the form, e.g. from a network scan. */
export function AddDeviceDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: Partial<DeviceInput>
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const create = useMutation({
    mutationFn: createDevice,
    onSuccess: async (device) => {
      toast.success(`${device.name} was added`)
      await queryClient.invalidateQueries({ queryKey: devicesKey })
      onOpenChange(false)
      navigate({ to: '/devices/$deviceId', params: { deviceId: device.id } })
    },
    onError: (error) => toast.error(error.message),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a Raspberry Pi</DialogTitle>
          <DialogDescription>
            The control center reaches it over SSH. Enable SSH in Raspberry Pi Imager or with{' '}
            <code>sudo raspi-config</code>.
          </DialogDescription>
        </DialogHeader>
        <DeviceForm
          initial={initial}
          submitLabel="Add device"
          isSubmitting={create.isPending}
          onSubmit={(input) => create.mutate({ data: input })}
        />
      </DialogContent>
    </Dialog>
  )
}
