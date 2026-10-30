import { createFileRoute } from '@tanstack/react-router'

import { refusalSearch } from '#/components/auth/sign-in-options'
import { type SignupSearch, SignupPage } from '#/components/auth/signup-page'
import { choiceSearch } from '#/lib/checkout-choice'
import { skipWhenSignedIn } from '#/lib/guards/skip-when-signed-in'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/signup')({
  validateSearch: (search: Record<string, unknown>): SignupSearch => ({
    ...choiceSearch(search),
    ...refusalSearch(search),
  }),
  beforeLoad: skipWhenSignedIn,
  head: titled('whereToWrite'),
  component: function Signup() {
    return <SignupPage mode="new" search={Route.useSearch()} />
  },
})
