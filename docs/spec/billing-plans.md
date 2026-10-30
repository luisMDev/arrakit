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
`libs/shared/emails/src/templates/plan.ts`, `apps/api/src/testing/fake-stripe.ts`.

---

## 1. Shared package: plans catalog (`packages/plans`, e.g. `@arrakit/plans`)

Framework-free TypeScript, imported by api, web and the price script. Port it
**verbatim** (logic and numbers), with its unit tests.

### 1.1 Plans

```ts
export const PLANS = ['free', 'pro', 'team', 'internal'] as const; // order = rank
export type Plan = (typeof PLANS)[number];
export const PLAN_LABELS = { free: 'Free', pro: 'Pro', team: 'Team', internal: 'Internal' };
export const CURRENCY = 'usd'; // Stripe lowercase ISO 4217
export function isPlan(value: unknown): value is Plan; // exact, case-sensitive match
```

| plan     | monthlyCents | yearlyCents | seats | monthlyGrantCents |
|----------|-------------:|------------:|------:|------------------:|
| free     | 0            | 0           | 1     | 100               |
| pro      | 2_000        | 19_200      | 3     | 1_000             |
| team     | 5_000        | 48_000      | 10    | 3_000             |
| internal | 0            | 0           | 100   | 10_000            |

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
- Exports: `Metric`, `METRIC_KEYS`, `isMetric`, `metricOf`, `metricAmount(metric, cents)` (floor),
  `metricAmounts(cents)`, `planGrant(plan)`, `isTopUpAmount(cents)` (integer within bounds),
  `UsagePeriod`, `usagePeriod(anchor, now)` (Stripe-like month arithmetic, day clamped to
  month end, UTC), `splitConsumption`, `MetricSums`, `MetricBalance`, `metricBalance`.

### 1.3 Unit tests to port (`plans.spec.ts`, all of them)
- Sold plans cheapest first by monthly price; Internal last, above Team.
- `PLAN_LABELS.internal === 'Internal'`.
- `isPlan` accepts the 4 ids; refuses `'enterprise'`, `'Pro'`, `'Internal'`, `'internal '`, `''`, `null`.
- `metricAmounts(2000)` → `{ credits: 2000, storage_gb: 200 }`; `metricAmount('storage_gb', 1005)` → 100.
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

priceLookupKey(plan, cycle) => `saas_${plan}_${cycle}`   // Stripe lookup key
planOfSubscription(status, lookupKey) => Plan
subscriptionOfLookupKey(lookupKey) => PaidSubscription | null
whenChangeApplies(from, to) => 'now' | 'renewal' | null
```

- Stripe lookup key prefix: saas-base uses `saas_`. **arrakit uses `arrakit_`**
  (one constant, `PRICE_KEY_PREFIX`); inside the app the key is the "plan key"
  `pro_yearly` (no prefix).
- `planOfSubscription`: statuses `active`, `trialing`, `past_due` keep the paid
  plan named by the key's first segment (`pro_yearly` → `pro`); any other status
  (`canceled`, `unpaid`, `incomplete`, `incomplete_expired`, `paused`) → `free`.
  A key that names no paid plan → `free` (so no price can ever set `internal`).
- `subscriptionOfLookupKey`: exactly `<paidPlan>_<cycle>`; `null`,
  `'enterprise_yearly'`, `'pro_weekly'`, `'pro'` → null; extra segments → null.
- `whenChangeApplies`: higher rank → `'now'` (any cycle); same plan & cycle →
  `null`; otherwise (down a plan, or same plan other cycle) → `'renewal'`.

Tests to port (`subscription-plan.spec.ts`): all.

### 2.2 Stripe gateway (`stripe-gateway.ts`)

An interface the app depends on, so tests inject an in-memory fake. Created by
`createStripeGateway(env)`; returns **null when any of `STRIPE_SECRET_KEY`,
`STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` is missing**. With null:
every billing procedure answers 503 ("Payments are not set up yet."), the
webhook answers 401, the rest of the app boots normally.

Inject it via the Hono/oRPC context (e.g. `context.stripe: StripeGateway | null`).

```ts
interface StripeGateway {
  readonly publishableKey: string;
  checkout(req: CheckoutRequest): Promise<{ clientSecret: string }>;
  topUpCheckout(req: TopUpRequest): Promise<{ url: string }>;
  topUpPayment(paymentIntentId): Promise<{ organizationId; cents; total } | null>;
  event(rawBody: Buffer|string, signature: string): BillingEvent | null; // throws on bad signature
  subscription(id): Promise<SubscriptionState>;           // always fresh from Stripe
  billing(customerId, subscriptionId | null): Promise<BillingSnapshot>;
  price(choice: PaidSubscription): Promise<Money>;
  previewNow(subscriptionId, choice): Promise<Money>;      // prorated amount due today
  changeNow(subscriptionId, choice, requestedBy: string): Promise<void>;
  changeAtRenewal(subscriptionId, choice, requestedBy: string): Promise<void>;
  markReceipted(subscriptionId, planKey: string): Promise<void>;
  cancelAtPeriodEnd(subscriptionId, cancel: boolean): Promise<void>;
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
  requestedBy: string|null /* metadata.requestedBy */;
  receiptFor: string|null  /* metadata.receiptFor, a plan key */;
  cancellationReason: string|null /* cancellation_details.reason */;
  status; lookupKey: string|null /* plan key via planKeyOf */; anchor: Date /* billing_cycle_anchor */
}
SubscriptionSnapshot = { status; lookupKey; periodEnd /* unix s */; cancelAtPeriodEnd;
  amount: Money|null; scheduled: { lookupKey; at /* unix s */; amount: Money|null } | null }
BillingSnapshot = {
  subscription: SubscriptionSnapshot | null;
  customer: { email; name; taxId; card: { brand; last4 } | null } | null;
  invoices: { id; created /* unix s */; total: Money; status: 'paid'|'open'|'uncollectible'; pdfUrl|null }[] // newest first
}
BillingEvent =
  | { kind: 'subscription'; subscriptionId|null; organizationId|null; previousLookupKey?: string|null }
  | { kind: 'top-up'; sessionId; organizationId|null; customerId|null; cents; paid: boolean }
  | { kind: 'payment-reversed'; reversalId; paymentIntentId; amount }
  | { kind: 'invoice-upcoming'; subscriptionId; amount: Money }
  | { kind: 'invoice-failed'; subscriptionId; amount: Money; nextAttempt: number|null }
  | { kind: 'invoice-paid'; subscriptionId; invoiceId; amount: Money; pdfUrl|null }
