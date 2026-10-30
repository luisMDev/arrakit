import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { orpc } from '#/lib/orpc'

import { GeneralSection } from './general-section'
import { answer, api, meAs, renderScreen } from './testing'

beforeAll(() => api.listen({ onUnhandledFrame: 'bypass' }))
afterEach(() => {
  api.resetHandlers()
  vi.restoreAllMocks()
})
afterAll(() => api.close())

const summary = { id: '0f8fad5b-d9cb-469f-a165-70867728950e', slug: 'acme', plan: 'team' as const }

describe('GeneralSection', () => {
  it('shows the name and slug read-only to a member', async () => {
    answer('me/get', meAs({ role: 'member' }))
    renderScreen(<GeneralSection />, { me: meAs({ role: 'member' }) })
    expect(await screen.findByLabelText('Organization name')).toBeDisabled()
    expect(screen.getByText('Slug: acme')).toBeInTheDocument()
  })

  it('renames on blur for an admin and patches me', async () => {
    const calls = answer('organizations/update', { ...summary, name: 'Acme Capital' })
    answer('me/get', meAs({ role: 'admin' }))
    const { queryClient } = renderScreen(<GeneralSection />, { me: meAs({ role: 'admin' }) })
    const input = await screen.findByLabelText('Organization name')
    await userEvent.clear(input)
    await userEvent.type(input, ' Acme Capital ')
    await userEvent.tab()
    await waitFor(() => expect(calls).toEqual([{ input: { name: 'Acme Capital' } }]))
    await waitFor(() =>
      expect(queryClient.getQueryData(orpc.me.get.queryOptions().queryKey)).toMatchObject({
        organization: { name: 'Acme Capital' },
      }),
    )
    expect(input).toHaveValue('Acme Capital')
  })

  it('never sends a blank name', async () => {
    const calls = answer('organizations/update', { ...summary, name: 'x' })
    answer('me/get', meAs({ role: 'admin' }))
    renderScreen(<GeneralSection />, { me: meAs({ role: 'admin' }) })
    const input = await screen.findByLabelText('Organization name')
    await userEvent.clear(input)
    await userEvent.tab()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(calls).toHaveLength(0)
  })

  it('puts the saved name back when the rename fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    answer('organizations/update', 500)
    const loads = answer('me/get', meAs())
    renderScreen(<GeneralSection />, { me: meAs({ role: 'owner' }) })
    const input = await screen.findByLabelText('Organization name')
    await waitFor(() => expect(loads).toHaveLength(1))
    await userEvent.type(input, ' Two')
    await userEvent.tab()
    expect(
      await screen.findByText("Couldn't save the organization's settings. Try again."),
    ).toBeInTheDocument()
    await waitFor(() => expect(input).toHaveValue('Acme'))
    expect(loads).toHaveLength(2)
  })

  it('loads the organization fresh when it opens', async () => {
    const loads = answer('me/get', meAs({ organization: { ...summary, name: 'Acme Labs' } }))
    renderScreen(<GeneralSection />, { me: meAs({ role: 'admin' }) })
    await waitFor(() => expect(loads).toHaveLength(1))
    await waitFor(() => expect(screen.getByLabelText('Organization name')).toHaveValue('Acme Labs'))
  })

  it('says so when the organization does not load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    answer('me/get', 500)
    renderScreen(<GeneralSection />, { me: meAs({ role: 'admin' }) })
    expect(
      await screen.findByText("Couldn't load your organization's settings. Reload the page."),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Organization name')).toHaveValue('Acme')
  })
})
