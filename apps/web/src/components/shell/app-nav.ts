import { type LinkOptions, linkOptions } from '@tanstack/react-router'
import { CreditCard, FolderKanban, House, type LucideIcon, Settings, Users } from 'lucide-react'

import type { Access } from '#/lib/current-user'

export interface AppNavItem {
  /** Under `nav.` in the locale files. */
  label: string
  icon: LucideIcon
  link: LinkOptions
  /** Who sees it; everyone in the organization when absent. */
  shows?: (access: Access) => boolean
}

/** The app's destinations, in sidebar order. A product module adds its screen here. */
export const APP_NAV: AppNavItem[] = [
  { label: 'home', icon: House, link: linkOptions({ to: '/app' }) },
  {
    label: 'workspaces',
    icon: FolderKanban,
    link: linkOptions({ to: '/app/workspaces' }),
    shows: (access) => access.can({ workspace: ['read'] }),
  },
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

export const navFor = (access: Access): AppNavItem[] =>
  APP_NAV.filter((item) => item.shows?.(access) ?? true)

const searchKeys = (item: AppNavItem) =>
  typeof item.link.search === 'object' && item.link.search
    ? Object.keys(item.link.search).length
    : 0

/**
 * The item for where the person is: of those whose path and search match, the one naming the
 * most search params (Members over Settings on `?section=members`); undefined when none match.
 */
export function activeItem(
  items: readonly AppNavItem[],
  matches: (item: AppNavItem) => boolean,
): AppNavItem | undefined {
  return items
    .filter(matches)
    .reduce<AppNavItem | undefined>(
      (best, item) => (!best || searchKeys(item) > searchKeys(best) ? item : best),
      undefined,
    )
}
