import { useTranslation } from 'react-i18next'

import { PagePlaceholder } from '#/components/page-placeholder'

export function UnavailablePage(_props: { reason?: 'forbidden'; next?: string }) {
  const { t } = useTranslation()
  return <PagePlaceholder title={t('app.titles.unavailable')} />
}
