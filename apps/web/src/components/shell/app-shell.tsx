import { Outlet } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { SidebarProvider } from '#/components/ui/sidebar'
import { useCurrentUser } from '#/lib/current-user'

import { AppMenu } from './app-menu'
import { AppSidebar, SidebarToggle } from './app-sidebar'
import { OrgSwitcher } from './org-switcher'

/** The signed-in part: the header's controls and the sidebar beside the screens. */
export function AppShell() {
  const { t } = useTranslation()
  const { user } = useCurrentUser()
  // Signing out, or leaving the last organization on the way to Profile: nothing renders then.
  if (!user?.organization) return null
  return (
    <SidebarProvider className="min-h-0 flex-1">
      <SidebarToggle className="absolute top-2.5 left-2 z-20 sm:left-3" />
      <nav
        aria-label={t('shell.account')}
        className="absolute top-0 right-4 z-20 flex h-14 items-center gap-4 [view-transition-name:app-bar] sm:right-6"
      >
        <OrgSwitcher />
        <AppMenu />
      </nav>
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
    </SidebarProvider>
  )
}
