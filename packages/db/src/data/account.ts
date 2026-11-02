import { normalizeEmail } from '@arrakit/address'
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm'

import type { Database } from '../connection'
import type { DataContext } from '../context'
import {
  type AccountLanguage,
  accounts,
  invitations,
  members,
  sessions,
  users,
} from '../schema/index'

const SIGN_IN_METHODS = ['email', 'google', 'microsoft'] as const
type SignInMethod = (typeof SIGN_IN_METHODS)[number]

export interface Account {
  user: {
    name: string
    email: string
    language: AccountLanguage
    timeZone: string | null
    emails: { productNews: boolean }
  }
  signInWith: SignInMethod
  /** Live sessions, the current one first. */
  sessions: { id: string; userAgent: string | null; current: boolean }[]
}

const SOCIAL = SIGN_IN_METHODS.filter((method) => method !== 'email')

async function readAccount(
  db: Database,
  userId: string,
  currentSessionId: string,
): Promise<Account | null> {
  const [[person], [social], live] = await Promise.all([
    db
      .select({
        name: users.name,
        email: users.email,
        language: users.language,
        timeZone: users.timeZone,
        productNews: users.emailProductNews,
      })
      .from(users)
      .where(eq(users.id, userId)),
    db
      .select({ providerId: accounts.providerId })
      .from(accounts)
      .where(and(eq(accounts.userId, userId), inArray(accounts.providerId, SOCIAL)))
      .orderBy(desc(accounts.createdAt))
      .limit(1),
    db
      .select({ id: sessions.id, userAgent: sessions.userAgent })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, sql`now()`)))
      .orderBy(desc(sessions.createdAt)),
  ])
  if (!person) return null
  return {
    user: {
      name: person.name,
      email: person.email,
      language: person.language,
      timeZone: person.timeZone,
      emails: { productNews: person.productNews },
    },
    signInWith: (social?.providerId as SignInMethod | undefined) ?? 'email',
    sessions: live
      .map((row) => ({ ...row, current: row.id === currentSessionId }))
      .sort((a, b) => Number(b.current) - Number(a.current)),
  }
}

export function accountData(ctx: DataContext) {
  return {
    account: (userId: string, currentSessionId: string) =>
      readAccount(ctx.db, userId, currentSessionId),

    /**
     * Readies a person's account for deletion: deletes every invitation addressed to them (any
     * status, any organization). Refuses, deleting nothing, while they own an organization.
     */
    async clearForAccountDeletion(user: {
      id: string
      email: string
    }): Promise<'owner' | 'cleared'> {
      const [owned] = await ctx.db
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.userId, user.id), eq(members.role, 'owner')))
        .limit(1)
      if (owned) return 'owner'
      await ctx.db.delete(invitations).where(eq(invitations.email, normalizeEmail(user.email)))
      return 'cleared'
    },
  }
}
