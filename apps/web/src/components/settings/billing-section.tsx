import { useTranslation } from 'react-i18next'

export function BillingSection() {
  const { t } = useTranslation()
  return (
    <section aria-labelledby="settings-billing">
      <h2 id="settings-billing" className="text-lg font-semibold">
        {t('settings.billing')}
      </h2>
    </section>
  )
}
