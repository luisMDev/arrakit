import { useEffect } from 'react'

import { apiFailed, noRefusal } from './api-errors'

/**
 * Reports a failed load and toasts `failure`, or the API's own message when `refusal` finds one.
 * Fires once per error; `refusal` must be stable (a module function), or it fires every render.
 */
export function useFailureToast(
  error: unknown,
  context: string,
  failure: string,
  refusal: (err: unknown) => string | null = noRefusal,
): void {
  useEffect(() => {
    if (error) apiFailed(context, error, failure, refusal)
  }, [error, context, failure, refusal])
}
