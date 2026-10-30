import { useTranslation } from 'react-i18next'

export function AccountSection() {
  const { t } = useTranslation()
  return (
    <section aria-labelledby="settings-account">
      <h2 id="settings-account" className="text-lg font-semibold">
        {t('settings.account')}
      </h2>
    </section>
  )
}
