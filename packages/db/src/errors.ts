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

const UNIQUE_VIOLATION = '23505'
const INSUFFICIENT_PRIVILEGE = '42501'

/** Postgres and PGlite report the code on the error; Drizzle wraps it as the cause. */
function hasPostgresCode(err: unknown, code: string): boolean {
  for (let current = err; current && typeof current === 'object';) {
    if ((current as { code?: unknown }).code === code) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

export function isUniqueViolation(err: unknown): boolean {
  return hasPostgresCode(err, UNIQUE_VIOLATION)
}

/** A refused policy check or a missing grant. */
export function isInsufficientPrivilege(err: unknown): boolean {
  return hasPostgresCode(err, INSUFFICIENT_PRIVILEGE)
}

/** Runs `write`, turning a unique violation into `refusal()`. */
export async function refusingDuplicates<T>(
  write: () => Promise<T>,
  refusal: () => DomainError,
): Promise<T> {
  try {
    return await write()
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
    throw refusal()
  }
}
