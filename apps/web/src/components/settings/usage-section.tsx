import { useTranslation } from 'react-i18next'

import { Skeleton } from '#/components/ui/skeleton'
import { UsageCards } from '#/components/usage/usage-cards'
import { useUsage } from '#/components/usage/use-usage'
import { useCurrentUser } from '#/lib/current-user'

export function UsageSection() {
  const { t } = useTranslation()
  const { isAdmin } = useCurrentUser()
  const { data, isPending, isError } = useUsage()

  return (
    <section aria-labelledby="settings-usage" className="flex flex-col gap-4">
      <h2 id="settings-usage" className="text-lg font-semibold">
        {t('settings.usageSettings.title')}
      </h2>
      {data && (
        <>
          <UsageCards metrics={data.metrics} />
          <p data-hint className="text-muted-foreground text-sm">
            {t(isAdmin ? 'settings.usageSettings.adminHint' : 'settings.usageSettings.memberHint')}
          </p>
        </>
      )}
      {isPending && !isError && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      )}
    </section>
  )
}
