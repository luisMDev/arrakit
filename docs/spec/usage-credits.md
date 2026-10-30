# Feature spec: Usage metrics, prepaid credits and top-ups

Source: saas-base (`apps/api/src/app/usage`, `libs/platform/data/src/usage`,
`libs/shared/plans`, `apps/api/src/app/billing` top-up and reversal paths,
`apps/web/src/app/signed-in/settings/usage-settings`, the Billing settings
"Usage" section). This document is the source of truth for arrakit; implementers
should not need to read saas-base.

Scope: what an organization may use each month (plan grant), what it buys on top
(top-ups via Stripe Checkout), how uses are spent (consumable metrics) or limited
(capacity metrics), refunds/disputes reversal, and the screens that show it.

Out of scope here (other specs): plan subscriptions/Checkout for plans, receipts,
invoices, customer portal, the Stripe gateway in general, organizations/members.
This spec only references them where they touch usage (`usage_anchor`,
`stripe_customer_id`, the webhook route).

---

## 1. Shared catalog (`packages/plans` or equivalent shared package)

Pure TypeScript, no I/O, imported by api, web and data. Port verbatim.

### 1.1 Constants

```ts
export const PLANS = ['free', 'pro', 'team', 'internal'] as const; // order = rank
export const CURRENCY = 'usd'; // Stripe lowercase ISO 4217

export const PLAN_OFFERS = {
  free:     { plan: 'free',     monthlyCents: 0,     yearlyCents: 0,      seats: 1,   monthlyGrantCents: 100 },
  pro:      { plan: 'pro',      monthlyCents: 2_000, yearlyCents: 19_200, seats: 3,   monthlyGrantCents: 1_000 },
  team:     { plan: 'team',     monthlyCents: 5_000, yearlyCents: 48_000, seats: 10,  monthlyGrantCents: 3_000 },
  internal: { plan: 'internal', monthlyCents: 0,     yearlyCents: 0,      seats: 100, monthlyGrantCents: 10_000 },
};

/** A top-up: any whole number of cents in [min, max]. Adds to EVERY metric at once; never expires. */
export const TOP_UP = { minCents: 1_000, maxCents: 50_000 } as const; // $10 .. $500

export type MetricKind = 'consumable' | 'capacity';

export const METRICS = [
  { key: 'credits',    label: 'Credits', unit: 'credits', kind: 'consumable', perCurrencyUnit: 100 },
  { key: 'storage_gb', label: 'Storage', unit: 'GB',      kind: 'capacity',   perCurrencyUnit: 10 },
] as const;
export type Metric = (typeof METRICS)[number]['key'];
export const METRIC_KEYS: readonly Metric[]; // ['credits', 'storage_gb'] — METRICS order is the display/API order
```

- `consumable`: each use spends from a balance; a use that would take the balance
  below zero is refused (credits).
- `capacity`: grants and top-ups raise a **limit**; the app reports a **level**;
  a level above the limit is refused (storage).
- `perCurrencyUnit`: how much of the metric $1 (100 cents) buys.
- Adding a metric = one line in `METRICS` + its i18n copy (`metric.<key>`,
  `amount.<key>`). No migration. Changing a factor/grant applies to future
  grants/top-ups only; ledger rows already written stay.

### 1.2 Functions (exact algorithms)

```ts
isPlan(v): boolean            // exact string match in PLANS ('Pro', 'internal ' refused)
isMetric(v): boolean          // exact match in METRIC_KEYS ('Credits', 'gb', '', null refused)
metricOf(metric): MetricDefinition // throws `no metric ${metric}` if unknown

metricAmount(metric, cents) = Math.floor(cents * perCurrencyUnit / 100)
// $20 = 2000 credits, 200 GB; metricAmount('storage_gb', 1005) === 100 (rounds DOWN)

metricAmounts(cents): Record<Metric, number>  // metricAmount for every metric
planGrant(plan) = metricAmounts(PLAN_OFFERS[plan].monthlyGrantCents)
// free => { credits: 100, storage_gb: 10 }; pro => {1000, 100}; team => {3000, 300}; internal => {10000, 1000}

isTopUpAmount(cents) = typeof cents === 'number' && Number.isInteger(cents)
                       && cents >= TOP_UP.minCents && cents <= TOP_UP.maxCents
// refuses 999, 50001, 1000.5, '2000', null
```

#### `usagePeriod(anchor: Date, now: Date): { start: Date; end: Date }` (end exclusive)

Months counted from `anchor` in UTC, keeping the anchor's time of day, with the
day clamped to the target month's last day (Jan 31 -> Feb 28), as Stripe does.

```ts
function addMonths(anchor, months) {
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth() + months;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(anchor.getUTCDate(), last),
    anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds(), anchor.getUTCMilliseconds()));
}
function usagePeriod(anchor, now) {
  if (now < anchor) return { start: anchor, end: addMonths(anchor, 1) };
  let months = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + now.getUTCMonth() - anchor.getUTCMonth();
  if (addMonths(anchor, months) > now) months -= 1;
  return { start: addMonths(anchor, months), end: addMonths(anchor, months + 1) };
}
```