```

#### Real implementation (Stripe Node SDK, latest)

- **Price lookup** `priceOf(choice)`: `prices.list({ lookup_keys: [priceLookupKey], active: true, limit: 1 })`;
  throws if none. No price id ever lives in env.
- **`planKeyOf(price)`**: `${metadata.plan}_${metadata.cycle}` when both set, else
  `lookup_key` without the prefix, else null. (Metadata never moves; the lookup
  key moves to a new price when prices change, and old subscriptions must still
  read their plan.)
- **`checkout`**: `checkout.sessions.create({ ui_mode: 'embedded_page' /* 'embedded' on older API versions; use whatever the installed SDK names Embedded Checkout */, mode: 'subscription', line_items: [{ price, quantity: 1 }], client_reference_id: organizationId, subscription_data: { metadata: { organizationId, requestedBy: email } }, allow_promotion_codes: true, billing_address_collection: 'required', tax_id_collection: { enabled: true }, return_url })` plus either
  `{ customer: customerId, customer_update: { name: 'auto', address: 'auto' } }` (returning customer; required by Stripe for tax ID collection) or `{ customer_email: email }`. Throws if no `client_secret`.
- **`topUpCheckout`**: hosted Checkout, `mode: 'payment'`, `line_items: [{ price_data: { currency: CURRENCY, product: <Credits product>, unit_amount: cents }, quantity: 1 }]`, `client_reference_id`, `metadata: { kind: 'top_up', organizationId, requestedBy: email }`, `payment_intent_data.metadata: { kind: 'top_up', organizationId, cents: String(cents) }`, `invoice_creation: { enabled: true, invoice_data: { metadata: { kind: 'top_up' } } }`, customer as above or `{ customer_email, customer_creation: 'always' }`, `billing_address_collection: 'required'`, `tax_id_collection.enabled`, `success_url`, `cancel_url`. Credits product found via price with lookup key `<prefix>credits_top_up`, memoised per process (reset on failure).
- **`topUpPayment`**: `paymentIntents.retrieve`; returns `{ organizationId, cents: Number(metadata.cents), total: intent.amount }` only when `metadata.kind === 'top_up'`.
- **`event`**: `stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)` (or `constructEventAsync` under Hono/Web Crypto). Mapping:
  - `refund.created`, `charge.dispute.created` → `payment-reversed` (null if no payment_intent).
  - `checkout.session.completed` / `checkout.session.async_payment_succeeded` with `mode === 'payment'`: if `metadata.kind === 'top_up'` → `top-up` with `organizationId = metadata.organizationId ?? client_reference_id`, `customerId`, `cents = amount_subtotal ?? 0`, `paid = payment_status === 'paid'`; other payment sessions → null. `async_payment_succeeded` in subscription mode → null.
  - `checkout.session.completed` (subscription mode) → `subscription` with `subscriptionId = session.subscription`, `organizationId = client_reference_id`.
  - `customer.subscription.created|updated|deleted` → `subscription` with `organizationId = metadata.organizationId ?? null` and `previousLookupKey` = plan key of `previous_attributes.items.data[0].price` **only if it differs** from the current item's plan key (a renewal changes the items list but not the price → null).
  - `invoice.upcoming` → `invoice-upcoming` (`amount_due`, currency).
  - `invoice.payment_failed` → `invoice-failed` with `nextAttempt = next_payment_attempt` (may be null).
  - `invoice.paid` → `invoice-paid` only when `billing_reason` ∈ {`subscription_cycle`, `subscription_update`} (`subscription_create`, `manual`, `subscription_threshold`, `upcoming` → null); `amount = amount_paid`, `pdfUrl = invoice_pdf`.
  - Invoice subscription id read from `invoice.parent.subscription_details.subscription` (id or expanded object). No subscription → null.
  - Anything else → null.
- **`subscription(id)`**: `subscriptions.retrieve`; maps metadata, `cancellation_details.reason`, status, plan key of item 0, `anchor = new Date(billing_cycle_anchor * 1000)`.
- **`billing`**: in parallel: `customers.retrieve(customerId, { expand: ['invoice_settings.default_payment_method', 'tax_ids'] })`, `subscriptions.retrieve(subscriptionId, { expand: ['default_payment_method', 'schedule.phases.items.price'] })` (if any), `invoices.list({ customer, limit: 24 })`. Card = subscription default PM, else customer's invoice default PM. Deleted customer → `customer: null`. Invoices: only statuses `paid|open|uncollectible` (drafts/void dropped). Snapshot: `periodEnd = item.current_period_end ?? billing_cycle_anchor`; `scheduled` = schedule phase whose `start_date >= periodEnd` (its price's plan key, start date and amount).
- **`price`**: unit amount of the price (throws if none).
- **`previewNow`**: `invoices.createPreview({ subscription, subscription_details: { items: [{ id: item.id, price }], proration_behavior: 'always_invoice', proration_date: now } })` → `{ amount: amount_due, currency }`.
- **`changeNow`**: release any schedule; `subscriptions.update(id, { items: [{ id: item.id, price }], proration_behavior: 'always_invoice', payment_behavior: 'error_if_incomplete', cancel_at_period_end: false, metadata: { requestedBy } })`. A declined card throws `StripeCardError` and leaves the subscription unchanged.
- **`changeAtRenewal`**: release any schedule; update `cancel_at_period_end: false` and merged metadata `{...metadata, requestedBy}`; `subscriptionSchedules.create({ from_subscription })`; then `subscriptionSchedules.update(schedule, { end_behavior: 'release', phases: [ { items: current price/qty, start_date, end_date, discounts, metadata }, { items: [{ price: new, quantity: 1 }], duration: { interval: cycle === 'yearly' ? 'year' : 'month' }, billing_cycle_anchor: 'phase_start', proration_behavior: 'none', discounts, metadata } ] })`. Discounts copied from the current phase (keeps a promo code). Both phases carry `requestedBy` metadata. (Older Stripe API versions use `iterations: 1` instead of `duration`.)
- **`markReceipted`**: `subscriptions.update(id, { metadata: { receiptFor: planKey } })` (Stripe merges keys).
- **`cancelAtPeriodEnd(id, cancel)`**: on cancel, release a pending schedule first; then `update({ cancel_at_period_end: cancel })`.
- **`endNow`**: no-op if already `canceled`; else `subscriptions.cancel(id)` (no refund).
- **`portal`**: `billingPortal.sessions.create({ customer, configuration, return_url, ...(to === 'payment' && { flow_data: { type: 'payment_method_update' } }) })`. Configuration found among active ones by `metadata.app === 'billing'` (saas-base used key `solon`), else created with `invoice_history`, `payment_method_update`, `customer_update` (`email`, `name`, `address`, `tax_id`) enabled and `subscription_cancel` / `subscription_update` **disabled** (plan changes stay in the app). Memoised per process, reset on failure.

#### Fake gateway (`apps/api/src/testing/fake-stripe.ts`)

In-memory implementation used by every API test. Records `checkouts`,
`topUps`, `changes` (`{ subscriptionId, choice, when: 'now'|'renewal' }`),
`cancellations` (`{ subscriptionId, cancel }`), `ended`, `portals`
(`{ customerId, returnUrl, to }`). Holds `subscriptions` (set by
`subscribe(state)`) and `customers` (set by `bill(customerId, snapshot)`).
Constants: `FAKE_STRIPE_SIGNATURE = 't=1,v1=fake-stripe-signature'`,
`FAKE_PRORATION = { amount: 120_000, currency: 'usd' }`; prices = `PLAN_OFFERS`
in US cents; publishable key `'pk_test_fake'`; portal URLs
`https://billing.stripe.test/...`. Its `event()` parses the raw body as a
`BillingEvent` JSON (kind defaults to `subscription`; `{}` = ignored event) and
throws on any other signature. `changeNow`/`changeAtRenewal` record
`requestedBy` on the held subscription; `markReceipted` records `receiptFor`.

