import { createFileRoute } from '@tanstack/react-router'

import { canCheckout } from '#/components/billing/can-checkout'
import { CheckoutPage } from '#/components/billing/checkout-page'
import { choiceSearch } from '#/lib/checkout-choice'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/app/checkout')({
  validateSearch: choiceSearch,
  beforeLoad: canCheckout,
  head: titled('checkout'),
  component: function Checkout() {
    const { choice } = Route.useRouteContext()
    return <CheckoutPage key={`${choice.plan}-${choice.cycle}`} choice={choice} />
  },
})
