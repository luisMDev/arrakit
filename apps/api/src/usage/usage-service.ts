import {
  type MetricUsage,
  type OrganizationScope,
  type ScopedData,
  UsageLimitError,
  type UsageVerdict,
} from '@arrakit/db'
import type { Metric } from '@arrakit/plans'
import { ORPCError } from '@orpc/server'

/** 402 Payment Required carrying what the use needed and what was left. */
function paymentRequired(error: UsageLimitError) {
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

/** 402 unless `quantity` of `metric` is available; spends nothing. */
export async function requireAvailable(
  usage: OrganizationScope['usage'],
  metric: Metric,
  quantity = 1,
): Promise<void> {
  const verdict = await usage.check(metric, quantity)
  if (!verdict.allowed) {
    throw paymentRequired(new UsageLimitError(metric, verdict.requested, verdict.available))
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

export function usageService(data: ScopedData): UsageService {
  const usageOf = (organizationId: string) => data.forOrganization(organizationId).usage
  const check = (organizationId: string, metric: Metric, quantity = 1) =>
    usageOf(organizationId).check(metric, quantity)

  return {
    check,
    async can(organizationId, metric, quantity = 1) {
      return (await check(organizationId, metric, quantity)).allowed
    },
    requireAvailable: (organizationId, metric, quantity) =>
      requireAvailable(usageOf(organizationId), metric, quantity),
    consume: (organizationId, metric, quantity, idempotencyKey) =>
      asPaymentRequired(usageOf(organizationId).consume(metric, quantity, { idempotencyKey })),
    set: (organizationId, metric, value) =>
      asPaymentRequired(usageOf(organizationId).set(metric, value)),
  }
}
