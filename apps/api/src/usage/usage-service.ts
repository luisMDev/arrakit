import { type Data, type MetricUsage, UsageLimitError, type UsageVerdict } from '@arrakit/db'
import type { Metric } from '@arrakit/plans'
import { ORPCError } from '@orpc/server'

/** 402 Payment Required carrying what the use needed and what was left. */
export function paymentRequired(error: UsageLimitError) {
  return new ORPCError('PAYMENT_REQUIRED', {
    status: 402,
    message: error.message,
    data: { metric: error.metric, requested: error.requested, available: error.available },
  })
}

async function asPaymentRequired<T>(work: Promise<T>): Promise<T> {
  try {
    return await work
  } catch (error) {
    if (error instanceof UsageLimitError) throw paymentRequired(error)
    throw error
  }
}

export interface UsageService {
  check(organizationId: string, metric: Metric, quantity?: number): Promise<UsageVerdict>
  can(organizationId: string, metric: Metric, quantity?: number): Promise<boolean>
  requireAvailable(organizationId: string, metric: Metric, quantity?: number): Promise<void>
  consume(
    organizationId: string,
    metric: Metric,
    quantity: number,
    idempotencyKey: string,
  ): Promise<MetricUsage>
  set(organizationId: string, metric: Metric, value: number): Promise<MetricUsage>
}

export function usageService(data: Data): UsageService {
  const usageOf = (organizationId: string) => data.forOrganization(organizationId).usage
  const check = (organizationId: string, metric: Metric, quantity = 1) =>
    usageOf(organizationId).check(metric, quantity)

  return {
    check,
    async can(organizationId, metric, quantity = 1) {
      return (await check(organizationId, metric, quantity)).allowed
    },
    async requireAvailable(organizationId, metric, quantity = 1) {
      const verdict = await check(organizationId, metric, quantity)
      if (!verdict.allowed) {
        throw paymentRequired(new UsageLimitError(metric, verdict.requested, verdict.available))
      }
    },
    consume: (organizationId, metric, quantity, idempotencyKey) =>
      asPaymentRequired(usageOf(organizationId).consume(metric, quantity, { idempotencyKey })),
    set: (organizationId, metric, value) =>
      asPaymentRequired(usageOf(organizationId).set(metric, value)),
  }
}
