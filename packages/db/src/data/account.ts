import type { DataContext } from '../context'
import { NotImplementedError } from '../errors'
import type { AccountLanguage } from '../schema/index'

export const SIGN_IN_METHODS = ['email', 'google', 'microsoft'] as const
export type SignInMethod = (typeof SIGN_IN_METHODS)[number]

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

export function accountData(_ctx: DataContext) {
  return {
    async account(_userId: string, _currentSessionId: string): Promise<Account | null> {
      throw new NotImplementedError('account')
    },
    async updateAccount(
      _userId: string,
      _sessionId: string,
      _changes: AccountChanges,
    ): Promise<Account | null> {
      throw new NotImplementedError('updateAccount')
    },
    async wantsEmail(_email: string, _kind: 'productNews'): Promise<boolean> {
      throw new NotImplementedError('wantsEmail')
    },
    async languageOf(_userId: string): Promise<AccountLanguage> {
      throw new NotImplementedError('languageOf')
    },
    /** False when the user is gone; PersonOwnsOrganizationError for an owner. */
    async deleteAccount(_userId: string): Promise<boolean> {
      throw new NotImplementedError('deleteAccount')
    },
  }
}
