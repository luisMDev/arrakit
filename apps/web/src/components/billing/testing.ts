import type { BillingView, Me, PlanOfferView } from '@arrakit/contract'

import { meAs } from '#/test/rpc'

export const OFFERS: PlanOfferView[] = [
  {
    plan: 'free',
    monthly: { amount: 0, currency: 'usd' },
    yearly: { amount: 0, currency: 'usd' },
    seats: 1,
  },
  {
    plan: 'pro',
    monthly: { amount: 2_000, currency: 'usd' },
    yearly: { amount: 19_200, currency: 'usd' },
    seats: 3,
  },
  {
    plan: 'team',
    monthly: { amount: 5_000, currency: 'usd' },
    yearly: { amount: 48_000, currency: 'usd' },
    seats: 10,
  },
]

export const meOn = (plan: Me['plan'], role: Me['role'] = 'owner'): Me =>
  meAs({ name: 'Lucía', plan, role, seats: 1 })

export function billingOf(overrides: Partial<BillingView> = {}): BillingView {
  return {
    plan: 'pro',
    cycle: 'yearly',
    renewsOn: '2027-10-04',
    endsOn: null,
    nextInvoice: { amount: 19_200, currency: 'usd' },
    scheduledChange: null,
    seats: 3,
    card: { brand: 'visa', last4: '4242' },
    billingEmail: 'finance@acme.com',
    invoiceTo: 'Acme SL',
    taxId: 'ESB99286321',
    invoices: [
      {
        id: 'in_2',
        issuedOn: '2026-10-04',
        total: { amount: 19_200, currency: 'usd' },
        status: 'paid',
        pdfUrl: 'https://pay.stripe.test/in_2.pdf',
      },
      {
        id: 'in_1',
        issuedOn: '2026-09-04',
        total: { amount: 1_499, currency: 'usd' },
        status: 'failed',
        pdfUrl: null,
      },
    ],
    ...overrides,
  }
}
