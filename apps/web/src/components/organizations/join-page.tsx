import { useTranslation } from 'react-i18next'

import { PagePlaceholder } from '#/components/page-placeholder'

export function JoinPage({ invitationId: _invitationId }: { invitationId: string }) {
  const { t } = useTranslation()
  return <PagePlaceholder title={t('app.titles.joinYourOrganization')} />
}
