import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { orpc } from '#/lib/orpc'
import { answer, answerAuth, meAs, quiet, renderAt, setupTestApi } from '#/test/rpc'

import { SecuritySection } from './security-section'

setupTestApi()

const ORG_ID = meAs().organization!.id
const OTHER = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  name: 'Birch',
  slug: 'birch',
  plan: 'free',
}
const NO_ORGANIZATION = meAs({ organization: null, role: null, plan: null })

describe('SecuritySection', () => {
  it.each(['admin', 'member'] as const)(
    'offers a %s to leave, and says only the owner deletes',
    async (role) => {
      renderAt(<SecuritySection />, { me: meAs({ role }) })
      expect(
        await screen.findByText('Only the owner can delete the organization.'),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Leave' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    },
  )

  it('deletes the organization once, then opens Profile when no other is left', async () => {
    const loads = answer('me/get', NO_ORGANIZATION)
    const calls = answerAuth('organization/delete', async () => {
      await new Promise((r) => setTimeout(r, 30))
      return { id: ORG_ID }
    })
    answerAuth('organization/list', [])
    const activated = answerAuth('organization/set-active', null)
    const { location, queryClient } = renderAt(<SecuritySection />)
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete the organization?' })
    await userEvent.dblClick(
      within(dialog).getByRole('button', { name: 'Delete the organization' }),
    )
    expect(await screen.findByText('Your organization is deleted.')).toBeInTheDocument()
    await waitFor(() => expect(location()).toBe('/profile'))
    expect(calls).toEqual([{ input: { organizationId: ORG_ID } }])
    expect(activated).toEqual([{ input: { organizationId: null } }])
    expect(loads.length).toBeGreaterThan(0)
    expect(queryClient.getQueryData(orpc.me.get.queryOptions().queryKey)).toMatchObject({
      organization: null,
    })
  })

  it("moves to the person's next organization after a delete", async () => {
    answer('me/get', meAs({ organization: OTHER as never }))
    answerAuth('organization/delete', { id: ORG_ID })
    answerAuth('organization/list', [OTHER])
    const activated = answerAuth('organization/set-active', OTHER)
    const { location } = renderAt(<SecuritySection />)
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Delete the organization' }))
    await waitFor(() => expect(location()).toBe('/app'))
    expect(activated).toEqual([{ input: { organizationId: OTHER.id } }])
  })

  it.each([
    [
      [502, "Couldn't reach Stripe. Try again in a minute."] as const,
      "Couldn't reach Stripe. Try again in a minute.",
    ],
    [500, "Couldn't delete your organization. Try again."],
  ])(
    'toasts a failed delete (%j), makes the organization active again and stays',
    async (reply, message) => {
      quiet()
      answer('me/get', meAs())
      answerAuth('organization/delete', reply)
      const activated = answerAuth('organization/set-active', { id: ORG_ID })
      const { location } = renderAt(<SecuritySection />)
      await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
      await userEvent.click(await screen.findByRole('button', { name: 'Delete the organization' }))
      expect(await screen.findByText(message)).toBeInTheDocument()
      await waitFor(() => expect(activated).toEqual([{ input: { organizationId: ORG_ID } }]))
      expect(location()).toBe('/app/settings')
    },
  )

  it('lets a member leave, then opens Profile', async () => {
    answer('me/get', NO_ORGANIZATION)
    const left = answerAuth('organization/leave', { id: 'm-3', organizationId: ORG_ID })
    answerAuth('organization/list', [])
    answerAuth('organization/set-active', null)
    const { location } = renderAt(<SecuritySection />, { me: meAs({ role: 'member' }) })
    await userEvent.click(await screen.findByRole('button', { name: 'Leave' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave Acme?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave the organization' }))
    expect(await screen.findByText('You left Acme.')).toBeInTheDocument()
    await waitFor(() => expect(location()).toBe('/profile'))
    expect(left).toEqual([{ input: { organizationId: ORG_ID } }])
  })

  it("shows our words for the plugin's refusal to leave", async () => {
    quiet()
    answerAuth('organization/leave', [
      400,
      'You cannot leave the organization as the only owner',
      'YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER',
    ])
    renderAt(<SecuritySection />, { me: meAs({ role: 'member' }) })
    await userEvent.click(await screen.findByRole('button', { name: 'Leave' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Leave the organization' }))
    expect(
      await screen.findByText("You're the organization's only owner, so you can't leave it."),
    ).toBeInTheDocument()
  })
})
