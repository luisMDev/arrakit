import type { Me } from '@arrakit/contract'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  RouterProvider,
} from '@tanstack/react-router'
import { render } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { Toaster } from '#/components/ui/sonner'
import '#/i18n'
import { requireUser } from '#/lib/guards/require-user'

import { AppShell } from './app-shell'
import { HomePage } from './home-page'
import { onPaidPlan } from './on-paid-plan'
import { RootLayout } from './root-layout'
import { UnavailablePage } from './unavailable-page'
import { WelcomePage } from './welcome-page'

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
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
}

export const ana: Me = {
  email: 'ana@acme.com',
  name: 'Ana Ruiz',
  language: 'en',
  organization: {
    id: '0f8fad5b-d9cb-469f-a165-70867728950e',
    name: 'Acme',
    slug: 'acme',
    plan: 'pro',
  },
  role: 'owner',
  plan: 'pro',
  seats: 3,
}

export function meAs(overrides: Partial<Me> = {}): Me {
  const me = { ...ana, ...overrides }
  if (me.organization && me.plan) me.organization = { ...me.organization, plan: me.plan }
  return me
}

const CODES: Record<number, string> = {
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  500: 'INTERNAL_SERVER_ERROR',
}

/** An oRPC answer as the RPC protocol encodes it. */
export function rpcResponse(body: unknown) {
  return HttpResponse.json({ json: body })
}

export function rpcError(status: number, message = 'refused') {
  return HttpResponse.json(
    { json: { defined: false, code: CODES[status] ?? 'BAD_REQUEST', status, message } },
    { status },
  )
}

export const api = setupServer()

/** `me.get` answers with each of `answers` in turn, the last one from then on. */
export function meAnswers(...answers: Array<Me | number | (() => Response)>) {
  let call = 0
  const handler = http.all('*/api/rpc/me/get', () => {
    const answer = answers[Math.min(call, answers.length - 1)]!
    call++
    if (typeof answer === 'number') return rpcError(answer)
    if (typeof answer === 'function') return answer()
    return rpcResponse(answer)
  })
  api.use(handler)
  return { calls: () => call }
}

function Heading({ title, section }: { title: string; section?: string }) {
  return (
    <main>
      <h1>{title}</h1>
      {section ? <h2>{section}</h2> : null}
    </main>
  )
}

/** The shell's routes over memory history, with stand-ins for other modules' screens. */
export function renderApp(url: string, { queryClient = new QueryClient() } = {}) {
  const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
    component: RootLayout,
  })
  const index = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    beforeLoad: () => {
      throw redirect({ to: '/signin' })
    },
  })
  const signin = createRoute({
    getParentRoute: () => rootRoute,
    path: '/signin',
    component: () => <Heading title="Sign in" />,
  })
  const profile = createRoute({
    getParentRoute: () => rootRoute,
    path: '/profile',
    component: () => <Heading title="Your organization" />,
  })
  const unavailable = createRoute({
    getParentRoute: () => rootRoute,
    path: '/unavailable',
    validateSearch: (search: Record<string, unknown>): { reason?: 'forbidden'; next?: string } => ({
      ...(search.reason === 'forbidden' ? { reason: 'forbidden' as const } : {}),
      ...(typeof search.next === 'string' ? { next: search.next } : {}),
    }),
    component: function Unavailable() {
      return <UnavailablePage {...unavailable.useSearch()} />
    },
  })
  const app = createRoute({
    getParentRoute: () => rootRoute,
    path: '/app',
    beforeLoad: requireUser,
    component: AppShell,
  })
  const home = createRoute({ getParentRoute: () => app, path: '/', component: HomePage })
  const settings = ['settings:Account', 'members:Members', 'billing:Billing'].map((entry) => {
    const [path, section] = entry.split(':') as [string, string]
    return createRoute({
      getParentRoute: () => app,
      path,
      component: () => <Heading title="Settings" section={section} />,
    })
  })
  const plans = createRoute({
    getParentRoute: () => app,
    path: '/plans',
    component: () => <Heading title="Plans" />,
  })
  const welcome = createRoute({
    getParentRoute: () => app,
    path: '/welcome',
    validateSearch: (search: Record<string, unknown>): { session_id?: string } =>
      typeof search.session_id === 'string' ? { session_id: search.session_id } : {},
    beforeLoad: onPaidPlan,
    component: WelcomePage,
  })
  const appCatchAll = createRoute({
    getParentRoute: () => app,
    path: '$',
    beforeLoad: () => {
      throw redirect({ to: '/app' })
    },
  })
  const catchAll = createRoute({
    getParentRoute: () => rootRoute,
    path: '$',
    beforeLoad: () => {
      throw redirect({ to: '/signin' })
    },
  })
  const routeTree = rootRoute.addChildren([
    index,
    signin,
    profile,
    unavailable,
    app.addChildren([home, ...settings, plans, welcome, appCatchAll]),
    catchAll,
  ])
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [url] }),
    context: { queryClient },
  })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>,
  )
  const location = () => router.state.location.href
  return { ...view, router, queryClient, location }
}
