import { useTranslation } from 'react-i18next'

import { PagePlaceholder } from '#/components/page-placeholder'

export function CheckoutPage() {
  const { t } = useTranslation()
  return <PagePlaceholder title={t('app.titles.checkout')} />
}
