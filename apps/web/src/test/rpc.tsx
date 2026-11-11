import { permissionsOf } from '@arrakit/auth/permissions'
import type { AuthProviders, BillingView, Me } from '@arrakit/contract'
import { COMMON_ORPC_ERROR_DEFS, fallbackORPCErrorMessage } from '@orpc/client'
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useSearch,
} from '@tanstack/react-router'
import { render } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest'

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
  ...Object.fromEntries(
    Object.entries(COMMON_ORPC_ERROR_DEFS).map(([code, { status }]) => [status, code]),
  ),
  402: 'PAYMENT_REQUIRED',
}

/** An oRPC error answer; without a message the API sends oRPC's fallback text for the code. */
function rpcError(status: number, message?: string) {
  const code = CODES[status] ?? 'INTERNAL_SERVER_ERROR'
  const text = message ?? fallbackORPCErrorMessage(code, undefined)
  return HttpResponse.json({ json: { defined: false, code, status, message: text } }, { status })
}

/** A Better Auth error answer: `{ code, message }` with the status. */
function authError(status: number, message = '', code?: string) {
  return HttpResponse.json({ message, ...(code ? { code } : {}) }, { status })
}

/** Answers `pattern` with each answer in turn (the last one from then on) and records the calls. */
function replyWith<I>(
  pattern: string,
  answers: unknown[],
  readInput: (request: Request) => Promise<I>,
  respond: (value: unknown) => Response,
) {
  const calls: { input: I }[] = []
  api.use(
    http.all(pattern, async ({ request }) => {
      const input = await readInput(request)
      const reply = answers[Math.min(calls.length, answers.length - 1)]
      calls.push({ input })
      const value = typeof reply === 'function' ? await (reply as (i: I) => unknown)(input) : reply
      return value instanceof Response ? value : respond(value)
    }),
  )
  return calls
}

type Reply = unknown | number | [number, string] | ((input: unknown) => unknown)

/**
 * Answers `/api/rpc/<path>` with each answer in turn (the last one from then on): a body, an
 * error status, `[status, message]`, a `Response`, or a function of the input. Returns the calls.
 */
export function answer(path: string, ...answers: Reply[]) {
  return replyWith(
    `*/api/rpc/${path}`,
    answers,
    async (request) => {
      const body = request.method === 'GET' ? null : await request.json().catch(() => null)
      return (body as { json?: unknown } | null)?.json
    },
    (value) => {
      if (typeof value === 'number') return rpcError(value)
      if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'number')
        return rpcError(value[0], value[1] as string)
      return HttpResponse.json({ json: value })
    },
  )
}

export interface AnsweredStream {
  /** Sends one value of the stream. */
  send(value: unknown): void
  /** Ends the stream as the API does when its procedure returns. */
  end(): void
}

/**
 * Answers the event stream `/api/rpc/<path>` (an oRPC event iterator): each call opens a new
 * stream, in the order of the returned list, that the test writes to.
 */
export function answerStream(path: string) {
  const streams: AnsweredStream[] = []
  const encoder = new TextEncoder()
  api.use(
    http.all(`*/api/rpc/${path}`, () => {
      let controller!: ReadableStreamDefaultController<Uint8Array>
      const body = new ReadableStream<Uint8Array>({
        start: (c) => {
          controller = c
        },
      })
      const write = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      streams.push({
        send: (value) => write('message', { json: value }),
        end: () => {
          write('done', {})
          controller.close()
        },
      })
      return new HttpResponse(body, { headers: { 'content-type': 'text/event-stream' } })
    }),
  )
  return streams
}

export interface StoredUpload {
  contentType: string | null
  bytes: number
}

/** Answers PUTs to a presigned storage `url` with `status`; returns what each one sent. */
export function answerStorage(url: string, status = 200) {
  const uploads: StoredUpload[] = []
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'PUT',
    'access-control-allow-headers': '*',
  }
  api.use(
    http.options(url, () => new HttpResponse(null, { status: 204, headers: cors })),
    http.put(url, async ({ request }) => {
      const bytes = (await request.arrayBuffer()).byteLength
      uploads.push({ contentType: request.headers.get('content-type'), bytes })
      return new HttpResponse(null, { status, headers: cors })
    }),
  )
  return uploads
}

type AuthReply =
  | unknown
  | number
  | [number, string]
  | [number, string, string]
  | ((input: Record<string, unknown>) => unknown)

/**
 * Answers Better Auth's `/api/auth/<path>` (e.g. `organization/list-members`) like `answer`
 * does; `[status, message, code]` is a refusal with the plugin's code. The input is the JSON
 * body, or the query for a GET.
 */
export function answerAuth(path: string, ...answers: AuthReply[]) {
  return replyWith(
    `*/api/auth/${path}`,
    answers,
    async (request): Promise<Record<string, unknown>> =>
      request.method === 'GET'
        ? Object.fromEntries(new URL(request.url).searchParams)
        : ((await request.json().catch(() => ({}))) as Record<string, unknown>),
    (value) => {
      if (typeof value === 'number') return authError(value)
      if (Array.isArray(value) && typeof value[0] === 'number')
        return authError(value[0], value[1] as string, value[2] as string | undefined)
      return HttpResponse.json(value ?? null)
    },
  )
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

type Screen = ReactNode | ((search: Record<string, unknown>) => ReactNode)

function ScreenAt({ ui }: { ui: Screen }) {
  const search = useSearch({ strict: false })
  return <>{typeof ui === 'function' ? ui(search) : ui}</>
}

/**
 * Renders `ui` at `url` inside a router with stand-in pages for where screens navigate. `ui` may
 * be a function of the URL's search, as a route component reads it. `me` is seeded into
 * `queryClient` (`null`: no one signed in).
 */
export function renderAt(
  ui: Screen,
  {
    me = meAs(),
    url = '/app/settings',
    queryClient = testQueryClient(),
  }: { me?: Me | null; url?: string; queryClient?: QueryClient } = {},
) {
  if (me) queryClient.setQueryData(orpc.me.get.queryOptions().queryKey, me)
  const rootRoute = createRootRoute()
  const path = url.split('?')[0]!
  const screen = createRoute({
    getParentRoute: () => rootRoute,
    path,
    component: () => <ScreenAt ui={ui} />,
  })
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
  return { ...view, router, queryClient, location: () => router.state.location.pathname }
}

/** `setupTestApi()`; every test begins with `providers` and quiet error logs. */
export function setupAuthTestApi(providers: AuthProviders = { google: true, microsoft: false }) {
  setupTestApi()
  beforeEach(() => {
    quiet()
    answer('authProviders/get', providers)
  })
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
