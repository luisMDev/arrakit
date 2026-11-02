import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { AccountSection } from '#/components/settings/account-section'
import { BillingSection } from '#/components/settings/billing-section'
import { GeneralSection } from '#/components/settings/general-section'
import { MembersSection } from '#/components/settings/members-section'
import { RolesSection } from '#/components/settings/roles-section'
import { SecuritySection } from '#/components/settings/security-section'
import { TeamsSection } from '#/components/settings/teams-section'
import { UsageSection } from '#/components/settings/usage-section'
import { Button } from '#/components/ui/button'
import { useCurrentUser } from '#/lib/current-user'
import { searchText } from '#/lib/search-params'

const SECTIONS = {
  account: AccountSection,
  general: GeneralSection,
  usage: UsageSection,
  members: MembersSection,
  teams: TeamsSection,
  roles: RolesSection,
  billing: BillingSection,
  security: SecuritySection,
}
export type SettingsSection = keyof typeof SECTIONS

const SECTION_IDS = Object.keys(SECTIONS) as [SettingsSection, ...SettingsSection[]]

export const settingsSearch = z.object({
  section: z.enum(SECTION_IDS).optional().catch(undefined),
  top_up: searchText,
})
export type SettingsSearch = z.infer<typeof settingsSearch>

const ORGANIZATION_SECTIONS = SECTION_IDS.filter((id) => id !== 'account')

const SETTINGS_NAV: { group: string; items: SettingsSection[] }[] = [
  { group: 'settings.mySettings', items: ['account'] },
  { group: 'settings.organizationSettings', items: ORGANIZATION_SECTIONS },
]

export function SettingsPage({ section = 'account' }: { section?: SettingsSection }) {
  const { t } = useTranslation()
  const { can, managesMembers } = useCurrentUser()
  const shown: Partial<Record<SettingsSection, boolean>> = {
    usage: can({ usage: ['read'] }),
    members: managesMembers,
    roles: can({ ac: ['create'] }),
    billing: can({ billing: ['read'] }),
  }
  const visible = (id: SettingsSection) => shown[id] ?? true
  const current = visible(section) ? section : 'account'
  const Section = SECTIONS[current]

  return (
    <main className="mx-auto grid w-full max-w-5xl gap-8 p-6 md:grid-cols-[14rem_1fr]">
      <div className="flex flex-col gap-4">
        <Button asChild variant="ghost" className="self-start">
          <Link to="/app">
            <ArrowLeft />
            {t('settings.back')}
          </Link>
        </Button>
        <h1 className="sr-only">{t('settings.title')}</h1>
        <nav aria-label={t('settings.title')} className="flex flex-col gap-4">
          {SETTINGS_NAV.map((group) => (
            <div
              key={group.group}
              role="group"
              aria-label={t(group.group)}
              className="flex flex-col gap-1"
            >
              <p className="text-muted-foreground px-3 text-xs font-medium">{t(group.group)}</p>
              {group.items.filter(visible).map((id) => (
                <Button
                  key={id}
                  asChild
                  variant={current === id ? 'secondary' : 'ghost'}
                  className="justify-start"
                >
                  <Link
                    to="/app/settings"
                    search={{ section: id }}
                    aria-current={current === id ? 'page' : undefined}
                  >
                    {t(`settings.${id}`)}
                  </Link>
                </Button>
              ))}
            </div>
          ))}
        </nav>
      </div>
      <Section />
    </main>
  )
}
