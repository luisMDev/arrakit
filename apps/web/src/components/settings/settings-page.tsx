import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
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

export interface SectionProps {
  /** Opens another settings section in place. */
  open: (section: SettingsSection) => void
}

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

const SECTIONS: Record<SettingsSection, (props: SectionProps) => React.JSX.Element> = {
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

export function SettingsPage({ section }: { section: SettingsSection }) {
  const { t } = useTranslation()
  const { isAdmin } = useCurrentUser()
  const visible = (id: SettingsSection) => isAdmin || !ADMIN_ONLY.has(id)
  const [chosen, setChosen] = useState<SettingsSection>(section)
  const current = visible(chosen) ? chosen : 'account'
  const open = (id: SettingsSection) => {
    if (visible(id)) setChosen(id)
  }
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
                    variant={current === item.id ? 'secondary' : 'ghost'}
                    className="justify-start"
                    aria-current={current === item.id ? 'true' : undefined}
                    onClick={() => open(item.id)}
                  >
                    {t(`settings.${item.id}`)}
                  </Button>
                ))}
            </div>
          ))}
        </nav>
      </div>
      <Section open={open} />
    </main>
  )
}
