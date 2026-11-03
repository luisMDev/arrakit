import { z } from 'zod'

import { useCurrentUser } from '#/lib/current-user'
import { searchText } from '#/lib/search-params'

export const SETTINGS_SECTIONS = [
  'account',
  'general',
  'usage',
  'members',
  'teams',
  'roles',
  'billing',
  'security',
] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export const settingsSearch = z.object({
  section: z.enum(SETTINGS_SECTIONS).optional().catch(undefined),
  top_up: searchText,
})
export type SettingsSearch = z.infer<typeof settingsSearch>

/** The sections the person's role opens, and the one shown for `section` (else Account). */
export function useSettingsSections(section: SettingsSection | undefined) {
  const { can, managesMembers } = useCurrentUser()
  const shown: Partial<Record<SettingsSection, boolean>> = {
    usage: can({ usage: ['read'] }),
    members: managesMembers,
    roles: can({ ac: ['create'] }),
    billing: can({ billing: ['read'] }),
  }
  const visible = (id: SettingsSection) => shown[id] ?? true
  return { visible, current: section && visible(section) ? section : 'account' }
}
