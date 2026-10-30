import type { OrganizationSummary } from '@arrakit/contract'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import '#/i18n'

import type { ChoiceSearch } from '#/lib/checkout-choice'

import { type OnboardingApi, OnboardingApiContext } from './onboarding-api'
import { ProfilePage } from './profile-page'

const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (message: string) => toastError(message) } }))

const ORG: OrganizationSummary = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  name: 'Acme',
  slug: 'acme',
  plan: 'free',
}

function fakeApi() {
  return {
    create: vi.fn<OnboardingApi['create']>(async () => ORG),
    skip: vi.fn<OnboardingApi['skip']>(async () => ORG),
    currentOrganization: vi.fn<OnboardingApi['currentOrganization']>(async () => null),
  }
}

function renderPage(api: OnboardingApi, search: ChoiceSearch = {}) {
  const onDone = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <OnboardingApiContext.Provider value={api}>
        <ProfilePage search={search} onDone={onDone} />
      </OnboardingApiContext.Provider>
    </QueryClientProvider>,
  )
  return onDone
}

const next = () => screen.getByRole('button', { name: 'Next' })
const skip = () => screen.getByRole('button', { name: 'Skip' })
const terms = (hidden = false) => screen.getByRole('checkbox', { name: 'I agree to the', hidden })

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)

beforeEach(() => toastError.mockReset())

describe('ProfilePage', () => {
  it('asks only for a name, an organization and the terms', () => {
    renderPage(fakeApi())
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
    renderPage(fakeApi())
    expect(next()).toBeDisabled()
    expect(skip()).toBeEnabled()
    await userEvent.click(terms())
    expect(next()).toBeEnabled()
  })

  it('sends the trimmed name and organization on Next and goes to /app', async () => {
    const api = fakeApi()
    const onDone = renderPage(api)
    await userEvent.type(screen.getByRole('textbox', { name: 'Your name' }), '  Ana Ibarra ')
    await userEvent.type(screen.getByRole('textbox', { name: 'Organization' }), ' Seaya ')
    await userEvent.click(terms())
    await userEvent.click(next())
    expect(api.create).toHaveBeenCalledWith({ name: 'Seaya', personName: 'Ana Ibarra' })
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ to: '/app' }))
  })

  it('allows blank fields', async () => {
    const api = fakeApi()
    renderPage(api)
    await userEvent.click(terms())
    await userEvent.click(next())
    expect(api.create).toHaveBeenCalledWith({ name: '', personName: '' })
  })

  it('skips without asking anything and goes to /app', async () => {
    const api = fakeApi()
    const onDone = renderPage(api)
    await userEvent.click(skip())
    expect(api.skip).toHaveBeenCalledWith()
    expect(api.create).not.toHaveBeenCalled()
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ to: '/app' }))
  })

  it('goes to checkout with a paid plan', async () => {
    const onDone = renderPage(fakeApi(), { plan: 'team', cycle: 'monthly' })
    await userEvent.click(skip())
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith({
        to: '/app/checkout',
        search: { plan: 'team', cycle: 'monthly' },
      }),
    )
  })

  it('continues after a 409 when the person now has an organization', async () => {
    const api = fakeApi()
    api.create.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }))
    api.currentOrganization.mockResolvedValueOnce({ name: 'Acme', slug: 'acme' })
    const onDone = renderPage(api)
    await userEvent.click(terms())
    await userEvent.click(next())
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ to: '/app' }))
    expect(toastError).not.toHaveBeenCalled()
  })

  it('toasts a failed Next and lets the person retry', async () => {
    const api = fakeApi()
    api.create.mockRejectedValueOnce(new Error('down'))
    const onDone = renderPage(api)
    await userEvent.click(terms())
    await userEvent.click(next())
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Couldn't save your organization. Check its name and try again.",
      ),
    )
    expect(next()).toBeEnabled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('toasts a failed Skip and lets the person retry', async () => {
    const api = fakeApi()
    api.skip.mockRejectedValueOnce(new Error('down'))
    const onDone = renderPage(api)
    await userEvent.click(skip())
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Couldn't skip this step. Try again."),
    )
    expect(skip()).toBeEnabled()
    await userEvent.click(skip())
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ to: '/app' }))
    expect(api.skip).toHaveBeenCalledTimes(2)
  })

  it('sends one request at a time', async () => {
    const api = fakeApi()
    let finish!: (org: OrganizationSummary) => void
    api.skip.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    renderPage(api)
    await userEvent.click(terms())
    await userEvent.click(skip())
    expect(skip()).toBeDisabled()
    expect(next()).toBeDisabled()
    await userEvent.click(skip())
    expect(api.skip).toHaveBeenCalledTimes(1)
    await act(async () => finish(ORG))
  })

  it.each([
    ['Terms', 'The Terms will be published here before launch.'],
    ['Privacy Policy', 'The Privacy Policy will be published here before launch.'],
  ])('opens %s without ticking the box and keeps its text while closing', async (name, body) => {
    renderPage(fakeApi())
    await userEvent.click(screen.getByRole('button', { name }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(name)
    expect(dialog).toHaveTextContent(body)
    expect(terms(true)).not.toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    const closing = screen.queryByRole('dialog', { hidden: true })
    if (closing) expect(closing).toHaveTextContent(body)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(terms()).not.toBeChecked()
  })
})
