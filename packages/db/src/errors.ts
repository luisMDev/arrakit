export const UNIQUE_VIOLATION = '23505'
export const FOREIGN_KEY_VIOLATION = '23503'

/** True when `err` (or anything in its `cause` chain) carries SQLSTATE `code`. Works for pg and PGlite. */
export function hasSqlState(err: unknown, code: string): boolean {
  let current: unknown = err
  for (let depth = 0; current && depth < 10; depth++) {
    if (typeof current === 'object' && (current as { code?: unknown }).code === code) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

export const isUniqueViolation = (err: unknown) => hasSqlState(err, UNIQUE_VIOLATION)

/** Thrown by data-layer stubs that a feature has not implemented yet. */
export class NotImplementedError extends Error {
  override name = 'NotImplementedError'
  constructor(what: string) {
    super(`[data] ${what} is not implemented yet`)
  }
}

export class PersonHasOrganizationError extends Error {
  override name = 'PersonHasOrganizationError'
  constructor() {
    super('That person already belongs to an organization.')
  }
}

export class OrganizationNameUnusableError extends Error {
  override name = 'OrganizationNameUnusableError'
  constructor() {
    super('Give the organization a name with letters or digits.')
  }
}

export class PersonOwnsOrganizationError extends Error {
  override name = 'PersonOwnsOrganizationError'
  constructor() {
    super(
      'You own an organization. Delete the organization first, in Settings → Security and data.',
    )
  }
}

export class InvitationNotFoundError extends Error {
  override name = 'InvitationNotFoundError'
  constructor() {
    super('This invitation is not open for you.')
  }
}

export class MemberChangeRefusedError extends Error {
  override name = 'MemberChangeRefusedError'
  constructor(readonly reason: string) {
    super(reason)
  }
}

export class SeatLimitError extends Error {
  override name = 'SeatLimitError'
}

export class AlreadyMemberError extends Error {
  override name = 'AlreadyMemberError'
  constructor(email: string) {
    super(`${email} is already in the organization.`)
  }
}

export class InviteEmailUnusableError extends Error {
  override name = 'InviteEmailUnusableError'
  constructor(raw: string) {
    super(`Enter a work email, like name@organization.com: "${raw}" is not one.`)
  }
}

export class NoSuchMemberError extends Error {
  override name = 'NoSuchMemberError'
  constructor(email: string) {
    super(`No one in the organization is ${email}.`)
  }
}

export class FileNotFoundError extends Error {
  override name = 'FileNotFoundError'
  constructor(name: string) {
    super(`[data] no file stored under "${name}"`)
  }
}
