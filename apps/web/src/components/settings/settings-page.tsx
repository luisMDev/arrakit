import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AccountSection } from '#/components/settings/account-section'
import { BillingSection } from '#/components/settings/billing-section'
import { GeneralSection } from '#/components/settings/general-section'
import { MembersSection } from '#/components/settings/members-section'
import { SecuritySection } from '#/components/settings/security-section'
import { UsageSection } from '#/components/settings/usage-section'
import { Button } from '#/components/ui/button'
import { useCurrentUser } from '#/lib/current-user'

const SETTINGS_SECTIONS = ['account', 'general', 'usage', 'members', 'billing', 'security'] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export interface SettingsSearch {
  section?: SettingsSection
  top_up?: string
}

const isSection = (value: unknown): value is SettingsSection =>
  (SETTINGS_SECTIONS as readonly unknown[]).includes(value)

export const settingsSearch = (search: Record<string, unknown>): SettingsSearch => ({
  ...(isSection(search.section) ? { section: search.section } : {}),
  ...(typeof search.top_up === 'string' ? { top_up: search.top_up } : {}),
})

const SETTINGS_NAV: {
  group: string
  items: { id: SettingsSection; adminOnly?: boolean }[]
}[] = [
  { group: 'settings.mySettings', items: [{ id: 'account' }] },
  {
    group: 'settings.organizationSettings',
    items: [
      { id: 'general' },
      { id: 'usage' },
      { id: 'members', adminOnly: true },
      { id: 'billing', adminOnly: true },
      { id: 'security' },
    ],
  },
]

const SECTIONS: Record<SettingsSection, () => React.JSX.Element> = {
  account: AccountSection,
  general: GeneralSection,
  usage: UsageSection,
  members: MembersSection,
  billing: BillingSection,
  security: SecuritySection,
}

const ADMIN_ONLY = new Set(
  SETTINGS_NAV.flatMap((group) => group.items)
    .filter((item) => item.adminOnly)
    .map((item) => item.id),
)

export function SettingsPage({ section = 'account' }: { section?: SettingsSection }) {
  const { t } = useTranslation()
  const { isAdmin } = useCurrentUser()
  const visible = (id: SettingsSection) => isAdmin || !ADMIN_ONLY.has(id)
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
              {group.items
                .filter((item) => visible(item.id))
                .map((item) => (
                  <Button
                    key={item.id}
                    asChild
                    variant={current === item.id ? 'secondary' : 'ghost'}
                    className="justify-start"
                  >
                    <Link
                      to="/app/settings"
                      search={{ section: item.id }}
                      aria-current={current === item.id ? 'page' : undefined}
                    >
                      {t(`settings.${item.id}`)}
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
