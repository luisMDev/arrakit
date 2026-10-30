import { redirect } from '@tanstack/react-router'

import { reportError, statusOf } from '#/lib/api-errors'

type GuardFailure = 'signed-out' | 'forbidden' | 'unavailable'

/** A 401 means signed out; anything else is reported under `context`. */
export function guardFailure(context: string, err: unknown): GuardFailure {
  const status = statusOf(err)
  if (status === 401) return 'signed-out'
  reportError(context, err)
  return status === 403 ? 'forbidden' : 'unavailable'
}

export function unavailableRedirect(failure: 'forbidden' | 'unavailable', next: string) {
  return failure === 'forbidden'
    ? redirect({ to: '/unavailable', search: { reason: 'forbidden' } })
    : redirect({ to: '/unavailable', search: { next } })
}
