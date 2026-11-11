import { type LinkOptions, linkOptions } from '@tanstack/react-router'
import {
  Activity,
  CreditCard,
  House,
  Library,
  type LucideIcon,
  Settings,
  Users,
} from 'lucide-react'

import type { Access } from '#/lib/current-user'

export interface AppNavItem {
  /** Under `nav.` in the locale files. */
  label: string
  icon: LucideIcon
  link: LinkOptions
  /** Who sees it; everyone in the organization when absent. */
  shows?: (access: Access) => boolean
}

/** The sidebar outside a workspace. A product module adds its organization-wide screen here. */
export const APP_NAV: AppNavItem[] = [
  { label: 'home', icon: House, link: linkOptions({ to: '/app' }) },
]

/** The sidebar inside a workspace. A module scoped to a workspace adds its screen here. */
export const workspaceNav = (workspaceId: string): AppNavItem[] => [
  {
    label: 'home',
    icon: House,
    link: linkOptions({ to: '/app/workspaces/$workspaceId', params: { workspaceId } }),
  },
  {
    label: 'library',
    icon: Library,
    link: linkOptions({ to: '/app/workspaces/$workspaceId/library', params: { workspaceId } }),
    shows: (access) => access.can({ file: ['read'] }),
  },
  {
    label: 'activity',
    icon: Activity,
    link: linkOptions({ to: '/app/workspaces/$workspaceId/activity', params: { workspaceId } }),
  },
]

/** The organization's own destinations, in the workspace menu's order. */
export const ORGANIZATION_NAV: AppNavItem[] = [
  { label: 'settings', icon: Settings, link: linkOptions({ to: '/app/settings', search: {} }) },
  {
    label: 'members',
    icon: Users,
    link: linkOptions({ to: '/app/settings', search: { section: 'members' } }),
    shows: (access) => access.managesMembers,
  },
  {
    label: 'billing',
    icon: CreditCard,
    link: linkOptions({ to: '/app/settings', search: { section: 'billing' } }),
    shows: (access) => access.can({ billing: ['read'] }),
  },
]

export const navFor = (access: Access, items: AppNavItem[] = APP_NAV): AppNavItem[] =>
  items.filter((item) => item.shows?.(access) ?? true)
