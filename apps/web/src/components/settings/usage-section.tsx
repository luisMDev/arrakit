import { useTranslation } from 'react-i18next'

export function UsageSection() {
  const { t } = useTranslation()
  return (
    <section aria-labelledby="settings-usage">
      <h2 id="settings-usage" className="text-lg font-semibold">
        {t('settings.usage')}
      </h2>
    </section>
  )
}
