import { linkOptions, useMatch } from '@tanstack/react-router'
import {
  Activity,
  ArrowLeft,
  Building2,
  CreditCard,
  Gauge,
  Library,
  Lock,
  type LucideIcon,
  ShieldCheck,
  UserRound,
  Users,
  UsersRound,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { SidebarNavLink } from '#/components/shell/sidebar-nav-link'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from '#/components/ui/sidebar'

import { SETTINGS_SECTIONS, type SettingsSection, useSettingsSections } from './settings-sections'

const SECTION_ICONS: Record<SettingsSection, LucideIcon> = {
  account: UserRound,
  general: Building2,
  library: Library,
  activity: Activity,
  usage: Gauge,
  members: Users,
  teams: UsersRound,
  roles: ShieldCheck,
  billing: CreditCard,
  security: Lock,
}

const SETTINGS_GROUPS: { group: string; items: readonly SettingsSection[] }[] = [
  { group: 'settings.mySettings', items: ['account'] },
  {
    group: 'settings.organizationSettings',
    items: SETTINGS_SECTIONS.filter((id) => id !== 'account'),
  },
]

export function SettingsSidebarNav() {
  const { t } = useTranslation()
  const section = useMatch({
    from: '/app/settings',
    shouldThrow: false,
    select: (match) => match.search.section,
  })
  const { visible, current } = useSettingsSections(section)
  return (
    <nav aria-label={t('settings.title')}>
      <SidebarGroup>
        <SidebarMenu>
          <SidebarNavLink
            label={t('settings.back')}
            icon={ArrowLeft}
            link={linkOptions({ to: '/app' })}
          />
        </SidebarMenu>
      </SidebarGroup>
      {SETTINGS_GROUPS.map(({ group, items }) => (
        <SidebarGroup key={group} role="group" aria-label={t(group)}>
          <SidebarGroupLabel>{t(group)}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.filter(visible).map((id) => (
                <SidebarNavLink
                  key={id}
                  label={t(`settings.${id}`)}
                  icon={SECTION_ICONS[id]}
                  link={linkOptions({ to: '/app/settings', search: { section: id } })}
                  isActive={current === id}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </nav>
  )
}
