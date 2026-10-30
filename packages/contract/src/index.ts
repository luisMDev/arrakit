import { meContract } from './account'
import { authProvidersContract } from './auth'
import { billingContract } from './billing'
import { onboardingContract } from './onboarding'
import { plansContract } from './plans'
import { teamsContract } from './teams'
import { topUpContract } from './top-up'
import { usageContract } from './usage'

export const contract = {
  authProviders: authProvidersContract,
  me: meContract,
  onboarding: onboardingContract,
  teams: teamsContract,
  plans: plansContract,
  billing: { ...billingContract, ...topUpContract },
  usage: usageContract,
}

export type Contract = typeof contract

export * from './common'
export * from './account'
export * from './auth'
export * from './billing'
export * from './onboarding'
export * from './plans'
export * from './teams'
export * from './top-up'
export * from './usage'
