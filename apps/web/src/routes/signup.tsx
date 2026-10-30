import { createFileRoute } from '@tanstack/react-router'

import { SignupPage, signupSearch } from '#/components/auth/signup-page'
import { skipWhenSignedIn } from '#/lib/guards/skip-when-signed-in'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/signup')({
  validateSearch: signupSearch,
  beforeLoad: skipWhenSignedIn,
  head: titled('whereToWrite'),
  component: function Signup() {
    return <SignupPage mode="new" search={Route.useSearch()} />
  },
})