Optional (arrakit addition, recommended for Playwright e2e without Stripe keys):
`STRIPE_FAKE=1` makes `createStripeGateway` return the fake, so Plans → Checkout
→ webhook flows can be exercised. Never enable it in production.

### 2.3 Applying a subscription event (`apply-billing-event.ts`) — port with tests

```ts
findOrganization(db, organizationId|null, what) -> { kind:'found', organizationId, organization } | { kind:'ignored', reason }
findSubscriptionOrganization(db, stripe, subscriptionId|null, eventOrganizationId?) -> found + subscription | ignored
applyBillingEvent(db, stripe, event: SubscriptionEvent) -> BillingOutcome
BillingOutcome = { kind:'ignored', reason } | { kind:'applied', organizationId, organization:{name,slug}, previousPlan, plan, subscription }
```

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
6. Otherwise write: `plan`, `stripe_customer_id = subscription.customerId`,
   `stripe_subscription_id = plan === 'free' ? null : subscription.id`,
   `usage_anchor = plan === 'free' ? null : subscription.anchor`. The customer
   id is kept on Free (a later Checkout reuses it).
7. Return `previousPlan` (plan before the write) for receipts/downgrade emails.

Tests to port (`apply-billing-event.spec.ts`): grant anchor written; active
subscription → plan + customer + subscription recorded; previousPlan free on
first payment and pro on replay; internal never moved (active/canceled);
idempotent on double delivery; `canceled`/`unpaid` → free with subscription
forgotten and customer kept; replaced subscription cancelled → plan kept;
organization from event when metadata lacks it; ignored for no subscription /
no organization / organization gone / malformed id (no writes).

### 2.4 Billing view (`billing-view.ts`) — pure, used by GET and by mutations

`dayOf(unixSeconds) => 'YYYY-MM-DD'` (UTC).

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
- `daysUntil(unixSeconds, nowMs)`: ceil of days, minimum 1 (3 days → 3, 1 hour → 1, past → 1, 2.1 days → 3).
- `adminsOf(members)`: emails with role `owner` or `admin` (never `member`).
- `shouldSendReceipt({ previousLookupKey, previousPlan, plan, lookupKey, receiptFor })`:
  false if `lookupKey` isn't a paid plan key, or its plan ≠ `plan`, or `receiptFor === lookupKey`;
  else `rank(current.plan) > rank(previous?.plan ?? previousPlan)`.
  Truth table (port as `it.each`):

  | case | prevKey | prevPlan | plan | key | receiptFor | → |
  |---|---|---|---|---|---|---|
  | free → pro_monthly | null | free | pro | pro_monthly | null | true |
  | pro_yearly → team_monthly | pro_yearly | team | team | team_monthly | pro_yearly | true |
  | pro_monthly → pro_yearly | pro_monthly | pro | pro | pro_yearly | pro_monthly | false |
  | pro_monthly → team_yearly | pro_monthly | pro | team | team_yearly | pro_monthly | true |
  | free → pro_yearly | null | free | pro | pro_yearly | null | true |
  | team_yearly → pro_yearly | team_yearly | team | pro | pro_yearly | team_yearly | false |
  | monthly renewal | pro_monthly | pro | pro | pro_monthly | null | false |
  | yearly renewal | pro_yearly | pro | pro | pro_yearly | null | false |
  | pro_yearly → pro_monthly | pro_yearly | pro | pro | pro_monthly | pro_yearly | false |
  | replay of move to yearly | pro_monthly | pro | pro | pro_yearly | pro_yearly | false |
  | replay of first payment | null | free | pro | pro_yearly | pro_yearly | false |
  | no prev key, already pro | null | pro | pro | pro_yearly | null | false |
  | no price | null | free | pro | null | null | false |
  | cancelled | null | pro | free | pro_yearly | null | false |

- `cycleReceiptDue({ lookupKey, receiptFor })`: current cycle yearly AND settled
  (`receiptFor`) monthly on the same plan. Cases: pro_monthly→pro_yearly true;
  pro_yearly/pro_yearly false; null/pro_yearly false; team_monthly/pro_yearly false; pro_monthly/pro_monthly false.
- `downgradeDue({ previousPlan, plan, cancellationReason })`:
  `cancellationReason === 'payment_failed' && previousPlan !== 'free' && plan === 'free'`.
- Mail builders, one `Mail { to, subject, html, text, replyTo? }` per recipient,
  all with links to `${WEB_URL}/app/billing`:
  `receiptMails`, `canceledMails`, `failedMails`, `downgradedMails`, `renewMails` (see §6).

---

## 3. Data model (Drizzle)

Billing lives on the `organizations` table (which is also Better Auth's
organization model: declare these as `additionalFields` on the organization
plugin, or keep them in the Drizzle table Better Auth maps to, with
`input: false` so clients cannot set them).

| column | type | notes |
|---|---|---|
| `plan` | `text NOT NULL DEFAULT 'free'` + `CHECK (plan IN ('free','pro','team','internal'))` | typed `$type<Plan>()`. Only the webhook (and the synchronous read-back after a change) moves it. |
| `stripe_customer_id` | `text UNIQUE NULL` | set on first payment (subscription or top-up); kept when going back to Free. |
| `stripe_subscription_id` | `text NULL` | the live subscription; null on Free. |
| `usage_anchor` | `timestamptz NULL` | subscription `billing_cycle_anchor` on a paid plan; null on Free (usage months then count from `created_at`). |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | existing. |

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
- `usage.credit(cents, { idempotencyKey })` / `usage.reverse(cents, { idempotencyKey })`
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

