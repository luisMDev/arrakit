import { createFileRoute } from '@tanstack/react-router'

import { OAuthSignInPage } from '#/components/oauth/oauth-signin-page'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/oauth/signin')({
  head: titled('signInToConnect'),
  component: OAuthSignInPage,
})
