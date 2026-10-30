import { createFileRoute } from '@tanstack/react-router'

import { PricingPage } from '#/components/billing/pricing-page'
import { titled } from '#/lib/page-title'

export const Route = createFileRoute('/pricing')({
  head: titled('pricing'),
  component: PricingPage,
})
