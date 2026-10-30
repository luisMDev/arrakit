import { createFileRoute } from '@tanstack/react-router'

import { SignupPage } from '#/components/auth/signup-page'
import { type ChoiceSearch, choiceSearch } from '#/lib/checkout-choice'
import { skipWhenSignedIn } from '#/lib/guards/skip-when-signed-in'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/signin')({
  validateSearch: (
    search: Record<string, unknown>,
  ): ChoiceSearch & { error?: string; via?: string } => ({
    ...choiceSearch(search),
    ...(typeof search.error === 'string' ? { error: search.error } : {}),
    ...(typeof search.via === 'string' ? { via: search.via } : {}),
  }),
  beforeLoad: skipWhenSignedIn,
  head: titled('signIn'),
  component: () => <SignupPage mode="returning" />,
})
