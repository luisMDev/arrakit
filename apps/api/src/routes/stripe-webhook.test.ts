import { APP_NAME } from '@arrakit/emails'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { joinAs, ownerOf } from '../testing/people'
import { type TestApp, createTestApp } from '../testing/app'
import { type FakeStripe, fakeStripe } from '../testing/fake-stripe'

const WEB = 'https://app.example.test'

function failingMail(t: TestApp) {
  const logged = t.errorLog()
  vi.spyOn(t.deps.mailer, 'send').mockRejectedValue(new Error('[mail] Resend refused: 500'))
  return logged
}

describe('POST /api/webhooks/stripe', () => {
  let t: TestApp
  let stripe: FakeStripe
  let headers: Headers
  let organizationId: string

  const me = async () => t.client(headers).me.get()
  const subscription = (status: string) => ({
    id: 'sub_alder',
    customerId: 'cus_alder',
    organizationId,
    status,
    lookupKey: 'pro_yearly',
  })
  const event = () => ({ subscriptionId: 'sub_alder', organizationId })

  beforeAll(async () => {
    stripe = fakeStripe()
    t = await createTestApp({ stripe, env: { WEB_URL: WEB } })
    const lucia = await ownerOf(t, 'lucia@alder.vc', 'free')
    headers = lucia.headers
    organizationId = lucia.organizationId
    stripe.subscribe(subscription('active'))
  })
  afterAll(async () => {
    vi.restoreAllMocks()
    await t.close()
  })

  it('refuses a forged signature with 401, the plan untouched', async () => {
    expect((await t.webhook(event(), 't=1,v1=forged')).status).toBe(401)
    expect((await me()).plan).toBe('free')
  })

  it('refuses a delivery with no Stripe-Signature with 401', async () => {
    expect((await t.webhook(event(), null)).status).toBe(401)
    expect((await me()).plan).toBe('free')
  })

  it('puts the organization on Pro once its subscription is paid', async () => {
    expect((await t.webhook(event())).status).toBe(204)
    expect(await me()).toMatchObject({ plan: 'pro', seats: 3 })
  })

  it('lands on the same state when Stripe delivers it again', async () => {
    const before = await me()
    expect((await t.webhook(event())).status).toBe(204)
    expect(await me()).toEqual(before)
  })

  it('puts the organization back on Free once the subscription is cancelled', async () => {
    stripe.subscribe(subscription('canceled'))
    expect((await t.webhook(event())).status).toBe(204)
    expect((await me()).plan).toBe('free')
  })

  it('answers 204 to an event the app ignores, changing nothing', async () => {
    const before = await me()
    expect((await t.webhook({})).status).toBe(204)
    expect(await me()).toEqual(before)
  })

  it('never changes the plan on an invoice event', async () => {
    stripe.subscribe(subscription('active'))
    stripe.bill('cus_alder', {
      subscription: {
        status: 'active',
        lookupKey: 'pro_yearly',
        periodEnd: Date.UTC(2027, 9, 4) / 1000,
        cancelAtPeriodEnd: false,
        amount: { amount: 143_000, currency: 'usd' },
        scheduled: null,
      },
      customer: { email: 'bill@alder.vc', name: null, taxId: null, card: null },
      invoices: [],
    })
    const before = await me()
    const amount = { amount: 143_000, currency: 'usd' }
    const invoice = { kind: 'invoice-upcoming', subscriptionId: 'sub_alder', amount }
    expect((await t.webhook(invoice)).status).toBe(204)
    expect(await me()).toEqual(before)
    stripe.subscribe(subscription('canceled'))
  })

  it('answers 500 when Stripe cannot be read, so Stripe delivers again', async () => {
    stripe.failNext('subscription', new Error('Stripe is down'))
    expect((await t.webhook(event())).status).toBe(500)
  })
})