Note: clamping is always computed from the ORIGINAL anchor (`addMonths(anchor, n)`),
never chained, so a 31st anchor returns to the 31st in long months.

Test vectors (port as unit tests):
| anchor | now | start | end |
|---|---|---|---|
| 2026-01-15T10:00Z | 2026-03-20T00:00Z | 2026-03-15T10:00Z | 2026-04-15T10:00Z |
| 2026-01-15T10:00Z | 2026-03-15T09:59:59Z | 2026-02-15T10:00Z | 2026-03-15T10:00Z |
| 2026-01-31T00:00Z | 2026-02-28T12:00Z | 2026-02-28T00:00Z | 2026-03-31T00:00Z |
| 2025-11-05T00:00Z | 2026-01-06T00:00Z | 2026-01-05T00:00Z | — |
| 2026-05-01T00:00Z | 2026-04-01T00:00Z (before anchor) | 2026-05-01T00:00Z | — |

#### `splitConsumption(quantity, { plan, purchased })`

```ts
const plan = Math.max(0, balance.plan);
const purchased = Math.max(0, balance.purchased);
if (quantity > plan + purchased) return null;
const fromPlan = Math.min(quantity, plan);
return { plan: fromPlan, purchased: quantity - fromPlan };
```
Plan grant is spent first, then purchased. Vectors: (30, {50,100}) -> {30,0};
(80, {50,100}) -> {50,30}; (151, {50,100}) -> null.

#### `metricBalance(metric, sums, level = 0): MetricBalance`

`MetricSums = { granted, planUsed, purchased, used }` (all default 0; uses positive).

```ts
if (kind === 'capacity') {
  const limit = granted + purchased;
  return { metric, kind, granted, plan: granted, purchased, used: level,
           available: Math.max(0, limit - level), limit };
}
const plan = Math.max(0, granted - planUsed);
const left = Math.max(0, purchased);  // a refund can drive purchased below 0: shown as 0
return { metric, kind, granted, plan, purchased: left, used, available: plan + left, limit: null };
```

This is the ONLY rule for computing a balance; the data layer, test fakes and
web fakes all use it. Vectors:
- credits {granted 100, planUsed 100, purchased 950, used 150} -> plan 0, purchased 950, used 150, available 950, limit null.
- credits {granted 100, purchased -50} -> purchased 0, available 100.
- storage_gb {granted 10, purchased 200}, level 12 -> plan 10, purchased 200, used 12, limit 210, available 198.

Note for capacity: `purchased` is NOT clamped (a negative purchased lowers the limit).

---

## 2. Data model (Drizzle, Postgres; PGlite in dev/tests)

### 2.1 `organizations` (column added by this feature)

| column | type | notes |
|---|---|---|
| `usage_anchor` | `timestamptz` NULL | Instant months of the plan grant count from. Paid plan: Stripe subscription's `billing_cycle_anchor`. Null on Free -> months count from `organizations.created_at`. |

Existing columns read here: `id uuid pk`, `plan text not null default 'free'`
(check in PLANS), `stripe_customer_id text unique`, `stripe_subscription_id`,
`created_at timestamptz not null default now()`.

