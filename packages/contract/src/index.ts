import { meContract } from './account'
import { authProvidersContract } from './auth'
import { billingContract } from './billing'
import { invitationsContract } from './invitations'
import { membersContract } from './members'
import { onboardingContract } from './onboarding'
import { organizationsContract } from './organizations'
import { plansContract } from './plans'
import { topUpContract } from './top-up'
import { usageContract } from './usage'

export const contract = {
  authProviders: authProvidersContract,
  me: meContract,
  organizations: { ...onboardingContract, ...organizationsContract },
  members: membersContract,
  invitations: invitationsContract,
  plans: plansContract,
  billing: { ...billingContract, ...topUpContract },
  usage: usageContract,
}

export type Contract = typeof contract

export * from './common'
export * from './account'
export * from './auth'
export * from './billing'
export * from './invitations'
export * from './members'
export * from './onboarding'
export * from './organizations'
export * from './plans'
export * from './top-up'
export * from './usage'
