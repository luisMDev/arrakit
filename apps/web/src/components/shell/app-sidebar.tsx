import { Link, useMatchRoute, useMatches } from '@tanstack/react-router'
import { PanelLeft } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingsSidebarNav } from '#/components/settings/settings-nav'
import { Button } from '#/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarRail,
  useSidebar,
} from '#/components/ui/sidebar'
import { useCurrentUser } from '#/lib/current-user'
import { cn } from '#/lib/utils'

import { AccountMenu } from './account-menu'
import { navFor } from './app-nav'
import { Wordmark } from './root-layout'
import { SidebarNavLink } from './sidebar-nav-link'

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
      <SidebarHeader className="flex-row items-center justify-between">
        <AppHomeLink className="px-1 group-data-[collapsible=icon]:hidden" />
        <SidebarToggle />
      </SidebarHeader>
      <SidebarContent className="overflow-x-hidden">
        <SidebarPanel />
      </SidebarContent>
      <SidebarFooter>
        <AccountMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

/** Slides in from the side it leads to, but not on the first screen opened. */
function SidebarPanel() {
  const panel: Panel =
    useMatches({
      select: (matches) =>
        matches.findLast((match) => match.staticData.sidebar)?.staticData.sidebar,
    }) ?? 'app'
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
  const items = navFor(access)
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
