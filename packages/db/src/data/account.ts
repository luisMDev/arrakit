import { normalizeEmail } from '@arrakit/address'
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm'

import type { Database } from '../connection'
import type { DataContext } from '../context'
import { PersonOwnsOrganizationError } from '../errors'
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

export interface AccountChanges {
  name?: string
  language?: AccountLanguage
  timeZone?: string
  emails?: { productNews?: boolean }
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

    async updateAccount(
      userId: string,
      sessionId: string,
      changes: AccountChanges,
    ): Promise<Account | null> {
      const set = {
        name: changes.name,
        language: changes.language,
        timeZone: changes.timeZone,
        emailProductNews: changes.emails?.productNews,
      }
      if (Object.values(set).some((value) => value !== undefined)) {
        await ctx.db.update(users).set(set).where(eq(users.id, userId))
      }
      return readAccount(ctx.db, userId, sessionId)
    },

    /** Unknown people want every email. */
    async wantsEmail(email: string, _kind: 'productNews'): Promise<boolean> {
      const [person] = await ctx.db
        .select({ wants: users.emailProductNews })
        .from(users)
        .where(eq(users.email, normalizeEmail(email)))
      return person?.wants ?? true
    },

    async languageOf(userId: string): Promise<AccountLanguage> {
      const [person] = await ctx.db
        .select({ language: users.language })
        .from(users)
        .where(eq(users.id, userId))
      return person?.language ?? 'en'
    },

    /** False when the user is gone; PersonOwnsOrganizationError for an owner of any organization. */
    async deleteAccount(userId: string): Promise<boolean> {
      return ctx.db.transaction(async (tx) => {
        const [person] = await tx
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, userId))
          .for('update')
        if (!person) return false
        const [owned] = await tx
          .select({ id: members.id })
          .from(members)
          .where(and(eq(members.userId, userId), eq(members.role, 'owner')))
          .limit(1)
        if (owned) throw new PersonOwnsOrganizationError()
        await tx.delete(invitations).where(eq(invitations.email, normalizeEmail(person.email)))
        await tx.delete(users).where(eq(users.id, userId))
        return true
      })
    },
  }
}
