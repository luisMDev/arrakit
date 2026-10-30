import type { Plan } from '@arrakit/plans'

import type { TestApp } from '../testing/app'
import type { FakeStripe } from '../testing/fake-stripe'
import { ownerOf } from '../testing/people'
import type { BillingSnapshot } from './stripe-gateway'

export const RENEWAL = Date.UTC(2027, 9, 4) / 1000

export function proYearly(): BillingSnapshot {
  return {
    subscription: {
      status: 'active',
      lookupKey: 'pro_yearly',
      periodEnd: RENEWAL,
      cancelAtPeriodEnd: false,
      amount: { amount: 143_000, currency: 'usd' },
      scheduled: null,
    },
    customer: {
      email: 'finance@alder.vc',
      name: 'Alder Ventures SL',
      taxId: 'ESB99286321',
      card: { brand: 'visa', last4: '4242' },
    },
    invoices: [
      {
        id: 'in_2',
        created: Date.UTC(2026, 9, 4, 12) / 1000,
        total: { amount: 143_000, currency: 'usd' },
        status: 'paid',
        pdfUrl: 'https://pay.stripe.test/in_2.pdf',
      },
      {
        id: 'in_1',
        created: Date.UTC(2026, 8, 4, 12) / 1000,
        total: { amount: 14_900, currency: 'usd' },
        status: 'uncollectible',
        pdfUrl: null,
      },
    ],
  }
}

export async function paying(
  t: TestApp,
  stripe: FakeStripe,
  email: string,
  snapshot: BillingSnapshot = proYearly(),
) {
  const person = await ownerOf(t, email, 'free')
  const slug = email.split('@')[1]?.split('.')[0]
  const customerId = `cus_${slug}`
  const subscriptionId = `sub_${slug}`
  const lookupKey = snapshot.subscription?.lookupKey ?? null
  const plan: Plan = lookupKey?.startsWith('team') ? 'team' : 'pro'
  await t.data.forOrganization(person.organizationId).setPlan(plan, { customerId, subscriptionId })
  stripe.bill(customerId, snapshot)
  stripe.subscribe({
    id: subscriptionId,
    customerId,
    organizationId: person.organizationId,
    status: 'active',
    lookupKey,
  })
  return { ...person, customerId, subscriptionId }
}
