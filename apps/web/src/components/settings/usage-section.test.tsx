import type { Me } from '@arrakit/contract'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import '#/i18n'
import { usageFixture } from '#/components/usage/fixtures'
import { orpc } from '#/lib/orpc'

import { UsageSection } from './usage-section'

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock('sonner', async (original) => {
  const sonner = await original<typeof import('sonner')>()
  return { ...sonner, toast: Object.assign(vi.fn(), sonner.toast, { error: toastError }) }
})

function renderAs(role: Me['role'], { withUsage = true } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(orpc.me.get.queryOptions().queryKey, {
    email: 'ana@acme.com',
    name: 'Ana',
    language: 'en',
    organization: {
      id: '0f8fad5b-d9cb-469f-a165-70867728950e',
      name: 'Acme',
      slug: 'acme',
      plan: 'pro',
    },
    role,
    plan: 'pro',
    seats: 3,
  } satisfies Me)
  if (withUsage) queryClient.setQueryData(orpc.usage.get.queryOptions().queryKey, usageFixture())
  return render(
    <QueryClientProvider client={queryClient}>
      <UsageSection />
    </QueryClientProvider>,
  )
}

describe('Settings > Usage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    toastError.mockReset()
  })

  it('shows members the cards and who can add credits, with no buttons', () => {
    renderAs('member')
    const section = screen.getByRole('region', { name: 'Usage' })
    const credits = section.querySelector('[data-metric="credits"]') as HTMLElement
    expect(within(credits).getByText('750 credits left')).toBeInTheDocument()
    expect(within(credits).getByText('250 credits used this month')).toBeInTheDocument()
    expect(
      within(section.querySelector('[data-metric="storage_gb"]') as HTMLElement).getByText(
        '12 GB of 100 GB used',
      ),
    ).toBeInTheDocument()
    expect(section.querySelector('[data-hint]')).toHaveTextContent(
      'Running low? An owner or an admin can add credits.',
    )
    expect(within(section).queryByRole('button')).not.toBeInTheDocument()
    expect(within(section).queryByText(/Add credits$/)).not.toBeInTheDocument()
  })

  it('points admins to Billing', () => {
    renderAs('admin')
    expect(document.querySelector('[data-hint]')).toHaveTextContent('Add credits in Billing.')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('says when usage could not load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('down', { status: 500 })),
    )
    renderAs('member', { withUsage: false })
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Couldn't load usage. Reload the page.",
        expect.anything(),
      ),
    )
    expect(document.querySelector('[data-metric]')).toBeNull()
  })
})
