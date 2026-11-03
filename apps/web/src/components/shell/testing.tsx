import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { vi } from 'vitest'

import { Toaster } from '#/components/ui/sonner'
import { TooltipProvider } from '#/components/ui/tooltip'
import { routeTree } from '#/routeTree.gen'
import { testQueryClient } from '#/test/rpc'

import { ThemeProvider } from './theme-provider'

vi.mock('#/components/auth/signup-page', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  SignupPage: ({ mode }: { mode: 'new' | 'returning' }) => (
    <Heading title={mode === 'new' ? 'Sign up' : 'Sign in'} />
  ),
}))
vi.mock('#/components/onboarding/profile-page', () => ({
  ProfilePage: () => <Heading title="Your organization" />,
}))
vi.mock('#/components/billing/plans-page', () => ({ PlansPage: () => <Heading title="Plans" /> }))
vi.mock('#/components/billing/pricing-page', () => ({
  PricingPage: () => <Heading title="Pricing" />,
}))
vi.mock('#/components/billing/checkout-page', () => ({
  CheckoutPage: () => <Heading title="Checkout" />,
}))
vi.mock('#/components/settings/settings-page', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  SettingsPage: ({ section = 'account' }: { section?: string }) => (
    <Heading title="Settings" section={SECTION_TITLES[section] ?? section} />
  ),
}))
vi.mock('#/components/workspaces/workspaces-page', () => ({
  WorkspacesPage: () => <Heading title="Workspaces" />,
}))
vi.mock('#/components/organizations/join-page', () => ({
  JoinPage: () => <Heading title="Join" />,
}))
vi.mock('#/components/oauth/oauth-consent-page', () => ({
  OAuthConsentPage: () => <Heading title="Connect" />,
}))
vi.mock('#/components/oauth/oauth-signin-page', () => ({
  OAuthSignInPage: () => <Heading title="Sign in to connect" />,
}))

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

function Shell({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <TooltipProvider>{children}</TooltipProvider>
      <Toaster />
    </ThemeProvider>
  )
}

/** The app's real route tree over memory history, with other modules' screens stubbed out. */
export function renderApp(url: string, { queryClient = testQueryClient() } = {}) {
  Object.assign(routeTree.options, { shellComponent: Shell })
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [url] }),
    context: { queryClient },
    defaultViewTransition: true,
  })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  const location = () => router.state.location.href
  return { ...view, router, queryClient, location }
}
