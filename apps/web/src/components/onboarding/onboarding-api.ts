import type { OrganizationSummary } from '@arrakit/contract'
import { createContext, useContext } from 'react'

import { client } from '#/lib/orpc'

export interface OnboardingApi {
  create(input: { name: string; personName: string }): Promise<OrganizationSummary>
  skip(): Promise<OrganizationSummary>
  currentOrganization(): Promise<{ name: string; slug: string } | null>
}

export const httpOnboardingApi: OnboardingApi = {
  create: ({ name, personName }) =>
    client.organizations.create({ name, personName, termsAccepted: true }),
  skip: () => client.organizations.skip(),
  currentOrganization: async () => (await client.me.get()).organization,
}

export const OnboardingApiContext = createContext<OnboardingApi>(httpOnboardingApi)

export const useOnboardingApi = () => useContext(OnboardingApiContext)
