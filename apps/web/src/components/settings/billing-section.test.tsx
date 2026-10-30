import type { BillingView } from '@arrakit/contract'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { answer, api, billingOf, meOn, renderAt } from '#/components/billing/testing'
import { usageFixture } from '#/components/usage/fixtures'

import { BillingSection, type BillingSectionProps } from './billing-section'

beforeAll(() => api.listen({ onUnhandledFrame: 'bypass' }))
afterEach(() => {
  api.resetHandlers()
  vi.restoreAllMocks()
})
afterAll(() => api.close())

const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => undefined)

function row(label: string) {
  const term = screen.getByText(label, { selector: 'dt' })
  return term.parentElement as HTMLElement
}

async function setup(billing: BillingView | number, props: BillingSectionProps = {}) {
  answer('billing/get', billing)
  answer('usage/get', usageFixture())
  const view = renderAt(<BillingSection {...props} />, {
    me: meOn(typeof billing === 'number' ? 'pro' : billing.plan),
    url: '/app/billing',
  })
  if (typeof billing !== 'number') await screen.findByText('Plan', { selector: 'dt' })
  return view
}

describe('Settings > Billing', () => {
  it('shows the plan, its renewal, the next invoice and what it includes', async () => {
    await setup(billingOf())
    expect(within(row('Plan')).getByText('Pro · yearly')).toBeInTheDocument()
    expect(within(row('Plan')).getByRole('link', { name: 'Switch plan' })).toHaveAttribute(
      'href',
      '/app/plans',
    )
    expect(within(row('Plan')).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(within(row('Renews on')).getByText('Oct 4, 2027')).toBeInTheDocument()
    expect(within(row('Next invoice')).getByText('$192')).toBeInTheDocument()
    expect(within(row('Includes')).getByText('Up to 3 seats')).toBeInTheDocument()
    expect(within(row('Includes')).getByRole('link', { name: 'See pricing' })).toHaveAttribute(
      'href',
      '/pricing',
    )
    expect(screen.queryByText('Ends on', { selector: 'dt' })).not.toBeInTheDocument()
  })

  it('shows the payment details with Edit buttons', async () => {
    await setup(billingOf())
    expect(within(row('Payment')).getByText('Visa ending 4242')).toBeInTheDocument()
    expect(within(row('Billing email')).getByText('finance@acme.com')).toBeInTheDocument()
    expect(within(row('Invoice to')).getByText('Acme SL')).toBeInTheDocument()
    expect(within(row('Tax ID')).getByText('ESB99286321')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(4)
  })

  it('lists the invoices newest first, with Download only when there is a PDF', async () => {
    await setup(billingOf())
    const items = within(screen.getByRole('list', { name: 'Invoices' })).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Oct 4, 2026')
    expect(items[0]).toHaveTextContent('$192 · Paid')
    expect(within(items[0]!).getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      'https://pay.stripe.test/in_2.pdf',
    )
    expect(items[1]).toHaveTextContent('$14.99 · Payment failed')
    expect(within(items[1]!).queryByRole('link')).not.toBeInTheDocument()
  })

  it('bills a Free organization nothing', async () => {
    await setup(
      billingOf({
        plan: 'free',
        cycle: null,
        renewsOn: null,
        nextInvoice: null,
        seats: 1,
        card: null,
        billingEmail: null,
        taxId: null,
        invoiceTo: 'Acme',
        invoices: [],
      }),
    )
    expect(within(row('Plan')).getByText('Free')).toBeInTheDocument()
    expect(screen.queryByText('Renews on', { selector: 'dt' })).not.toBeInTheDocument()
    expect(screen.queryByText('Next invoice', { selector: 'dt' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(within(row('Payment')).getByText('No card yet')).toBeInTheDocument()
    expect(within(row('Tax ID')).getByText('Not set')).toBeInTheDocument()
    expect(screen.getByText('No invoices yet.')).toBeInTheDocument()
  })

  it('lets a Free organization that paid before edit its details', async () => {
    await setup(billingOf({ plan: 'free', cycle: null, renewsOn: null, nextInvoice: null }))
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(4)
  })

  it('offers an Internal organization neither Cancel nor Edit', async () => {
    await setup(billingOf({ plan: 'internal', cycle: null, renewsOn: null, seats: 100 }))
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('shows a move down waiting for the renewal', async () => {
    await setup(
      billingOf({
        plan: 'team',
        scheduledChange: { plan: 'pro', cycle: 'monthly', on: '2027-10-04' },
      }),
    )
    expect(within(row('Then')).getByText('Pro · monthly from Oct 4, 2027')).toBeInTheDocument()
  })

  it('cancels the plan, then keeps it', async () => {
    const cancelled = billingOf({ renewsOn: null, endsOn: '2027-10-04', nextInvoice: null })
    const cancels = answer('billing/cancel', cancelled)
    const resumes = answer('billing/resume', billingOf())
    await setup(billingOf())
    await userEvent.click(within(row('Plan')).getByRole('button', { name: 'Cancel' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel your plan?' })
    expect(dialog).toHaveTextContent(
      'Your organization keeps Pro until Oct 4, 2027, then moves to Free.',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel plan' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(cancels).toHaveLength(1)
    expect(within(row('Ends on')).getByText('Oct 4, 2027')).toBeInTheDocument()
    expect(screen.queryByText('Renews on', { selector: 'dt' })).not.toBeInTheDocument()
    expect(screen.queryByText('Next invoice', { selector: 'dt' })).not.toBeInTheDocument()
    expect(within(row('Plan')).queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    await userEvent.click(within(row('Plan')).getByRole('button', { name: 'Keep my plan' }))
    await waitFor(() =>
      expect(screen.getByText('Renews on', { selector: 'dt' })).toBeInTheDocument(),
    )
    expect(resumes).toHaveLength(1)
  })

  it('keeps the plan when the cancel dialog is closed', async () => {
    const cancels = answer('billing/cancel', billingOf())
    await setup(billingOf())
    await userEvent.click(within(row('Plan')).getByRole('button', { name: 'Cancel' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep my plan' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(cancels).toHaveLength(0)
  })

  it('says so when the plan cannot be cancelled', async () => {
    quiet()
    answer('billing/cancel', 502)
    await setup(billingOf())
    await userEvent.click(within(row('Plan')).getByRole('button', { name: 'Cancel' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel plan' }))
    expect(await screen.findByText("Couldn't cancel the plan. Try again.")).toBeInTheDocument()
  })

  it.each([
    ['Payment', 'payment'],
    ['Billing email', 'details'],
    ['Invoice to', 'details'],
    ['Tax ID', 'details'],
  ] as const)('opens the portal from %s on %s', async (label, target) => {
    const openPortal = vi.fn(async () => ({ url: 'https://billing.stripe.test/p/1' }))
    const redirect = vi.fn()
    await setup(billingOf(), { openPortal, redirect })
    await userEvent.click(within(row(label)).getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(redirect).toHaveBeenCalledWith('https://billing.stripe.test/p/1'))
    expect(openPortal).toHaveBeenCalledWith(target)
  })

  it('says so when the portal cannot open', async () => {
    quiet()
    const openPortal = vi.fn(async () => Promise.reject(new Error('502')))
    await setup(billingOf(), { openPortal, redirect: vi.fn() })
    await userEvent.click(within(row('Payment')).getByRole('button', { name: 'Edit' }))
    expect(
      await screen.findByText("Couldn't open Stripe. Try again in a minute."),
    ).toBeInTheDocument()
  })

  it('says so when billing cannot load', async () => {
    quiet()
    await setup(502)
    expect(await screen.findByText("Couldn't load billing. Reload the page.")).toBeInTheDocument()
  })

  it('embeds the usage cards with Add credits', async () => {
    await setup(billingOf())
    expect(await screen.findByRole('button', { name: 'Add credits' })).toBeInTheDocument()
  })
})
