import type { Plan } from '@arrakit/plans'

import type { DataContext } from '../context'
import { NotImplementedError } from '../errors'
import type { OrganizationId } from '../organization-id'
import type { OrganizationRow } from './organization'

export interface StripeRefs {
  customerId: string
  subscriptionId: string | null
  /** Subscription billing_cycle_anchor on a paid plan. */
  anchor?: Date
}

export function billingScope(_ctx: DataContext, _organizationId: OrganizationId) {
  return {
    /** Sets the plan (and Stripe ids when given). Free clears usage_anchor. */
    async setPlan(_plan: Plan, _stripe?: StripeRefs): Promise<OrganizationRow | undefined> {
      throw new NotImplementedError('forOrganization().setPlan')
    },
    /** Sets the Stripe customer only when it is still null; returns the row as it is now. */
    async setStripeCustomer(_customerId: string): Promise<OrganizationRow | undefined> {
      throw new NotImplementedError('forOrganization().setStripeCustomer')
    },
  }
}
