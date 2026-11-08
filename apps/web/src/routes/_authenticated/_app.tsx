import { AppLayout, type NavUserUser } from '@rpi-control-center/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Outlet, createFileRoute, useLocation } from '@tanstack/react-router'
import { ClipboardListIcon, CpuIcon, DatabaseIcon, RadarIcon, SettingsIcon } from 'lucide-react'
import { toast } from 'sonner'

import { AssistantBar } from '~/lib/assistant/AssistantBar'
import { AssistantProvider } from '~/lib/assistant/AssistantProvider'
import { logoutFn } from '~/lib/auth/server'
import { GlobalSearch } from '~/lib/components/GlobalSearch'
import { usePreferencesSync } from '~/lib/preferences'

const NAV = [
  { title: 'Devices', url: '/devices', icon: CpuIcon, matchPrefix: true },
  { title: 'Find a Pi', url: '/discover', icon: RadarIcon, matchPrefix: true },
  { title: 'Activity logs', url: '/activity-logs', icon: ClipboardListIcon, matchPrefix: true },
]

const NAV_SECONDARY = [{ title: 'Settings', url: '/settings', icon: SettingsIcon }]

function headerTitle(pathname: string): string {
  if (pathname.startsWith('/devices')) return 'Devices'
  if (pathname.startsWith('/discover')) return 'Find a Pi'
  if (pathname.startsWith('/activity-logs')) return 'Activity logs'
  if (pathname.startsWith('/settings')) return 'Settings'
  return 'Raspberry Pi control center'
}

const Layout = () => {
  const { user } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const location = useLocation()
  usePreferencesSync()

  const logOutMutation = useMutation({
    mutationFn: logoutFn,
    onSuccess: async () => {
      toast.success('Logout successful')
      await queryClient.invalidateQueries({ queryKey: ['user'] })
    },
    onError: (error) => {
      toast.error(`Logout failed: ${error.message}`)
    },
  })

  const sidebarUser: NavUserUser | undefined = user
    ? {
        name: user.email ?? 'Account',
        email: user.email ?? '',
        initials: (user.email ?? 'U').slice(0, 2).toUpperCase(),
      }
    : undefined

  return (
    <AssistantProvider>
      <AppLayout
        headerProps={{
          brand: 'Pi Control Center',
          title: headerTitle(location.pathname),
          center: (
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <GlobalSearch />
              </div>
              <AssistantBar />
            </div>
          ),
        }}
        sidebarProps={{
          user: sidebarUser,
          onLogout: () => logOutMutation.mutate(undefined),
          navMain: NAV,
          documents: [],
          navSecondary: NAV_SECONDARY,
          userMenuItems: [
            {
              label: 'Local DB',
              icon: DatabaseIcon,
              href: 'http://127.0.0.1:54723/project/default',
              external: true,
            },
          ],
        }}
      >
        <Outlet />
      </AppLayout>
    </AssistantProvider>
  )
}

export const Route = createFileRoute('/_authenticated/_app')({
  component: Layout,
})
