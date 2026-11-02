# Spec: Billing & Plans

Source of truth for porting the **billing / plans** area of saas-base
(NestJS + Angular) to arrakit (Hono + oRPC + Drizzle + Better Auth + TanStack
Start + shadcn/ui). Implementers should be able to build the whole area from
this file without reading saas-base.

Covered: plans catalog, public Pricing, in-app Plans, Embedded Checkout,
Welcome after paying, plan/cycle change with a priced preview, cancel/resume,
Stripe customer portal, Settings → Billing, top-up Checkout (entry point only),
Stripe webhook and its effects, billing emails (receipt, renewal, failed
payment, cancellation, downgraded), the Stripe price bootstrap script, and the
end of a subscription when an organization is deleted.

Covered elsewhere (only listed here): usage ledger arithmetic (credit, reverse,
consume, balances, `usagePeriod`), the Usage cards and top-up history on the
Billing screen, seat enforcement on invitations and joins, `/api/me`.

saas-base source locations (for reference only):
`apps/api/src/app/billing/*`, `libs/shared/plans/src/plans.ts`,
`apps/api/scripts/stripe-prices.mts`, `apps/web/src/app/pricing/*`,
`apps/web/src/app/signed-in/{plans,checkout,welcome,settings/billing-settings,plan-access.ts}`,
`libs/shared/emails/src/templates/plan.ts`, `apps/api/src/testing/fake-stripe.ts` (Arrakit: `apps/api/src/billing/fake-stripe.ts`).

---

## 1. Shared package: plans catalog (`packages/plans`, e.g. `@arrakit/plans`)

Framework-free TypeScript, imported by api, web and the price script. Port it
**verbatim** (logic and numbers), with its unit tests.

### 1.1 Plans

```ts
export const PLANS = ['free', 'pro', 'team', 'internal'] as const // order = rank
export type Plan = (typeof PLANS)[number]
export const PLAN_LABELS = { free: 'Free', pro: 'Pro', team: 'Team', internal: 'Internal' }
export const CURRENCY = 'usd' // Stripe lowercase ISO 4217
```

| plan     | monthlyCents | yearlyCents | seats | monthlyGrantCents |
| -------- | -----------: | ----------: | ----: | ----------------: |
| free     |            0 |           0 |     1 |               100 |
| pro      |        2_000 |      19_200 |     3 |             1_000 |
| team     |        5_000 |      48_000 |    10 |             3_000 |
| internal |            0 |           0 |   100 |            10_000 |

`PlanOffer = { plan, monthlyCents, yearlyCents, seats, monthlyGrantCents }`,
exported as `PLAN_OFFERS: Record<Plan, PlanOffer>`.

Rules:

- `internal` is **never sold**. Set only by hand (SQL) for the team's own
  organizations. It is last in `PLANS`, so rank comparisons put it above Team.
  The Stripe webhook never touches an organization on `internal`.
- Plans are ranked by their index in `PLANS` (used for "move up" vs "move down"
  and for receipts).
- `seats` counts members **plus pending invitations**.
- Yearly is 20% cheaper than 12 × monthly for both paid plans (Pro $192/yr vs
  $240; Team $480/yr vs $600).

### 1.2 Metrics and top-ups (listed; arithmetic is specified in the usage spec)

- `TOP_UP = { minCents: 1_000, maxCents: 50_000 }` ($10 to $500).
- `METRICS = [{ key: 'credits', label: 'Credits', unit: 'credits', kind: 'consumable', perCurrencyUnit: 100 }, { key: 'storage_gb', label: 'Storage', unit: 'GB', kind: 'capacity', perCurrencyUnit: 10 }]`.
- Exports: `Metric`, `METRIC_KEYS`, `isMetric`, `metricOf`, `metricAmounts(cents)` (each metric
  floored; the per-metric `metricAmount` is private), `planGrant(plan)`, `isTopUpAmount(cents)` (integer within bounds),
  `UsagePeriod`, `usagePeriod(anchor, now)` (Stripe-like month arithmetic, day clamped to
  month end, UTC), `splitConsumption`, `MetricSums`, `MetricBalance`, `metricBalance`.

### 1.3 Unit tests to port (`plans.spec.ts`, all of them)

- Sold plans cheapest first by monthly price; Internal last, above Team.
- `PLAN_LABELS.internal === 'Internal'`.
- `metricAmounts(2000)` → `{ credits: 2000, storage_gb: 200 }`; `metricAmounts(1005).storage_gb` → 100.
- `planGrant('free')` → `{ credits: 100, storage_gb: 10 }`; grants increase with rank.
- Metric keys unique; `isMetric` refuses `'Credits'`, `'gb'`, `''`, `null`.
- `isTopUpAmount`: accepts 1000, 2000, 50000; refuses 999, 50001, 1000.5, `'2000'`, `null`.
- `usagePeriod` cases (anchor time-of-day, before anchor time, Jan 31 → Feb 28, year crossing, future anchor).
- `splitConsumption`, `metricBalance` cases.

---

## 2. Billing domain module in the API (`apps/api/src/billing/`)

### 2.1 Subscription plan helpers (`subscription-plan.ts`) — pure, port with tests

```ts
export const BILLING_CYCLES = ['monthly', 'yearly'] as const; type BillingCycle
export const PAID_PLANS = ['pro', 'team'] as const;            type PaidPlan
interface PaidSubscription { plan: PaidPlan; cycle: BillingCycle }
interface BilledPlan { plan: PaidPlan; cycle: BillingCycle | null }

priceLookupKey(plan, cycle) => `arrakit_${plan}_${cycle}` // Stripe lookup key
billedPlanOf(lookupKey) => BilledPlan | null   // the one parsing rule
planOfSubscription(status, lookupKey) => Plan
subscriptionOfLookupKey(lookupKey) => PaidSubscription | null
whenChangeApplies(from: BilledPlan, to: PaidSubscription) => 'now' | 'renewal' | null
```

- Stripe lookup key prefix `arrakit_` (one constant, `PRICE_KEY_PREFIX`);
  inside the app the key is the "plan key" `pro_yearly` (no prefix). The plan
  and cycle of a subscription are read **only** from its price's
  `lookup_key` (no price metadata).
- `billedPlanOf`: the key's first segment must be a paid plan (else null); the
  cycle is the second segment when it is one, else null (`pro_monthly_eur` →
  pro/monthly, `pro_weekly` and `team` → cycle null). Everything below derives
  from it, so plan and cycle can never disagree.
- `planOfSubscription`: statuses `active`, `trialing`, `past_due` keep the paid
  plan of `billedPlanOf`; any other status
  (`canceled`, `unpaid`, `incomplete`, `incomplete_expired`, `paused`) → `free`.
  A key that names no paid plan → `free` (so no price can ever set `internal`).
- `subscriptionOfLookupKey`: `billedPlanOf` when its cycle is known, else null
  (`null`, `'enterprise_yearly'`, `'pro_weekly'`, `'pro'` → null).
- `whenChangeApplies`: higher rank → `'now'` (any cycle); same plan & cycle →
  `null`; otherwise (down a plan, same plan other cycle, or same plan from an
  unknown cycle) → `'renewal'`.

Tests to port (`subscription-plan.spec.ts`): all.

### 2.2 Stripe gateway (`stripe-gateway.ts`)

An interface the app depends on, so tests inject an in-memory fake.
`createStripeGateway(env)` never returns null:

- `STRIPE_FAKE=1` → the in-memory fake (`billing/fake-stripe.ts`; refused in
  production by env parsing).
- Any of `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
  missing → `unconfiguredStripe()`: every call rejects with 503
  `Payments are not set up yet.` and `event()` throws (the webhook answers
  401). The rest of the app boots normally.
- Else `realStripeGateway(keys)`.

`buildDeps` wraps the gateway with `guardedStripe(gateway, log, refuse?)`, and
`deps.stripe` is always the guarded one. Every call that reaches Stripe
(all but `publishableKey` and `event`) is guarded and every failure is answered
as one error built by `refuse(code, message)` (default: an `ORPCError`; the
organization plugin's hooks get a guard built with `apiRefusal`, a Better Auth
`APIError` with the same status and message). The unconfigured 503 above is not
logged; anything else is logged (`Stripe call failed`, with `operation` and the
error):

- `err.type === 'StripeCardError'` → 402 `Your card was declined. Update it under Payment, then try again.`
- anything else → 502 `Couldn't reach Stripe. Try again in a minute.` (`STRIPE_UNREACHABLE`).

Stripe's own message or status is never exposed. Procedures do not wrap
Stripe calls themselves.

