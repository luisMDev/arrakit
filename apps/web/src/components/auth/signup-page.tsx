import { useTranslation } from 'react-i18next'

import { PagePlaceholder } from '#/components/page-placeholder'

export function SignupPage({ mode }: { mode: 'new' | 'returning' }) {
  const { t } = useTranslation()
  return (
    <PagePlaceholder
      title={t(mode === 'returning' ? 'app.titles.signIn' : 'app.titles.whereToWrite')}
    />
  )
}
