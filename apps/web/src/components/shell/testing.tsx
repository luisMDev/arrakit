import type { Me } from '@arrakit/contract'
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  RouterProvider,
} from '@tanstack/react-router'
import { render } from '@testing-library/react'

import { Toaster } from '#/components/ui/sonner'
import '#/i18n'
import { settingsSearch } from '#/components/settings/settings-page'
import { requireUser } from '#/lib/guards/require-user'
import { meAs as sharedMeAs, testQueryClient } from '#/test/rpc'

import { AppShell } from './app-shell'
import { HomePage } from './home-page'
import { NotFoundPage } from './not-found-page'
import { onPaidPlan, welcomeSearch } from './on-paid-plan'
import { RootLayout } from './root-layout'
import { ThemeProvider } from './theme-provider'
import { UnavailablePage, unavailableSearch } from './unavailable-page'
import { viewTransitionRouterOptions } from './view-transitions'
import { WelcomePage } from './welcome-page'

export const meAs = (overrides: Partial<Me> = {}): Me =>
  sharedMeAs({ email: 'ana@acme.com', name: 'Ana Ruiz', plan: 'pro', seats: 3, ...overrides })

const SECTION_TITLES: Record<string, string> = {
  account: 'Account',
  members: 'Members',
  billing: 'Billing',
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
export function renderApp(url: string, { queryClient = testQueryClient() } = {}) {
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
    validateSearch: unavailableSearch,
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
  const settings = createRoute({
    getParentRoute: () => app,
    path: '/settings',
    validateSearch: settingsSearch,
    component: function Settings() {
      const { section = 'account' } = settings.useSearch()
      return <Heading title="Settings" section={SECTION_TITLES[section] ?? section} />
    },
  })
  const plans = createRoute({
    getParentRoute: () => app,
    path: '/plans',
    component: () => <Heading title="Plans" />,
  })
  const welcome = createRoute({
    getParentRoute: () => app,
    path: '/welcome',
    validateSearch: welcomeSearch,
    beforeLoad: onPaidPlan,
    component: WelcomePage,
  })
  const appCatchAll = createRoute({
    getParentRoute: () => app,
    path: '$',
    component: NotFoundPage,
  })
  const catchAll = createRoute({
    getParentRoute: () => rootRoute,
    path: '$',
    component: NotFoundPage,
  })
  const routeTree = rootRoute.addChildren([
    index,
    signin,
    profile,
    unavailable,
    app.addChildren([home, settings, plans, welcome, appCatchAll]),
    catchAll,
  ])
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [url] }),
    context: { queryClient },
    ...viewTransitionRouterOptions,
  })
  const view = render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>,
  )
  const location = () => router.state.location.href
  return { ...view, router, queryClient, location }
}
