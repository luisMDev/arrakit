import { Hono } from 'hono'

import type { AppDeps } from '../deps'

export function stripeWebhookRoutes(deps: AppDeps) {
  return new Hono().post('/api/webhooks/stripe', async (c) => {
    const raw = await c.req.text()
    const signature = c.req.header('stripe-signature')
    if (!deps.stripe || !signature) {
      console.warn(`refused webhook: ${deps.stripe ? 'no signature' : 'Stripe is not configured'}`)
      return c.body(null, 401)
    }
    let event
    try {
      event = deps.stripe.event(raw, signature)
    } catch {
      console.warn('refused webhook: bad signature')
      return c.body(null, 401)
    }
    if (event === null) return c.body(null, 204)
    return c.body(null, 204)
  })
}
