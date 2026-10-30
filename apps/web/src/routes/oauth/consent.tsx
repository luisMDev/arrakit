import { createFileRoute } from '@tanstack/react-router'

import { OAuthConsentPage } from '#/components/oauth/oauth-consent-page'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/oauth/consent')({
  head: titled('connect'),
  component: OAuthConsentPage,
})
