import { useTranslation } from 'react-i18next'

export function MembersSection() {
  const { t } = useTranslation()
  return (
    <section aria-labelledby="settings-members">
      <h2 id="settings-members" className="text-lg font-semibold">
        {t('settings.members')}
      </h2>
    </section>
  )
}
