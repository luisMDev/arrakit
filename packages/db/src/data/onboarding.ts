import type { DataContext } from '../context'
import { NotImplementedError } from '../errors'
import type { OrganizationRow } from '../organization/organization'

export interface OrganizationAdmin {
  userId: string
  personName?: string
  termsAccepted: boolean
}

export function onboardingData(_ctx: DataContext) {
  return {
    /**
     * First free slug of slugCandidates(name); with an admin, locks the user row, refuses a person
     * who already has a membership (PersonHasOrganizationError), inserts the owner member and sets
     * the person's name. One transaction.
     */
    async createOrganization(_name: string, _admin?: OrganizationAdmin): Promise<OrganizationRow> {
      throw new NotImplementedError('createOrganization')
    },
  }
}
