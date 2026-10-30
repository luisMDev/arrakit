export type DomainErrorCode =
  'BAD_REQUEST' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'PAYMENT_REQUIRED'

/** A refusal the API answers with `code`, `message` and `data` as they are. */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly data?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export class PersonHasOrganizationError extends DomainError {
  override name = 'PersonHasOrganizationError'
  constructor(message = 'You already belong to an organization.') {
    super('CONFLICT', message)
  }
}

export class OrganizationNameUnusableError extends DomainError {
  override name = 'OrganizationNameUnusableError'
  constructor() {
    super('BAD_REQUEST', 'Give the organization a name with letters or digits.')
  }
}

export class PersonOwnsOrganizationError extends DomainError {
  override name = 'PersonOwnsOrganizationError'
  constructor() {
    super(
      'CONFLICT',
      'You own an organization. Delete the organization first, in Settings → Security and data.',
    )
  }
}

export class InvitationNotFoundError extends DomainError {
  override name = 'InvitationNotFoundError'
  constructor() {
    super('NOT_FOUND', 'This invitation is not open for you.')
  }
}

export class MemberChangeRefusedError extends DomainError {
  override name = 'MemberChangeRefusedError'
  constructor(readonly reason: string) {
    super('FORBIDDEN', reason)
  }
}

export class SeatLimitError extends DomainError {
  override name = 'SeatLimitError'
  constructor(message: string) {
    super('FORBIDDEN', message)
  }
}

export class AlreadyMemberError extends DomainError {
  override name = 'AlreadyMemberError'
  constructor(email: string) {
    super('BAD_REQUEST', `${email} is already in the organization.`)
  }
}

export class InviteEmailUnusableError extends DomainError {
  override name = 'InviteEmailUnusableError'
  constructor(raw: string) {
    super('BAD_REQUEST', `Enter a work email, like name@organization.com: "${raw}" is not one.`)
  }
}

export class NoSuchMemberError extends DomainError {
  override name = 'NoSuchMemberError'
  constructor(email: string) {
    super('NOT_FOUND', `No one in the organization is ${email}.`)
  }
}
