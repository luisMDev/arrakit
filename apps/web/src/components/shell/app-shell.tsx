import { Outlet } from '@tanstack/react-router'

import { SidebarProvider } from '#/components/ui/sidebar'
import { isMember, useCurrentUser } from '#/lib/current-user'

import { AppHomeLink, AppSidebar, SidebarToggle } from './app-sidebar'

export function AppShell() {
  const { user } = useCurrentUser()
  // Signing out, or leaving the last organization on the way to Profile: nothing renders then.
  if (!isMember(user)) return null
  return (
    <SidebarProvider>
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center gap-2 border-b px-2 md:hidden">
          <SidebarToggle />
          <AppHomeLink />
        </div>
        <Outlet />
      </div>
    </SidebarProvider>
  )
}
