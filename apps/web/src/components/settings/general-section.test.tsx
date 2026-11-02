import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { orpc } from '#/lib/orpc'
import { answer, answerAuth, meAs, quiet, renderAt, setupTestApi } from '#/test/rpc'

import { GeneralSection } from './general-section'

setupTestApi()

const ORG_ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const summary = { id: ORG_ID, slug: 'acme', plan: 'team' as const }

describe('GeneralSection', () => {
  it('shows the name and slug read-only to a member', async () => {
    answer('me/get', meAs({ role: 'member' }))
    renderAt(<GeneralSection />, { me: meAs({ role: 'member' }) })
    expect(await screen.findByLabelText('Organization name')).toBeDisabled()
    expect(screen.getByText('Slug: acme')).toBeInTheDocument()
  })

  it('renames on blur for an admin and patches me', async () => {
    const calls = answerAuth('organization/update', { ...summary, name: 'Acme Capital' })
    answer('me/get', meAs({ role: 'admin' }))
    const { queryClient } = renderAt(<GeneralSection />, { me: meAs({ role: 'admin' }) })
    const input = await screen.findByLabelText('Organization name')
    await userEvent.clear(input)
    await userEvent.type(input, ' Acme Capital ')
    await userEvent.tab()
    await waitFor(() =>
      expect(calls).toEqual([
        { input: { organizationId: ORG_ID, data: { name: 'Acme Capital' } } },
      ]),
    )
    await waitFor(() =>
      expect(queryClient.getQueryData(orpc.me.get.queryOptions().queryKey)).toMatchObject({
        organization: { name: 'Acme Capital' },
      }),
    )
    expect(input).toHaveValue('Acme Capital')
  })

  it('leaves me alone when the organization changed before the rename answered', async () => {
    const birch = meAs({
      role: 'admin',
      organization: {
        id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        name: 'Birch',
        slug: 'birch',
        plan: 'free',
      },
      plan: 'free',
    })
    let answerRename = () => {}
    const calls = answerAuth('organization/update', async () => {
      await new Promise<void>((resolve) => (answerRename = resolve))
      return { ...summary, name: 'Acme Capital' }
    })
    answer('me/get', birch)
    const { queryClient } = renderAt(<GeneralSection />, { me: meAs({ role: 'admin' }) })
    const { queryKey } = orpc.me.get.queryOptions()
    const input = await screen.findByLabelText('Organization name')
    await userEvent.clear(input)
    await userEvent.type(input, 'Acme Capital')
    await userEvent.tab()
    await waitFor(() => expect(calls).toHaveLength(1))
    queryClient.setQueryData(queryKey, birch)
    answerRename()
    await waitFor(() => expect(queryClient.isMutating()).toBe(0))
    expect(queryClient.getQueryData(queryKey)).toEqual(birch)
  })

  it('never sends a blank name', async () => {
    const calls = answerAuth('organization/update', { ...summary, name: 'x' })
    answer('me/get', meAs({ role: 'admin' }))
    renderAt(<GeneralSection />, { me: meAs({ role: 'admin' }) })
    const input = await screen.findByLabelText('Organization name')
    await userEvent.clear(input)
    await userEvent.tab()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(calls).toHaveLength(0)
  })

  it('puts the saved name back when the rename fails', async () => {
    quiet()
    answerAuth('organization/update', 500)
    const loads = answer('me/get', meAs())
    renderAt(<GeneralSection />, { me: meAs({ role: 'owner' }) })
    const input = await screen.findByLabelText('Organization name')
    await userEvent.type(input, ' Two')
    await userEvent.tab()
    expect(
      await screen.findByText("Couldn't save the organization's settings. Try again."),
    ).toBeInTheDocument()
    await waitFor(() => expect(input).toHaveValue('Acme'))
    expect(loads).toHaveLength(1)
  })

  it("toasts the API's refusal", async () => {
    quiet()
    answerAuth('organization/update', [400, 'Give the organization a name.'])
    answer('me/get', meAs())
    renderAt(<GeneralSection />, { me: meAs() })
    const input = await screen.findByLabelText('Organization name')
    await userEvent.type(input, ' Two')
    await userEvent.tab()
    expect(await screen.findByText('Give the organization a name.')).toBeInTheDocument()
  })

  it('leaves the name read-only to a custom role without organization:update', async () => {
    const me = meAs({ role: 'finance', permissions: { billing: ['read'] } })
    renderAt(<GeneralSection />, { me })
    expect(await screen.findByLabelText('Organization name')).toBeDisabled()
  })
})
