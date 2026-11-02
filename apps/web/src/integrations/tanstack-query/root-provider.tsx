import {
  type DefaultOptions,
  MutationCache,
  QueryCache,
  QueryClient,
  type QueryKey,
} from '@tanstack/react-query'

import { apiMessage, statusOf } from '#/lib/api-errors'
import { notify } from '#/lib/notify'

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: { failure?: string }
    mutationMeta: { failure?: string | ((variables: never) => string) }
  }
}

/** `[['me', 'get'], {...}]` (oRPC) or `['account']` -> `me.get` / `account`. */
function procedureOf(key: QueryKey | undefined): string {
  const head = key?.[0]
  if (Array.isArray(head)) return head.join('.')
  return typeof head === 'string' ? head : 'request'
}

/** A 401 is a signed-out visitor, never a failure; `failure` is the toast when the API gives none. */
function failed(key: QueryKey | undefined, err: unknown, failure: string | undefined): void {
  if (statusOf(err) === 401) return
  console.error(`[${procedureOf(key)}] failed`, err)
  if (failure !== undefined) notify.error(apiMessage(err) ?? failure)
}

export function createQueryClient(defaultOptions: DefaultOptions = {}) {
  return new QueryClient({
    defaultOptions: {
      ...defaultOptions,
      queries: { staleTime: 30_000, ...defaultOptions.queries },
    },
    queryCache: new QueryCache({
      onError: (err, query) => failed(query.queryKey, err, query.meta?.failure),
    }),
    mutationCache: new MutationCache({
      onError: (err, variables, _result, mutation) => {
        const failure = mutation.meta?.failure
        const text =
          typeof failure === 'function' ? (failure as (v: unknown) => string)(variables) : failure
        failed(mutation.options.mutationKey, err, text)
      },
    }),
  })
}

export function getContext() {
  return { queryClient: createQueryClient() }
}