Common middleware for every `billing.*` procedure:
1. **Session required** (Better Auth session) → 401.
2. **Active organization membership required**; no organization → 404.
3. **Admin only**: role `owner` or `admin`; `member` → 403.
4. **Trusted origin** for every mutation: request `Origin` must be one of Better
   Auth's trusted origins (the web URL) → 403 with the per-procedure message.
   (Guards CSRF on cookie-auth mutations.)
5. Stripe gateway present, else 503 `Payments are not set up yet.` (Checks run
   in the order listed per procedure below; validation errors come first.)
6. The organization is re-read from the DB (`organizationOf`) — never trust the
   session's cached copy.

Stripe call wrapper `call(organization, what, run, refusal = LOAD_REFUSAL)`:
- `LOAD_REFUSAL = "Couldn't load billing from Stripe. Try again in a minute."`
- `CHANGE_REFUSAL = "Couldn't reach Stripe, so nothing changed. Try again in a minute."`
- Already-HTTP/ORPC errors pass through.
- `err.type === 'StripeCardError'` → 402 `Your card was declined. Update it under Payment, then try again.`
- Anything else → log `"<what> for organization <id> failed: <message>"` and 502 with `refusal`.
  **Never** expose Stripe's own message or status.

Shared Zod schemas:

```ts
const paidChoice = z.object({ plan: z.enum(['pro','team']), cycle: z.enum(['monthly','yearly']) });
const money = z.object({ amount: z.number().int(), currency: z.string() });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const billing = z.object({
  plan: z.enum(PLANS), cycle: z.enum(BILLING_CYCLES).nullable(),
  renewsOn: day.nullable(), endsOn: day.nullable(), nextInvoice: money.nullable(),
  scheduledChange: paidChoice.extend({ on: day }).nullable(),
  seats: z.number().int(), card: z.object({ brand: z.string(), last4: z.string() }).nullable(),
  billingEmail: z.string().min(1).nullable(), invoiceTo: z.string(), taxId: z.string().min(1).nullable(),
  invoices: z.array(z.object({ id: z.string(), issuedOn: day, total: money,
    status: z.enum(['paid','open','failed']), pdfUrl: z.string().min(1).nullable() })), // newest first
});
const planOffer = z.object({ plan: z.enum(PLANS), monthly: money, yearly: money, seats: z.number().int() });
```

### 4.1 `plans.list` — public catalog (new in arrakit; saas-base built it client-side)
- Auth: none. Input: none.
- Output: `planOffer[]` = PLANS minus `internal`, cheapest first:
  `{ plan, monthly: { amount: monthlyCents, currency: 'usd' }, yearly: { amount: yearlyCents, currency: 'usd' }, seats }`.
- The web may equally compute it from `@arrakit/plans` without a request; either
  way, screens must render from this shape.
- "Organization plans" for the in-app Plans screen = `{ plans: plans.list(), current: me.organization.plan }`.

### 4.2 `billing.checkout` (saas-base `POST /api/billing/checkout`)
- Input: `paidChoice`. Anything else → 400 (e.g. `enterprise`, `free`, `weekly`, missing cycle); nothing opened.
- Order: session (401) → admin (403) → trusted origin (403 `Pay from the app.`) → Stripe (503) → org on non-Free plan → 409 `Your organization is on <Label>. Switch plans in Settings → Billing.` (also for `internal`).
- Calls `stripe.checkout({ organizationId, plan, cycle, customerId: organization.stripeCustomerId, email: session.user.email, returnUrl: `${WEB_URL}/app/welcome?session_id={CHECKOUT_SESSION_ID}` })`.
- Stripe failure → log `checkout for organization <id> failed: <reason>` and 502 `Couldn't open the payment form. Try again in a minute.`
- Output: `{ clientSecret: string, publishableKey: string }`.
- Does **not** change the plan; only the webhook does.
- Reuses an existing customer id (organization that paid before).

### 4.3 `billing.get` (saas-base `GET /api/billing`)
- Admin only. Output: `billing`.
- No `stripe_customer_id` → `billingView(org, null)` without calling Stripe and
  **without requiring Stripe to be configured** (Free org shows: plan free, cycle null, all null, seats 1, invoiceTo = org name, invoices []).
- Else `stripe.billing(customerId, stripeSubscriptionId)` via `call` (502 LOAD_REFUSAL on failure) → `billingView`.

### 4.4 `billing.previewChange` (saas-base `POST /api/billing/change/preview`)
- Input: `paidChoice`. Trusted origin message: `Change plans from the app.`
- `paidOrganization`: org on `internal` → 409 `Your organization is on Internal: there is nothing to bill.`; org on Free or missing customer/subscription ids → 409 `Your organization is on Free. Pick a plan to pay for it.`; then loads `stripe.billing(...)` (502 on failure); if the subscription is missing or its plan key isn't a known paid plan → log `organization <id>: subscription <sub> bills no known price` and 502 LOAD_REFUSAL.
- `applies = whenChangeApplies(current, choice)`; null → 409 `Your organization is already on <Label>, billed <cycle>.`
- In parallel: `applies === 'now' ? stripe.previewNow(subscriptionId, choice) : null`, `stripe.price(choice)`.
- Output:
  ```ts
  { applies: 'now'|'renewal',
    on: day,        // today (UTC) when now; dayOf(periodEnd) at renewal
    dueToday: money,// prorated preview when now; { amount: 0, currency } at renewal
    nextInvoice: money } // one period of the new price
  ```

### 4.5 `billing.change` (saas-base `POST /api/billing/change`)
- Same input/guards/conflicts as preview.
- `now` → `stripe.changeNow(sub, choice, session.user.email)`; `renewal` →
  `stripe.changeAtRenewal(...)`; via `call(..., CHANGE_REFUSAL)` (402 on declined card; plan unchanged).
- Then immediately runs `applyBillingEvent({ kind: 'subscription', subscriptionId, organizationId })`
  (read-back so a move up gets the bigger limits on this very response; the
  webhook will converge to the same state).
- Output: `billing` (re-read organization + fresh snapshot).
- Drops a pending cancellation and replaces any pending scheduled change.
- Records `requestedBy` (admin email) on the subscription metadata in both modes.

### 4.6 `billing.cancel` / `billing.resume` (saas-base `POST /api/billing/cancel|resume`)
- Input: none. Trusted origin `Change plans from the app.`
- Internal → 409 `Your organization is on Internal: there is nothing to bill.` (no Stripe call).
- Free or no subscription id → 409 `Your organization is on Free: there is nothing to cancel.`
- `stripe.cancelAtPeriodEnd(sub, cancel)` via `call(..., CHANGE_REFUSAL)`. Cancel also drops a pending scheduled change.
- Re-reads snapshot; output `billingView(organization, snapshot)`.
- The plan is **not** changed here: it stays until Stripe ends the subscription (webhook → Free).
- **Cancellation email (cancel only)**: if the snapshot has a subscription, send
  `canceledMails` with `plan = PLAN_LABELS[org.plan]`, `endsOn = dayOf(periodEnd)`,
  `to = recipients(cancellingAdminEmail, ...adminsOf(members))`. Any failure
  building/sending is logged as `organization <id>: cancellation email not sent`
  (stack only; **never the address or the body**) and never fails the request.
  No subscription in snapshot → log `organization <id>: cancellation email not sent, Stripe shows no subscription`.
  Resume sends nothing.

