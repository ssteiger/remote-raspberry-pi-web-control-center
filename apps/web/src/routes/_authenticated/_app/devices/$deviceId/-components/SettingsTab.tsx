import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  buttonVariants,
} from '@rpi-control-center/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { deleteDevice, updateDevice } from '~/lib/pi/server'
import type { PublicDevice } from '~/lib/pi/types'
import { DeviceForm } from '../../-components/DeviceForm'
import { deviceHealthKey, deviceKey, devicesKey } from '../../-components/queries'
import { SettingRow, SettingsSection } from '../../../settings/-components/SettingsSection'

export function SettingsTab({ device }: { device: PublicDevice }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const update = useMutation({
    mutationFn: updateDevice,
    onSuccess: async (updated) => {
      toast.success('Saved')
      queryClient.setQueryData(deviceKey(device.id), updated)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: devicesKey, exact: true }),
        queryClient.invalidateQueries({ queryKey: deviceHealthKey(device.id) }),
      ])
    },
    onError: (error) => toast.error(error.message),
  })

  const remove = useMutation({
    mutationFn: () => deleteDevice({ data: { deviceId: device.id } }),
    onSuccess: async () => {
      toast.success(`${device.name} was removed`)
      await queryClient.invalidateQueries({ queryKey: devicesKey })
      navigate({ to: '/devices' })
    },
    onError: (error) => toast.error(error.message),
  })

  return (
    <>
      <SettingsSection
        title="Connection"
        description="How the control center reaches this Pi over SSH."
      >
        <DeviceForm
          key={device.id}
          device={device}
          submitLabel="Save changes"
          isSubmitting={update.isPending}
          onSubmit={(input) => update.mutate({ data: { deviceId: device.id, device: input } })}
        />
      </SettingsSection>

      <SettingsSection title="Remove device">
        <SettingRow
          label={`Forget ${device.name}`}
          description="Deletes the saved login and the deploy history here. Nothing on the Pi is touched, and a running script keeps running."
        >
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5 text-destructive">
                <Trash2Icon className="size-3.5" />
                Remove
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {device.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Its login and deploy history are deleted from the control center. You can add it
                  again later.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction
                  className={buttonVariants({ variant: 'destructive' })}
                  onClick={() => remove.mutate()}
                >
                  Remove device
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </SettingRow>
      </SettingsSection>
    </>
  )
}
