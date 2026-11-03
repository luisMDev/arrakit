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

/** Postgres and PGlite report the code on the error; Drizzle wraps it as the cause. */
export function isUniqueViolation(err: unknown): boolean {
  for (let current = err; current && typeof current === 'object';) {
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
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
