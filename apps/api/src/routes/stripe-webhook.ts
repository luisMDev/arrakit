import { Hono } from 'hono'

import { settleBillingEvent } from '../billing/settle-event'
import type { BillingEvent } from '../billing/stripe-gateway'
import type { AppDeps } from '../deps'

export function stripeWebhookRoutes(deps: AppDeps) {
  return new Hono().post('/api/webhooks/stripe', async (c) => {
    const raw = await c.req.text()
    const signature = c.req.header('stripe-signature')
    let event: BillingEvent | null
    try {
      if (!signature) throw new Error('no Stripe-Signature header')
      event = deps.stripe.event(raw, signature)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      c.get('log').warn({ reason }, 'webhook refused')
      return c.body(null, 401)
    }
    if (event) await settleBillingEvent(deps, c.get('log'), event)
    return c.body(null, 204)
  })
}
