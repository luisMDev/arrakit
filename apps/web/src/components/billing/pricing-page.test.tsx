import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { SITE_URL } from '#/config'

import { PricingPage } from './pricing-page'
import { OFFERS, answer, api, renderAt } from './testing'

beforeAll(() => api.listen({ onUnhandledFrame: 'bypass' }))
afterEach(() => {
  api.resetHandlers()
  vi.restoreAllMocks()
})
afterAll(() => api.close())

const card = (name: string) => screen.getByRole('article', { name })

function setup() {
  answer('plans/list', OFFERS)
  return renderAt(<PricingPage />, { me: null, url: '/pricing' })
}

describe('PricingPage', () => {
  it('shows every sold plan to a visitor, yearly prices struck from monthly', async () => {
    setup()
    await screen.findByRole('article', { name: 'Team' })
    expect(screen.getAllByRole('article')).toHaveLength(3)
    expect(within(card('Pro')).getByText('$16')).toBeInTheDocument()
    expect(within(card('Pro')).getByText('$20')).toHaveClass('line-through')
    expect(within(card('Team')).getByText('$40')).toBeInTheDocument()
    expect(within(card('Free')).getByText('No card needed')).toBeInTheDocument()
    expect(within(card('Pro')).getByText('Billed yearly')).toBeInTheDocument()
  })

  it('switches to monthly, showing the yearly saving on the switch', async () => {
    setup()
    await screen.findByRole('article', { name: 'Team' })
    const cycle = screen.getByRole('group', { name: 'Billing' })
    expect(within(cycle).getByRole('button', { name: /Yearly/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(cycle).getByText('Save 20%')).toBeInTheDocument()
    await userEvent.click(within(cycle).getByRole('button', { name: 'Monthly' }))
    expect(within(card('Pro')).getByText('$20')).not.toHaveClass('line-through')
    expect(within(card('Pro')).getByText('Billed monthly')).toBeInTheDocument()
  })

  it('lists the seats, then what each plan adds', async () => {
    setup()
    await screen.findByRole('article', { name: 'Team' })
    expect(within(card('Free')).getByText('1 seat')).toBeInTheDocument()
    expect(within(card('Pro')).getByText('Up to 3 seats')).toBeInTheDocument()
    expect(within(card('Pro')).getByText('Everything in Free, plus')).toBeInTheDocument()
    expect(within(card('Team')).getByText('Team features')).toBeInTheDocument()
  })

  it('links every plan to sign up with the cycle shown, and the header to sign in', async () => {
    setup()
    await screen.findByRole('article', { name: 'Team' })
    expect(within(card('Free')).getByRole('link', { name: 'Start free' })).toHaveAttribute(
      'href',
      '/signup',
    )
    expect(within(card('Pro')).getByRole('link', { name: 'Get Pro' })).toHaveAttribute(
      'href',
      '/signup?plan=pro&cycle=yearly',
    )
    expect(within(card('Team')).getByRole('link', { name: 'Get Team' })).toHaveAttribute(
      'href',
      '/signup?plan=team&cycle=yearly',
    )
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/signin')
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', SITE_URL)
  })

  it('says so when the plans cannot load', async () => {
    answer('plans/list', 500)
    renderAt(<PricingPage />, { me: null, url: '/pricing' })
    await waitFor(() =>
      expect(screen.getByText("Couldn't load the plans. Reload the page.")).toBeInTheDocument(),
    )
  })
})
