import { useTranslation } from 'react-i18next'

import { PagePlaceholder } from '#/components/page-placeholder'

export function PricingPage() {
  const { t } = useTranslation()
  return <PagePlaceholder title={t('app.titles.pricing')} />
}