```ts
interface StripeGateway {
  readonly publishableKey: string;
  checkout(req: CheckoutRequest): Promise<{ clientSecret: string }>;
  topUpCheckout(req: TopUpRequest): Promise<{ url: string }>;
  topUpPayment(paymentIntentId): Promise<{ organizationId; cents; total } | null>;
  event(rawBody: string, signature: string): BillingEvent | null; // throws on bad signature
  subscription(id): Promise<SubscriptionState>;                  // always fresh from Stripe
  customer(id): Promise<{ email: string|null; card: Card|null }>;
  billing(customerId, subscriptionId | null): Promise<BillingSnapshot>;
  price(choice: PaidSubscription): Promise<Money>;
  previewNow(subscription: SubscriptionState, choice, prorationDate): Promise<Money>; // prorated amount due today
  changeNow(subscription: SubscriptionState, choice, prorationDate): Promise<SubscriptionState>; // same date → same charge
  changeAtRenewal(subscription: SubscriptionState, choice): Promise<SubscriptionState>;
  cancelAtPeriodEnd(subscription: SubscriptionState, cancel: boolean): Promise<void>;
  endNow(subscriptionId): Promise<void>;
  portal(customerId, returnUrl, to: 'payment' | 'details'): Promise<string>;
}
```

Types:

```ts
CheckoutRequest = { organizationId; plan: PaidPlan; cycle; customerId: string|null; email; returnUrl }
TopUpRequest   = { organizationId; cents; customerId: string|null; email; successUrl; cancelUrl }
Money          = { amount: number /* minor unit */; currency: string /* lowercase */ }
SubscriptionState = {
  id; customerId; organizationId: string|null /* metadata.organizationId */;
  cancellationReason: string|null /* cancellation_details.reason */;
  status; lookupKey: string|null /* plan key via planKeyOf */; anchor: Date /* billing_cycle_anchor */;
  periodEnd /* unix s */; itemId: string|null; scheduleId: string|null
}
SubscriptionSnapshot = { status; lookupKey; periodEnd /* unix s */; cancelAtPeriodEnd;
  amount: Money|null; scheduled: { lookupKey; at /* unix s */; amount: Money|null } | null }
BillingSnapshot = {
  subscription: SubscriptionSnapshot | null;
  customer: { email; name; taxId; card: { brand; last4 } | null } | null;
  invoices: { id; created /* unix s */; total: Money; status: 'paid'|'open'|'uncollectible'; pdfUrl|null }[] // newest first
}
BillingEvent =
  | { kind: 'subscription'; subscriptionId|null; organizationId|null }
  | { kind: 'top-up'; sessionId; organizationId|null; customerId|null; cents; paid: boolean }
  | { kind: 'payment-reversed'; reversalId; paymentIntentId; amount }
  | { kind: 'invoice-upcoming'; subscriptionId; amount: Money }
  | { kind: 'invoice-failed'; subscriptionId; amount: Money; nextAttempt: number|null }
  | { kind: 'invoice-paid'; subscriptionId; amount: Money; invoiceUrl: string|null }
```

The only subscription metadata the app writes and reads is `organizationId`.

#### Real implementation (`real-stripe.ts`)

- **Price lookup** `priceOf(choice)`: `prices.list({ lookup_keys: [priceLookupKey], active: true, limit: 1 })`,
  cached per key for 5 minutes (`PRICE_CACHE_MS`; dropped on failure); throws if none. No price id ever lives in env.
  Every call that sends a price id (`checkout`, `previewNow`, `changeNow`, the schedule update of
  `changeAtRenewal`) retries once with a freshly looked-up price when Stripe refuses it as an invalid
  request naming a price (`refusesPrice`: archived after `stripe:prices` moved the lookup key).
- **`planKeyOf(price)`**: `lookup_key` without the prefix, else null.
- **`checkout`**: `checkout.sessions.create({ ui_mode: 'embedded_page', mode: 'subscription', line_items: [{ price, quantity: 1 }], client_reference_id: organizationId, subscription_data: { metadata: { organizationId } }, allow_promotion_codes: true, billing_address_collection: 'required', tax_id_collection: { enabled: true }, return_url })` plus either
  `{ customer: customerId, customer_update: { name: 'auto', address: 'auto' } }` (returning customer; required by Stripe for tax ID collection) or `{ customer_email: email }`. Throws if no `client_secret`.
- **`topUpCheckout`**: hosted Checkout, `mode: 'payment'`, `line_items: [{ price_data: { currency: CURRENCY, product: <Credits product>, unit_amount: cents }, quantity: 1 }]`, `client_reference_id`, `metadata: { kind: 'top_up', organizationId }`, `payment_intent_data.metadata: { kind: 'top_up', organizationId, cents: String(cents) }`, `invoice_creation: { enabled: true, invoice_data: { metadata: { kind: 'top_up' } } }`, customer as above or `{ customer_email, customer_creation: 'always' }`, `billing_address_collection: 'required'`, `tax_id_collection.enabled`, `success_url`, `cancel_url`. Credits product found via the price with lookup key `<prefix>credits_top_up`.
- **`topUpPayment`**: `paymentIntents.retrieve`; returns `{ organizationId, cents: Number(metadata.cents), total: intent.amount }` only when `metadata.kind === 'top_up'`.
- **`event`**: `stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)`, then `mapStripeEvent`:
  - `refund.created`, `charge.dispute.created` → `payment-reversed` (null if no payment_intent).
  - `checkout.session.completed` / `checkout.session.async_payment_succeeded` with `mode === 'payment'`: if `metadata.kind === 'top_up'` → `top-up` with `organizationId = metadata.organizationId ?? client_reference_id`, `customerId`, `cents = amount_subtotal ?? 0`, `paid = payment_status === 'paid'`; other payment sessions → null. `async_payment_succeeded` in subscription mode → null.
  - `checkout.session.completed` (subscription mode) → `subscription` with `subscriptionId = session.subscription`, `organizationId = client_reference_id`.
  - `customer.subscription.created|updated|deleted` → `subscription` with `organizationId = metadata.organizationId ?? null`.
  - `invoice.upcoming` → `invoice-upcoming` (`amount_due`, currency).
  - `invoice.payment_failed` → `invoice-failed` with `nextAttempt = next_payment_attempt` (may be null).
  - `invoice.paid` → `invoice-paid` only when `billing_reason` starts with `subscription` (`subscription_create`, `subscription_cycle`, `subscription_update`, …; `manual` → null); `amount = amount_paid`, `invoiceUrl = invoice_pdf ?? hosted_invoice_url ?? null`.
  - Invoice subscription id read from `invoice.parent.subscription_details.subscription` (id or expanded object). No subscription → null.
  - Anything else → null.
