import type { StripeGateway } from '../billing/stripe-gateway'

export const FAKE_STRIPE_SIGNATURE = 't=1,v1=fake-stripe-signature'
export const FAKE_PRORATION = { amount: 120_000, currency: 'usd' }

export type FakeStripe = StripeGateway

export function fakeStripe(): FakeStripe {
  const todo = (what: string) => () =>
    Promise.reject(new Error(`[fake-stripe] ${what} is not implemented yet`))
  return {
    publishableKey: 'pk_test_fake',
    checkout: todo('checkout'),
    topUpCheckout: todo('topUpCheckout'),
    topUpPayment: todo('topUpPayment'),
    event(_rawBody, signature) {
      if (signature !== FAKE_STRIPE_SIGNATURE) throw new Error('bad signature')
      return null
    },
    subscription: todo('subscription'),
    billing: todo('billing'),
    price: todo('price'),
    previewNow: todo('previewNow'),
    changeNow: todo('changeNow'),
    changeAtRenewal: todo('changeAtRenewal'),
    markReceipted: todo('markReceipted'),
    cancelAtPeriodEnd: todo('cancelAtPeriodEnd'),
    endNow: todo('endNow'),
    portal: todo('portal'),
  }
}
