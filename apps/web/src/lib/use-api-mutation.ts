import { type UseMutationOptions, type UseMutationResult, useMutation } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'

import { apiFailed, refusalMessage } from './api-errors'

export interface ApiMutationFailure<TVariables> {
  /** Prefix for the reported error, e.g. `[members] inviting failed`. */
  context: string
  /** The toast when the API gives no message `refusal` accepts. */
  failure: string | ((variables: TVariables) => string)
  /** Picks the API's own message to toast instead of `failure`; defaults to 400/403 refusals. */
  refusal?: (err: unknown) => string | null
}

export type ApiMutation<TData, TVariables, TError = unknown> = UseMutationResult<
  TData,
  TError,
  TVariables
> & {
  /**
   * Runs the mutation unless this one is already running (checked synchronously, so a double
   * click sends one request). Resolves to the data, or `undefined` when it failed or was skipped.
   */
  run(...args: RunArgs<TVariables>): Promise<TData | undefined>
}

type RunArgs<TVariables> = undefined extends TVariables
  ? [variables?: TVariables]
  : [variables: TVariables]

/**
 * A mutation for a screen: a failure is reported and toasts the API's refusal message or
 * `failure`, then the caller's own `onError` runs (to put a control back).
 */
export function useApiMutation<TData, TVariables = void, TError = unknown>(
  options: UseMutationOptions<TData, TError, TVariables>,
  { context, failure, refusal = refusalMessage }: ApiMutationFailure<TVariables>,
): ApiMutation<TData, TVariables, TError> {
  const mutation = useMutation<TData, TError, TVariables>({
    ...options,
    onError: (err, variables, onMutateResult, mutationContext) => {
      const text = typeof failure === 'string' ? failure : failure(variables)
      apiFailed(context, err, text, refusal)
      return options.onError?.(err, variables, onMutateResult, mutationContext)
    },
  })
  const running = useRef(false)
  const { mutateAsync } = mutation

  const run = useCallback(
    async (...[variables]: RunArgs<TVariables>) => {
      if (running.current) return undefined
      running.current = true
      try {
        return await mutateAsync(variables as TVariables)
      } catch {
        return undefined
      } finally {
        running.current = false
      }
    },
    [mutateAsync],
  )

  return { ...mutation, run }
}
