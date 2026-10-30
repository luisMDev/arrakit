import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AccountSection } from '#/components/settings/account-section'
import { BillingSection } from '#/components/settings/billing-section'
import { GeneralSection } from '#/components/settings/general-section'
import { MembersSection } from '#/components/settings/members-section'
import { SecuritySection } from '#/components/settings/security-section'
import { UsageSection } from '#/components/settings/usage-section'
import { Button } from '#/components/ui/button'
import { useCurrentUser } from '#/lib/current-user'

export type SettingsSection = 'account' | 'general' | 'usage' | 'members' | 'billing' | 'security'

const NAV: { group: string; items: { id: SettingsSection; adminOnly?: boolean }[] }[] = [
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

export function SettingsPage({ section }: { section: SettingsSection }) {
  const { t } = useTranslation()
  const { isAdmin } = useCurrentUser()
  const visible = (id: SettingsSection) =>
    !NAV.flatMap((g) => g.items).find((i) => i.id === id)?.adminOnly || isAdmin
  const [current, setCurrent] = useState<SettingsSection>(visible(section) ? section : 'account')
  const Section = SECTIONS[current]

  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 p-6 md:grid-cols-[14rem_1fr]">
      <nav aria-label={t('settings.title')} className="flex flex-col gap-4">
        <h1 className="sr-only">{t('settings.title')}</h1>
        {NAV.map((group) => (
          <div
            key={group.group}
            role="group"
            aria-label={t(group.group)}
            className="flex flex-col gap-1"
          >
            <p className="text-muted-foreground text-sm">{t(group.group)}</p>
            {group.items
              .filter((item) => visible(item.id))
              .map((item) => (
                <Button
                  key={item.id}
                  variant={current === item.id ? 'secondary' : 'ghost'}
                  className="justify-start"
                  aria-current={current === item.id ? 'true' : undefined}
                  onClick={() => setCurrent(item.id)}
                >
                  {t(`settings.${item.id}`)}
                </Button>
              ))}
          </div>
        ))}
      </nav>
      <Section />
    </main>
  )
}
