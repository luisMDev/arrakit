import { PLANS, type Plan } from '@arrakit/plans'

const SOLD: readonly Plan[] = PLANS.filter((plan) => plan !== 'internal')

export function plansAbove(current: Plan): Plan[] {
  if (current === 'internal') return []
  return SOLD.slice(SOLD.indexOf(current) + 1)
}

export const isPaying = (plan: Plan | null | undefined): boolean =>
  plan === 'pro' || plan === 'team'
