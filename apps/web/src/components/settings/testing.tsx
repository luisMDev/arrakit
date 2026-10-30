import type { Me } from '@arrakit/contract'
import { fallbackORPCErrorMessage } from '@orpc/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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

import { Toaster } from '#/components/ui/sonner'
import '#/i18n'
import { orpc } from '#/lib/orpc'

if (typeof window !== 'undefined') {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>
  proto.hasPointerCapture ??= () => false
  proto.releasePointerCapture ??= () => undefined
  proto.setPointerCapture ??= () => undefined
  proto.scrollIntoView ??= () => undefined
  window.scrollTo = () => undefined
  window.matchMedia ??= (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

export function meAs(overrides: Partial<Me> = {}): Me {
  const plan = overrides.plan === undefined ? 'team' : overrides.plan
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
    role: 'owner',
    seats: 10,
    ...overrides,
    plan,
  }
}

const CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_SERVER_ERROR',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
}

export function rpcOk(body: unknown = null) {
  return HttpResponse.json({ json: body })
}

export function rpcError(status: number, message?: string) {
  const code = CODES[status] ?? 'INTERNAL_SERVER_ERROR'
  return HttpResponse.json(
    {
      json: {
        defined: false,
        code,
        status,
        message: message ?? fallbackORPCErrorMessage(code, undefined),
      },
    },
    { status },
  )
}

export const api = setupServer()

export interface Call {
  input: unknown
}

/**
 * Answers `/api/rpc/<path>` with each answer in turn (the last one from then on): a body, an
 * error status, `[status, message]`, or a function of the input. Returns the calls received.
 */
export function answer(
  path: string,
  ...answers: Array<unknown | number | [number, string] | ((input: unknown) => unknown)>
) {
  const calls: Call[] = []
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
      return rpcOk(value)
    }),
  )
  return calls
}

/** Renders `ui` at `/app/settings` inside a router with stand-in pages for where screens navigate. */
export function renderScreen(ui: ReactNode, { me = meAs(), url = '/app/settings' } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (me) queryClient.setQueryData(orpc.me.get.queryOptions().queryKey, me)
  const rootRoute = createRootRoute()
  const stub = (path: string, title: string) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: () => <h1>{title}</h1> })
  const screen = createRoute({
    getParentRoute: () => rootRoute,
    path: url.split('?')[0]!,
    component: () => <>{ui}</>,
  })
  const routes = [
    screen,
    stub('/app', 'Home'),
    stub('/signin', 'Sign in'),
    stub('/profile', 'Profile'),
  ]
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes.filter((r, i) => i === 0 || r.path !== screen.path)),
    history: createMemoryHistory({ initialEntries: [url] }),
  })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>,
  )
  return { ...view, router, queryClient, location: () => router.state.location.pathname }
}
