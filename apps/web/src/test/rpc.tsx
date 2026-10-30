import { permissionsOf } from '@arrakit/auth/permissions'
import type { Me } from '@arrakit/contract'
import { fallbackORPCErrorMessage } from '@orpc/client'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { render } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'

import { Toaster } from '#/components/ui/sonner'
import '#/i18n'
import { createQueryClient } from '#/integrations/tanstack-query/root-provider'
import { orpc } from '#/lib/orpc'

const api = setupServer()

/** Starts the msw server for the file; after each test: no handlers, no spies, no toasts. */
export function setupTestApi({
  onUnhandledFrame = 'bypass',
}: { onUnhandledFrame?: 'bypass' | 'error' } = {}) {
  beforeAll(() => api.listen({ onUnhandledFrame }))
  afterEach(() => {
    api.resetHandlers()
    vi.restoreAllMocks()
    toast.dismiss()
  })
  afterAll(() => api.close())
}

export const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => undefined)

const CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  402: 'PAYMENT_REQUIRED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'TOO_MANY_REQUESTS',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
}

/** An oRPC error answer; without a message the API sends oRPC's fallback text for the code. */
function rpcError(status: number, message?: string) {
  const code = CODES[status] ?? 'INTERNAL_SERVER_ERROR'
  const text = message ?? fallbackORPCErrorMessage(code, undefined)
  return HttpResponse.json({ json: { defined: false, code, status, message: text } }, { status })
}

type Reply = unknown | number | [number, string] | ((input: unknown) => unknown)

/**
 * Answers `/api/rpc/<path>` with each answer in turn (the last one from then on): a body, an
 * error status, `[status, message]`, a `Response`, or a function of the input. Returns the calls.
 */
export function answer(path: string, ...answers: Reply[]) {
  const calls: { input: unknown }[] = []
  api.use(
    http.all(`*/api/rpc/${path}`, async ({ request }) => {
      const body = request.method === 'GET' ? null : await request.json().catch(() => null)
      const input = (body as { json?: unknown } | null)?.json
      const reply = answers[Math.min(calls.length, answers.length - 1)]
      calls.push({ input })
      const value =
        typeof reply === 'function' ? await (reply as (i: unknown) => unknown)(input) : reply
      if (value instanceof Response) return value
      if (typeof value === 'number') return rpcError(value)
      if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'number')
        return rpcError(value[0], value[1] as string)
      return HttpResponse.json({ json: value })
    }),
  )
  return calls
}

type AuthReply =
  | unknown
  | number
  | [number, string]
  | [number, string, string]
  | ((input: Record<string, unknown>) => unknown)

/** A Better Auth error answer: `{ code, message }` with the status. */
function authError(status: number, message = '', code?: string) {
  return HttpResponse.json({ message, ...(code ? { code } : {}) }, { status })
}

/**
 * Answers Better Auth's `/api/auth/<path>` (e.g. `organization/list-members`) like `answer`
 * does; `[status, message, code]` is a refusal with the plugin's code. The input is the JSON
 * body, or the query for a GET.
 */
export function answerAuth(path: string, ...answers: AuthReply[]) {
  const calls: { input: Record<string, unknown> }[] = []
  api.use(
    http.all(`*/api/auth/${path}`, async ({ request }) => {
      const input =
        request.method === 'GET'
          ? Object.fromEntries(new URL(request.url).searchParams)
          : ((await request.json().catch(() => ({}))) as Record<string, unknown>)
      const reply = answers[Math.min(calls.length, answers.length - 1)]
      calls.push({ input })
      const value =
        typeof reply === 'function'
          ? await (reply as (i: Record<string, unknown>) => unknown)(input)
          : reply
      if (value instanceof Response) return value
      if (typeof value === 'number') return authError(value)
      if (Array.isArray(value) && typeof value[0] === 'number')
        return authError(value[0], value[1] as string, value[2] as string | undefined)
      return HttpResponse.json(value ?? null)
    }),
  )
  return calls
}

export function meAs(overrides: Partial<Me> = {}): Me {
  const plan = overrides.plan === undefined ? 'team' : overrides.plan
  const role = overrides.role === undefined ? 'owner' : overrides.role
  return {
    email: 'lucia@acme.com',
    name: 'Lucía Gómez',
    language: 'en',
    organization: {
      id: '0f8fad5b-d9cb-469f-a165-70867728950e',
      name: 'Acme',
      slug: 'acme',
      plan: plan ?? 'team',
    },
    seats: 10,
    ...overrides,
    role,
    permissions: overrides.permissions ?? (role ? permissionsOf(role) : {}),
    plan,
  }
}

export const testQueryClient = () =>
  createQueryClient({ queries: { retry: false }, mutations: { retry: false } })

export function withQueries(client = testQueryClient()) {
  return function QueriesWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

const STUBS: [string, string][] = [
  ['/app', 'Home'],
  ['/app/plans', 'Plans'],
  ['/app/settings', 'Settings'],
  ['/app/checkout', 'Checkout'],
  ['/pricing', 'Pricing'],
  ['/profile', 'Profile'],
  ['/signup', 'Sign up'],
  ['/signin', 'Sign in'],
]

/** Renders `ui` at `url` inside a router with stand-in pages for where screens navigate. */
export function renderAt(
  ui: ReactNode,
  { me = meAs(), url = '/app/settings' }: { me?: Me | null; url?: string } = {},
) {
  const queryClient = testQueryClient()
  if (me) queryClient.setQueryData(orpc.me.get.queryOptions().queryKey, me)
  const rootRoute = createRootRoute()
  const path = url.split('?')[0]!
  const screen = createRoute({ getParentRoute: () => rootRoute, path, component: () => <>{ui}</> })
  const stubs = STUBS.filter(([stubPath]) => stubPath !== path).map(([stubPath, title]) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path: stubPath,
      component: () => <h1>{title}</h1>,
    }),
  )
  const router = createRouter({
    routeTree: rootRoute.addChildren([screen, ...stubs]),
    history: createMemoryHistory({ initialEntries: [url] }),
  })
  const view = render(
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>,
    { wrapper: withQueries(queryClient) },
  )
  return { ...view, router, queryClient, location: () => router.state.location.pathname }
}
