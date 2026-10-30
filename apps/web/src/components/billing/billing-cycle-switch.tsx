import { BILLING_CYCLES, type BillingCycle } from '@arrakit/plans'
import { useTranslation } from 'react-i18next'

import { Badge } from '#/components/ui/badge'
import { Toggle } from '#/components/ui/toggle'

export function BillingCycleSwitch({
  cycle,
  saving,
  onChange,
}: {
  cycle: BillingCycle
  saving: number | null
  onChange: (cycle: BillingCycle) => void
}) {
  const { t } = useTranslation()
  return (
    <div
      role="group"
      aria-label={t('pricing.billingCycleSwitch.billing')}
      className="bg-muted inline-flex items-center gap-1 rounded-lg p-1"
    >
      {BILLING_CYCLES.map((option) => (
        <Toggle
          key={option}
          size="sm"
          pressed={cycle === option}
          onPressedChange={(pressed) => pressed && onChange(option)}
          className="data-[state=on]:bg-background px-3"
        >
          {t(`pricing.billingCycleSwitch.${option}`)}
          {option === 'yearly' && saving !== null && (
            <Badge variant="secondary">{t('pricing.billingCycleSwitch.save', { saving })}</Badge>
          )}
        </Toggle>
      ))}
    </div>
  )
}
