import { Link, useMatchRoute } from '@tanstack/react-router'
import { PanelLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '#/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '#/components/ui/sidebar'
import { useCurrentUser } from '#/lib/current-user'

import { activeItem, navFor } from './app-nav'

/** The app's navigation under the site header: an icon rail when collapsed, a sheet on phones. */
export function AppSidebar() {
  const { t } = useTranslation()
  const access = useCurrentUser()
  const matchRoute = useMatchRoute()
  const { isMobile, setOpenMobile } = useSidebar()
  const items = navFor(access)
  const active = activeItem(items, ({ link }) =>
    Boolean(matchRoute({ to: link.to, search: link.search, includeSearch: true } as never)),
  )

  return (
    <Sidebar
      collapsible="icon"
      className="top-14 h-[calc(100svh-3.5rem)]! [view-transition-name:app-sidebar]"
    >
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <nav aria-label={t('nav.label')}>
              <SidebarMenu>
                {items.map((item) => {
                  const label = t(`nav.${item.label}`)
                  const isActive = item === active
                  return (
                    <SidebarMenuItem key={item.label}>
                      <SidebarMenuButton asChild isActive={isActive} tooltip={label}>
                        <Link
                          {...item.link}
                          activeOptions={{ exact: true, includeSearch: true }}
                          aria-current={isActive ? 'page' : undefined}
                          onClick={() => {
                            if (isMobile) setOpenMobile(false)
                          }}
                        >
                          <item.icon />
                          <span>{label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}

/** Opens and closes the sidebar (the sheet on phones); Ctrl/⌘+B does the same. */
export function SidebarToggle({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { toggleSidebar, isMobile, open, openMobile } = useSidebar()
  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      aria-label={t('nav.toggle')}
      aria-expanded={isMobile ? openMobile : open}
      onClick={toggleSidebar}
    >
      <PanelLeft />
    </Button>
  )
}
