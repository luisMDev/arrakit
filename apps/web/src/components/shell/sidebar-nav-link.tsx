import { Link, type LinkOptions } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'

import { SidebarMenuButton, SidebarMenuItem, useSidebar } from '#/components/ui/sidebar'

/**
 * One sidebar destination. The caller decides which one is active: the Link only matches exactly,
 * so it never marks a second item on its own.
 */
export function SidebarNavLink({
  label,
  icon: Icon,
  link,
  isActive = false,
}: {
  label: string
  icon: LucideIcon
  link: LinkOptions
  isActive?: boolean
}) {
  const { isMobile, setOpenMobile } = useSidebar()
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={label}>
        <Link
          {...link}
          activeOptions={{ exact: true, includeSearch: true }}
          aria-current={isActive ? 'page' : undefined}
          onClick={() => {
            if (isMobile) setOpenMobile(false)
          }}
        >
          <Icon />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
