import { Outlet, createFileRoute } from '@tanstack/react-router'
import { SlidersHorizontalIcon, UserIcon } from 'lucide-react'

import { Page, PageHeader } from '~/lib/components/PageChrome'
import { type SettingsNavItem, SidebarNav } from './-components/SidebarNav'

const SECTIONS: SettingsNavItem[] = [
  {
    href: '/settings',
    title: 'General',
    hint: 'Theme, text size, motion',
    icon: SlidersHorizontalIcon,
  },
  {
    href: '/settings/account',
    title: 'Account',
    hint: 'Sign-in and saved choices',
    icon: UserIcon,
  },
]

function SettingsLayout() {
  return (
    <Page>
      <PageHeader title="Settings" description="How the app looks and who is signed in." />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="shrink-0 border-b p-2 lg:w-64 lg:border-r lg:border-b-0">
          <div className="lg:sticky lg:top-2">
            <SidebarNav items={SECTIONS} />
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <Outlet />
        </div>
      </div>
    </Page>
  )
}

export const Route = createFileRoute('/_authenticated/_app/settings')({
  component: SettingsLayout,
})