- **`subscription(id)`**: `subscriptions.retrieve`; maps `metadata.organizationId`, `cancellation_details.reason`, status, plan key of item 0, period end, item id, schedule id, `anchor = new Date(billing_cycle_anchor * 1000)`.
- **`customer(id)`**: email and default card; a deleted customer → `{ email: null, card: null }`.
- **`billing`**: in parallel: the customer (with default payment method and tax ids), the subscription (with default payment method and schedule phases' prices) if any, `invoices.list({ customer, limit: 24 })`. Card = subscription default PM, else customer's invoice default PM. Deleted customer → `customer: null`. Invoices: only statuses `paid|open|uncollectible`. Snapshot: `periodEnd = item.current_period_end ?? billing_cycle_anchor`; `scheduled` = schedule phase whose `start_date >= periodEnd` (its price's plan key, start date and amount).
- **`price`**: unit amount of the price (throws if none).
- **`previewNow`**: `invoices.createPreview({ subscription, subscription_details: { items: [{ id: item.id, price }], proration_behavior: 'always_invoice', proration_date } })` → `{ amount: amount_due, currency }`.
- **`changeNow`**: release any schedule; `subscriptions.update(id, { items: [{ id: item.id, price }], proration_behavior: 'always_invoice', proration_date, payment_behavior: 'error_if_incomplete', cancel_at_period_end: false })`; returns the changed state. A declined card throws `StripeCardError` and leaves the subscription unchanged.
- **`changeAtRenewal`**: release any schedule; update `cancel_at_period_end: false`; `subscriptionSchedules.create({ from_subscription })`; then `subscriptionSchedules.update(schedule, { end_behavior: 'release', phases: [ { items: current price/qty, start_date, end_date, discounts, metadata }, { items: [{ price: new, quantity: 1 }], duration: { interval: cycle === 'yearly' ? 'year' : 'month' }, billing_cycle_anchor: 'phase_start', proration_behavior: 'none', discounts, metadata } ] })`. Discounts (discount, coupon or promotion code) copied from the current phase; both phases carry `{ organizationId }` metadata. Returns the kept state with the new `scheduleId`.
- **`cancelAtPeriodEnd(subscription, cancel)`**: on cancel, release a pending schedule first; then `update({ cancel_at_period_end: cancel })`.
- **`endNow`**: no-op if already `canceled`; else `subscriptions.cancel(id)` (no refund).
- **`portal`**: `billingPortal.sessions.create({ customer, configuration, return_url, ...(to === 'payment' && { flow_data: { type: 'payment_method_update' } }) })`. Configuration found among active ones by `metadata.app === 'billing'`, else created with `invoice_history`, `payment_method_update`, `customer_update` (`email`, `name`, `address`, `tax_id`) enabled and `subscription_cancel` / `subscription_update` **disabled** (plan changes stay in the app). Memoised per process, reset on failure.

#### Fake gateway (`apps/api/src/billing/fake-stripe.ts`)

In-memory implementation used by every API test and by `STRIPE_FAKE=1`
(Playwright). Records `checkouts`, `topUps`, `topUpPayments`, `changes`
(`{ subscriptionId, choice, when: 'now'|'renewal' }`), `cancellations`
(`{ subscriptionId, cancel }`), `ended`, `portals` (`{ customerId, returnUrl, to }`).
Holds `subscriptions` (set by `subscribe(state)`) and `customers` (set by
`bill(customerId, snapshot)`); `failNext(method, error)` makes the next call
throw. Constants: `FAKE_STRIPE_SIGNATURE = 't=1,v1=fake-stripe-signature'`,
`FAKE_PRORATION = { amount: 120_000, currency: 'usd' }`; prices = `PLAN_OFFERS`
in US cents; publishable key `'pk_test_fake'`; portal URLs
`https://billing.stripe.test/...`. Its `event()` parses the raw body as a
`BillingEvent` JSON (kind defaults to `subscription`; `{}` = ignored event) and
throws on any other signature.

### 2.3 Applying a subscription event (`applyBillingEvent` in `settle-event.ts`) — port with tests

```ts
findOrganization(data, log, organizationId|null, what) -> { scope, organization } | null
findSubscriptionOrganization(data, stripe, log, subscriptionId|null, eventOrganizationId?) -> found + subscription | null
applyBillingEvent(data, stripe, log, event: SubscriptionEvent) -> { organization (as it was before), plan, subscription } | null
```

An ignored event logs warn `billing event ignored` with its `reason` and answers null.

Rules:

1. No subscription id → ignored. The subscription is **always re-read from Stripe**
   (never trust the event payload), so replays/out-of-order deliveries converge.
2. Organization = `subscription.metadata.organizationId ?? event.organizationId`.
   Missing, malformed (not a UUID) or deleted → ignored, nothing written.
3. Organization on `internal` → ignored (active or canceled subscription alike).
4. `plan = planOfSubscription(status, lookupKey)`.
5. If `plan === 'free'` **and** the organization has a different
   `stripe_subscription_id` (it was replaced) → ignored; the old subscription's
   cancellation never takes away the plan.
6. If the plan is paid, the organization has a different `stripe_subscription_id`
   and that subscription is still live (two Checkouts paid while on Free) →
   `stripe.endNow(incoming)` and null (logged as warn
   `duplicate subscription ended` with `organizationId`, `kept`, `ended`); the
   subscription the organization already pays with stays. A failing `endNow`
   answers 500 so Stripe delivers again. The ended one then settles as rule 5.
   The second payment is not refunded.
7. Otherwise write: `plan`, `stripe_customer_id = subscription.customerId`,
   `stripe_subscription_id = plan === 'free' ? null : subscription.id`,
   `usage_anchor = plan === 'free' ? null : subscription.anchor`. The customer
   id is kept on Free (a later Checkout reuses it).
8. Return the organization as it was before the write (its `plan` is the previous plan, for the downgrade email).

Tests to port (`settle-event.test.ts`): grant anchor written; active
subscription → plan + customer + subscription recorded; previousPlan free on
first payment and pro on replay; internal never moved (active/canceled);
idempotent on double delivery; `canceled`/`unpaid` → free with subscription
forgotten and customer kept; replaced subscription cancelled → plan kept;
organization from event when metadata lacks it; ignored for no subscription /
no organization / organization gone / malformed id (no writes).

### 2.4 Billing view (`billingView` in `billing-service.ts`) — pure, used by GET and by mutations

`dayOf(unixSeconds | Date) => 'YYYY-MM-DD'` (UTC; `apps/api/src/day.ts`).

`billingView(organization, snapshot | null)`:

- `seats = PLAN_OFFERS[organization.plan].seats`.
- `unbilled = plan === 'free' || plan === 'internal'` → subscription ignored
  (Internal leftovers bill nothing on screen).
- `cycle` = cycle of the subscription's plan key, else null.
- `cancelled = subscription.cancelAtPeriodEnd`.
- `renewsOn = cancelled ? null : dayOf(periodEnd)`; `endsOn = cancelled ? dayOf(periodEnd) : null`.
- `nextInvoice = cancelled ? null : (scheduled ? scheduled.amount : subscription.amount) ?? null`.
- `scheduledChange = scheduled with a valid plan key && !cancelled ? { plan, cycle, on: dayOf(scheduled.at) } : null`.
- `card`, `billingEmail`, `taxId` from customer (null when none).
- `invoiceTo = customer.name || organization.name`.
- `invoices` mapped `{ id, issuedOn: dayOf(created), total, status: paid→'paid', open→'open', uncollectible→'failed', pdfUrl }`.
- An organization on Free that paid before still shows its card and invoices.

### 2.5 Billing mail helpers (`billing-mail.ts`) — pure, port with tests

- `recipients(...emails)`: drop empty/null, dedupe by normalized email
  (lowercase/trim, same `normalizeEmail` as the auth area), keep first spelling.
  `('Ana@Organization.com', 'ana@organization.com', '', null, 'bill@organization.com')` → `['Ana@Organization.com', 'bill@organization.com']`.
- `chargeOf(money, card)` → `{ amount, card }`. Amount via `Intl.NumberFormat('en-US', currency)`
  using the currency's own minor-unit digits, decimals only when non-integer:
  `143000 usd → '$1,430'`, `1499 usd → '$14.99'`, `143000 eur → '€1,430'`, `1430 jpy → '¥1,430'`.
  Card: `'Visa ending 4242'` (brand capitalised), or `'your card'` when none.
- `daysUntil(date, now)` (from `@arrakit/emails`, `copy.ts`): ceil of days, minimum 1 (3 days → 3, 1 hour → 1, past → 1, 2.1 days → 3).
- `adminsOf(members)`: emails of members whose static role manages billing (`owner`, `admin`; never `member`; custom roles are not mailed).
- `downgradeDue({ previousPlan, plan, cancellationReason })`:
  `cancellationReason === 'payment_failed' && previousPlan !== 'free' && plan === 'free'`.
- `billingLink(webOrigin)` = `${webOrigin}/app/billing`.
- `sendMails(mailer, email, to, onFailure)`: sends the rendered template
  (templates in `@arrakit/emails`, §6) to each recipient in parallel; each failure
  goes to `onFailure` and never stops the others.

---

## 3. Data model (Drizzle)

Billing lives on the `organizations` table (an app table; only the API
writes it).

| column                   | type                                                                                | notes                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `plan`                   | `text NOT NULL DEFAULT 'free'` + `CHECK (plan IN ('free','pro','team','internal'))` | typed `$type<Plan>()`. Only the webhook (and the synchronous read-back after a change) moves it.              |
| `stripe_customer_id`     | `text UNIQUE NULL`                                                                  | set on first payment (subscription or top-up); kept when going back to Free.                                  |
| `stripe_subscription_id` | `text NULL`                                                                         | the live subscription; null on Free.                                                                          |
| `usage_anchor`           | `timestamptz NULL`                                                                  | subscription `billing_cycle_anchor` on a paid plan; null on Free (usage months then count from `created_at`). |
| `created_at`             | `timestamptz NOT NULL DEFAULT now()`                                                | existing.                                                                                                     |

Data functions (org-scoped repository, e.g. `forOrganization(id)`):

- `organization()` → row or undefined.
- `setPlan(plan, stripe?: { customerId; subscriptionId: string|null; anchor?: Date })`:
  sets `plan`; if `plan === 'free'` sets `usage_anchor = null`, else sets it when
  `anchor` given; when `stripe` given also sets customer and subscription ids.
  Without `stripe`, keeps customer/subscription. Returns updated row, or
  undefined for an unknown organization. Never touches other organizations.
- `setStripeCustomer(customerId)`: sets it **only if currently null** (first
  top-up); returns the row as it is now.
- `members.list()` → `{ email, role }[]` (used for admin recipients).
- `usage.credit(cents, { idempotencyKey })` / `usage.reverse(cents, { idempotencyKey, payment })`
  (usage spec).

Integration tests to port (PGlite): every org starts Free with no Stripe ids;
`setPlan` records customer and subscription; `setPlan('free')` alone keeps the
customer; `setStripeCustomer` records first and keeps it; unknown org →
undefined; other org untouched.

---

## 4. API (oRPC contract `billing.*`, `plans.*` + Hono routes)

All procedures live in the oRPC contract (`@orpc/contract` + Zod) under
`/api/rpc`. HTTP status semantics are kept via `ORPCError` codes:
`UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409,
`BAD_REQUEST` 400 (Zod input), `SERVICE_UNAVAILABLE` 503, `BAD_GATEWAY` 502,
and a custom `PAYMENT_REQUIRED` with `status: 402`. Error `message` strings
below are user-facing and must be exact (the web shows them).

Common middleware for every `billing.*` procedure (`member({ billing: [...] })`):

1. **Session required** (Better Auth session) → 401.
2. **Membership in the active organization required**, read fresh (`activeMembership`); no organization → 404.
3. **Permission**: `billing.get` needs `billing:read`, every other procedure `billing:manage` (owner and admin have both,
   `member` neither, a custom role what the owner gave it) → 403 "You don't have permission to do this.".
   The billing contract keeps working on the session's active organization.
4. Writes from an untrusted `Origin` are refused 403 `Use the app.` by the
   app-wide `/api/rpc/*` middleware (platform spec §4), before any of this.

Stripe failures are mapped once by `guardedStripe` (§2.2): 503 when Stripe is
not set up, 402 for a declined card, 502 `Couldn't reach Stripe. Try again in
a minute.` for anything else.

Shared Zod schemas:

```ts
const paidChoice = z.object({ plan: z.enum(['pro', 'team']), cycle: z.enum(['monthly', 'yearly']) })
const money = z.object({ amount: z.number().int(), currency: z.string() })
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const billing = z.object({
  plan: z.enum(PLANS),
  cycle: z.enum(BILLING_CYCLES).nullable(),
  renewsOn: day.nullable(),
  endsOn: day.nullable(),
  nextInvoice: money.nullable(),
  scheduledChange: paidChoice.extend({ on: day }).nullable(),
  seats: z.number().int(),
  card: z.object({ brand: z.string(), last4: z.string() }).nullable(),
  billingEmail: z.string().min(1).nullable(),
  invoiceTo: z.string(),
  taxId: z.string().min(1).nullable(),
  invoices: z.array(
    z.object({
      id: z.string(),
      issuedOn: day,
      total: money,
      status: z.enum(['paid', 'open', 'failed']),
      pdfUrl: z.string().min(1).nullable(),
    }),
  ), // newest first
})
const planOffer = z.object({
  plan: z.enum(PLANS),
  monthly: money,
  yearly: money,
  seats: z.number().int(),
})
```

### 4.1 `plans.list` — public catalog

- Auth: none. Input: none.
- Output: `soldOffers()` from `@arrakit/plans` = `planOffer[]` for `SOLD_PLANS`
  (`free`, `pro`, `team`; never `internal`), cheapest first:
  `{ plan, monthly: { amount: monthlyCents, currency: 'usd' }, yearly: { amount: yearlyCents, currency: 'usd' }, seats }`.
- The web does not call it: Pricing and Plans render `soldOffers()` directly
  (static catalog, no request).

### 4.2 `billing.checkout` (saas-base `POST /api/billing/checkout`)

- Input: `paidChoice`. Anything else → 400 (e.g. `enterprise`, `free`, `weekly`, missing cycle); nothing opened.
- Order: session (401) → admin (403) → org on non-Free plan → 409 `Your organization is on <Label>. Switch plans in Settings → Billing.` (also for `internal`) → Stripe (503 when not set up).
- Calls `stripe.checkout({ organizationId, plan, cycle, customerId: organization.stripeCustomerId, email: session.user.email, returnUrl: `${WEB_URL}/app/welcome?session_id={CHECKOUT_SESSION_ID}` })`.
- Stripe failure → 502 `Couldn't reach Stripe. Try again in a minute.` (logged by `guardedStripe`).
- Output: `{ clientSecret: string, publishableKey: string }`.
- Does **not** change the plan; only the webhook does.
- Reuses an existing customer id (organization that paid before).

### 4.3 `billing.get` (saas-base `GET /api/billing`)

- Admin only. Output: `billing`.
- No `stripe_customer_id` → `billingView(org, null)` without calling Stripe and
  **without requiring Stripe to be configured** (Free org shows: plan free, cycle null, all null, seats 1, invoiceTo = org name, invoices []).
- Else `stripe.billing(customerId, stripeSubscriptionId)` (502 on failure) → `billingView`.

### 4.4 `billing.previewChange` (saas-base `POST /api/billing/change/preview`)

- Input: `paidChoice`.
- `paidOrganization` (`billing-service.ts`): org on `internal` → 409 `Your organization is on Internal: there is nothing to bill.`; org on Free or missing customer/subscription ids → 409 `Your organization is on Free. Pick a plan to pay for it.`; then `stripe.subscription(subscriptionId)` (502 on failure); `current = billedPlanOf(lookupKey)`; if its key names no paid plan → log `subscription bills no known price` and 502 `Couldn't reach Stripe. Try again in a minute.` A known plan with an unknown cycle is served (view `cycle: null`; cancel/resume work; a change to the same plan applies at renewal).
- `applies = whenChangeApplies(current, choice)`; null → 409 `Your organization is already on <Label>, billed <cycle>.`
- In parallel: `applies === 'now' ? stripe.previewNow(subscription, choice, prorationDate = now) : null`, `stripe.price(choice)`.
- Output:
  ```ts
  { applies: 'now'|'renewal',
    on: day,        // today (UTC) when now; dayOf(periodEnd) at renewal
    dueToday: money,// prorated preview when now; { amount: 0, currency } at renewal
    nextInvoice: money, // one period of the new price
    prorationDate: number | null } // unix s of the preview when now; null at renewal
  ```

### 4.5 `billing.change` (saas-base `POST /api/billing/change`)

- Same input/guards/conflicts as preview, plus optional `prorationDate` (the preview's).
- `now` → `stripe.changeNow(subscription, choice, prorationDate)`, reusing the
  given date when it is at most one hour old and not in the future (else now), so
  the charge matches the preview; `renewal` →
  `stripe.changeAtRenewal(subscription, choice)` (402 on declined card; plan unchanged).
- Then writes `setPlan(planOfSubscription(changed.status, changed.lookupKey), stripeRefs(changed, plan))`
  from the state the change returned (so a move up gets the bigger limits on
  this very response; the webhook converges to the same state).
- Output: `billing` (organization with the new plan + fresh snapshot).
- Drops a pending cancellation and replaces any pending scheduled change.

### 4.6 `billing.cancel` / `billing.resume` (saas-base `POST /api/billing/cancel|resume`)

- Input: none. Same `paidOrganization` guard as preview (Internal 409, Free 409 `Your organization is on Free. Pick a plan to pay for it.`).
- `stripe.cancelAtPeriodEnd(subscription, cancel)`. Cancel also drops a pending scheduled change.
- Re-reads snapshot; output `billingView(organization, snapshot)`.
- The plan is **not** changed here: it stays until Stripe ends the subscription (webhook → Free).
- **Cancellation email (cancel only)**: `canceledEmail` with
  `plan = PLAN_LABELS[org.plan]`, `endsOn = dayOf(subscription.periodEnd)`,
  `to = recipients(cancellingAdminEmail, ...adminsOf(members))`. Any failure
  building/sending is logged as `cancellation email not sent` with
  `organizationId` (**never the address or the body**) and never fails the
  request. Resume sends nothing.

### 4.7 `billing.portal` (saas-base `POST /api/billing/portal`)

- Input: `{ to: 'payment' | 'details' }`.
- Internal → 409 (Internal message). No `stripe_customer_id` → 409 `Your organization has no billing details yet. Pick a plan first.`
- `stripe.portal(customerId, `${WEB_URL}/app/billing`, to)` (502 on failure).
- Output `{ url }`; the web navigates the browser there.

### 4.8 `billing.topUp` (saas-base `POST /api/billing/top-up`; details in the usage spec)

- Input: `{ cents }` validated with `isTopUpAmount` (integer 1000..50000) → 400 otherwise.
- Admin only; Stripe required (503).
- `stripe.topUpCheckout({ organizationId, cents, customerId, email, successUrl: `${WEB_URL}/app/billing?top_up=paid`, cancelUrl: `${WEB_URL}/app/billing` })`.
- Output `{ url }`. Allowed on any plan (Free included).

### 4.9 Organization deletion (cross-reference, organizations spec)

Before deleting an organization with a `stripe_subscription_id`:
`stripe.endNow(sub)`; Stripe not set up → 503, failure → 502
`Couldn't reach Stripe. Try again in a minute.`; nothing deleted either way.

### 4.10 Stripe webhook — plain Hono route

- Path: **`POST /api/webhooks/stripe`** (outside oRPC). Not session-authenticated, no origin check.
- Read the **raw body** (`await c.req.text()` / arrayBuffer) before any JSON parsing.
- Verification: Stripe not set up (`event()` throws), missing `stripe-signature`
  header, or failed signature → log warn `webhook refused` with `reason`
  (never secret or body) → **401**.
- `event === null` → **204** (ignored event, nothing changed).
- Success → **204**. Errors while reading DB/Stripe (before emails are sent)
  propagate as **500** so Stripe redelivers. Email send failures are logged,
  never 500.

Dispatch:

1. **`top-up`** (`settleTopUp`): if `!paid` return (bank debit pending; its own
   `async_payment_succeeded` comes later). Find org (ignored → warn). `usage.credit(cents, { idempotencyKey: 'checkout:<sessionId>' })` (credited once even if both `completed` and `async_payment_succeeded` arrive, or on redelivery). If `customerId`, `setStripeCustomer(customerId)` (first payment keeps the customer so Billing lists invoices).
2. **`payment-reversed`** (`settleReversal`): `topUpPayment(paymentIntentId)`; null → return (not a top-up). Find org. `cents = min(topUp.cents, round(event.amount * topUp.cents / max(topUp.total, 1)))` (proportional, tax included in both). 0 → return. `usage.reverse(cents, { idempotencyKey: 'reversal:<reversalId>' })`. A dispute won later gives nothing back automatically.
3. **`invoice-upcoming`** (`settleRenewal`): find subscription org (ignored → warn). Only when its plan key's cycle is **yearly**. `stripe.customer(customerId)`; `to = recipients(customer.email)` (billing email only); empty → log not sent and return. Send `renewEmail` with `charge = chargeOf(event.amount, card)`, `renewsOn = dayOf(periodEnd)`, `daysLeft = daysUntil(periodEnd, now)`. Stripe sends `invoice.upcoming` N days ahead (Dashboard setting).
4. **`invoice-paid`** (`settleReceipt`): the only source of receipts. Skip a zero-amount invoice. Find subscription org (ignored → warn); its plan key must be a known paid plan (else ignored). `stripe.customer(customerId)`; send `receiptEmail` with `plan` and `billing` (cycle) of the subscription's current price, `charge = chargeOf(event.amount, card)`, `renewsOn = dayOf(periodEnd)`, `invoice = event.invoiceUrl ?? WEB_URL/app/billing`, `to = recipients(customer.email)` (billing email only). `mapStripeEvent` only yields this for subscription billing reasons, so the first payment, renewals and prorated moves each get one receipt per paid invoice; nothing is stored to deduplicate (Stripe's redelivery of the same event can send it again).
5. **`invoice-failed`**: if `nextAttempt === null` (Stripe's last try) send nothing (the downgrade email follows). Find subscription org (ignored → warn). Load customer + members. Send `failedEmail` with `charge = chargeOf(amount, card)`, `retryInDays = daysUntil(nextAttempt, now)`, `to = recipients(customer.email, ...adminsOf(members))`. Plan untouched.
6. **`subscription`**: `applyBillingEvent` (ignored → warn, 204; it logs `plan updated` with `organizationId`, `plan`). Then (failure logged, still 204):
   - **Downgrade** (`settleDowngrade`): if `downgradeDue(...)` (Stripe cancelled after failed retries): load customer + members; send `downgradedEmail` with `plan = PLAN_LABELS[previousPlan]`, `to = recipients(customer.email, ...adminsOf(members))`. An admin's cancel (`cancellation_requested`) and replays (already Free) send nothing.
   - Subscription events never send a receipt.

- Every mail is sent independently (`sendMails`); a failing one logs `billing email not sent` with `organizationId` and `mail` (`receipt`, `failed payment`, `renewal`, `downgraded`), and the rest still go. Never log address or body.

Stripe Dashboard webhook events to subscribe: `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`,
`invoice.upcoming`, `invoice.payment_failed`, `invoice.paid`, `refund.created`,
`charge.dispute.created`.

---

## 5. Web screens (TanStack Start, shadcn/ui default theme, i18n en/es)

Money formatting on screens: `money({ amount, currency }, { whole? })` with
`Intl.NumberFormat` for the active locale (`en-US` / `es-ES`), currency style,
0 decimals when `whole` or amount is a whole unit, else 2 (`$1,430`,
`$1,430.50`, whole: `$119`). Dates: `fullDay('YYYY-MM-DD')` → `Oct 4, 2027`
/ `4 oct 2027` (both in `#/lib/format`, Intl in the active language; the day is read
and written in UTC so it never moves).
Shared copy helpers (`plan-copy.ts`): `planLabel(plan)` = `t('pricing.plan.<plan>')`;
`seatsLine(seats)` = `pricing.oneSeat` when 1 else `pricing.seatsUpTo {upTo, seats}`;
`planPrice(offer, cycle)`:

- Free: `{ was: null, price: '$0', billed: null, billedNote: null }`.
- monthly: `{ was: null, price: money(monthly, whole), billed: 'billed monthly', billedNote: 'Billed monthly' }`.
- yearly: `{ was: money(monthly, whole), price: money(round(yearly/12), whole), billed: 'billed yearly', billedNote: '<total> billed yearly' }` (Pro yearly: was $20, price $16).
  `yearlySaving(offer) = round((1 - yearly/(monthly*12)) * 100)` (20);
  `YEARLY_SAVING` (constant next to `OFFERS` in `plan-copy.ts`) = min over paid offers; `twelveMonths(offer)` = monthly × 12.

Reusable component **BillingCycleSwitch**: two toggle buttons (shadcn
`ToggleGroup` type single) "Monthly" / "Yearly" with `aria-pressed`, group
`aria-label = pricing.billingCycleSwitch.billing`; Yearly shows badge
`Save {{saving}}%` when saving not null. Default cycle **yearly**.

### 5.1 `/pricing` — public Pricing

- No session needed; outside the signed-in shell. Header link "Sign in" → `/signin`. Footer link "Home" → landing site URL (`SITE_URL`).
- Title `pricing.titleLead` + `pricing.titleRest`, subtitle `pricing.subtitle`, cycle switch (yearly default; saving = least saving = 20%).
- One card per sold plan (Free, Pro, Team), Team highlighted. Card: label, audience (`pricing.audience.<plan>`), struck `was` price when yearly, price + `pricing.perMonth`, note (`pricing.billed.<cycle>` for paid; `pricing.noCardNeeded` on Free), CTA, usage lines (`seatsLine`), then lead (`pricing.feature.<lead>`) and features:
  - free: lead null, features `[coreFeatures]`
  - pro: lead `everythingInFreePlus`, features `[prioritySupport]`
  - team: lead `everythingInProPlus`, features `[teamFeatures]`
  - internal (never shown): lead `everythingInTeam`, features `[]`
- CTA: Free → "Start free" → `/signup`; paid → "Get {{plan}}" → `/signup?plan=<plan>&cycle=<cycle shown>`.
- A signed-in person with an organization following "Get Team" lands directly on `/app/checkout?plan=team&cycle=yearly` (the `/signup` route's skip-when-signed-in guard forwards `plan`/`cycle`). New users: Signup → magic link landing `/profile?plan=&cycle=` → after creating the organization → `/app/checkout?plan=&cycle=` (else `/app`). Invalid choices are dropped.
- Offers come from `soldOffers()` (`@arrakit/plans`, static; no request).

### 5.2 `/app/plans` — in-app Plans

- Any member can see it. Title `plans.titleLead/titleRest`, subtitle, cycle switch.
- Data: offers from `soldOffers()` (static) and `current` = the current
  user's plan. If the user is admin and `current` is a paid plan (not
  free/internal), also load `billing.get` to know the paying cycle; set the
  switch to that cycle. Failure → toast `plans.billingLoadFailed` (query
  `meta.failure`).
- Cards (Free, Pro, Team): label, audience, price (struck `was` when yearly), `plans.perMonthBilled {billed}` for paid, features = `[seatsLine(seats), ...planFeatures]` where planFeatures: free `[coreFeatures]`, pro `[everythingInFree, prioritySupport]`, team `[everythingInPro, teamFeatures]`, internal `[everythingInTeam]`. Team has badge `plans.recommended`.
- Card `current` = `offer.plan === current && (!paying || paying.cycle === shownCycle)`.
- Button per card:
  - current → disabled "Your current plan" (`plans.currentPlan`).
  - organization on Free, paid plan, admin → "Select {{plan}}" (`plans.select`; Team button primary, others outline).
  - paying org (billing loaded), not current, not Free, admin → "Switch to {{plan}}" (`plans.switchTo`), disabled while busy.
  - members: no button; below the grid `plans.onlyAdmin`.
  - A paying org whose billing fails to load is **never** sent to Checkout (no button).
- Select on yearly → navigate `/app/checkout?plan=<plan>&cycle=yearly`.
- Select on monthly → **annual offer dialog** (title `plans.annualModal`): card "`{{plan}}, yearly`" + `Save {{saving}}%` + `plans.compared` ("$480 a year instead of $600."); buttons "Continue yearly" → checkout yearly, "Continue monthly" → checkout monthly. Closing returns to Plans.
- Switch → `billing.previewChange` (busy; failure toast `plans.priceFailed`) → **switch confirmation dialog**: title `plans.switchTitle.<cycle>` ("Switch to Team, yearly"), lines from `switchLines(fromPlan, choice, preview)`:
  - applies now: `plans.dueToday {amount}`, `plans.movesNow {plan}`, `plans.then {after}` where after = `plans.per.<cycle> {amount: nextInvoice}`.
  - at renewal: `plans.nothingToday`, then same plan → `plans.staysOn.<cycle> {plan, on, after}`; other plan → `plans.keepsUntil {from, on, plan, after}` (`on = fullDay(preview.on)`).
  - Buttons: "Switch to {{plan}}" → `billing.change` (with the preview's `prorationDate`); on success store the returned billing, patch the cached current user (plan, seats) and navigate `/app/settings?section=billing`; on error toast the API message or `plans.switchFailed`. "Not now" closes.
- Footer links: "Not now" → `/app`, "Compare all plans" → `/pricing`.

### 5.3 `/app/checkout?plan=&cycle=` — Embedded Checkout

- Guard `canCheckout` (reads the person from the cache left by `requireUser`): admin AND `checkoutChoice(search)` valid (plan ∈ {pro, team}, cycle ∈ {monthly, yearly}); otherwise redirect `/app/plans` (`/app/checkout`, `plan=free`, `plan=enterprise`, `plan=internal`, `plan=Internal`, `cycle=weekly`, missing cycle all redirect). Validate search params with Zod in the route's `validateSearch`.
- Left: order summary (`aria-label = checkout.orderSummary`): back link "Back" → `/app/plans`; `checkout.subscribeTo {product}` with product = `${APP_NAME} ${planLabel}`; total = full price of the cycle (`money(yearly)` or `money(monthly)`) + `checkout.per.<cycle>`; line item with `checkout.terms.<cycle>`; Subtotal; Tax → `checkout.taxFromAddress`; "Total due today" = total.
- Right: heading `checkout.payment`; while opening `checkout.opening`; on failure an `role="alert"` with the API message or `checkout.openFailed`; a mount `<div data-stripe-checkout>`; footer `checkout.cancelAnytime`.
- On mount (client only): `billing.checkout({ plan, cycle })` → `loadStripe(publishableKey)` (`@stripe/stripe-js`) → `stripe.createEmbeddedCheckoutPage({ clientSecret })` (or `initEmbeddedCheckout` depending on stripe-js version) → `mount(element)`. Destroy the embedded checkout on unmount (also if unmounted while opening).
- The order summary prices the choice from `soldOffers()` (static).
- After paying, Stripe redirects to `/app/welcome?session_id=...`.

### 5.4 `/app/welcome` — after Checkout

- Guard `onPaidPlan`: if the cached person's org is on a paid plan → show. If not and there is no `session_id` → redirect `/app/plans`. With `session_id`: re-read `me.get` once per second up to **15 tries** (`PAID_WAIT_TRIES`) until the plan is paid (webhook may land after the browser); success → show; timeout/error → `/app/plans`.
- Content: check icon, `welcome.titleLead` + `welcome.titleRest {plan}` (current plan label), body, button "Go to the app →" → `/app`; footer `welcome.receiptSent` + link "Settings" → `/app/settings?section=billing` + `welcome.receiptEnd`.

### 5.5 `/app/settings?section=billing` — Settings → Billing

- A section of the Settings page; the section lives in the URL
  (`/app/settings?section=billing`). `/app/billing` redirects there, keeping
  `top_up` (Stripe's top-up success/cancel URLs and email links use it).
  Billing is **admin only**: hidden from a member's nav, and a member opening
  it sees their Account section instead.
- Loads `billing.get` (failure toast `settings.billingSettings.notLoaded`, via query `meta.failure`) and the usage summary (usage spec; failure toast `settings.usageSettings.notLoaded`).
- Section title `settings.billingSettings.title`. Card 1 (rows label → value [+ action]):
  - **Plan**: `planLine` = `planCycle {plan, cycle}` ("Pro · yearly") or just label ("Free"). Actions: "Switch plan" → `/app/plans`; if `endsOn` → "Keep my plan" (`billing.resume`); else if plan not free/internal → destructive "Cancel" opening the cancel dialog.
  - **Renews on** (`fullDay(renewsOn)`) when set.
  - **Ends on** when `endsOn` set.
  - **Then**: `scheduled {plan: planLine(change), day}` ("Pro · monthly from Oct 4, 2027") when `scheduledChange`.
  - **Next invoice**: `money(nextInvoice)` when set.
  - **Includes**: `seatsLine(seats)` ("Up to 3 seats") + link "See pricing" → `/pricing`.
- Usage block (usage spec): title, "Add credits" button opening the top-up dialog, `?top_up=paid` → status `usage.topUpPaid`, usage cards.
- Card 2 (payment details); `billed` = billing loaded AND plan ≠ internal AND (plan ≠ free OR card OR invoices.length > 0). The "Edit" buttons show only when `billed`:
  - **Payment**: `cardLine` → `noCard` or `cardEnding {brand, last4}`; brand mapping `amex → American Express`, `diners → Diners Club`, `mastercard → Mastercard`, `unionpay → UnionPay`, else capitalised (`visa → Visa`). Edit → `billing.portal({ to: 'payment' })`.
  - **Billing email**: value or `notSet`; Edit → portal `details`.
  - **Invoice to**: `invoiceTo`; Edit → portal `details`.
  - **Tax ID**: value or `notSet`; Edit → portal `details`.
  - Portal: on success `window.location.href = url`; failure toast `portalNotOpened`; buttons disabled while busy.
- Top-ups list (usage spec): `usage.topUps`, rows `fullDay(paidOn)` + `topUpLine`, empty `usage.noTopUps`.
- **Invoices**: heading `invoices`; rows `fullDay(issuedOn)` | `money(total) · invoiceStatus.<status>` (Paid / Due / Payment failed) | "Download" link (`target=_blank rel=noopener`) only when `pdfUrl`; empty `noInvoices`. Newest first.
- **Cancel dialog**: title `cancelTitle`; text `cancelUntil {plan, day: fullDay(renewsOn)}` or `cancelNoDate {plan}`; buttons "Cancel plan" (destructive → `billing.cancel`, disabled while busy) and "Keep my plan" (closes). On success replace billing with the response and close; errors toast `notCancelled` / `notKept`. After cancel: Renews on and Next invoice disappear, Ends on appears, Cancel button gone, Keep my plan shown.
- **Top-up dialog** (usage spec): amount input in whole currency units (min 10, max 500, step 1, default 20), bounds text `usage.topUpBounds` (error color when invalid), preview `usage.topUpYouGet {amounts}`, note, "Cancel" / "Continue to payment" (disabled while invalid or busy) → `billing.topUp({ cents })` → redirect to Stripe URL; failure toast `usage.topUpNotOpened`. Invalid typed values: "5", "501", "".
- Free org: Plan "Free", no Renews/Next invoice, no Cancel, no Edit buttons (unless it paid before: then Edit shows), "No card yet", "No invoices yet."
- Internal org: no Cancel, no Edit.

### 5.6 Other surfaces

- Settings nav, app menu or home may link "Upgrade" to `/app/plans` (shell area).
- `me.get` exposes `plan` and `seats` (used by guards, Welcome label, Plans `current`).

### 5.7 i18n keys (copy verbatim from saas-base `apps/web/public/i18n/{en,es}.json`)

- `pricing.*`: `signIn, titleLead, titleRest, subtitle, perMonth, home, startFree, getPlan, noCardNeeded, plan.{free,pro,team,internal}, audience.{free,pro,team,internal}, feature.{everythingInPro,everythingInTeam,everythingInFreePlus,everythingInProPlus,coreFeatures,everythingInFree,prioritySupport,teamFeatures}, upTo, oneSeat, seatsUpTo, billedLower.{monthly,yearly}, billed.{monthly,yearly}, billedYearlyTotal, billingCycleSwitch.{billing,monthly,yearly,save}`.
- `plans.*`: `billingLoadFailed, priceFailed, switchFailed, annualTitle, compared, switchTitle.{monthly,yearly}, switchTo, per.{monthly,yearly}, dueToday, movesNow, then, nothingToday, staysOn.{monthly,yearly}, keepsUntil, titleLead, titleRest, subtitle, recommended, perMonthBilled, currentPlan, select, onlyAdmin, notNow, compareAll, annualModal, save, continueYearly, continueMonthly`.
- `checkout.*`: `openFailed, per.{monthly,yearly}, terms.{monthly,yearly}, orderSummary, back, subscribeTo, subtotal, tax, taxFromAddress, totalDueToday, payment, opening, cancelAnytime`.
- `welcome.*`: `titleLead, titleRest, receiptSent, settings, receiptEnd, goHome`.
- `settings.billingSettings.*`: `title, plan, planCycle, cycle.{monthly,yearly}, scheduled, switchPlan, keepMyPlan, cancel, renewsOn, endsOn, then, nextInvoice, includes, upTo, seePricing, payment, noCard, cardEnding, edit, billingEmail, notSet, invoiceTo, taxId, invoices, invoiceStatus.{paid,open,failed}, download, noInvoices, cancelTitle, cancelUntil, cancelNoDate, cancelPlan, notLoaded, notCancelled, notKept, portalNotOpened, usage.{title,addCredits,topUpTitle,topUpAmount,topUpBounds,topUpYouGet,topUpNote,topUpPay,topUpCancel,topUpNotOpened,topUpPaid,topUps,noTopUps}`.
- Page titles (`title.pricing`, `title.plans`, `title.checkout`, `title.welcome`, `title.settings`).
- Interpolation: saas-base used Transloco `{{x}}`; i18next uses `{{x}}` by default too — keep as is.

Key English strings for tests: "Pick the plan that fits.", "Your current plan",
"Select Team", "Switch to Team", "Recommended", "Only an admin of your
organization can change its plan.", "Pay less with yearly billing", "Team,
yearly Save 20% $480 a year instead of $600.", "Continue yearly", "Continue
monthly", "Pro · yearly", "Oct 4, 2027", "Up to 3 seats", "Visa ending 4242",
"Your organization keeps Pro until Oct 4, 2027, then moves to Free.",
"Pro · monthly from Oct 4, 2027".

---

## 6. Emails (`packages/emails`, rendered by the API mailer)

Templates are pure functions `(input) → { subject, html, text, replyTo }` built
with the shared email layout (masthead `APP_NAME`, heading lead/tail, blocks:
`rows`, `paragraph`, `actions`, footer). `APP_NAME` lives in one constant
(saas-base `'SaaS'`; arrakit `'Arrakit'`). Amounts/cards arrive pre-formatted
(`chargeOf`). Days rendered with `fullDay` / `shortDay` (English). Sent via
Resend in production; Mailpit in dev and e2e; recording mailer in tests (tests assert on
`sent[]`).

| Template          | When                                                                                                | Subject                                                             | Heading                                         | Body                                                                                                        | Actions                                                                          | Footer                                               | Recipients                         |
| ----------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------- |
| `receiptEmail`    | every paid, non-zero subscription invoice (`invoice.paid`: first payment, renewals, prorated moves) | `You're on {APP_NAME} {plan}`                                       | `You're on {plan}.` / `Thanks for paying.`      | rows: Plan `{plan} · {billing}`; Paid `{amount} · {card}`; Renews `fullDay(renewsOn)`                       | "Download invoice" → invoice PDF (or /app/billing); "Manage plan" → /app/billing | `Sent to the billing email.`                         | billing email (Stripe customer)    |
| `renewEmail`      | `invoice.upcoming` on a yearly price                                                                | `{APP_NAME} {plan} renews on {shortDay(renewsOn)}`                  | `{plan} renews` / `in {count(daysLeft,'day')}.` | `{amount} on {fullDay}, to {card}.`                                                                         | "Manage plan"                                                                    | `Yearly plans only.`                                 | billing email only                 |
| `failedEmail`     | `invoice.payment_failed` with a next attempt                                                        | `Your payment didn't go through`                                    | `Your payment` / `didn't go through.`           | `We couldn't charge {amount} to {card}. We'll try again in {n day(s)}. Your plan keeps working until then.` | "Update card" → /app/billing                                                     | `Sent to the billing email and organization admins.` | billing email + owners + admins    |
| `canceledEmail`   | admin cancels                                                                                       | `{plan} ends on {fullDay(endsOn)}` (e.g. `Pro ends on Oct 4, 2027`) | `{plan} ends` / `on {fullDay}.`                 | `Until then, nothing changes. After that you move to Free. Your data stays.`                                | `Keep {plan}` → /app/billing                                                     | `Sent to organization admins.`                       | cancelling admin + owners + admins |
| `downgradedEmail` | Stripe cancelled after failed retries (`payment_failed`)                                            | `{org} is back on Free`                                             | `{plan} ended.` / `{org} is on Free.`           | `We couldn't charge your card after a week of tries, so {plan} has ended. Your data stays.`                 | "Choose a plan" → /app/billing                                                   | `Sent to the billing email and organization admins.` | billing email + owners + admins    |

All links are absolute: `${WEB_URL}/app/billing` (tests stub `WEB_URL` to an https origin).
Template tests to port (`templates/plan.spec.ts`; Arrakit: `packages/emails/src/templates.test.ts`): receipt confirms plan/paid/renews;
renew says what/when/which card; failed says charge failed and retry; canceled names last day;
downgraded says back on Free.

---

## 7. Stripe price bootstrap script (`apps/api/scripts/stripe-prices.ts`)

Run once per Stripe account and after any price change:
`pnpm --filter api stripe:prices` (`node --env-file=.env scripts/stripe-prices.ts`
or `tsx`). Requires `STRIPE_SECRET_KEY`; logs `LIVE` vs `test` mode.

1. For each paid offer (Pro, Team): find product by
   `products.search({ query: "metadata['plan']:'<plan>'" })`, else create
   `{ name: '<APP_NAME> <Label>', metadata: { plan } }`.
2. For each cycle (monthly → interval `month`, yearly → `year`): lookup key
   `<prefix><plan>_<cycle>`; amount from `PLAN_OFFERS` (no price metadata: the
   app reads plan and cycle from the lookup key only).
   If the current price (by lookup key) is active with the same amount: log
   "already there". Else create a new recurring price
   with `transfer_lookup_key: true` and deactivate the old one (existing
   subscriptions keep their old price; new Checkouts charge the new one).
3. Credits product (`metadata.kind = 'credits'`, name `<APP_NAME> Credits`) with
   a `custom_unit_amount` price (`enabled`, `minimum = TOP_UP.minCents`,
   `maximum = TOP_UP.maxCents`, `preset = min(2 × min, max)`), lookup key
   `<prefix>credits_top_up`, currency `CURRENCY`; replaced (transfer lookup key,
   old deactivated) when currency/min/max differ.

---

## 8. Environment variables

| var                           | where | purpose                                                                                                                |
| ----------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`           | api   | `sk_test_…` / `sk_live_…`. Missing (any of the three) → `unconfiguredStripe()`: every Stripe call 503, webhook 401.    |
| `STRIPE_PUBLISHABLE_KEY`      | api   | returned to the browser by `billing.checkout`; not needed in the web env.                                              |
| `STRIPE_WEBHOOK_SECRET`       | api   | `whsec_…` endpoint signing secret; locally from `stripe listen --forward-to localhost:<API_PORT>/api/webhooks/stripe`. |
| `WEB_URL`                     | api   | web origin for return/success/cancel URLs, portal return URL, email links; also a Better Auth trusted origin.          |
| `SITE_URL`                    | web   | landing site link on Pricing ("Home").                                                                                 |
| `STRIPE_FAKE`                 | api   | `1`: in-memory fake gateway (dev/e2e only; refused in production).                                                     |
| `RESEND_API_KEY`, `MAIL_FROM` | api   | mailer (mail spec); unset → Mailpit (`MAILPIT_URL`) or console.                                                        |

Document all of them in `apps/api/.env.example`.

---

## 9. Dependencies

API: `stripe`. Web: `@stripe/stripe-js`. Shared: none beyond zod. Tests:
`vitest`, `@testing-library/react`, `@testing-library/user-event`, `@playwright/test`,
`@electric-sql/pglite`.

---

## 10. Background jobs

None in this area. All Stripe work is synchronous in request handlers or the
webhook; reliability comes from Stripe's webhook redelivery (500 → retry) plus
idempotency (ledger idempotency keys `checkout:<sessionId>` /
`reversal:<reversalId>`, re-reading the subscription from Stripe). Emails are
not deduplicated. Emails are sent inline (not queued) and failures are logged only.
(Storage purge after organization deletion is queued by the organizations area.)

---

## 11. Business rules & edge cases (summary checklist)

- Only Stripe's webhook (and `billing.change`, from the subscription state Stripe returns) changes `organizations.plan`. Checkout never does.
- Checkout only from Free; a paying org switches via Plans/Billing (409 otherwise). There is never a second subscription.
- Up a plan = immediate, prorated charge (`always_invoice`, `error_if_incomplete`); down a plan or cycle change = at renewal via subscription schedule with its own new billing cycle anchor, no refund; promo discounts preserved.
- Change drops a pending cancellation; cancel drops a pending change.
- Cancel = at period end; plan kept until Stripe deletes the subscription; resume undoes before period end.
- `past_due` and `trialing` keep the paid plan; `canceled`/`unpaid`/`incomplete*`/`paused` → Free.
- Customer id survives going back to Free (reuse at next Checkout; invoices and card still visible).
- A cancelled old subscription never downgrades an org that has a newer subscription.
- `internal`: never sold, never moved by the webhook, cannot cancel/change/portal (409), shows no Cancel/Edit, checkout 409.
- Receipts: one per paid, non-zero subscription invoice (`invoice.paid` with a `subscription*` billing reason), to the billing email; subscription events never send one; nothing stored to deduplicate.
- Failed payment emails until Stripe's last retry; last retry silent; then downgrade email if Stripe cancels for `payment_failed`.
- Renewal notice only for yearly prices, only to the billing email.
- Never leak Stripe error messages, email addresses or email bodies in responses or logs.
- Every `/api/rpc/*` write requires a trusted `Origin` (CSRF; app-wide middleware, 403 `Use the app.`).
- Deleting an organization ends its subscription first; failure aborts the delete.
- Seats: `PLAN_OFFERS[plan].seats` caps members + pending invitations (members spec); a downgrade does not remove members.

---

## 12. saas-base tests worth porting

API (Vitest; integration with PGlite + Better Auth test utils to create users,
organizations, sessions/cookies; fake Stripe; recording mailer):

- `libs/shared/plans/src/plans.spec.ts` — all (pure).
- `subscription-plan.spec.ts` — all (pure).
- `billing-mail.test.ts` — all (pure: recipients, chargeOf, adminsOf, downgradeDue, sendMails; `daysUntil` in `packages/emails/src/copy.test.ts`).
- `settle-event.test.ts` — all (against PGlite or an in-memory repo).
- `real-stripe.test.ts` — against a mocked `Stripe` client: `createStripeGateway` (unconfigured without each env var, real with all three, fake with `STRIPE_FAKE=1`); `guardedStripe` (declined card 402, anything else 502, both logged; unconfigured 503 unlogged; webhook signature failures pass through; refusals built by the given factory); Checkout with the admin's email and returning customer; changeNow; changeAtRenewal keeps `organizationId` and discounts in both phases, `billing_cycle_anchor: 'phase_start'`; reads plan/period/item/schedule/anchor/cancellation reason; customer email and card; each price looked up once; cancel/resume; top-up Checkout and payment; endNow; `planKeyOf` from the lookup key; `mapStripeEvent` (subscription Checkout, non-top-up payment ignored, subscription changes, invoice events, no subscription ignored).
- `routers/billing.test.ts` → `plans.list` (sold plans cheapest first, no Internal, public); `billing.checkout`: owner gets clientSecret + publishableKey and return URL; reuses customer; 502 own words; member 403; no session 401; non-Free 409 with exact message; invalid inputs 400; foreign Origin 403; no Stripe → 503 and app still boots. `billing.get` (Free asks Stripe nothing; paying org full view; cancelled; scheduled move down; back on Free keeps invoices/card; 502 own words; member 403), `previewChange` (now with FAKE_PRORATION and next invoice 48000; renewal with 0 today and next 2000 on renewal day; same plan 409; Free 409), `change` (up now → plan team at once; down at renewal → plan unchanged; 402 declined card plan unchanged; foreign Origin 403 nothing changed), cancel/resume (records both, plan stays; Internal 409 for cancel and change; Free 409; member 403), portal (URL + return URL + target; never-billed 409), cancellation email (to cancelling admin, subject `Pro ends on Oct 4, 2027`, link to /app/billing, resume sends nothing; all owners+admins never members; send failure still cancels and logs without address/body).
- `top-up.spec.ts` → `billing.topUp` + webhook top-up paths (usage spec owns the ledger asserts).
- `stripe-webhook.test.ts` → Hono webhook route: forged signature 401; missing signature 401; subscription paid → Pro; replay idempotent; cancelled → Free; ignored event 204; invoice events never change plan; Stripe unreadable → 500; receipt (to the billing email on a paid subscription invoice with plan/charge/PDF; names the current plan after a move; links Billing without an invoice page; none for a subscription event or a zero invoice; send failure → 204 logged); failed charge (billing + owner + admins, not members; dedupe owner = billing email; last try silent; send failure 204); downgrade (recipients; replay silent; admin cancel silent; failure 204 still Free); renewal notice (billing email only, yearly only, failure 204); no Stripe → 401.
- `organization-settings.int.spec.ts` (setPlan / setStripeCustomer parts).
- `packages/emails/src/templates.test.ts`.

Web (Vitest + React Testing Library, API mocked at the oRPC client / MSW level):

- `pricing.page.spec.ts`: every plan to a visitor; yearly prices vs struck monthly; switching to monthly + "Save 20%"; seats then features; CTA links (`/signup`, `/signup?plan=pro&cycle=yearly`, `/signup?plan=team&cycle=yearly`, `/signin`); signed-in "Get Team" → checkout.
- `plans.page.spec.ts`: recommended + own plan marked; top plan offered the switch down; paying cycle marked and other cycle offered; switch up shows today's charge then lands on Billing; switch down at renewal nothing today; preview failure toast; paying org never sent to Checkout even if billing fails; yearly select → checkout; monthly select → annual dialog and close; dialog → checkout yearly/monthly; member sees no buy buttons + onlyAdmin text; footer links.
- `checkout.page.spec.ts`: summary yearly/monthly; back to Plans; member redirected; invalid query redirected (5 cases); API refusal message shown; Stripe Embedded Checkout mounted with the session (mock `@stripe/stripe-js`).
- `checkout-choice.test.ts`: `checkoutChoice` accept/refuse tables.
- `welcome.page.spec.ts`: welcome + plan name; Free → Plans; links.
- `billing-settings.spec.ts`: rows (plan, renews, next invoice, includes, see pricing link); payment details; card brand mapping; invoices newest first + Download only with PDF; Free bills nothing; Internal no Cancel/Edit; cancel flow + keep my plan; scheduled move down; each Edit opens portal with the right target (Payment → payment, others → details); portal failure toast; load failure toast; usage/top-up dialog cases (usage spec).

E2E (Playwright, with `STRIPE_FAKE=1` or Stripe test mode):

- Visitor Pricing → Get Pro → sign up → create organization → Checkout page opens (summary shown).
- Admin on Free: Plans → Select Team monthly → annual dialog → Checkout.
- Simulated webhook (signed fake event posted to `/api/webhooks/stripe`) → Welcome shows "Welcome to Team." → Billing shows plan, renewal, invoices.
- Paying admin: Plans → Switch to Team → confirmation shows amount due today → Billing shows Team. Cancel → Ends on → Keep my plan.
- Member: Plans shows no buy buttons; the Billing section is not reachable; `/app/checkout?...` redirects to Plans.