### 4.7 `billing.portal` (saas-base `POST /api/billing/portal`)
- Input: `{ to: 'payment' | 'details' }`. Trusted origin `Change billing from the app.`
- Internal → 409 (Internal message). No `stripe_customer_id` → 409 `Your organization has no billing details yet. Pick a plan first.`
- `stripe.portal(customerId, `${WEB_URL}/app/billing`, to)` via `call` (502 LOAD_REFUSAL).
- Output `{ url }`; the web navigates the browser there.

### 4.8 `billing.topUp` (saas-base `POST /api/billing/top-up`; details in the usage spec)
- Input: `{ cents }` validated with `isTopUpAmount` (integer 1000..50000) → 400 otherwise.
- Admin only; trusted origin `Add credits from the app.`; Stripe required (503).
- `stripe.topUpCheckout({ organizationId, cents, customerId, email, successUrl: `${WEB_URL}/app/billing?top_up=paid`, cancelUrl: `${WEB_URL}/app/billing` })` via `call`.
- Output `{ url }`. Allowed on any plan (Free included).

### 4.9 Organization deletion (cross-reference, organizations spec)
Before deleting an organization with a `stripe_subscription_id`: no gateway →
503, else `stripe.endNow(sub)`; failure → log and 502
`Couldn't cancel your plan with Stripe, so nothing was deleted. Try again in a minute.`; nothing deleted.

### 4.10 Stripe webhook — plain Hono route
- Path: **`POST /api/webhooks/stripe`** (saas-base: `POST /webhooks/stripe`;
  outside OpenAPI/oRPC). Not session-authenticated, no origin check.
- Read the **raw body** (`await c.req.text()` / arrayBuffer) before any JSON parsing.
- Verification: gateway null, missing `stripe-signature` header, or failed
  signature → log warn `refused webhook: <reason>` (never secret or body) → **401**.
- `event === null` → **204** (ignored event, nothing changed).
- Success → **204**. Errors while reading DB/Stripe (before emails are sent)
  propagate as **500** so Stripe redelivers. Email send failures are logged,
  never 500.

Dispatch:

1. **`top-up`** (`settleTopUp`): if `!paid` return (bank debit pending; its own
   `async_payment_succeeded` comes later). Find org (ignored → warn). `usage.credit(cents, { idempotencyKey: 'checkout:<sessionId>' })` (credited once even if both `completed` and `async_payment_succeeded` arrive, or on redelivery). If `customerId`, `setStripeCustomer(customerId)` (first payment keeps the customer so Billing lists invoices).
2. **`payment-reversed`** (`settleReversal`): `topUpPayment(paymentIntentId)`; null → return (not a top-up). Find org. `cents = min(topUp.cents, round(event.amount * topUp.cents / max(topUp.total, 1)))` (proportional, tax included in both). 0 → return. `usage.reverse(cents, { idempotencyKey: 'reversal:<reversalId>' })`. A dispute won later gives nothing back automatically.
3. **`invoice-upcoming`** (`settleRenewal`): find subscription org (ignored → warn). Only when its plan key's cycle is **yearly**. Load billing; no subscription period → throw (500). `to = recipients(customer.email)` (billing email only); empty → log not sent and return. Send `renewMails` with `charge = chargeOf(event.amount, card)`, `renewsOn = dayOf(periodEnd)`, `daysLeft = daysUntil(periodEnd, now)`. Stripe sends `invoice.upcoming` N days ahead (Dashboard setting).
4. **`invoice-paid`** (`settleCycleReceipt`): find subscription org. Only if `cycleReceiptDue({ lookupKey, receiptFor })` (monthly → yearly on same plan). Load billing (no period → 500). Mark receipted **before** sending: `markReceipted(sub, lookupKey)` (a failed mark = 500 with nothing sent, so no double receipt). Send `receiptMails` with `charge = chargeOf(event.amount, card)`, `invoiceUrl = event.pdfUrl ?? WEB_URL/app/billing`, `to = recipients(requestedBy, customer.email)`.
5. **`invoice-failed`**: if `nextAttempt === null` (Stripe's last try) send nothing (the downgrade email follows). Find subscription org (ignored → warn). Load billing + members. Send `failedMails` with `charge = chargeOf(amount, card)`, `retryInDays = daysUntil(nextAttempt, now)`, `to = recipients(customer.email, ...adminsOf(members))`. Plan untouched.
6. **`subscription`**: `applyBillingEvent` (ignored → warn, 204). Log `organization <id> is on <plan>`. Then, each in its own try/catch (failures logged, still 204):
   - **Receipt** (`settleReceipt`):
     - Skip if key isn't a paid plan key, `plan === 'free'`, or `receiptFor === lookupKey` (already settled).
     - If `previousLookupKey` and `cycleReceiptDue({ lookupKey, receiptFor: previousLookupKey })` (monthly → yearly): `markReceipted(sub, previousLookupKey)` and return (the yearly `invoice.paid` sends the receipt; works for subscriptions settled before receipts existed).
     - `due = shouldSendReceipt(...)`. If due: load billing; take the newest invoice with status `paid` (none, or no period → throw → logged); `to = recipients(requestedBy, customer.email)` (none → throw); send `receiptMails` with `charge = chargeOf(invoice.total, card)`, `renewsOn = dayOf(periodEnd)`, `invoiceUrl = invoice.pdfUrl ?? WEB_URL/app/billing`.
     - If `due || previousLookupKey` → `markReceipted(sub, lookupKey)`. (A move down marks too, so moving back up later is a new receipt. An event that neither earns a receipt nor moves the price marks nothing, so a later-arriving move event still sends its receipt.)
   - **Downgrade** (`settleDowngrade`): if `downgradeDue(...)` (Stripe cancelled after failed retries): load billing (customer only) + members; send `downgradedMails` with `plan = PLAN_LABELS[previousPlan]`, `to = recipients(customer.email, ...adminsOf(members))`. An admin's cancel (`cancellation_requested`) and replays (already Free) send nothing.
   - `sendAll`: each mail sent independently; a failing one logs `organization <id>: <kind> email not sent` (kinds: `receipt`, `failed payment`, `renewal`, `downgraded`) and the rest still go. Never log address or body.

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
`$1,430.50`, whole: `$119`). Dates: `fullDay('YYYY-MM-DD', lang)` → `Oct 4, 2027`
/ `4 oct 2027` (parse the three numbers; never `new Date('YYYY-MM-DD')`).
Shared copy helpers (`plan-copy.ts`): `planLabel(plan)` = `t('pricing.plan.<plan>')`;
`seatsLine(seats)` = `pricing.oneSeat` when 1 else `pricing.seatsUpTo {upTo, seats}`;
`planPrice(offer, cycle)`:
- Free: `{ was: null, price: '$0', billed: null, billedNote: null }`.
- monthly: `{ was: null, price: money(monthly, whole), billed: 'billed monthly', billedNote: 'Billed monthly' }`.
- yearly: `{ was: money(monthly, whole), price: money(round(yearly/12), whole), billed: 'billed yearly', billedNote: '<total> billed yearly' }` (Pro yearly: was $20, price $16).
`yearlySaving(offer) = round((1 - yearly/(monthly*12)) * 100)` (20);
`leastYearlySaving(offers)` = min over paid offers or null; `twelveMonths(offer)` = monthly × 12.

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
- Load failure → error toast `pricing.loadFailed`.

