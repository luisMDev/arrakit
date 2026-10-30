import { createFileRoute } from '@tanstack/react-router'

import { SignupPage, signupSearch } from '#/components/auth/signup-page'
import { skipWhenSignedIn } from '#/lib/guards'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/signin')({
  validateSearch: signupSearch,
  beforeLoad: skipWhenSignedIn,
  head: titled('signIn'),
  component: function SignIn() {
    return <SignupPage mode="returning" search={Route.useSearch()} />
  },
})
