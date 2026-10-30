import type { Metric, MetricKind } from '@arrakit/plans'

import type { DataContext } from '../context'
import { NotImplementedError } from '../errors'
import type { OrganizationId } from '../organization-id'

export interface MetricBalance {
  metric: Metric
  kind: MetricKind
  granted: number
  plan: number
  purchased: number
  used: number
  available: number
  limit: number | null
}

export interface MetricUsage extends MetricBalance {
  /** End of the current usage period (exclusive). */
  resetsOn: Date
}

export interface UsageVerdict {
  metric: Metric
  allowed: boolean
  available: number
  requested: number
}

export interface TopUp {
  at: Date
  cents: number
  amounts: Partial<Record<Metric, number>>
}

export interface OrganizationUsage {
  summary(): Promise<MetricUsage[]>
  check(metric: Metric, quantity?: number): Promise<UsageVerdict>
  consume(
    metric: Metric,
    quantity: number,
    options: { idempotencyKey: string },
  ): Promise<MetricUsage>
  set(metric: Metric, value: number): Promise<MetricUsage>
  credit(cents: number, options: { idempotencyKey: string }): Promise<boolean>
  reverse(cents: number, options: { idempotencyKey: string }): Promise<boolean>
  adjust(metric: Metric, amount: number, options: { idempotencyKey: string }): Promise<boolean>
  topUps(): Promise<TopUp[]>
}

/** Thrown when a use would exceed what the organization has (mapped to HTTP 402). */
export class UsageLimitError extends Error {
  override name = 'UsageLimitError'
  constructor(
    readonly metric: Metric,
    readonly kind: MetricKind,
    readonly requested: number,
    readonly available: number,
    message: string,
  ) {
    super(message)
  }
}

export function usageScope(_ctx: DataContext, _organizationId: OrganizationId): OrganizationUsage {
  const todo = (what: string) => () => Promise.reject(new NotImplementedError(`usage.${what}`))
  return {
    summary: todo('summary'),
    check: todo('check'),
    consume: todo('consume'),
    set: todo('set'),
    credit: todo('credit'),
    reverse: todo('reverse'),
    adjust: todo('adjust'),
    topUps: todo('topUps'),
  }
}
