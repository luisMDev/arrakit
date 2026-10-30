import { useTranslation } from 'react-i18next'

import { Skeleton } from '#/components/ui/skeleton'
import { UsageCards } from '#/components/usage/usage-cards'
import { useUsage } from '#/components/usage/use-usage'
import { useCurrentUser } from '#/lib/current-user'

import { SettingsSectionLayout } from './settings-ui'

export function UsageSection() {
  const { t } = useTranslation()
  const { managesBilling } = useCurrentUser()
  const { data, isPending } = useUsage()

  return (
    <SettingsSectionLayout id="usage" title={t('settings.usageSettings.title')}>
      {data && (
        <>
          <UsageCards metrics={data.metrics} />
          <p data-hint className="text-muted-foreground text-sm">
            {t(
              managesBilling
                ? 'settings.usageSettings.adminHint'
                : 'settings.usageSettings.memberHint',
            )}
          </p>
        </>
      )}
      {isPending && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      )}
    </SettingsSectionLayout>
  )
}
