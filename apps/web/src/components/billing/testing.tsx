import type { BillingView, Me, PlanOfferView } from '@arrakit/contract'
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

export const OFFERS: PlanOfferView[] = [
  {
    plan: 'free',
    monthly: { amount: 0, currency: 'usd' },
    yearly: { amount: 0, currency: 'usd' },
    seats: 1,
  },
  {
    plan: 'pro',
    monthly: { amount: 2_000, currency: 'usd' },
    yearly: { amount: 19_200, currency: 'usd' },
    seats: 3,
  },
  {
    plan: 'team',
    monthly: { amount: 5_000, currency: 'usd' },
    yearly: { amount: 48_000, currency: 'usd' },
    seats: 10,
  },
]

export function meOn(plan: Me['plan'], role: Me['role'] = 'owner'): Me {
  return {
    email: 'lucia@acme.com',
    name: 'Lucía',
    language: 'en',
    organization: {
      id: '0f8fad5b-d9cb-469f-a165-70867728950e',
      name: 'Acme',
      slug: 'acme',
      plan: plan ?? 'free',
    },
    role,
    plan,
    seats: 1,
  }
}

export function billingOf(overrides: Partial<BillingView> = {}): BillingView {
  return {
    plan: 'pro',
    cycle: 'yearly',
    renewsOn: '2027-10-04',
    endsOn: null,
    nextInvoice: { amount: 19_200, currency: 'usd' },
    scheduledChange: null,
    seats: 3,
    card: { brand: 'visa', last4: '4242' },
    billingEmail: 'finance@acme.com',
    invoiceTo: 'Acme SL',
    taxId: 'ESB99286321',
    invoices: [
      {
        id: 'in_2',
        issuedOn: '2026-10-04',
        total: { amount: 19_200, currency: 'usd' },
        status: 'paid',
        pdfUrl: 'https://pay.stripe.test/in_2.pdf',
      },
      {
        id: 'in_1',
        issuedOn: '2026-09-04',
        total: { amount: 1_499, currency: 'usd' },
        status: 'failed',
        pdfUrl: null,
      },
    ],
    ...overrides,
  }
}

const CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  402: 'PAYMENT_REQUIRED',
  403: 'FORBIDDEN',
  409: 'CONFLICT',
  500: 'INTERNAL_SERVER_ERROR',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
}

export function rpcError(status: number, message?: string) {
  const code = CODES[status] ?? 'INTERNAL_SERVER_ERROR'
  return HttpResponse.json(
    {
      json: {
        defined: false,
        code,
        status,
        // Without its own message the API sends oRPC's fallback text for the code.
        message: message ?? fallbackORPCErrorMessage(code, undefined),
      },
    },
    { status },
  )
}

export const api = setupServer()

type Reply = unknown | number | [number, string] | ((input: unknown) => unknown)

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
      if (typeof value === 'number') return rpcError(value)
      if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'number')
        return rpcError(value[0], value[1] as string)
      return HttpResponse.json({ json: value })
    }),
  )
  return calls
}

const STUBS: [string, string][] = [
  ['/app', 'Home'],
  ['/app/plans', 'Plans'],
  ['/app/billing', 'Billing'],
  ['/app/checkout', 'Checkout'],
  ['/pricing', 'Pricing'],
  ['/signup', 'Sign up'],
  ['/signin', 'Sign in'],
]

export function renderAt(ui: ReactNode, { me, url }: { me?: Me | null; url: string }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
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
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>,
  )
  return { ...view, router, queryClient, location: () => router.state.location }
}
