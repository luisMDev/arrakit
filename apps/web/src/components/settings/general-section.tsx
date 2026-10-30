import { useTranslation } from 'react-i18next'

export function GeneralSection() {
  const { t } = useTranslation()
  return (
    <section aria-labelledby="settings-general">
      <h2 id="settings-general" className="text-lg font-semibold">
        {t('settings.general')}
      </h2>
    </section>
  )
}