Rules in `setPlan(plan, stripe?)`:
- `plan === 'free'` -> `usage_anchor = NULL`.
- paid plan with `stripe.anchor` -> `usage_anchor = stripe.anchor`; without anchor, leave as is.
- A new anchor starts a new month immediately (last month's plan use stops counting; purchased stays).

`setStripeCustomer(customerId)`: sets `stripe_customer_id` only if null (first
payment that is not a subscription, i.e. a top-up). An existing one is kept.

`organizations` is an app table (no Better Auth organization plugin); the
ledger FK and the row lock below target it.

### 2.2 `credit_ledger` (append-only)

| column | type | notes |
|---|---|---|
| `id` | uuid pk default random | |
| `organization_id` | uuid not null FK organizations(id) ON DELETE CASCADE | |
| `metric` | text not null | a METRIC key (not DB-constrained, so metrics can be added without migration) |
| `bucket` | text not null CHECK in ('plan','purchased') | `plan` lapses monthly, `purchased` never |
| `reason` | text not null CHECK in ('plan_grant','purchase','consumption','adjustment') | `plan_grant` is allowed by the check but never written (grants are computed on read; such rows are ignored) |
| `amount` | bigint (mode number) not null | signed; consumption rows negative |
| `period_start` | timestamptz NULL | set on `consumption` rows (the month they belong to); null on purchase/adjustment |
| `cents` | integer NULL | money behind a `purchase` row (whole top-up cents, same value on each metric row) |
| `idempotency_key` | text not null | |
| `created_at` | timestamptz not null default now() | |

Constraints / indexes:
- `UNIQUE credit_ledger_idempotency_unique (organization_id, metric, bucket, idempotency_key)`
  — a use paid from both buckets is two rows under one key.
- `INDEX credit_ledger_organization_metric_idx (organization_id, metric)`.
- Rows are never updated or deleted (except by org cascade).

Idempotency key namespaces used:
- top-up: `checkout:${stripeCheckoutSessionId}`
- refund/dispute: stored as `reversal-of:${encodeURIComponent(paymentIntentId)}:reversal:${refundOrDisputeId}`
  (the payment prefix lets `reverse` cap all reversals of one payment)
- consumption: caller-supplied (job id, request id, `report:${id}`). Callers must not reuse the
  `checkout:`/`reversal-of:` prefixes (unique constraint is per bucket, so a collision would
  silently no-op).

### 2.3 `usage_levels`

| column | type | notes |
|---|---|---|
| `organization_id` | uuid not null FK organizations(id) ON DELETE CASCADE | |
| `metric` | text not null | capacity metric key |
| `value` | bigint (mode number) not null | current level as last reported |
| `updated_at` | timestamptz not null default now() | updated on upsert |

PK `(organization_id, metric)`.

### 2.4 Migration

Both tables, `organizations.usage_anchor`, the cascading FKs and the index are
in `0000_init` (drizzle-kit).

---

## 3. Data-layer service: `OrganizationUsage` (`forOrganization(orgId).usage`)

`usageScope(ctx, organizationId)` (`packages/db/src/organization/usage.ts`;
`ctx.now` is the injectable clock). Interface:

```ts
interface MetricUsage extends MetricBalance { resetsOn: Date }   // = period.end
interface UsageVerdict { metric; allowed: boolean; available: number; requested: number }
interface TopUp { at: Date; cents: number; amounts: Partial<Record<Metric, number>> }

summary(): Promise<MetricUsage[]>                 // all metrics, METRICS order
check(metric, quantity = 1): Promise<UsageVerdict>
consume(metric, quantity, { idempotencyKey }): Promise<MetricUsage>
set(metric, value): Promise<MetricUsage>          // capacity only
credit(cents, { idempotencyKey }): Promise<boolean>
reverse(cents, { idempotencyKey, payment: { key, cents } }): Promise<boolean>
topUps(): Promise<TopUp[]>                        // newest first
```

There is no manual `adjust`.

### 3.1 `UsageLimitError`

```ts
class UsageLimitError extends DomainError /* code 'PAYMENT_REQUIRED', data { metric, requested, available } */ {
  name = 'UsageLimitError'; metric; kind; requested; available;
  message (consumable): `Not enough ${label.toLowerCase()}: this needs ${requested} ${unit} and your organization has ${available} left. Add credits in Settings → Billing.`
  message (capacity):   `${label} limit reached: this needs ${requested} ${unit} more and your organization has ${available} left. Add credits in Settings → Billing to raise it.`
}
```

The API's `reportErrors` middleware maps it (like every `DomainError`) to a 402
oRPC error carrying the same message and data.

### 3.2 Grant on read, and locking

The plan grant is **not stored**: every read computes `granted =
planGrant(plan)[metric]` from the organization's current plan. An upgrade
mid-month raises the grant at once (Pro → Team: granted 3000, plan use so far
still counted), and a downgrade mid-month lowers it at once (Team → Free:
granted 100). No job, no grant rows; `plan_grant` rows left in the ledger are
ignored.

Each read takes the organization row (`plan`, `created_at`, `usage_anchor`;
gone → `Error('[data] organization <id> is gone')`) and
`period = usagePeriod(usage_anchor ?? created_at, now())`.

- `summary` and `check` read without a lock and write nothing.
- `consume`, `set` and `reverse` run in one transaction that first locks the
  organization row `FOR NO KEY UPDATE` (FK inserts elsewhere taking KEY SHARE
  are not blocked), so concurrent uses cannot pass one balance and concurrent
  reversals of one payment cannot exceed it.
- `credit` does not lock; it relies on the unique constraint +
  `ON CONFLICT DO NOTHING ... RETURNING id` (rows returned > 0 means `true`).

### 3.3 Sums for the current period

Over the org's ledger rows except `plan_grant`, grouped by metric:
- `planUsed` = -sum(amount) where bucket='plan' and reason='consumption' and period_start = period.start
- `purchased` = sum(amount) where bucket='purchased' (all time, any reason: purchase, purchased-side consumption, reversals)
- `used` = -sum(amount) where reason='consumption' and period_start = period.start

Levels: `SELECT metric, value FROM usage_levels WHERE organization_id = $org`.
Balance per metric = `metricBalance(metric, { granted, planUsed, purchased, used }, level)`;
`resetsOn = period.end`. Last month's plan use stops counting because only
consumption with the current `period_start` counts. Purchased never lapses.

### 3.4 Operations

- `check(metric, quantity=1)`: `metric` must be a known metric (else throws
  `[data] no metric X in METRICS`); `quantity` safe integer >= 0 (else throws
  `[data] a quantity must be a whole number of at least 0, not X`). Reads
  `available` (no lock); returns
  `{ metric, allowed: quantity <= available, available, requested: quantity }`.
  Consumable: quantity is what would be spent; capacity: quantity added to current level
  (`available = limit - level`).
- `consume(metric, quantity, { idempotencyKey })`:
  - metric must be `consumable` (else throws `[data] storage_gb is a capacity metric, not consumable`).
  - quantity safe integer >= 1; key non-blank after trim (else `[data] an idempotency key must not be blank`).
  - Under the lock: look for an existing row (org, metric, reason='consumption', key).
    If found -> return current usage, spending nothing (retry; quantity not compared).
  - `split = splitConsumption(quantity, usage)`; null -> throw `UsageLimitError(metric, quantity, usage.available)`, nothing written.
  - Insert one row per non-zero part: bucket 'plan' amount `-split.plan`, bucket 'purchased'
    amount `-split.purchased`, reason 'consumption', `period_start = period.start`, same key.
  - Return the new balance computed arithmetically (no re-read).
- `set(metric, value)`: metric must be `capacity`; value safe integer >= 0. Under the lock:
  if `value > usage.used && value > limit` -> throw `UsageLimitError(metric, value - used, available)`,
  nothing saved. Otherwise upsert `usage_levels` (on conflict (org, metric) update value, updated_at=now()).
  Going down always saves; going up to exactly the limit is allowed.
- `credit(cents, { idempotencyKey })`: cents safe integer >= 1; key non-blank. Inserts
  one `purchased`/`purchase` row per metric with `amount = metricAmounts(cents)[metric]`,
  `cents = cents`. Returns `true` if written, `false` if the key already existed (webhook
  redelivery). Concurrent identical credits: exactly one `true`.
- `reverse(cents, { idempotencyKey, payment: { key, cents } })`: cents >= 1, key and
  `payment.key` non-blank, `payment.cents` >= 1 (what the payment bought). Under the lock,
  reads the earlier reversals of that payment (keys prefixed
  `reversal-of:<encoded payment key>:`); the same key again → `false`; takes
  `min(cents, payment.cents - reversedSoFar)`; nothing left → `false`. Inserts
  `purchased`/`adjustment` rows with `amount = -metricAmounts(take)[metric]` for metrics
  with amount > 0 and `cents = take`. May drive purchased below zero (the debt is
  consumed before anything bought later). A refund followed by a dispute of the same
  payment never takes back more than it bought; caps are per payment.
- `topUps()`: rows with reason='purchase', ordered `created_at DESC, idempotency_key`,
  grouped by key into `{ at: created_at, cents, amounts: { [metric]: amount } }`, insertion
  order preserved (newest first). Reversals are NOT subtracted from this list.

### 3.5 Concurrency guarantees (must hold on Postgres; PGlite serializes anyway)

- 5 parallel `consume('credits', 30)` with distinct keys on Free (100): exactly 3 succeed,
  used 90, available 10.
- Concurrent reversals of one payment take back at most what it bought.

---

## 4. API service layer (Hono + oRPC)

### 4.1 Spending from a procedure

There is no usage service: a procedure behind `member(level)` uses its
organization scope directly, `context.scope.usage.consume(...)` / `.set(...)`.
A `UsageLimitError` thrown there becomes a 402 through `reportErrors`.

### 4.2 402 Payment Required

`UsageLimitError` → oRPC error `PAYMENT_REQUIRED`, HTTP 402, `message` =
`UsageLimitError.message` (contains "Add credits in Settings → Billing"),
`data = { metric, requested, available }`. The RPC client receives it as an
`ORPCError` with `status: 402` and that data. The web surfaces `message` as a
toast/alert and may link admins to Billing.

### 4.3 `requiresUsage(metric, quantity = 1)` oRPC middleware

`apps/api/src/usage/requires-usage.ts`. Typed on `MemberContext`, so it can only
be used after `requireMember`. Calls `context.scope.usage.check(metric, quantity)`
and throws `UsageLimitError` (→ 402) when not allowed; does NOT spend. The
handler then calls `consume(...)` itself (a use the handler never makes costs
nothing).

Behaviour from tests (port with a probe router in tests only):
- Free org: `check(100)` allowed, `check(101)` not, nothing spent.
- Procedure guarded by `requiresUsage('credits', 40)` + `consume(40, 'report:<id>')`:
  report a -> left 60; report a again -> left 60 (idempotent); report b -> left 20.
- After spending 70: guarded report -> 402 `{metric:'credits', requested:40, available:30}`, message contains "Add credits in Settings → Billing".
- `consume(101)` on Free -> 402.
- `set('storage_gb', 10)` -> 200; `set(11)` -> 402.

### 4.4 Endpoints

All oRPC procedures under `/api/rpc`; session from Better Auth; the organization is
the person's membership read fresh (`memberOf`), never from the session. Errors: 401
no session, 404 no organization.

#### `usage.get` (saas-base: `GET /api/usage`)
- Auth: any member of the active organization (member, admin, owner).
- Input: none.
- Output:
```ts
{
  currency: 'usd',
  metrics: Array<{
    metric: Metric, kind: 'consumable' | 'capacity',
    granted: int,          // this month's plan grant
    plan: int,             // consumable: left of grant; capacity: the grant
    purchased: int,        // consumable: left of bought (>=0); capacity: all bought
    used: int,             // consumable: spent this month; capacity: current level
    available: int,        // what one more use may take
    limit: int >= 0 | null,// capacity: plan + purchased; consumable: null
    resetsOn: 'YYYY-MM-DD' // period.end as UTC day (toISOString().slice(0,10))
  }>,                      // METRICS order
  topUps: Array<{ paidOn: 'YYYY-MM-DD' (UTC), cents: int,
                  amounts: Array<{ metric, amount: int }> /* METRICS order, only metrics present */ }>  // newest first
}
```
- Reading writes nothing (the grant is computed).
- Expected for a fresh Free org (seen by a plain member): credits `{consumable, granted 100, plan 100, purchased 0, used 0, available 100, limit null}`, storage_gb `{capacity, granted 10, plan 10, purchased 0, used 0, available 10, limit 10}`, `topUps: []`. Signed out -> 401.

#### `billing.topUp` (saas-base: `POST /api/billing/top-up`)
- Auth: owner or admin of the org (member -> 403). Lives with billing settings (admins only).
- CSRF/origin: the app-wide `/api/rpc/*` middleware refuses an untrusted `Origin` with 403 "Use the app." (platform spec, section 4).
- Input: `{ cents: z.number().int().min(1000).max(50000) }` (400 on 999, 50001, 1000.5, "2000").
- Stripe not configured -> 503 "Payments are not set up yet."
- Stripe failure -> 502 "Couldn't reach Stripe. Try again in a minute." (`guardedStripe`, billing spec 2.2).
- Allowed on any plan, including Free and Internal.
- Action: create Stripe Checkout Session:
  - `mode: 'payment'`
  - `line_items: [{ price_data: { currency: 'usd', product: <Credits product id>, unit_amount: cents }, quantity: 1 }]`
    (product found via the price with lookup key `<prefix>credits_top_up`, memoised; failed lookup retried next time)
  - `client_reference_id: orgId`
  - `metadata: { kind: 'top_up', organizationId }`
  - `payment_intent_data.metadata: { kind: 'top_up', organizationId, cents: String(cents) }`
  - `invoice_creation: { enabled: true, invoice_data: { metadata: { kind: 'top_up' } } }`
  - if org has `stripe_customer_id`: `customer`, `customer_update: { name: 'auto', address: 'auto' }`;
    else `customer_email: <admin email>`, `customer_creation: 'always'`
  - `billing_address_collection: 'required'`, `tax_id_collection: { enabled: true }`
  - `success_url: ${WEB_URL}/app/billing?top_up=paid`, `cancel_url: ${WEB_URL}/app/billing`
    (the web redirects `/app/billing` to `/app/settings?section=billing`, keeping `top_up`)
- Output: `{ url: string }` (Stripe hosted Checkout URL). Web redirects `window.location.href = url`.
- Test fake records `{ organizationId, cents, customerId: null, email, successUrl, cancelUrl }`; URL starts with `https://checkout.stripe.test`.

#### Stripe webhook (plain Hono route `POST /api/webhooks/stripe`)

Signature verified with `STRIPE_WEBHOOK_SECRET` over the RAW body; bad/missing
signature -> 401 (log reason only, never the secret/body). Success -> 204. A thrown
error -> 500 so Stripe redelivers. Usage-relevant events:

1. **Top-up paid** — `checkout.session.completed` or `checkout.session.async_payment_succeeded`
   with `session.mode === 'payment'`. If `metadata.kind !== 'top_up'` ignore. Normalized:
   `{ kind:'top-up', sessionId, organizationId: metadata.organizationId ?? client_reference_id,
   customerId, cents: session.amount_subtotal ?? 0 /* before tax */, paid: payment_status === 'paid' }`.
   Settlement:
   - `!paid` (delayed bank debit) -> do nothing; the later `async_payment_succeeded` credits.
   - Find org: null id -> ignore ("names no organization"); invalid uuid -> ignore; org gone -> ignore. Ignored -> 204 + warn log.
   - `credit(cents, { idempotencyKey: 'checkout:' + sessionId })` — completed + async_succeeded for the same session credit once.
   - If `customerId`: `setStripeCustomer(customerId)` (keep first customer so Billing lists invoices; plan unchanged, stays 'free').
   - Log `credits topped up` (with `organizationId`, `cents`) only when newly credited.
2. **Refund / dispute** — `refund.created` or `charge.dispute.created`. Normalized:
   `{ kind:'payment-reversed', reversalId: object.id, paymentIntentId, amount: object.amount /* tax included */ }`
   (no payment_intent -> ignore). Settlement:
   - `topUpPayment(paymentIntentId)`: retrieve PaymentIntent; if `metadata.kind !== 'top_up'` or no organizationId or no cents -> null -> ignore (payment that is not a top-up: 204).
   - Otherwise `{ organizationId, cents: Number(metadata.cents), total: intent.amount /* charged incl. tax */ }`.
   - Find org (ignored as above).
   - `reversedCents = Math.min(topUp.cents, Math.round(event.amount * topUp.cents / Math.max(topUp.total, 1)))` — proportional, tax apart.
   - `reversedCents === 0` -> nothing. Else `reverse(reversedCents, { idempotencyKey: 'reversal:' + reversalId, payment: { key: paymentIntentId, cents: topUp.cents } })`.
   - A dispute later WON gives nothing back automatically (there is no manual adjustment).
   - Example: $20 credited, $24.20 charged, refund 1210 -> 1000 cents reversed -> credits purchased 1000, storage purchased 100. Delivered twice -> once.

Webhook endpoint must be subscribed to: `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `refund.created`, `charge.dispute.created`
(plus the subscription/invoice events of the billing spec).

Subscription events (billing spec) touch usage only through `setPlan(plan, { anchor: subscription.billing_cycle_anchor })`.

### 4.5 Stripe setup script

`apps/api/scripts/stripe-prices.ts` (idempotent): ensures a product "<APP_NAME> Credits"
with `metadata.kind = 'credits'` (found via `products.search("metadata['kind']:'credits'")`),
and a price with lookup key `<prefix>_credits_top_up`, currency usd,
`custom_unit_amount { enabled, minimum: TOP_UP.minCents, maximum: TOP_UP.maxCents,
preset: min(minCents*2, maxCents) }`, `transfer_lookup_key: true`; if an existing
active price matches currency/min/max, keep it; otherwise create the new one and
deactivate the old.

---

## 5. Screens (apps/web, TanStack Start + shadcn/ui)

Shared copy helpers (i18n prefix `settings.usageSettings`):
- `metricLabel(metric)` -> `metric.<metric>`
- `amountText(metric, n)` -> `amount.<metric>` with `n` locale-formatted (`Intl.NumberFormat` en-US / es-ES: "2,000" / "2.000")
- `availableLine` -> `available.<kind>` with `{amount}` ("1,750 credits left", "38 GB free")
- `splitLine` -> `split` `{plan, purchased}` ("750 credits from your plan · 1,000 credits purchased")
- `usedLine` -> capacity: `usedOf {used, limit}` ("12 GB of 50 GB used"); consumable: `usedThisMonth {amount}` ("250 credits used this month")
- `usedPercent` -> `whole = capacity ? (limit ?? 0) : used + available`; `whole <= 0 ? (used > 0 ? 100 : 0) : min(100, round(used / whole * 100))`
- `resetLine` -> `resets {day}` where day = full date of `resetsOn` in active locale ("Nov 4, 2026" / "4 nov 2026")
- `amountsLine(amounts)` -> locale list joining ("2,000 credits and 200 GB" / "... y ...")
- `topUpLine({ cents, amounts })` -> `${money(cents)} · ${amountsLine}` ("$25 · 2,500 credits and 250 GB"); money shows cents only if non-zero.

### 5.1 `UsageCards` component (reused)

Grid (1 col, 2 cols from `sm`), one shadcn `Card` per metric, `data-metric={metric}`:
- label (`metricLabel`)
- big number `data-available` (`availableLine`)
- `data-split` (`splitLine`)
- shadcn `Progress` value `usedPercent`, aria-label = `usedLine`
- `data-used` (`usedLine`)
- `data-resets` (`resetLine`)

### 5.2 Settings → Usage (all members)

- Location: Settings page, nav group "Organization settings", item `usage` (label key
  `settings.usage`), between General and Members. Visible to member, admin, owner.
  URL `/app/settings?section=usage`, reachable for every role.
- Loads `usage.get` (TanStack Query).
- Shows section title `settings.usageSettings.title` ("Usage"), `UsageCards`, then a hint `data-hint`:
  - member: `memberHint` "Running low? An owner or an admin can add credits."
  - admin/owner: `adminHint` "Add credits in Billing."
- Read only: NO buttons (test asserts no `button` in the section, no "Add credits" text for members).
- Error state: toast `settings.usageSettings.notLoaded` "Couldn't load usage. Reload the page." (query `meta.failure`, shown by the QueryCache handler).
- Loading: render nothing/skeleton until data.

### 5.3 Settings → Billing → "Usage" section and top-ups (owner/admin only)

Billing (`/app/settings?section=billing`; `/app/billing` redirects there keeping `top_up`) is
admin-only (hidden from member nav, not shown if opened by URL).
It loads both billing and `usage.get` (usage failure -> toast `settings.usageSettings.notLoaded`).

Usage section (aria-label `settings.billingSettings.usage.title`):
- Header row: title "Usage" + button `usage.addCredits` "Add credits" (opens dialog).
- If URL has `?top_up=paid`: `role="status"` success text `usage.topUpPaid`
  "Payment received. Your credits show up here in a moment." (webhook credits asynchronously).
- `UsageCards` with usage metrics.

Top-ups list (after the payment-method card), container `data-top-ups`:
- Heading `usage.topUps` "Top-ups".
- Rows (newest first): `fullDay(paidOn)` | `topUpLine(topUp)`, e.g. "Oct 8, 2026 | $25 · 2,500 credits and 250 GB".
- Empty: `usage.noTopUps` "No top-ups yet."

Add credits dialog (shadcn `Dialog`), title `usage.topUpTitle` "Add credits":
- Number input `name="amount"`, label `usage.topUpAmount` with `{currency}` ("Amount (USD)" — currency uppercase),
  `inputmode=decimal`, `min=10`, `max=500`, `step=1`, in whole dollars; default value 20 (2000 cents).
  State `topUpCents = value.trim() === '' ? null : Math.round(Number(value) * 100)`.
- Bounds hint `data-bounds` `usage.topUpBounds` {min:"$10", max:"$500"} -> "Between $10 and $500";
  destructive color when invalid (`!isTopUpAmount(cents)`), muted otherwise.
- Preview `data-preview` `usage.topUpYouGet` {amounts} -> "You get 2,000 credits and 200 GB." (amounts of 0 when invalid).
  Typing 45 -> "You get 4,500 credits and 450 GB."
- Note `usage.topUpNote`.
- Buttons: `usage.topUpCancel` "Cancel" (closes), submit `usage.topUpPay` "Continue to payment",
  disabled while busy or invalid (e.g. "5", "501", "" are invalid).
- Submit -> `billing.topUp({ cents })` -> redirect to returned URL. Error -> toast `usage.topUpNotOpened`
  "Couldn't open the payment. Try again in a minute." and re-enable.

### 5.4 i18n keys (reuse values from saas-base `apps/web/public/i18n/{en,es}.json`)

`settings.usage`, `settings.billing`,
`settings.usageSettings.{title, memberHint, adminHint, notLoaded, metric.credits, metric.storage_gb, amount.credits, amount.storage_gb, available.consumable, available.capacity, split, usedThisMonth, usedOf, resets}`,
`settings.billingSettings.usage.{title, addCredits, topUpTitle, topUpAmount, topUpBounds, topUpYouGet, topUpNote, topUpPay, topUpCancel, topUpNotOpened, topUpPaid, topUps, noTopUps}`.

English values:
```
usageSettings: title "Usage"; memberHint "Running low? An owner or an admin can add credits.";
  adminHint "Add credits in Billing."; notLoaded "Couldn't load usage. Reload the page.";
  metric {credits "Credits", storage_gb "Storage"}; amount {credits "{{n}} credits", storage_gb "{{n}} GB"};
  available {consumable "{{amount}} left", capacity "{{amount}} free"};
  split "{{plan}} from your plan · {{purchased}} purchased"; usedThisMonth "{{amount}} used this month";
  usedOf "{{used}} of {{limit}} used"; resets "Your plan's part resets on {{day}}"
billingSettings.usage: title "Usage"; addCredits "Add credits"; topUpTitle "Add credits";
  topUpAmount "Amount ({{currency}})"; topUpBounds "Between {{min}} and {{max}}"; topUpYouGet "You get {{amounts}}.";
  topUpNote "Added to every metric at once, and never expires. Your plan's monthly part is used first.";
  topUpPay "Continue to payment"; topUpCancel "Cancel"; topUpNotOpened "Couldn't open the payment. Try again in a minute.";
  topUpPaid "Payment received. Your credits show up here in a moment."; topUps "Top-ups"; noTopUps "No top-ups yet."
```
Spanish values: copy from saas-base `es.json` (e.g. title "Consumo", available.consumable "Quedan {{amount}}",
topUpPay "Continuar al pago", noTopUps "Aún no hay recargas."). i18next uses `{{var}}` interpolation natively.

---

## 6. Background jobs, emails, integrations, env vars

- Jobs: none. Monthly grants are computed on read (nothing stored, no cron).
- Emails: none specific to usage/top-ups (Stripe sends the top-up receipt/invoice via `invoice_creation`).
- Integrations: Stripe (Checkout payment mode, PaymentIntents retrieve, webhooks, prices/products in setup script).
- Env vars: `DATABASE_URL` (absent -> PGlite), `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
  `STRIPE_WEBHOOK_SECRET` (all three required for Stripe; any missing -> top-up 503, webhook 401),
  `BETTER_AUTH_URL` / `WEB_URL` (success/cancel URLs and trusted origins).

---

## 7. Business rules and edge cases (from tests)

1. Free grants $1/month: 100 credits, 10 GB; `resetsOn` > signup + 27 days.
2. The grant is computed on read: reading writes nothing to the ledger, and `plan_grant` rows are ignored.
3. Plan grant spent first, then purchased: Free + $20 top-up -> plan 100, purchased 2000, available 2100; consume 150 -> plan 0, purchased 1950, used 150, available 1950.
4. One top-up adds to every metric by its factor ($20 -> 2000 credits + 200 GB; storage limit 210 on Free).
5. Top-up credited once per key, even with concurrent deliveries.
6. A refused use spends nothing (Free, consume 101 -> UsageLimitError {requested 101, available 100}; used stays 0).
7. Retried consume with the same key spends once.
8. No two concurrent uses pass one balance (5x30 on 100 -> 3 succeed).
9. `check` never spends (`check('credits',100)` -> allowed, `101` -> not; `check('storage_gb', 11)` on Free -> not allowed).
10. Last month's grant lapses, purchased is kept: Pro (anchor 5 days ago) + $10 top-up, consume 1200 -> plan 0, purchased 800; new anchor -> granted 1000, plan 1000, purchased 800, used 0.
11. The grant follows the current plan mid-month: Pro, consume 400, move to Team -> granted 3000, plan 2600; Team, consume 50, move to Free -> granted 100, plan 50, used 50.
12. Capacity: set 8 on Free -> used 8, available 2; set 11 -> error {requested 3, available 2}; after $10 top-up set 11 ok (limit 110); set 0 always ok.
13. Refund reverses proportionally from every metric, once per reversal key; `reverse` second call returns false.
14. Reversals of one payment (refunds and disputes, even concurrent) never take back more than it bought; caps are per payment.
15. `consume` on a capacity metric throws (/capacity/); non-integer quantity throws (/whole number/).
16. Balances are per organization (same idempotency key in two orgs is independent).
17. Deleting an organization cascades ledger and levels; usage calls afterwards throw /gone/.
18. Webhook: unpaid top-up credits nothing; top-up naming no/invalid organization -> 204 ignored; reversal of a non-top-up payment -> 204 ignored; first top-up stores the Stripe customer without changing plan.
19. Purchased can go negative after a refund; consumable display clamps to 0; the debt is paid by the next top-up.
20. `topUps` list is not reduced by refunds.

---

## 8. saas-base tests worth porting

| saas-base test | Port to arrakit as |
|---|---|
| `libs/shared/plans/src/plans.spec.ts` (metricAmounts, planGrant, isTopUpAmount, usagePeriod, splitConsumption, metricBalance, isMetric/isPlan) | Vitest unit tests of the shared package, verbatim vectors |
| `libs/platform/data/src/usage/usage.int.spec.ts` | `packages/db/src/organization/usage.test.ts` on PGlite (grant on read, plan-then-purchased, idempotent credit/consume, capacity, per-payment reversal caps, cascade) and `usage-locking.test.ts` (reads take no lock; uses and reversals lock the org row; concurrency on real Postgres) |
| `apps/api/src/app/usage/usage.spec.ts` | `apps/api/src/usage/usage.test.ts` (probe router with `requiresUsage`/`consume`/`set`; 402 with data through the RPC client; `usage.get` member view; 401/404) |
| `apps/api/src/app/billing/top-up.spec.ts` | `apps/api/src/usage/top-up.test.ts` (Checkout for an admin, 403 origin, 403 member, 502, 503 without Stripe; webhook credit idempotency, keep customer, pending payment, invalid org, proportional refund, refund + dispute capped, non-top-up reversal, 500 when the payment cannot be read) |
| `apps/web/.../usage-settings.spec.ts` (member vs admin hint, no buttons, load error toast) | React Testing Library |
| `apps/web/.../billing-settings.spec.ts` usage cases (cards text incl. bar %, plan-then-purchased split, top-ups list ordering/empty, dialog preview 20->45, invalid "5"/"501"/"" disable submit with bounds text, Checkout failure toast, `?top_up=paid` status) | React Testing Library with an oRPC client mock |
| `delete-organization.int.spec.ts` ledger/levels cascade | Part of the organizations integration suite |

Web fixture used by those specs (Pro plan, `used: { credits: 250, storage_gb: 12 }`,
`resetsOn: '2026-11-04'`): credits "750 credits left" / "750 credits from your plan · 0 credits purchased"
/ "250 credits used this month"; storage "88 GB free" / "12 GB of 100 GB used". With a $20 top-up:
"2,750 credits left", bar 8; storage "288 GB free", "12 GB of 300 GB used", bar 4. Free + 150 used +
$10 top-up: "950 credits left", "0 credits from your plan · 950 credits purchased".

E2E (Playwright) suggestion: member sees Usage cards and no Add credits; admin opens Billing, opens
Add credits, sees preview, and (with fake Stripe in e2e) is redirected; simulate webhook to see top-up row.