describe('POST /api/webhooks/stripe: emails', () => {
  let t: TestApp
  let stripe: FakeStripe

  beforeAll(async () => {
    stripe = fakeStripe()
    t = await createTestApp({ stripe, env: { WEB_URL: WEB } })
  })
  afterAll(() => t.close())
  afterEach(() => vi.restoreAllMocks())

  async function organizationPaying(domain: string, lookupKey: string) {
    const person = await ownerOf(t, `owner@${domain}`, 'free')
    const subscriptionId = `sub_${domain}`
    const customerId = `cus_${domain}`
    stripe.subscribe({
      id: subscriptionId,
      customerId,
      organizationId: person.organizationId,
      status: 'active',
      lookupKey,
      periodEnd: Date.UTC(2027, 9, 4) / 1000,
    })
    stripe.bill(customerId, {
      subscription: {
        status: 'active',
        lookupKey,
        periodEnd: Date.UTC(2027, 9, 4) / 1000,
        cancelAtPeriodEnd: false,
        amount: { amount: 143_000, currency: 'usd' },
        scheduled: null,
      },
      customer: {
        email: `bill@${domain}`,
        name: null,
        taxId: null,
        card: { brand: 'visa', last4: '4242' },
      },
      invoices: [
        {
          id: 'in_2',
          created: Date.UTC(2026, 9, 4) / 1000,
          total: { amount: 143_000, currency: 'usd' },
          status: 'paid',
          pdfUrl: 'https://pay.stripe.test/in_2.pdf',
        },
      ],
    })
    const event = () => ({ subscriptionId, organizationId: person.organizationId })
    const moveTo = (key: string) => {
      const held = stripe.subscriptions.get(subscriptionId)!
      stripe.subscribe({ ...held, lookupKey: key })
    }
    const plan = async () => (await t.client(person.headers).me.get()).plan
    return { ...person, customerId, subscriptionId, event, moveTo, plan }
  }

  const mailsAfter = () => {
    const from = t.sent.length
    return () => t.sent.slice(from)
  }

  const paidInvoice = (subscriptionId: string) => ({
    kind: 'invoice-paid',
    subscriptionId,
    amount: { amount: 143_000, currency: 'usd' },
    invoiceUrl: 'https://pay.stripe.test/in_3.pdf',
  })

  async function organizationWithTeam(domain: string) {
    const organization = await organizationPaying(domain, 'pro_yearly')
    await t.webhook(organization.event())
    await joinAs(t, organization.organizationId, `admin@${domain}`, 'admin')
    await joinAs(t, organization.organizationId, `member@${domain}`, 'member')
    return organization
  }

  describe('the receipt', () => {
    it('goes to the billing email once an invoice of the subscription is paid', async () => {
      const organization = await organizationPaying('ash.vc', 'pro_yearly')
      const mails = mailsAfter()
      expect((await t.webhook(paidInvoice(organization.subscriptionId))).status).toBe(204)
      expect(mails().map((mail) => mail.to)).toEqual(['bill@ash.vc'])
      const [mail] = mails()
      expect(mail?.subject).toBe(`You're on ${APP_NAME} Pro`)
      expect(mail?.text).toContain('Pro · yearly')
      expect(mail?.text).toContain('$1,430 · Visa ending 4242')
      expect(mail?.text).toContain('https://pay.stripe.test/in_3.pdf')
    })

    it('names the plan the subscription is on now, after a move', async () => {
      const organization = await organizationPaying('cedar.vc', 'pro_yearly')
      organization.moveTo('team_yearly')
      const mails = mailsAfter()
      expect((await t.webhook(paidInvoice(organization.subscriptionId))).status).toBe(204)
      expect(mails().map((mail) => mail.subject)).toEqual([`You're on ${APP_NAME} Team`])
    })

    it('links the billing page when the invoice has no page of its own', async () => {
      const organization = await organizationPaying('fir.vc', 'pro_monthly')
      const mails = mailsAfter()
      const invoice = { ...paidInvoice(organization.subscriptionId), invoiceUrl: null }
      expect((await t.webhook(invoice)).status).toBe(204)
      expect(mails()[0]?.text).toContain(`${WEB}/app/billing`)
    })

    it('is not sent for a subscription change or a paid invoice of nothing', async () => {
      const organization = await organizationPaying('elm.vc', 'team_yearly')
      const mails = mailsAfter()
      expect((await t.webhook(organization.event())).status).toBe(204)
      const free = {
        ...paidInvoice(organization.subscriptionId),
        amount: { amount: 0, currency: 'usd' },
      }
      expect((await t.webhook(free)).status).toBe(204)
      expect(mails()).toEqual([])
    })

    it('failing to send still answers 204, logging the organization but no address or body', async () => {
      const organization = await organizationPaying('ivy.vc', 'pro_yearly')
      const lines = failingMail(t)
      expect((await t.webhook(paidInvoice(organization.subscriptionId))).status).toBe(204)
      expect(lines()).toHaveLength(1)
      expect(lines()[0]).toMatchObject({
        msg: 'billing email not sent',
        organizationId: organization.organizationId,
        mail: 'receipt',
      })
      const line = JSON.stringify(lines()[0])
      expect(line).not.toContain('ivy.vc')
      expect(line).not.toContain('<html')
    })
  })

  describe('a failed charge', () => {
    const failed = (subscriptionId: string, nextAttempt: number | null) => ({
      kind: 'invoice-failed',
      subscriptionId,
      amount: { amount: 143_000, currency: 'usd' },
      nextAttempt,
    })
    const inThreeDays = () => Math.floor(Date.now() / 1000) + 3 * 86_400

    it('emails the billing email, the owner and the admins, never a member, the plan untouched', async () => {
      const organization = await organizationWithTeam('larch.vc')
      const mails = mailsAfter()
      expect((await t.webhook(failed(organization.subscriptionId, inThreeDays()))).status).toBe(204)
      expect(mails().map((mail) => mail.to)).toEqual([
        'bill@larch.vc',
        'owner@larch.vc',
        'admin@larch.vc',
      ])
      for (const mail of mails()) {
        expect(mail.subject).toBe("Your payment didn't go through")
        expect(mail.text).toContain('$1,430')
        expect(mail.text).toContain('Visa ending 4242')
        expect(mail.text).toContain('3 days')
        expect(mail.text).toContain(`${WEB}/app/billing`)
      }
      expect(await organization.plan()).toBe('pro')
    })

    it('emails the owner once when the owner is the billing email', async () => {
      const organization = await organizationWithTeam('maple.vc')
      const billing = await stripe.billing(organization.customerId, organization.subscriptionId)
      stripe.bill(organization.customerId, {
        ...billing,
        customer: billing.customer && { ...billing.customer, email: 'Owner@Maple.vc' },
      })
      const mails = mailsAfter()
      expect((await t.webhook(failed(organization.subscriptionId, inThreeDays()))).status).toBe(204)
      expect(mails().map((mail) => mail.to)).toEqual(['Owner@Maple.vc', 'admin@maple.vc'])
    })

    it("sends nothing on Stripe's last try, with no next attempt", async () => {
      const organization = await organizationWithTeam('oak.vc')
      const mails = mailsAfter()
      expect((await t.webhook(failed(organization.subscriptionId, null))).status).toBe(204)
      expect(mails()).toEqual([])
    })

    it('failing to send still answers 204, logging the organization but no address', async () => {
      const organization = await organizationWithTeam('pine.vc')
      const lines = failingMail(t)
      expect((await t.webhook(failed(organization.subscriptionId, inThreeDays()))).status).toBe(204)
      expect(lines()).toHaveLength(3)
      for (const entry of lines()) {
        expect(entry).toMatchObject({
          msg: 'billing email not sent',
          organizationId: organization.organizationId,
          mail: 'failed payment',
        })
        const line = JSON.stringify(entry)
        expect(line).not.toContain('pine.vc')
      }
    })
  })

  describe('back on Free after the failed retries', () => {
    const cancel = (subscriptionId: string, cancellationReason: string) => {
      const held = stripe.subscriptions.get(subscriptionId)!
      stripe.subscribe({ ...held, status: 'canceled', cancellationReason })
    }

    it('emails the billing email, the owner and the admins, never a member', async () => {
      const organization = await organizationWithTeam('alder-tree.vc')
      cancel(organization.subscriptionId, 'payment_failed')
      const mails = mailsAfter()
      expect((await t.webhook(organization.event())).status).toBe(204)
      expect(await organization.plan()).toBe('free')
      expect(mails().map((mail) => mail.to)).toEqual([
        'bill@alder-tree.vc',
        'owner@alder-tree.vc',
        'admin@alder-tree.vc',
      ])
      for (const mail of mails()) {
        expect(mail.subject).toMatch(/ is back on Free$/)
        expect(mail.text).toContain('Pro ended.')
        expect(mail.text).toContain('Choose a plan')
        expect(mail.text).toContain(`${WEB}/app/billing`)
      }
    })

    it('sends nothing when Stripe delivers the cancellation again', async () => {
      const organization = await organizationWithTeam('beech.vc')
      cancel(organization.subscriptionId, 'payment_failed')
      await t.webhook(organization.event())
      const mails = mailsAfter()
      expect((await t.webhook(organization.event())).status).toBe(204)
      expect(mails()).toEqual([])
    })

    it('sends nothing when an admin cancelled the plan', async () => {
      const organization = await organizationWithTeam('chestnut.vc')
      cancel(organization.subscriptionId, 'cancellation_requested')
      const mails = mailsAfter()
      expect((await t.webhook(organization.event())).status).toBe(204)
      expect(await organization.plan()).toBe('free')
      expect(mails()).toEqual([])
    })

    it('failing to send still answers 204 with the organization on Free', async () => {
      const organization = await organizationWithTeam('cypress.vc')
      cancel(organization.subscriptionId, 'payment_failed')
      const lines = failingMail(t)
      expect((await t.webhook(organization.event())).status).toBe(204)
      expect(lines()).toHaveLength(3)
      for (const entry of lines()) {
        expect(entry).toMatchObject({
          msg: 'billing email not sent',
          organizationId: organization.organizationId,
          mail: 'downgraded',
        })
        const line = JSON.stringify(entry)
        expect(line).not.toContain('cypress.vc')
      }
      vi.restoreAllMocks()
      expect(await organization.plan()).toBe('free')
    })
  })

  describe('the renewal notice', () => {
    const upcoming = (subscriptionId: string) => ({
      kind: 'invoice-upcoming',
      subscriptionId,
      amount: { amount: 143_000, currency: 'usd' },
    })

    async function renewing(domain: string, lookupKey: string) {
      const organization = await organizationPaying(domain, lookupKey)
      await t.webhook(organization.event())
      return organization
    }

    it('emails the billing email alone, the plan untouched', async () => {
      const organization = await renewing('poplar.vc', 'pro_yearly')
      const mails = mailsAfter()
      expect((await t.webhook(upcoming(organization.subscriptionId))).status).toBe(204)
      expect(mails().map((mail) => mail.to)).toEqual(['bill@poplar.vc'])
      expect(mails()[0]?.subject).toBe(`${APP_NAME} Pro renews on Oct 4`)
      expect(mails()[0]?.text).toContain('$1,430 on Oct 4, 2027, to Visa ending 4242')
      expect(mails()[0]?.text).toContain(`${WEB}/app/billing`)
      expect(await organization.plan()).toBe('pro')
    })

    it('sends nothing on a monthly price', async () => {
      const organization = await renewing('quince.vc', 'pro_monthly')
      const mails = mailsAfter()
      expect((await t.webhook(upcoming(organization.subscriptionId))).status).toBe(204)
      expect(mails()).toEqual([])
    })

    it('failing to send still answers 204, logging the organization but no address', async () => {
      const organization = await renewing('rowan.vc', 'pro_yearly')
      const lines = failingMail(t)
      expect((await t.webhook(upcoming(organization.subscriptionId))).status).toBe(204)
      expect(lines()).toHaveLength(1)
      expect(lines()[0]).toMatchObject({
        msg: 'billing email not sent',
        organizationId: organization.organizationId,
        mail: 'renewal',
      })
      expect(JSON.stringify(lines()[0])).not.toContain('rowan.vc')
    })
  })

  describe('top-ups', () => {
    it('keeps the first customer of a paid top-up so Billing lists its invoices', async () => {
      const person = await ownerOf(t, 'owner@topup.vc', 'free')
      const credit = vi.fn(async () => true)
      const realScope = t.data.forOrganization.bind(t.data)
      vi.spyOn(t.data, 'forOrganization').mockImplementation((id: string) => {
        const scope = realScope(id)
        return { ...scope, usage: { ...scope.usage, credit } }
      })
      const body = {
        kind: 'top-up',
        sessionId: 'cs_1',
        organizationId: person.organizationId,
        customerId: 'cus_topup',
        cents: 2_000,
        paid: true,
      }
      expect((await t.webhook(body)).status).toBe(204)
      expect(credit).toHaveBeenCalledWith(2_000, { idempotencyKey: 'checkout:cs_1' })
      vi.restoreAllMocks()
      expect(
        (await t.data.forOrganization(person.organizationId).organization())?.stripeCustomerId,
      ).toBe('cus_topup')
    })

    it('waits for a delayed payment, crediting nothing', async () => {
      const person = await ownerOf(t, 'owner@pending.vc', 'free')
      const body = {
        kind: 'top-up',
        sessionId: 'cs_2',
        organizationId: person.organizationId,
        customerId: 'cus_pending',
        cents: 2_000,
        paid: false,
      }
      expect((await t.webhook(body)).status).toBe(204)
      expect(
        (await t.data.forOrganization(person.organizationId).organization())?.stripeCustomerId,
      ).toBeNull()
    })

    it('takes back the share of a refunded top-up', async () => {
      const person = await ownerOf(t, 'owner@refund.vc', 'free')
      stripe.topUpPayments.set('pi_1', {
        organizationId: person.organizationId,
        cents: 2_000,
        total: 2_420,
      })
      const reverse = vi.fn(async () => true)
      const realScope = t.data.forOrganization.bind(t.data)
      vi.spyOn(t.data, 'forOrganization').mockImplementation((id: string) => {
        const scope = realScope(id)
        return { ...scope, usage: { ...scope.usage, reverse } }
      })
      const body = {
        kind: 'payment-reversed',
        reversalId: 're_1',
        paymentIntentId: 'pi_1',
        amount: 1_210,
      }
      expect((await t.webhook(body)).status).toBe(204)
      expect(reverse).toHaveBeenCalledWith(1_000, {
        idempotencyKey: 'reversal:re_1',
        payment: { key: 'pi_1', cents: 2_000 },
      })
    })
  })
})

describe('POST /api/webhooks/stripe without Stripe set up', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(() => t.close())

  it('refuses every delivery with 401', async () => {
    expect((await t.webhook({ subscriptionId: 'sub_1', organizationId: null })).status).toBe(401)
    vi.restoreAllMocks()
  })
})
