// Shared plans catalog and pure arithmetic (no I/O). Runs in web and api.
// Filled in by the billing-plans and usage-credits features (docs/spec/billing-plans.md).
export const BILLING_CYCLES = ['monthly', 'yearly'] as const
export type BillingCycle = (typeof BILLING_CYCLES)[number]
