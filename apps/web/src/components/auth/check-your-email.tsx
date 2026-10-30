import { useTranslation } from 'react-i18next'

import { PagePlaceholder } from '#/components/page-placeholder'

export function CheckYourEmail({ email }: { email: string }) {
  const { t } = useTranslation()
  return (
    <PagePlaceholder
      title={`${t('auth.checkYourEmail.titleStart')} ${t('auth.checkYourEmail.titleEnd')}`}
    >
      {t('auth.checkYourEmail.sentTo', { email })}
    </PagePlaceholder>
  )
}
