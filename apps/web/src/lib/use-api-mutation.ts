import {
  type DefaultError,
  type UseMutationOptions,
  type UseMutationResult,
  useMutation,
} from '@tanstack/react-query'
import { useCallback, useRef } from 'react'

type ApiMutation<TData, TError, TVariables, TOnMutateResult> = UseMutationResult<
  TData,
  TError,
  TVariables,
  TOnMutateResult
> & {
  /**
   * Runs the mutation unless this one is already running (checked synchronously, so a double
   * click sends one request). Resolves to the data, or `undefined` when it failed or was skipped.
   */
  run(...args: RunArgs<TVariables>): Promise<TData | undefined>
  /** Running, or done and about to leave the screen. */
  busy: boolean
}

type RunArgs<TVariables> = undefined extends TVariables
  ? [variables?: TVariables]
  : [variables: TVariables]

/** A mutation for a screen; its failure toasts `meta.failure` through the query client. */
export function useApiMutation<
  TData = unknown,
  TError = DefaultError,
  TVariables = void,
  TOnMutateResult = unknown,
>(
  options: UseMutationOptions<TData, TError, TVariables, TOnMutateResult>,
): ApiMutation<TData, TError, TVariables, TOnMutateResult> {
  const mutation = useMutation(options)
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

  return { ...mutation, run, busy: mutation.isPending || mutation.isSuccess }
}
