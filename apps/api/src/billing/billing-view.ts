import type { BillingView } from '@arrakit/contract'
import type { OrganizationRow } from '@arrakit/db'
import { PLAN_OFFERS } from '@arrakit/plans'

import type { BillingSnapshot } from './stripe-gateway'
import { subscriptionOfLookupKey } from './subscription-plan'

export const dayOf = (unixSeconds: number): string =>
  new Date(unixSeconds * 1000).toISOString().slice(0, 10)

const INVOICE_STATUS = { paid: 'paid', open: 'open', uncollectible: 'failed' } as const

export type BillingOrganization = Pick<OrganizationRow, 'plan' | 'name'>

export function billingView(
  organization: BillingOrganization,
  snapshot: BillingSnapshot | null,
): BillingView {
  const { seats } = PLAN_OFFERS[organization.plan]
  const unbilled = organization.plan === 'free' || organization.plan === 'internal'
  const subscription = unbilled ? null : (snapshot?.subscription ?? null)
  const customer = snapshot?.customer ?? null
  const cancelled = subscription?.cancelAtPeriodEnd ?? false
  const scheduled = subscription?.scheduled ?? null
  const scheduledChoice = scheduled ? subscriptionOfLookupKey(scheduled.lookupKey) : null
  const periodEnd = subscription ? dayOf(subscription.periodEnd) : null
  return {
    plan: organization.plan,
    cycle: subscriptionOfLookupKey(subscription?.lookupKey ?? null)?.cycle ?? null,
    renewsOn: cancelled ? null : periodEnd,
    endsOn: cancelled ? periodEnd : null,
    nextInvoice: cancelled ? null : ((scheduled ? scheduled.amount : subscription?.amount) ?? null),
    scheduledChange:
      scheduled && scheduledChoice && !cancelled
        ? { ...scheduledChoice, on: dayOf(scheduled.at) }
        : null,
    seats,
    card: customer?.card ?? null,
    billingEmail: customer?.email || null,
    invoiceTo: customer?.name || organization.name,
    taxId: customer?.taxId || null,
    invoices: (snapshot?.invoices ?? []).map((invoice) => ({
      id: invoice.id,
      issuedOn: dayOf(invoice.created),
      total: invoice.total,
      status: INVOICE_STATUS[invoice.status],
      pdfUrl: invoice.pdfUrl || null,
    })),
  }
}
