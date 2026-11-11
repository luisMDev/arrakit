import { useTranslation } from 'react-i18next'

import { AccountSection } from '#/components/settings/account-section'
import { ActivitySection } from '#/components/settings/activity-section'
import { BillingSection } from '#/components/settings/billing-section'
import { GeneralSection } from '#/components/settings/general-section'
import { LibrarySection } from '#/components/settings/library-section'
import { MembersSection } from '#/components/settings/members-section'
import { RolesSection } from '#/components/settings/roles-section'
import { SecuritySection } from '#/components/settings/security-section'
import { TeamsSection } from '#/components/settings/teams-section'
import { UsageSection } from '#/components/settings/usage-section'

import { type SettingsSection, useSettingsSections } from './settings-sections'

const SECTIONS = {
  account: AccountSection,
  general: GeneralSection,
  library: LibrarySection,
  activity: ActivitySection,
  usage: UsageSection,
  members: MembersSection,
  teams: TeamsSection,
  roles: RolesSection,
  billing: BillingSection,
  security: SecuritySection,
} satisfies Record<SettingsSection, () => React.ReactNode>

export function SettingsPage({ section }: { section?: SettingsSection }) {
  const { t } = useTranslation()
  const Section = SECTIONS[useSettingsSections(section).current]
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <h1 className="sr-only">{t('settings.title')}</h1>
      <Section />
    </main>
  )
}