### 5.2 `/app/plans` — in-app Plans
- Any member can see it. Title `plans.titleLead/titleRest`, subtitle, cycle switch.
- Data: organization plans (`plans` + `current`). If the user is admin and
  `current` is a paid plan (not free/internal), also load `billing.get` to know
  the paying cycle; set the switch to that cycle. Failure → toast `plans.billingLoadFailed`.
- Cards (Free, Pro, Team): label, audience, price (struck `was` when yearly), `plans.perMonthBilled {billed}` for paid, features = `[seatsLine(seats), ...planFeatures]` where planFeatures: free `[coreFeatures]`, pro `[everythingInFree, prioritySupport]`, team `[everythingInPro, teamFeatures]`, internal `[everythingInTeam]`. Team has badge `plans.recommended`.
- Card `current` = `offer.plan === current && (!paying || paying.cycle === shownCycle)`.
- Button per card:
  - current → disabled "Your current plan" (`plans.currentPlan`).
  - organization on Free, plan above current (`plansAbove`: offers after current; none for team/internal), admin → "Select {{plan}}" (`plans.select`; Team button primary, others outline).
  - paying org (billing loaded), not current, not Free, admin → "Switch to {{plan}}" (`plans.switchTo`), disabled while busy.
  - members: no button; below the grid `plans.onlyAdmin`.
  - A paying org whose billing fails to load is **never** sent to Checkout (no button).
- Select on yearly → navigate `/app/checkout?plan=<plan>&cycle=yearly`.
- Select on monthly → **annual offer dialog** (title `plans.annualModal`): card "`{{plan}}, yearly`" + `Save {{saving}}%` + `plans.compared` ("$480 a year instead of $600."); buttons "Continue yearly" → checkout yearly, "Continue monthly" → checkout monthly. Closing returns to Plans.
- Switch → `billing.previewChange` (busy; failure toast `plans.priceFailed`) → **switch confirmation dialog**: title `plans.switchTitle.<cycle>` ("Switch to Team, yearly"), lines from `switchLines(fromPlan, choice, preview)`:
  - applies now: `plans.dueToday {amount}`, `plans.movesNow {plan}`, `plans.then {after}` where after = `plans.per.<cycle> {amount: nextInvoice}`.
  - at renewal: `plans.nothingToday`, then same plan → `plans.staysOn.<cycle> {plan, on, after}`; other plan → `plans.keepsUntil {from, on, plan, after}` (`on = fullDay(preview.on)`).
  - Buttons: "Switch to {{plan}}" → `billing.change`; on success reload current user (`/api/me`) and navigate `/app/billing`; on error toast the API message or `plans.switchFailed`. "Not now" closes.
- Footer links: "Not now" → `/app`, "Compare all plans" → `/pricing`.
- Plans load failure → toast `plans.loadFailed`.

### 5.3 `/app/checkout?plan=&cycle=` — Embedded Checkout
- Guard `canCheckout`: admin AND `checkoutChoice(search)` valid (plan ∈ {pro, team}, cycle ∈ {monthly, yearly}); otherwise redirect `/app/plans` (`/app/checkout`, `plan=free`, `plan=enterprise`, `plan=internal`, `plan=Internal`, `cycle=weekly`, missing cycle all redirect). Validate search params with Zod in the route's `validateSearch`.
- Left: order summary (`aria-label = checkout.orderSummary`): back link "Back" → `/app/plans`; `checkout.subscribeTo {product}` with product = `${APP_NAME} ${planLabel}`; total = full price of the cycle (`money(yearly)` or `money(monthly)`) + `checkout.per.<cycle>`; line item with `checkout.terms.<cycle>`; Subtotal; Tax → `checkout.taxFromAddress`; "Total due today" = total.
- Right: heading `checkout.payment`; while opening `checkout.opening`; on failure an `role="alert"` with the API message or `checkout.openFailed`; a mount `<div data-stripe-checkout>`; footer `checkout.cancelAnytime`.
- On mount (client only): `billing.checkout({ plan, cycle })` → `loadStripe(publishableKey)` (`@stripe/stripe-js`) → `stripe.createEmbeddedCheckoutPage({ clientSecret })` (or `initEmbeddedCheckout` depending on stripe-js version) → `mount(element)`. Destroy the embedded checkout on unmount (also if unmounted while opening).
- Plan load failure → toast `checkout.loadFailed`.
- After paying, Stripe redirects to `/app/welcome?session_id=...`.

### 5.4 `/app/welcome` — after Checkout
- Guard `onPaidPlan`: if the org is not on Free → show. If on Free and there is no `session_id` → redirect `/app/plans`. With `session_id`: poll `/api/me` once per second up to **15 tries** (`PAID_WAIT_TRIES`) until the plan is not Free (webhook may land after the browser); success → show; timeout/error → `/app/plans`.
- Content: check icon, `welcome.titleLead` + `welcome.titleRest {plan}` (current plan label), body, button "Go to the app →" → `/app`; footer `welcome.receiptSent` + link "Settings" → `/app/billing` + `welcome.receiptEnd`.

### 5.5 `/app/billing` — Settings → Billing
- Part of the Settings page (`/app/settings`, `/app/members`, `/app/billing` open the same page on a section). Billing is **admin only**: hidden from a member's nav, and a member opening `/app/billing` sees their Account section instead.
- Loads `billing.get` (failure toast `settings.billingSettings.notLoaded`) and the usage summary (usage spec; failure toast `settings.usageSettings.notLoaded`).
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
- `/api/me` exposes `organization.plan` and `seats` (used by guards, Welcome label, Plans `current`).

