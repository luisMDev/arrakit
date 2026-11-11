import { useTranslation } from 'react-i18next'

import { Skeleton } from '#/components/ui/skeleton'
import { UsageCards, useUsage } from '#/components/usage/usage-cards'

import { SettingsSectionLayout } from './settings-ui'

export function UsageSection() {
  const { t } = useTranslation()
  const { data, isPending } = useUsage()

  return (
    <SettingsSectionLayout id="usage" title={t('settings.usageSettings.title')}>
      {data && (
        <>
          <UsageCards metrics={data.metrics} />
          <p data-hint className="text-muted-foreground text-sm">
            {t('settings.usageSettings.memberHint')}
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
