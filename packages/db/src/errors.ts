export class PersonHasOrganizationError extends Error {
  override name = 'PersonHasOrganizationError'
  constructor(message = 'You already belong to an organization.') {
    super(message)
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
