import {
  AlreadyMemberError,
  InvitationNotFoundError,
  InviteEmailUnusableError,
  MemberChangeRefusedError,
  NoSuchMemberError,
  OrganizationNameUnusableError,
  PersonHasOrganizationError,
  PersonOwnsOrganizationError,
  SeatLimitError,
} from '@arrakit/db'
import { ORPCError } from '@orpc/server'

export type PersonHasOrganizationContext = 'accept' | 'create'

/** The data layer's member/organization errors as oRPC errors; anything else is rethrown as is. */
export function toMemberError(
  err: unknown,
  context: PersonHasOrganizationContext = 'accept',
): unknown {
  if (err instanceof MemberChangeRefusedError || err instanceof SeatLimitError) {
    return new ORPCError('FORBIDDEN', { message: err.message })
  }
  if (
    err instanceof AlreadyMemberError ||
    err instanceof InviteEmailUnusableError ||
    err instanceof OrganizationNameUnusableError
  ) {
    return new ORPCError('BAD_REQUEST', { message: err.message })
  }
  if (err instanceof NoSuchMemberError) return new ORPCError('NOT_FOUND', { message: err.message })
  if (err instanceof InvitationNotFoundError) {
    return new ORPCError('NOT_FOUND', { message: 'This invitation is not open for you.' })
  }
  if (err instanceof PersonHasOrganizationError) {
    return new ORPCError('CONFLICT', {
      message:
        context === 'create'
          ? 'You already have an organization.'
          : 'You already belong to an organization.',
    })
  }
  if (err instanceof PersonOwnsOrganizationError) {
    return new ORPCError('CONFLICT', { message: err.message })
  }
  return err
}

export async function mapMemberErrors<T>(
  work: () => Promise<T>,
  context?: PersonHasOrganizationContext,
): Promise<T> {
  try {
    return await work()
  } catch (err) {
    throw toMemberError(err, context)
  }
}
