import { Hono } from 'hono'

import { settleBillingEvent } from '../billing/settle-event'
import type { BillingEvent } from '../billing/stripe-gateway'
import type { AppDeps } from '../deps'

export function stripeWebhookRoutes(deps: AppDeps) {
  return new Hono().post('/api/webhooks/stripe', async (c) => {
    const raw = await c.req.text()
    const signature = c.req.header('stripe-signature')
    const stripe = deps.stripe
    if (!stripe || !signature) {
      const reason = stripe ? 'no Stripe-Signature header' : 'Stripe is not set up'
      c.get('log').warn({ reason }, 'webhook refused')
      return c.body(null, 401)
    }
    let event: BillingEvent | null
    try {
      event = stripe.event(raw, signature)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      c.get('log').warn({ reason }, 'webhook refused')
      return c.body(null, 401)
    }
    if (event) {
      await settleBillingEvent(
        {
          data: deps.data,
          stripe,
          mailer: deps.mailer,
          webUrl: deps.env.webUrl,
          log: c.get('log'),
        },
        event,
      )
    }
    return c.body(null, 204)
  })
}
