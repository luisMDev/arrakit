import { useEffect } from 'react'

import { apiFailed } from './api-errors'

/** Reports a failed load and toasts the API's own message or `failure`, once per error. */
export function useFailureToast(error: unknown, context: string, failure: string): void {
  useEffect(() => {
    if (error) apiFailed(context, error, failure)
  }, [error, context, failure])
}
