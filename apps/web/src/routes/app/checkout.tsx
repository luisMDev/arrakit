import { createFileRoute } from '@tanstack/react-router'

import { CheckoutPage } from '#/components/billing/checkout-page'
import { choiceSearch } from '#/lib/checkout-choice'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/app/checkout')({
  validateSearch: choiceSearch,
  head: titled('checkout'),
  component: CheckoutPage,
})
