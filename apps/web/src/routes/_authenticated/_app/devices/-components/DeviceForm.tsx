import { Button, Input, Label, Textarea, cn } from '@rpi-control-center/ui'
import { useMutation } from '@tanstack/react-query'
import {
  CheckCircle2Icon,
  KeyRoundIcon,
  Loader2Icon,
  LockIcon,
  PlugZapIcon,
  XCircleIcon,
} from 'lucide-react'
import * as React from 'react'

import { testConnection } from '~/lib/pi/server'
import { type DeviceInput, type PublicDevice, deviceInputProblem } from '~/lib/pi/types'
import { ChoiceGroup } from '../../settings/-components/SettingsSection'

const EMPTY: DeviceInput = {
  name: '',
  host: 'raspberrypi.local',
  port: 22,
  username: 'pi',
  authMethod: 'password',
  secret: '',
  remotePath: 'raspberry-pi-script',
}

function fromDevice(device: PublicDevice): DeviceInput {
  return {
    name: device.name,
    host: device.host,
    port: device.port,
    username: device.username,
    authMethod: device.authMethod,
    secret: '',
    remotePath: device.remotePath,
  }
}

function Field({
  id,
  label,
  hint,
  className,
  children,
}: {
  id: string
  label: string
  hint?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/**
 * The connection details of a Pi. Without `device` it adds one, starting
 * from `initial`; with it, it edits that one and an empty password or key
 * keeps the saved one.
 */
export function DeviceForm({
  device,
  initial,
  submitLabel,
  isSubmitting,
  onSubmit,
  footer,
}: {
  device?: PublicDevice
  initial?: Partial<DeviceInput>
  submitLabel: string
  isSubmitting?: boolean
  onSubmit: (input: DeviceInput) => void
  footer?: React.ReactNode
}) {
  const [input, setInput] = React.useState<DeviceInput>(() =>
    device ? fromDevice(device) : { ...EMPTY, ...initial },
  )
  const [showProblem, setShowProblem] = React.useState(false)
  const editing = Boolean(device)
  const keepsSecret = editing && device?.authMethod === input.authMethod
  const problem = deviceInputProblem(input, { requireSecret: !keepsSecret })

  const set = <K extends keyof DeviceInput>(key: K, value: DeviceInput[K]) =>
    setInput((current) => ({ ...current, [key]: value }))

  const test = useMutation({
    mutationFn: () => testConnection({ data: { device: input, deviceId: device?.id } }),
  })

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (problem) {
      setShowProblem(true)
      return
    }
    onSubmit(input)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field id="device-name" label="Name" hint="What you call this Pi, e.g. “Garden sensor”.">
        <Input
          id="device-name"
          value={input.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Living room Pi"
          autoFocus={!editing}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-[1fr_6rem]">
        <Field id="device-host" label="Host" hint="Host name or IP address on your network.">
          <Input
            id="device-host"
            value={input.host}
            onChange={(e) => set('host', e.target.value)}
            placeholder="raspberrypi.local"
            autoCapitalize="off"
            spellCheck={false}
          />
        </Field>
        <Field id="device-port" label="SSH port">
          <Input
            id="device-port"
            type="number"
            min={1}
            max={65535}
            value={Number.isNaN(input.port) ? '' : input.port}
            onChange={(e) => set('port', e.target.valueAsNumber)}
          />
        </Field>
      </div>

      <Field id="device-username" label="Username">
        <Input
          id="device-username"
          value={input.username}
          onChange={(e) => set('username', e.target.value)}
          autoCapitalize="off"
          spellCheck={false}
        />
      </Field>

      <ChoiceGroup
        name="device-auth"
        label="Sign in with"
        columns={2}
        value={input.authMethod}
        onChange={(value) => set('authMethod', value)}
        choices={[
          {
            value: 'password',
            label: 'Password',
            hint: 'The SSH password of the user',
            icon: LockIcon,
          },
          {
            value: 'key',
            label: 'Private key',
            hint: 'An OpenSSH or PEM key without passphrase',
            icon: KeyRoundIcon,
          },
        ]}
      />

      {input.authMethod === 'password' ? (
        <Field
          id="device-secret"
          label="Password"
          hint={
            keepsSecret
              ? 'Leave empty to keep the saved password.'
              : 'Stored encrypted; never sent back to the browser.'
          }
        >
          <Input
            id="device-secret"
            type="password"
            autoComplete="new-password"
            value={input.secret}
            onChange={(e) => set('secret', e.target.value)}
            placeholder={keepsSecret ? '••••••••' : undefined}
          />
        </Field>
      ) : (
        <Field
          id="device-secret"
          label="Private key"
          hint={
            keepsSecret
              ? 'Leave empty to keep the saved key.'
              : 'Stored encrypted; never sent back to the browser.'
          }
        >
          <Textarea
            id="device-secret"
            value={input.secret}
            onChange={(e) => set('secret', e.target.value)}
            placeholder={keepsSecret ? 'Saved key is kept' : '-----BEGIN OPENSSH PRIVATE KEY-----'}
            className="min-h-28 font-mono text-xs"
            spellCheck={false}
          />
        </Field>
      )}

      <Field
        id="device-path"
        label="Deploy folder"
        hint="Inside the user’s home directory. It is emptied and refilled on every deploy."
      >
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-sm text-muted-foreground">~/</span>
          <Input
            id="device-path"
            value={input.remotePath}
            onChange={(e) => set('remotePath', e.target.value)}
            className="font-mono"
            autoCapitalize="off"
            spellCheck={false}
          />
        </div>
      </Field>

      {test.data ? (
        <output
          className={cn(
            'flex items-start gap-2 rounded-md border p-3 text-sm',
            test.data.ok
              ? 'border-emerald-500/40 text-emerald-800 dark:text-emerald-200'
              : 'border-destructive/40 text-destructive',
          )}
        >
          {test.data.ok ? (
            <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" />
          ) : (
            <XCircleIcon className="mt-0.5 size-4 shrink-0" />
          )}
          {test.data.message}
        </output>
      ) : null}
      {test.error ? <p className="text-sm text-destructive">{test.error.message}</p> : null}
      {showProblem && problem ? <p className="text-sm text-destructive">{problem}</p> : null}

      <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
        {footer}
        <Button
          type="button"
          variant="outline"
          onClick={() => (problem ? setShowProblem(true) : test.mutate())}
          disabled={test.isPending}
        >
          {test.isPending ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <PlugZapIcon className="size-4" />
          )}
          Test connection
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Loader2Icon className="size-4 animate-spin" /> : null}
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
