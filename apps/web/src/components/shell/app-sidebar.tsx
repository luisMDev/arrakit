import { Link, useMatchRoute, useMatches, useParams } from '@tanstack/react-router'
import { PanelLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TasksIndicator } from '#/components/tasks/tasks-indicator'
import { SettingsSidebarNav } from '#/components/settings/settings-nav'
import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarRail,
  useSidebar,
} from '#/components/ui/sidebar'
import { useWorkspace } from '#/components/workspaces/use-workspace'
import { initialOf, useCurrentUser } from '#/lib/current-user'
import { rememberWorkspace } from '#/lib/last-workspace'
import { cn } from '#/lib/utils'

import { APP_NAV, navFor, workspaceNav } from './app-nav'
import { Wordmark } from './root-layout'
import { SidebarNavLink } from './sidebar-nav-link'
import { WorkspaceMenu } from './workspace-menu'

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** The sidebar a route shows; the app's navigation when no route in the match names one. */
    sidebar?: 'settings'
  }
}

type Panel = 'app' | 'settings'

const SLIDE_IN: Record<Panel, string> = {
  settings: 'slide-in-from-right-8',
  app: 'slide-in-from-left-8',
}

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon" className="[view-transition-name:app-sidebar]">
      <SidebarHeader>
        <div className="flex items-center justify-between">
          <AppHomeLink className="px-1 group-data-[collapsible=icon]:hidden" />
          <SidebarToggle />
        </div>
        {useSidebarPanel() === 'settings' ? <SidebarPerson /> : <SidebarWorkspaceMenu />}
      </SidebarHeader>
      <SidebarContent className="overflow-x-hidden">
        <SidebarPanel />
      </SidebarContent>
      <TasksIndicator />
      <SidebarRail />
    </Sidebar>
  )
}

function useSidebarPanel(): Panel {
  return (
    useMatches({
      select: (matches) =>
        matches.findLast((match) => match.staticData.sidebar)?.staticData.sidebar,
    }) ?? 'app'
  )
}

/** Who is signed in: Settings are the person's and the organization's, not a workspace's. */
function SidebarPerson() {
  const { t } = useTranslation()
  const { user, name } = useCurrentUser()
  if (!user) return null
  return (
    <div
      role="group"
      aria-label={t('settings.signedInAs')}
      className="flex items-center gap-2 p-2 text-sm group-data-[collapsible=icon]:p-0"
    >
      <Avatar className="size-8 rounded-lg">
        <AvatarFallback className="rounded-lg">{initialOf(name)}</AvatarFallback>
      </Avatar>
      <span className="grid flex-1 leading-tight group-data-[collapsible=icon]:hidden">
        <span className="truncate font-medium">{name}</span>
        <span className="text-muted-foreground truncate text-xs">{user.email}</span>
      </span>
    </div>
  )
}

/** The workspace the person is inside of, if their role reads workspaces. */
function useOpenWorkspaceId(): string | undefined {
  const { can } = useCurrentUser()
  const workspaceId = useParams({ strict: false, select: (params) => params.workspaceId })
  return can({ workspace: ['read'] }) ? workspaceId : undefined
}

function SidebarWorkspaceMenu() {
  const workspaceId = useOpenWorkspaceId()
  return workspaceId ? <OpenWorkspaceMenu workspaceId={workspaceId} /> : <WorkspaceMenu />
}

function OpenWorkspaceMenu({ workspaceId }: { workspaceId: string }) {
  const organizationId = useCurrentUser().user?.organization?.id
  const workspace = useWorkspace(workspaceId).data
  useEffect(() => {
    if (organizationId && workspace) rememberWorkspace(organizationId, workspace.id)
  }, [organizationId, workspace])
  return <WorkspaceMenu workspace={workspace} />
}

/** Slides in from the side it leads to, but not on the first screen opened. */
function SidebarPanel() {
  const panel = useSidebarPanel()
  const [shown, setShown] = useState({ panel, animate: false })
  if (shown.panel !== panel) setShown({ panel, animate: true })
  return (
    <div
      key={panel}
      data-panel={panel}
      className={cn(
        shown.animate &&
          `animate-in fade-in duration-200 ease-out motion-reduce:animate-none ${SLIDE_IN[panel]}`,
      )}
    >
      {panel === 'settings' ? <SettingsSidebarNav /> : <AppNav />}
    </div>
  )
}

export function AppHomeLink({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <Link to="/app" aria-label={t('app.homeLabel')} className={className}>
      <Wordmark />
    </Link>
  )
}

function AppNav() {
  const { t } = useTranslation()
  const access = useCurrentUser()
  const matchRoute = useMatchRoute()
  const workspaceId = useOpenWorkspaceId()
  const items = navFor(access, workspaceId ? workspaceNav(workspaceId) : APP_NAV)
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <nav aria-label={t('nav.label')}>
          <SidebarMenu>
            {items.map((item) => (
              <SidebarNavLink
                key={item.label}
                label={t(`nav.${item.label}`)}
                icon={item.icon}
                link={item.link}
                isActive={Boolean(matchRoute({ to: item.link.to }))}
              />
            ))}
          </SidebarMenu>
        </nav>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

/** Opens and closes the sidebar (the sheet on phones); Ctrl/⌘+B does the same. */
export function SidebarToggle() {
  const { t } = useTranslation()
  const { toggleSidebar, isMobile, open, openMobile } = useSidebar()
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t('nav.toggle')}
      aria-expanded={isMobile ? openMobile : open}
      onClick={toggleSidebar}
    >
      <PanelLeft />
    </Button>
  )
}
