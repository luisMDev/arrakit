import { useTranslation } from 'react-i18next'

export function SecuritySection() {
  const { t } = useTranslation()
  return (
    <section aria-labelledby="settings-security">
      <h2 id="settings-security" className="text-lg font-semibold">
        {t('settings.security')}
      </h2>
    </section>
  )
}
