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
