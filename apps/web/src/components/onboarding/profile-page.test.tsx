import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import '#/i18n'
import { renderAt } from '#/test/rpc'
import { answer, answerAuth, meAs, quiet, setupTestApi } from '#/test/rpc'
import type { ChoiceSearch } from '#/lib/checkout-choice'

import { ProfilePage } from './profile-page'

const ORG = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  name: 'Acme',
  slug: 'acme',
  plan: 'free',
} as const

const NO_ORGANIZATION = meAs({ organization: null, role: null, plan: null, seats: null })

setupTestApi()
let activated: { input: Record<string, unknown> }[]
beforeEach(() => {
  quiet()
  answer('me/get', NO_ORGANIZATION)
  activated = answerAuth('organization/set-active', ORG)
})

async function renderPage(search: ChoiceSearch = {}) {
  const onDone = vi.fn()
  const { router } = renderAt(<ProfilePage search={search} onDone={onDone} />, {
    me: null,
    url: '/profile',
  })
  await act(() => router.load())
  return onDone
}

const next = () => screen.getByRole('button', { name: 'Next' })
const skip = () => screen.getByRole('button', { name: 'Skip' })
const terms = (hidden = false) => screen.getByRole('checkbox', { name: 'I agree to the', hidden })

describe('ProfilePage', () => {
  it('asks only for a name, an organization and the terms', async () => {
    await renderPage()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Tell us about your organization.' }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('textbox')).toHaveLength(2)
    expect(screen.getByRole('textbox', { name: 'Your name' })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: 'Your name' })).toHaveAttribute(
      'autocomplete',
      'name',
    )
    expect(screen.getByRole('textbox', { name: 'Organization' })).toHaveAttribute(
      'autocomplete',
      'organization',
    )
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  it('keeps Next disabled until the terms are ticked', async () => {
    await renderPage()
    expect(next()).toBeDisabled()
    expect(skip()).toBeEnabled()
    await userEvent.click(terms())
    expect(next()).toBeEnabled()
  })

  it('names the person, creates the organization with the terms on Next and goes to /app', async () => {
    const named = answerAuth('update-user', { status: true })
    const created = answerAuth('organization/create', ORG)
    const onDone = await renderPage()
    await userEvent.type(screen.getByRole('textbox', { name: 'Your name' }), '  Ana Ibarra ')
    await userEvent.type(screen.getByRole('textbox', { name: 'Organization' }), ' Seaya ')
    await userEvent.click(terms())
    await userEvent.click(next())
    await waitFor(() =>
      expect(created).toEqual([{ input: { name: 'Seaya', slug: 'pending', termsAccepted: true } }]),
    )
    expect(named).toEqual([{ input: { name: 'Ana Ibarra' } }])
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ to: '/app' }))
    expect(activated).toEqual([])
  })

  it('allows blank fields, keeping the person name', async () => {
    const named = answerAuth('update-user', { status: true })
    const created = answerAuth('organization/create', ORG)
    await renderPage()
    await userEvent.click(terms())
    await userEvent.click(next())
    await waitFor(() =>
      expect(created).toEqual([{ input: { name: '', slug: 'pending', termsAccepted: true } }]),
    )
    expect(named).toEqual([])
  })

  it('sends nothing for a name past 100 characters', async () => {
    const created = answerAuth('organization/create', ORG)
    await renderPage()
    await userEvent.click(screen.getByRole('textbox', { name: 'Your name' }))
    await userEvent.paste('a'.repeat(101))
    await userEvent.click(terms())
    await userEvent.click(next())
    expect(
      await screen.findByText("Couldn't save your organization. Check its name and try again."),
    ).toBeInTheDocument()
    expect(created).toEqual([])
  })

  it('skips without asking anything or recording terms, and goes to /app', async () => {
    const named = answerAuth('update-user', { status: true })
    const created = answerAuth('organization/create', ORG)
    const onDone = await renderPage()
    await userEvent.type(screen.getByRole('textbox', { name: 'Your name' }), 'Ana')
    await userEvent.click(terms())
    await userEvent.click(skip())
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ to: '/app' }))
    expect(created).toEqual([{ input: { name: '', slug: 'pending' } }])
    expect(named).toEqual([])
  })

  it('goes to checkout with a paid plan', async () => {
    answerAuth('organization/create', ORG)
    const onDone = await renderPage({ plan: 'team', cycle: 'monthly' })
    await userEvent.click(skip())
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith({
        to: '/app/checkout',
        search: { plan: 'team', cycle: 'monthly' },
      }),
    )
  })

  it('continues after a lost answer when the person now has an organization', async () => {
    answerAuth('organization/create', 502)
    answer('me/get', meAs())
    const onDone = await renderPage()
    await userEvent.click(terms())
    await userEvent.click(next())
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ to: '/app' }))
    expect(activated).toEqual([])
    expect(console.error).not.toHaveBeenCalled()
  })

  it('toasts a failed Next and lets the person retry', async () => {
    answerAuth('organization/create', 500)
    const onDone = await renderPage()
    await userEvent.click(terms())
    await userEvent.click(next())
    expect(
      await screen.findByText("Couldn't save your organization. Check its name and try again."),
    ).toBeInTheDocument()
    expect(next()).toBeEnabled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('toasts a failed Skip and lets the person retry', async () => {
    const skipped = answerAuth('organization/create', 500, ORG)
    const onDone = await renderPage()
    await userEvent.click(skip())
    expect(await screen.findByText("Couldn't skip this step. Try again.")).toBeInTheDocument()
    expect(skip()).toBeEnabled()
    await userEvent.click(skip())
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ to: '/app' }))
    expect(skipped).toHaveLength(2)
  })

  it('sends one request at a time', async () => {
    let finish!: (org: typeof ORG) => void
    const skipped = answerAuth(
      'organization/create',
      () => new Promise((resolve) => (finish = resolve)),
    )
    const onDone = await renderPage()
    await userEvent.click(terms())
    await userEvent.click(skip())
    expect(skip()).toBeDisabled()
    expect(next()).toBeDisabled()
    await userEvent.click(skip())
    await waitFor(() => expect(skipped).toHaveLength(1))
    await act(async () => finish(ORG))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ to: '/app' }))
  })

  it.each([
    ['Terms', 'https://example.com/terms'],
    ['Privacy Policy', 'https://example.com/privacy'],
  ])('links %s to the published page in a new tab', async (name, href) => {
    await renderPage()
    const link = screen.getByRole('link', { name })
    expect(link).toHaveAttribute('href', href)
    expect(link).toHaveAttribute('target', '_blank')
    expect(terms()).not.toBeChecked()
  })
})
