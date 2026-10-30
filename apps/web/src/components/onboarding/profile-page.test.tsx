import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import '#/i18n'
import { renderWithQueries } from '#/components/auth/testing'
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

function renderPage(search: ChoiceSearch = {}) {
  const onDone = vi.fn()
  renderWithQueries(<ProfilePage search={search} onDone={onDone} />)
  return onDone
}

const next = () => screen.getByRole('button', { name: 'Next' })
const skip = () => screen.getByRole('button', { name: 'Skip' })
const terms = (hidden = false) => screen.getByRole('checkbox', { name: 'I agree to the', hidden })

describe('ProfilePage', () => {
  it('asks only for a name, an organization and the terms', () => {
    renderPage()
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
    renderPage()
    expect(next()).toBeDisabled()
    expect(skip()).toBeEnabled()
    await userEvent.click(terms())
    expect(next()).toBeEnabled()
  })

  it('sends the trimmed name and organization on Next and goes to /app', async () => {
    const created = answer('onboarding/create', ORG)
    const onDone = renderPage()
    await userEvent.type(screen.getByRole('textbox', { name: 'Your name' }), '  Ana Ibarra ')
    await userEvent.type(screen.getByRole('textbox', { name: 'Organization' }), ' Seaya ')
    await userEvent.click(terms())
    await userEvent.click(next())
    await waitFor(() =>
      expect(created).toEqual([
        { input: { name: 'Seaya', personName: 'Ana Ibarra', termsAccepted: true } },
      ]),
    )
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ to: '/app' }))
    expect(activated).toEqual([{ input: { organizationId: ORG.id } }])
  })

  it('allows blank fields', async () => {
    const created = answer('onboarding/create', ORG)
    renderPage()
    await userEvent.click(terms())
    await userEvent.click(next())
    await waitFor(() =>
      expect(created).toEqual([{ input: { name: '', personName: '', termsAccepted: true } }]),
    )
  })

  it('skips without asking anything and goes to /app', async () => {
    const skipped = answer('onboarding/skip', ORG)
    const created = answer('onboarding/create', ORG)
    const onDone = renderPage()
    await userEvent.click(skip())
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ to: '/app' }))
    expect(skipped).toHaveLength(1)
    expect(created).toEqual([])
  })

  it('goes to checkout with a paid plan', async () => {
    answer('onboarding/skip', ORG)
    const onDone = renderPage({ plan: 'team', cycle: 'monthly' })
    await userEvent.click(skip())
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith({
        to: '/app/checkout',
        search: { plan: 'team', cycle: 'monthly' },
      }),
    )
  })

  it('continues after a lost answer when the person now has an organization', async () => {
    answer('onboarding/create', 502)
    answer('me/get', meAs())
    const onDone = renderPage()
    await userEvent.click(terms())
    await userEvent.click(next())
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ to: '/app' }))
    expect(activated).toEqual([{ input: { organizationId: meAs().organization!.id } }])
    expect(console.error).not.toHaveBeenCalled()
  })

  it('toasts a failed Next and lets the person retry', async () => {
    answer('onboarding/create', 500)
    const onDone = renderPage()
    await userEvent.click(terms())
    await userEvent.click(next())
    expect(
      await screen.findByText("Couldn't save your organization. Check its name and try again."),
    ).toBeInTheDocument()
    expect(next()).toBeEnabled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('toasts a failed Skip and lets the person retry', async () => {
    const skipped = answer('onboarding/skip', 500, ORG)
    const onDone = renderPage()
    await userEvent.click(skip())
    expect(await screen.findByText("Couldn't skip this step. Try again.")).toBeInTheDocument()
    expect(skip()).toBeEnabled()
    await userEvent.click(skip())
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ to: '/app' }))
    expect(skipped).toHaveLength(2)
  })

  it('sends one request at a time', async () => {
    let finish!: (org: typeof ORG) => void
    const skipped = answer('onboarding/skip', () => new Promise((resolve) => (finish = resolve)))
    const onDone = renderPage()
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
  ])('links %s to the published page in a new tab', (name, href) => {
    renderPage()
    const link = screen.getByRole('link', { name })
    expect(link).toHaveAttribute('href', href)
    expect(link).toHaveAttribute('target', '_blank')
    expect(terms()).not.toBeChecked()
  })
})
