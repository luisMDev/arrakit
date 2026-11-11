import type { Me } from '@arrakit/contract'
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { usageFixture } from '#/components/usage/fixtures'
import { orpc } from '#/lib/orpc'
import { meAs, renderAt, testQueryClient } from '#/test/rpc'

import { UsageSection } from './usage-section'

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock('sonner', async (original) => {
  const sonner = await original<typeof import('sonner')>()
  return { ...sonner, toast: Object.assign(vi.fn(), sonner.toast, { error: toastError }) }
})

async function renderAs(role: Me['role'], { withUsage = true } = {}) {
  const queryClient = testQueryClient()
  if (withUsage) queryClient.setQueryData(orpc.usage.get.queryOptions().queryKey, usageFixture())
  const view = renderAt(<UsageSection />, { me: meAs({ role, plan: 'pro' }), queryClient })
  await act(() => view.router.load())
  return view
}

describe('Settings > Usage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    toastError.mockReset()
  })

  it('shows members the cards and who can add credits, with no buttons', async () => {
    await renderAs('member')
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

  it('says when usage could not load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('down', { status: 500 })),
    )
    await renderAs('member', { withUsage: false })
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Couldn't load usage. Reload the page.",
        expect.anything(),
      ),
    )
    expect(document.querySelector('[data-metric]')).toBeNull()
  })
})
