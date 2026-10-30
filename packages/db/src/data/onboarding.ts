import { slugCandidates } from '@arrakit/address'
import { eq, sql } from 'drizzle-orm'

import type { Database } from '../connection'
import type { DataContext } from '../context'
import { OrganizationNameUnusableError, PersonHasOrganizationError } from '../errors'
import type { OrganizationRow } from '../organization/organization'
import { members, organizations, users } from '../schema/index'

export interface OrganizationAdmin {
  userId: string
  personName?: string
  termsAccepted: boolean
}

async function lockPersonWithoutOrganization(tx: Database, userId: string): Promise<void> {
  const [person] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .for('update')
  if (!person) throw new Error(`[data] no person ${userId}`)
  const [membership] = await tx
    .select({ id: members.id })
    .from(members)
    .where(eq(members.userId, userId))
    .limit(1)
  if (membership) throw new PersonHasOrganizationError()
}

async function claimSlug(tx: Database, name: string, candidates: string[]) {
  for (const slug of candidates) {
    const [organization] = await tx
      .insert(organizations)
      .values({ name, slug })
      .onConflictDoNothing({ target: organizations.slug })
      .returning()
    if (organization) return organization
  }
  throw new Error(`[data] every slug for "${name}" is taken`)
}

export function onboardingData(ctx: DataContext) {
  return {
    async createOrganization(name: string, admin?: OrganizationAdmin): Promise<OrganizationRow> {
      const candidates = slugCandidates(name)
      if (candidates.length === 0) throw new OrganizationNameUnusableError()
      return ctx.db.transaction(async (tx) => {
        if (admin) await lockPersonWithoutOrganization(tx, admin.userId)
        const organization = await claimSlug(tx, name.trim(), candidates)
        if (admin) {
          await tx.insert(members).values({
            organizationId: organization.id,
            userId: admin.userId,
            role: 'owner',
            termsAcceptedAt: admin.termsAccepted ? sql`now()` : null,
          })
          const personName = admin.personName?.trim()
          if (personName) {
            await tx.update(users).set({ name: personName }).where(eq(users.id, admin.userId))
          }
        }
        return organization
      })
    },
  }
}
