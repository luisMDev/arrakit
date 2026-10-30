import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { orpc } from '#/lib/orpc'
import { answer, api, meAs, quiet, renderAt } from '#/test/rpc'

import { SecuritySection } from './security-section'

beforeAll(() => api.listen({ onUnhandledFrame: 'bypass' }))
afterEach(() => {
  api.resetHandlers()
  vi.restoreAllMocks()
})
afterAll(() => api.close())

describe('SecuritySection', () => {
  it.each(['admin', 'member'] as const)('only tells a %s who can delete', async (role) => {
    renderAt(<SecuritySection />, { me: meAs({ role }) })
    expect(
      await screen.findByText('Only the owner can delete the organization.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('deletes the organization once, clears me and opens Profile', async () => {
    const calls = answer('organizations/delete', async () => {
      await new Promise((r) => setTimeout(r, 30))
      return null
    })
    const { location, queryClient } = renderAt(<SecuritySection />)
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete the organization?' })
    await userEvent.dblClick(
      within(dialog).getByRole('button', { name: 'Delete the organization' }),
    )
    expect(await screen.findByText('Your organization is deleted.')).toBeInTheDocument()
    await waitFor(() => expect(location()).toBe('/profile'))
    expect(calls).toHaveLength(1)
    expect(queryClient.getQueryData(orpc.me.get.queryOptions().queryKey)).toBeUndefined()
  })

  it.each([
    [
      [
        502,
        "Couldn't cancel your plan with Stripe, so nothing was deleted. Try again in a minute.",
      ] as const,
      "Couldn't cancel your plan with Stripe, so nothing was deleted. Try again in a minute.",
    ],
    [500, "Couldn't delete your organization. Try again."],
  ])('toasts a failed delete (%j) and stays', async (reply, message) => {
    quiet()
    answer('organizations/delete', reply as number | [number, string])
    const { location } = renderAt(<SecuritySection />)
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Delete the organization' }))
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(location()).toBe('/app/settings')
  })
})