### 5.7 i18n keys (copy verbatim from saas-base `apps/web/public/i18n/{en,es}.json`)
- `pricing.*`: `signIn, titleLead, titleRest, subtitle, perMonth, home, loadFailed, startFree, getPlan, noCardNeeded, plan.{free,pro,team,internal}, audience.{free,pro,team,internal}, feature.{everythingInPro,everythingInTeam,everythingInFreePlus,everythingInProPlus,coreFeatures,everythingInFree,prioritySupport,teamFeatures}, upTo, oneSeat, seatsUpTo, billedLower.{monthly,yearly}, billed.{monthly,yearly}, billedYearlyTotal, billingCycleSwitch.{billing,monthly,yearly,save}`.
- `plans.*`: `loadFailed, billingLoadFailed, priceFailed, switchFailed, annualTitle, compared, switchTitle.{monthly,yearly}, switchTo, per.{monthly,yearly}, dueToday, movesNow, then, nothingToday, staysOn.{monthly,yearly}, keepsUntil, titleLead, titleRest, subtitle, recommended, perMonthBilled, currentPlan, select, onlyAdmin, notNow, compareAll, annualModal, save, continueYearly, continueMonthly`.
- `checkout.*`: `loadFailed, openFailed, per.{monthly,yearly}, terms.{monthly,yearly}, orderSummary, back, subscribeTo, subtotal, tax, taxFromAddress, totalDueToday, payment, opening, cancelAnytime`.
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

| Template | When | Subject | Heading | Body | Actions | Footer | Recipients |
|---|---|---|---|---|---|---|---|
| `receiptEmail` | first payment, move up a plan, monthly→yearly (on yearly invoice paid) | `You're on {APP_NAME} {plan}` | `You're on {plan}.` / `Thanks for paying.` | rows: Plan `{plan} · {billing}`; Paid `{amount} · {card}`; Renews `fullDay(renewsOn)` | "Download invoice" → invoice PDF (or /app/billing); "Manage plan" → /app/billing | `Sent to you and the billing email.` | `recipients(requestedBy, billingEmail)` |
| `renewEmail` | `invoice.upcoming` on a yearly price | `{APP_NAME} {plan} renews on {shortDay(renewsOn)}` | `{plan} renews` / `in {count(daysLeft,'day')}.` | `{amount} on {fullDay}, to {card}.` | "Manage plan" | `Yearly plans only.` | billing email only |
| `failedEmail` | `invoice.payment_failed` with a next attempt | `Your payment didn't go through` | `Your payment` / `didn't go through.` | `We couldn't charge {amount} to {card}. We'll try again in {n day(s)}. Your plan keeps working until then.` | "Update card" → /app/billing | `Sent to the billing email and organization admins.` | billing email + owners + admins |
| `canceledEmail` | admin cancels | `{plan} ends on {fullDay(endsOn)}` (e.g. `Pro ends on Oct 4, 2027`) | `{plan} ends` / `on {fullDay}.` | `Until then, nothing changes. After that you move to Free. Your data stays.` | `Keep {plan}` → /app/billing | `Sent to organization admins.` | cancelling admin + owners + admins |
| `downgradedEmail` | Stripe cancelled after failed retries (`payment_failed`) | `{org} is back on Free` | `{plan} ended.` / `{org} is on Free.` | `We couldn't charge your card after a week of tries, so {plan} has ended. Your data stays.` | "Choose a plan" → /app/billing | `Sent to the billing email and organization admins.` | billing email + owners + admins |

All links are absolute: `${WEB_URL}/app/billing` (tests stub `WEB_URL` to an https origin).
Template tests to port (`templates/plan.spec.ts`): receipt confirms plan/paid/renews;
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
   `<prefix><plan>_<cycle>`; amount from `PLAN_OFFERS`; metadata `{ plan, cycle }`.
   If the current price (by lookup key) is active with the same amount: fix
   metadata if needed, log "already there". Else create a new recurring price
   with `transfer_lookup_key: true` and deactivate the old one (existing
   subscriptions keep their old price; new Checkouts charge the new one).
3. Credits product (`metadata.kind = 'credits'`, name `<APP_NAME> Credits`) with
   a `custom_unit_amount` price (`enabled`, `minimum = TOP_UP.minCents`,
   `maximum = TOP_UP.maxCents`, `preset = min(2 × min, max)`), lookup key
   `<prefix>credits_top_up`, currency `CURRENCY`; replaced (transfer lookup key,
   old deactivated) when currency/min/max differ.

---

## 8. Environment variables

| var | where | purpose |
|---|---|---|
| `STRIPE_SECRET_KEY` | api | `sk_test_…` / `sk_live_…`. Missing → payments disabled (503). |
| `STRIPE_PUBLISHABLE_KEY` | api | returned to the browser by `billing.checkout`; not needed in the web env. |
| `STRIPE_WEBHOOK_SECRET` | api | `whsec_…` endpoint signing secret; locally from `stripe listen --forward-to localhost:<API_PORT>/api/webhooks/stripe`. |
| `WEB_URL` | api | web origin for return/success/cancel URLs, portal return URL, email links; also a Better Auth trusted origin. |
| `SITE_URL` | web | landing site link on Pricing ("Home"). |
| `STRIPE_FAKE` (optional, arrakit) | api | dev/e2e only: use the in-memory fake gateway. |
| `RESEND_API_KEY`, `MAIL_FROM` | api | mailer (mail spec); unset → Mailpit (`MAILPIT_URL`) or console. |

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
idempotency (`receiptFor` metadata marker, ledger idempotency keys
`checkout:<sessionId>` / `reversal:<reversalId>`, re-reading the subscription
from Stripe). Emails are sent inline (not queued) and failures are logged only.
(Storage purge after organization deletion is queued by the organizations area.)

---

## 11. Business rules & edge cases (summary checklist)

