import { QueryClient } from '@tanstack/react-query'
import { isRedirect } from '@tanstack/react-router'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { orpc } from '#/lib/orpc'
import { answer, api, quiet, renderAt } from '#/test/rpc'

import { canCheckout } from './can-checkout'
import { CheckoutPage } from './checkout-page'
import { OFFERS, meOn } from './testing'

const stripe = vi.hoisted(() => {
  const mount = vi.fn()
  const destroy = vi.fn()
  const createEmbeddedCheckoutPage = vi.fn(async () => ({ mount, destroy }))
  return { mount, destroy, createEmbeddedCheckoutPage, loadStripe: vi.fn() }
})
vi.mock('@stripe/stripe-js', () => ({ loadStripe: stripe.loadStripe }))

beforeAll(() => api.listen({ onUnhandledFrame: 'bypass' }))
afterEach(() => {
  api.resetHandlers()
  vi.clearAllMocks()
})
afterAll(() => api.close())

function setup(cycle: 'monthly' | 'yearly' = 'yearly') {
  stripe.loadStripe.mockResolvedValue({
    createEmbeddedCheckoutPage: stripe.createEmbeddedCheckoutPage,
  })
  answer('plans/list', OFFERS)
  const sessions = answer('billing/checkout', {
    clientSecret: 'cs_secret',
    publishableKey: 'pk_test',
  })
  const view = renderAt(<CheckoutPage choice={{ plan: 'team', cycle }} />, {
    me: meOn('free'),
    url: `/app/checkout?plan=team&cycle=${cycle}`,
  })
  return { ...view, sessions }
}

describe('CheckoutPage', () => {
  it('sums up a yearly subscription', async () => {
    setup('yearly')
    const summary = await screen.findByRole('region', { name: 'Order summary' })
    expect(within(summary).getByText('Subscribe to Arrakit Team')).toBeInTheDocument()
    await waitFor(() => expect(within(summary).getAllByText('$480')).toHaveLength(4))
    expect(within(summary).getByText('per year')).toBeInTheDocument()
    expect(within(summary).getByText('Billed yearly')).toBeInTheDocument()
    expect(within(summary).getByText('Calculated from your address')).toBeInTheDocument()
    expect(within(summary).getByText('Total due today')).toBeInTheDocument()
  })

  it('sums up a monthly subscription', async () => {
    setup('monthly')
    const summary = await screen.findByRole('region', { name: 'Order summary' })
    await waitFor(() => expect(within(summary).getAllByText('$50')).toHaveLength(4))
    expect(within(summary).getByText('per month')).toBeInTheDocument()
  })

  it('goes back to Plans', async () => {
    const view = setup()
    await userEvent.click(await screen.findByRole('link', { name: 'Back' }))
    await waitFor(() => expect(view.location()).toBe('/app/plans'))
  })

  it('mounts Stripe Embedded Checkout with the session, and destroys it on leaving', async () => {
    const view = setup()
    await waitFor(() => expect(stripe.mount).toHaveBeenCalled())
    expect(view.sessions[0]?.input).toEqual({ plan: 'team', cycle: 'yearly' })
    expect(stripe.loadStripe).toHaveBeenCalledWith('pk_test')
    expect(stripe.createEmbeddedCheckoutPage).toHaveBeenCalledWith({ clientSecret: 'cs_secret' })
    expect(stripe.mount.mock.calls[0]?.[0]).toHaveAttribute('data-stripe-checkout')
    expect(screen.queryByText('Opening the payment form…')).not.toBeInTheDocument()
    view.unmount()
    expect(stripe.destroy).toHaveBeenCalled()
  })

  it("shows the API's refusal instead of the form", async () => {
    quiet()
    answer('plans/list', OFFERS)
    answer('billing/checkout', [
      409,
      'Your organization is on Pro. Switch plans in Settings → Billing.',
    ])
    renderAt(<CheckoutPage choice={{ plan: 'team', cycle: 'yearly' }} />, {
      me: meOn('pro'),
      url: '/app/checkout?plan=team&cycle=yearly',
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your organization is on Pro. Switch plans in Settings → Billing.',
    )
    expect(stripe.mount).not.toHaveBeenCalled()
  })

  it.each([
    [503, 'Payments are not set up yet.'],
    [502, 'Stripe refused the session: the price is archived.'],
  ])("shows the API's own words for a %i", async (status, message) => {
    quiet()
    answer('plans/list', OFFERS)
    answer('billing/checkout', [status, message])
    renderAt(<CheckoutPage choice={{ plan: 'team', cycle: 'yearly' }} />, {
      me: meOn('free'),
      url: '/app/checkout?plan=team&cycle=yearly',
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(stripe.mount).not.toHaveBeenCalled()
  })

  it('says it could not open the form when Stripe fails', async () => {
    quiet()
    answer('plans/list', OFFERS)
    answer('billing/checkout', 502)
    renderAt(<CheckoutPage choice={{ plan: 'team', cycle: 'yearly' }} />, {
      me: meOn('free'),
      url: '/app/checkout?plan=team&cycle=yearly',
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't open the payment form. Reload the page to try again.",
    )
  })
})

describe('canCheckout', () => {
  const contextFor = (role: 'owner' | 'admin' | 'member') => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(orpc.me.get.queryOptions().queryKey, meOn('free', role))
    return { queryClient }
  }

  it.each(['owner', 'admin'] as const)('lets an %s check out a paid plan', async (role) => {
    await expect(
      canCheckout({ context: contextFor(role), search: { plan: 'pro', cycle: 'monthly' } }),
    ).resolves.toEqual({ choice: { plan: 'pro', cycle: 'monthly' } })
  })

  it('sends a member to Plans', async () => {
    const outcome = await canCheckout({
      context: contextFor('member'),
      search: { plan: 'pro', cycle: 'yearly' },
    }).catch((err: unknown) => err)
    expect(isRedirect(outcome)).toBe(true)
  })

  it.each([
    {},
    { plan: 'free', cycle: 'yearly' },
    { plan: 'enterprise', cycle: 'yearly' },
    { plan: 'internal', cycle: 'yearly' },
    { plan: 'Internal', cycle: 'yearly' },
    { plan: 'pro', cycle: 'weekly' },
    { plan: 'pro' },
  ])('sends %o to Plans', async (search) => {
    const outcome = await canCheckout({ context: contextFor('owner'), search }).catch(
      (err: unknown) => err,
    )
    expect(isRedirect(outcome)).toBe(true)
    expect((outcome as { options: { to: string } }).options.to).toBe('/app/plans')
  })
})
