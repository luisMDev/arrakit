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

/** The data layer's member/organization errors as oRPC errors; anything else is returned as is. */
export function toMemberError(err: unknown): unknown {
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
  if (err instanceof PersonHasOrganizationError || err instanceof PersonOwnsOrganizationError) {
    return new ORPCError('CONFLICT', { message: err.message })
  }
  return err
}