- Only Stripe's webhook (and the synchronous read-back after `billing.change`) changes `organizations.plan`. Checkout never does.
- Checkout only from Free; a paying org switches via Plans/Billing (409 otherwise). There is never a second subscription.
- Up a plan = immediate, prorated charge (`always_invoice`, `error_if_incomplete`); down a plan or cycle change = at renewal via subscription schedule with its own new billing cycle anchor, no refund; promo discounts preserved.
- Change drops a pending cancellation; cancel drops a pending change.
- Cancel = at period end; plan kept until Stripe deletes the subscription; resume undoes before period end.
- `past_due` and `trialing` keep the paid plan; `canceled`/`unpaid`/`incomplete*`/`paused` → Free.
- Customer id survives going back to Free (reuse at next Checkout; invoices and card still visible).
- A cancelled old subscription never downgrades an org that has a newer subscription.
- `internal`: never sold, never moved by the webhook, cannot cancel/change/portal (409), shows no Cancel/Edit, checkout 409.
- Receipts: exactly once per settled price (marker `receiptFor` on subscription metadata); none for renewals or moves down; monthly→yearly receipt waits for the yearly invoice; recipients deduped case-insensitively.
- Failed payment emails until Stripe's last retry; last retry silent; then downgrade email if Stripe cancels for `payment_failed`.
- Renewal notice only for yearly prices, only to the billing email.
- Never leak Stripe error messages, email addresses or email bodies in responses or logs.
- All billing mutations require a trusted `Origin` (CSRF).
- Deleting an organization ends its subscription first; failure aborts the delete.
- Seats: `PLAN_OFFERS[plan].seats` caps members + pending invitations (members spec); a downgrade does not remove members.

---

## 12. saas-base tests worth porting

API (Vitest; integration with PGlite + Better Auth test utils to create users,
organizations, sessions/cookies; fake Stripe; recording mailer):
- `libs/shared/plans/src/plans.spec.ts` — all (pure).
- `subscription-plan.spec.ts` — all (pure).
- `billing-mail.spec.ts` — all (pure: recipients, chargeOf, receiptMails, shouldSendReceipt table, cycleReceiptDue, daysUntil, adminsOf, failedMails, renewMails, downgradeDue, downgradedMails).
- `apply-billing-event.spec.ts` — all (against PGlite or an in-memory repo).
- `stripe-gateway.spec.ts` — port the pure mapping parts against a mocked `Stripe` client: gateway null without each env var; requestedBy on Checkout/changeNow/changeAtRenewal (both phases keep it); renewal phase uses `billing_cycle_anchor: 'phase_start'` and yearly duration; reads requestedBy/anchor/cancellation reason; previous price only when the price changed; invoice event mapping (upcoming, failed with/without retry, paid only for `subscription_cycle`/`subscription_update`, subscription id as id or object, ignores events without subscription); `planKeyOf` metadata vs lookup-key fallback; top-up Checkout parameters, completed/async events, refund/dispute mapping, `topUpPayment`; subscription Checkout still read as subscription.
- `billing.controller.spec.ts` → `billing.checkout` procedure: owner gets clientSecret + publishableKey and return URL; reuses customer; 502 own words; member 403; no session 401; non-Free 409 with exact message; invalid inputs 400; foreign Origin 403; no Stripe → 503 and app still boots.
- `billing-settings.controller.spec.ts` → `billing.get` (Free asks Stripe nothing; paying org full view; cancelled; scheduled move down; back on Free keeps invoices/card; 502 own words; member 403), `previewChange` (now with FAKE_PRORATION and next invoice 48000; renewal with 0 today and next 2000 on renewal day; same plan 409; Free 409), `change` (up now → plan team at once; down at renewal → plan unchanged; requestedBy recorded both ways; 402 declined card plan unchanged; foreign Origin 403 nothing changed), cancel/resume (records both, plan stays; Internal 409 for cancel and change; Free 409; member 403), portal (URL + return URL + target; never-billed 409), cancellation email (to cancelling admin, subject `Pro ends on Oct 4, 2027`, link to /app/billing, resume sends nothing; all owners+admins never members; send failure still cancels and logs without address/body).
- `top-up.spec.ts` → `billing.topUp` + webhook top-up paths (usage spec owns the ledger asserts).
- `stripe-webhook.controller.spec.ts` → Hono webhook route: forged signature 401; missing signature 401; subscription paid → Pro; replay idempotent; cancelled → Free; ignored event 204; invoice events never change plan; all receipt scenarios (first payment to admin + billing email with plan/charge/PDF and `receiptFor` set; no second on replay; Pro→Team; move-up after an unrelated update; monthly→yearly once on yearly invoice; invoice paid before update; pre-receipt subscriptions; no receipt for renewals or moves down; billing email alone when no requestedBy; one mail when requestedBy equals billing email case-insensitively; send failure → 204 logged); failed charge (billing + owner + admins, not members; dedupe owner = billing email; last try silent; send failure 204); downgrade (recipients; replay silent; admin cancel silent; failure 204 still Free); renewal notice (billing email only, yearly only, failure 204); no Stripe → 401.
- `organization-settings.int.spec.ts` (setPlan / setStripeCustomer parts).
- `libs/shared/emails/src/templates/plan.spec.ts`.

Web (Vitest + React Testing Library, API mocked at the oRPC client / MSW level):
- `pricing.page.spec.ts`: every plan to a visitor; yearly prices vs struck monthly; switching to monthly + "Save 20%"; seats then features; CTA links (`/signup`, `/signup?plan=pro&cycle=yearly`, `/signup?plan=team&cycle=yearly`, `/signin`); signed-in "Get Team" → checkout; load failure toast.
- `plans.page.spec.ts`: recommended + own plan marked; top plan offered the switch down; paying cycle marked and other cycle offered; switch up shows today's charge then lands on Billing; switch down at renewal nothing today; preview failure toast; paying org never sent to Checkout even if billing fails; yearly select → checkout; monthly select → annual dialog and close; dialog → checkout yearly/monthly; member sees no buy buttons + onlyAdmin text; footer links; load failure toast.
- `checkout.page.spec.ts`: summary yearly/monthly; back to Plans; member redirected; invalid query redirected (5 cases); API refusal message shown; Stripe Embedded Checkout mounted with the session (mock `@stripe/stripe-js`).
- `plan-access.spec.ts`: `plansAbove`, `checkoutChoice` accept/refuse tables.
- `welcome.page.spec.ts`: welcome + plan name; Free → Plans; links.
- `billing-settings.spec.ts`: rows (plan, renews, next invoice, includes, see pricing link); payment details; card brand mapping; invoices newest first + Download only with PDF; Free bills nothing; Internal no Cancel/Edit; cancel flow + keep my plan; scheduled move down; each Edit opens portal with the right target (Payment → payment, others → details); portal failure toast; load failure toast; usage/top-up dialog cases (usage spec).

E2E (Playwright, with `STRIPE_FAKE=1` or Stripe test mode):
- Visitor Pricing → Get Pro → sign up → create organization → Checkout page opens (summary shown).
- Admin on Free: Plans → Select Team monthly → annual dialog → Checkout.
- Simulated webhook (signed fake event posted to `/api/webhooks/stripe`) → Welcome shows "Welcome to Team." → Billing shows plan, renewal, invoices.
- Paying admin: Plans → Switch to Team → confirmation shows amount due today → Billing shows Team. Cancel → Ends on → Keep my plan.
- Member: Plans shows no buy buttons; `/app/billing` not reachable; `/app/checkout?...` redirects to Plans.
