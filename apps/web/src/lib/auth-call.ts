import { i18n } from '#/i18n'

interface AuthFailure {
  status: number
  code?: string
  message?: string
}

type AuthAnswer<T> = { data: T | null; error: AuthFailure | null }

export class AuthCallError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message)
    this.name = 'AuthCallError'
  }
}

/** Our copy (`orgErrors.<CODE>`) for a Better Auth code we translate, else the API's message. */
function messageOf({ code, message }: AuthFailure): string {
  const key = `orgErrors.${code}`
  return code && i18n.exists(key) ? i18n.t(key) : (message ?? '')
}

/** Unwraps a Better Auth client answer: its data, or an error `statusOf`/`apiMessage` read. */
export async function authCall<T>(pending: Promise<AuthAnswer<T>>): Promise<T> {
  const { data, error } = await pending
  if (error) throw new AuthCallError(error.status, error.code ?? null, messageOf(error))
  return data as T
}

export const codeOf = (err: unknown): string | null =>
  err instanceof AuthCallError ? err.code : null
