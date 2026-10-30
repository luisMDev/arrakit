import { createFileRoute, redirect } from '@tanstack/react-router'

import { choiceSearch } from '#/lib/checkout-choice'

export const Route = createFileRoute('/start')({
  validateSearch: choiceSearch,
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/signup', search })
  },
})
