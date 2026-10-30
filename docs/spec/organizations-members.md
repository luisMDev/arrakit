# Spec: Organizations, members, invitations, account and security settings

Source of truth: saas-base (NestJS + Angular). This file is implementation-ready for arrakit
(Hono + oRPC + Zod, Drizzle, Better Auth, TanStack Start + shadcn/ui). Port **behaviour, copy and
rules**, not styles. Where saas-base paths are cited, they are for traceability only.

Scope:

- Organization create (Profile "Next" / "Skip"), rename, delete.
- Roles `owner` / `admin` / `member` and the role policy.
- Members list, role change, removal.
- Invitations: invite, list, resend, cancel, accept; the `MailMember` email; seat limits.
- `/join/:invitationId` page.
- `GET me` (the signed-in person + organization + role + plan + seats).
- Settings page shell (left nav, sections) and the sections: Account, General, Members, Security and data.
  (Usage and Billing sections are specced elsewhere; only their nav entries and role rules are here.)
- Account deletion; "Sign out everywhere" (Better Auth `revoke-other-sessions`); devices list.
- Tenancy: the organization-scoped data access layer (`forOrganization`).

Out of scope here but referenced: Profile page UI (onboarding spec), Billing/Stripe (billing spec),
storage purge worker internals (files spec), OAuth provider/MCP grants (mcp spec).

---

## 1. Domain constants and shared helpers

Put these in a shared package (e.g. `packages/shared` or `packages/domain`) so API and web use the same values.

### 1.1 Roles

```ts
export const ORGANIZATION_ROLES = ['owner', 'admin', 'member'] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];
export type AssignableRole = 'admin' | 'member'; // never 'owner'
export const isAdminRole = (role: string | null | undefined) => role === 'owner' || role === 'admin';
// Any stored role that is not exactly one of the three reads as 'member' (least privilege).
export const toOrganizationRole = (role: string): OrganizationRole =>
  (ORGANIZATION_ROLES as readonly string[]).includes(role) ? (role as OrganizationRole) : 'member';
```

- `owner`: the organization's creator (Better Auth organization plugin `creatorRole: 'owner'`).
  Everything an admin can, plus naming/demoting/removing admins and deleting the organization.
- `admin`: manages members, invitations and billing; renames the organization.
- `member`: uses the app. Reads General (read-only), Usage, Security (sees "owner only" text), Account.
- Case-sensitive: `'Admin'` is NOT an admin role (`isAdminRole('Admin') === false`).

### 1.2 Plans and seats (from the plans package; billing spec owns the rest)

| plan       | label    | seats |
| ---------- | -------- | ----- |
| `free`     | Free     | 1     |
| `pro`      | Pro      | 3     |
| `team`     | Team     | 10    |
| `internal` | Internal | 100   |

- Every new organization starts on `free` (1 seat = the owner alone, so a Free org cannot invite anyone).
- `internal` is never sold, set by hand in SQL.
- Seats count **members + live (pending AND unexpired) invitations**.

### 1.3 Email helpers (`address` package)

```ts
const EMAIL = /^[^\s@]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const isWorkEmail = (email: string) => EMAIL.test(normalizeEmail(email)); // needs a dot + TLD >= 2 letters
```

`jon@organization` (no dot in the domain) is refused. Free-mail addresses ARE accepted by `isWorkEmail`
(the name is historical): it only checks that we can write to it.

### 1.4 Slugs (`address` package)

```ts
export const MAX_SLUG_LENGTH = 63;
export const slugOf = (name: string) =>
  name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '');
// Candidates: base, base-2 … base-50 (49 numbered), each truncated so the suffix fits in 63 chars.
export const slugCandidates = (name: string): string[] => { /* [] when slugOf(name) === '' */ };
```

Examples: `'  Alder Ventures '` -> `alder-ventures`; `'ÁLDER  ventures'` -> `alder-ventures`;
second org with the same base -> `alder-ventures-2`, third -> `alder-ventures-3`.
`'北京基金'` and `'&.!'` produce no slug (`[]`).

### 1.5 Organization naming (`address` package) — used by create and skip

- `domainOf(email)`: part after last `@`, normalized, trailing dots removed.
- `TWO_LEVEL_SUFFIXES` (copy verbatim from saas-base `libs/shared/address/src/naming.ts`):
  `co.uk org.uk ac.uk gov.uk me.uk ltd.uk plc.uk net.uk com.au net.au org.au edu.au gov.au com.br net.br org.br co.nz org.nz net.nz co.jp or.jp ne.jp ac.jp com.es org.es nom.es com.mx com.ar com.co com.pe com.uy com.ec com.ve co.za co.il co.in co.kr co.id co.th co.ke com.tr com.sg com.hk com.cn com.tw com.my com.ph com.vn com.pl com.pt com.ua`.
- `FREE_MAIL_DOMAINS` (exact, whole-domain match, never suffix/substring):
  `gmail.com googlemail.com outlook.com outlook.es outlook.fr outlook.de outlook.it hotmail.com hotmail.es hotmail.co.uk hotmail.fr hotmail.de hotmail.it live.com live.co.uk live.fr live.de live.it msn.com yahoo.com yahoo.es yahoo.co.uk yahoo.fr yahoo.de yahoo.it ymail.com aol.com icloud.com me.com mac.com proton.me protonmail.com pm.me gmx.com gmx.de gmx.net gmx.at gmx.ch web.de t-online.de mail.com zoho.com yandex.com fastmail.com hey.com orange.fr wanadoo.fr sfr.fr free.fr laposte.net libero.it telefonica.net qq.com 163.com naver.com`.
- `organizationNameFromEmail(email)`: the label just left of the public suffix (2-level suffix counts as one),
  hyphens -> spaces, each word capitalised. `x@mail.cedar.co.uk` -> `Cedar`; `x@birch-ventures.com` -> `Birch Ventures`;
  `x@team.rowan.com.au` -> `Rowan`; `x@info.co.uk` -> `Info`; `x@co.uk` -> `''`.
- `nameFromLocalPart(email)`: local part, drop `+tag`, split on `.`, `_`, `-`, capitalise: `ana.perez+x@gmail.com` -> `Ana Perez`.
- `organizationNameOnSkip(email, personName = '')`:
  1. If domain is NOT free mail and `organizationNameFromEmail` has a letter/digit -> that.
  2. Else if `personName` has a letter/digit -> `personName`.
  3. Else if local-part name has a letter/digit -> that.
  4. Else `'My Organization'`.
- `organizationNameOr(typed, email, personName)`: `typed` if it has a letter/digit (i.e. `slugOf(typed) !== ''`), else `organizationNameOnSkip(email, personName)`.

Test table (port as unit tests of the naming package AND as API tests):

| endpoint | email | session name | typed name | personName | result name | slug |
| --- | --- | --- | --- | --- | --- | --- |
| create | dana@elm.vc | – | `''` | Lucía Gómez | Elm | elm |
| create | dana@oak-partners.com | – | `'   '` | Lucía Gómez | Oak Partners | oak-partners |
| create | dana@mail.yew.co.uk | – | `'&.!'` | Lucía Gómez | Yew | yew |
| create | dana@pine.vc | – | `'北京基金'` | Lucía Gómez | Pine | pine |
| create | ana.perez@gmail.com | – | `''` | Ana Pérez | Ana Pérez | ana-perez |
| create | x@outlook.com | Marta Ruiz | `''` | `''` | Marta Ruiz | marta-ruiz |
| create | bruno.diaz@hotmail.com | – | `''` | `''` | Bruno Diaz | bruno-diaz |
| create | dana@co.uk | – | `'&.!'` | Lucía Gómez | Lucía Gómez | – |
| skip | lucia@alder.vc | – | – | – | Alder | alder |
| skip | ana.perez@gmail.com | – | – | – | Ana Perez | ana-perez |
| skip | x@outlook.com | Marta Ruiz | – | – | Marta Ruiz | marta-ruiz |
| skip | _@gmail.com | – | – | – | My Organization | my-organization |
| skip | sara@oak.vc | Sara Gil | – | – | Oak | oak |
| skip | x@co.uk | Ana Pérez | – | – | Ana Pérez | starts with `ana` |

Never name an org after a free-mail provider (slug must never contain `gmail`/`hotmail`).

### 1.6 Time zone validation (`isTimeZone`)

Accept exactly IANA names as the zone DB writes them: `'UTC'`, anything in
`Intl.supportedValuesOf('timeZone')`, or a renamed zone matching
`/^(?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)(?:\/[A-Z][a-z]+(?:_[A-Z][a-z]+)*){1,2}$/`
whose `Intl.DateTimeFormat('en',{timeZone}).resolvedOptions().timeZone` is listed and differs from the input
other than by case (e.g. `Asia/Kolkata`, `Europe/Kyiv`). Reject `europe/madrid`, `+02:00`, `CET`.
Port saas-base `apps/api/src/app/organizations/time-zone.spec.ts`.

### 1.7 Device names (`deviceName(userAgent)`)

From the first parenthesised part after `Mozilla/5.0 (` split by `;` and trimmed, first match wins in order:
`^iPhone$`->`iPhone`, `^iPad$`->`iPad`, `^Android\b`->`Android phone`, `^CrOS\b`->`browser`,
`^Macintosh$`->`Mac`, `^Windows NT\b`->`Windows PC`, `^(X11|Linux\b)`->`Linux computer`; anything else
(including null, curl) -> `browser`. iPad in desktop mode sends a Mac UA and reads as `Mac`.
Port `device-name.spec.ts`.

---

## 2. Data model (Drizzle, Postgres; PGlite in dev/tests)

All timestamps `timestamp with time zone`. Better Auth tables are mapped onto these (use Better Auth's
Drizzle adapter with a schema mapping / `modelName` + `fields` overrides; the organization plugin's
`organization`, `member`, `invitation` models map to `organizations`, `members`, `invitations` with
`organizationId` -> `organization_id`).

### 2.1 `users` (Better Auth `user`, plus additional fields)

| column | type | notes |
| --- | --- | --- |
| id | text PK | Better Auth id |
| name | text not null | `''` after a magic-link signup until the person gives one |
| email | text not null unique | |
| email_verified | boolean not null default false | |
| image | text null | Google/Microsoft picture |
| language | text not null default `'en'` | CHECK `language in ('en','es')`; Better Auth `user.additionalFields` with `input: false` (must NOT be settable through Better Auth's own `update-user`: test "keeps the language off better-auth's own update-user") |
| time_zone | text null | IANA, null until set |
| email_product_news | boolean not null default false | "Product news"; stored only, nothing sends it yet |
| created_at, updated_at | timestamptz | |

### 2.2 `sessions` (Better Auth `session`)

id text PK, expires_at, token unique, created_at, updated_at, ip_address, user_agent,
user_id -> users.id ON DELETE CASCADE (index), active_organization_id uuid null -> organizations.id ON DELETE SET NULL
(plugin field; nothing sets it).

### 2.3 `accounts` (Better Auth `account`)

Standard Better Auth columns; `provider_id` values used here: `google`, `microsoft`, `credential`/magic link.
user_id -> users.id ON DELETE CASCADE.

### 2.4 `organizations` (tenant root; Better Auth `organization`)

| column | type | notes |
| --- | --- | --- |
| id | uuid PK default random | Must stay a UUID (tenancy checks UUID shape). Configure Better Auth id generation accordingly or let the DB default win. |
| name | text not null | trimmed |
| slug | text not null **unique** | lowercase, never changes after creation |
| logo | text null | plugin field, unused |
| metadata | text null | plugin field, unused |
| plan | text not null default `'free'` | CHECK `plan in ('free','pro','team','internal')` |
| stripe_customer_id | text unique null | billing spec |
| stripe_subscription_id | text null | billing spec; used by org delete |
| usage_anchor | timestamptz null | billing/usage spec |
| created_at | timestamptz not null default now() | |

### 2.5 `members` (Better Auth `member`)

| column | type | notes |
| --- | --- | --- |
| id | text PK, default `randomUUID()` | |
| organization_id | uuid not null -> organizations.id ON DELETE CASCADE | |
| user_id | text not null -> users.id ON DELETE CASCADE | index `members_user_id_idx` |
| role | text not null default `'member'` | |
| terms_accepted_at | timestamptz null | only on the creator's row; stamped by Postgres `now()` when Terms accepted on Profile "Next"; null on Skip |
| created_at | timestamptz not null default now() | |

Unique `(organization_id, user_id)`.
A person may technically be in several orgs (DB allows it); the app always uses the **earliest joined**
(`ORDER BY members.created_at ASC LIMIT 1`). The API forbids creating/joining a second one.

### 2.6 `invitations` (Better Auth `invitation` + our `email_sent`)

| column | type | notes |
| --- | --- | --- |
| id | text PK | `randomUUID()` |
| organization_id | uuid not null -> organizations.id ON DELETE CASCADE | index |
| email | text not null | normalized (trim + lowercase); index |
| role | text null | `admin` or `member` (read back: `'admin'` -> admin, anything else -> member) |
| status | text not null default `'pending'` | `pending` -> `accepted` / `canceled` |
| email_sent | boolean not null **default false** | ours; default required or Better Auth refuses requests |
| expires_at | timestamptz not null | `now() + 7 days` on invite/re-invite/resend |
| created_at | timestamptz not null default now() | list order |
| inviter_id | text not null -> users.id ON DELETE CASCADE | |

Derived: `sentAt = expiresAt - 7 days` (not stored). "Live" = `status = 'pending' AND expires_at > now()`.
One `pending` row per (organization, email): re-inviting updates it.

### 2.7 OAuth grant tables (from the MCP/OAuth provider spec)

`oauth_access_tokens`, `oauth_refresh_tokens`, `oauth_consents` carry `reference_id` (= organization id, **no FK**)
and `user_id`. They must be deleted explicitly (see org delete and member removal).

### 2.8 Cascades summary (delete organization)

Every table with `organization_id` references `organizations.id ON DELETE CASCADE`: members, invitations, and every
product table (companies, files, inbound emails, attachments, usage…). `sessions.active_organization_id` set null.
OAuth grants deleted manually in the same transaction. Users/accounts/sessions survive.
Add a schema test: "every table with `organization_id` has an FK to organizations with ON DELETE CASCADE"
(saas-base `schema.spec.ts`, `delete-organization.int.spec.ts` "walks the tables that carry organization_id").

---

## 3. Tenancy layer (`forOrganization`)

Port `libs/platform/data/src/tenancy/*` to arrakit's data package.

- `toOrganizationId(value)`: must match UUID regex `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`;
  returns lowercased branded `OrganizationId`. Throws (before any query) on `''`, `not-a-uuid`, wildcards, slashes,
  padding, braces. Accepts v4 and v7. Uppercase input -> lowercase (one storage prefix per org).
- `forOrganization(id)` returns `OrganizationDb`:
  - `organization()` reads its own row.
  - `table(t)` for any table with an `organizationId` column (throws for a table without it):
    `select(where?, orderBy?)`, `pick(columns, where?, orderBy?)`, `insert(values)` (forces `organizationId`),
    `update(set, where)` (drops `organizationId` from `set`; throws if `where` yields no condition),
    `delete(where)` (same), `lock(where, strength)` with `update | no key update | share | key share`.
  - `transaction(work)` scoped to the same org.
  - `where`/`orderBy` callbacks receive a restricted operator set (`and, or, not, eq, ne, gt, gte, lt, lte, inArray, isNull, isNotNull`, `asc, desc`); no raw `sql`.
  - `members` (section 4), `rename(name)`, `setPlan(...)`, `files`, etc.
- Tests worth porting: `tenant-db.int.spec.ts` (isolation A/B on read/update/delete/insert/lock, empty-where refusal,
  transaction commit/rollback, lock waits) and `organization-id.spec.ts`. Run on PGlite in-memory. The "conflicting lock
  waits" test may need adapting on PGlite (single connection); keep it for real Postgres or skip under PGlite with a note.

---

## 4. Data operations (business rules)

Constant: `INVITE_DAYS = 7`.

### 4.1 `createOrganization(name, admin?)`

Input `admin = { userId, personName?, termsAccepted: boolean }`.

1. `candidates = slugCandidates(name)`; empty -> throw `OrganizationNameUnusableError`.
2. In one transaction:
   - If admin: lock the user row `FOR UPDATE` (missing user -> generic error); if the user has any `members` row -> throw
     `PersonHasOrganizationError`. (Two concurrent submits by the same person create exactly one org.)
   - Claim slug: for each candidate, `INSERT ... ON CONFLICT (slug) DO NOTHING RETURNING`; first success wins. Concurrent
     orgs named alike get `x`, `x-2`, `x-3`. All 50 taken -> generic error.
   - Name stored = `name.trim()`.
   - If admin: insert `members { role: 'owner', termsAcceptedAt: termsAccepted ? now() : null }`; if
     `personName?.trim()` non-empty, update `users.name` to it (blank keeps current name).
3. Without `admin` it creates a bare tenant root (used by tests/seeds).

### 4.2 `memberOf(userId)` / `organizationOf(userId)`

Earliest membership joined to its organization, role via `toOrganizationRole`. Null when none. Always read from DB
(never cached in session): removal takes effect on the very next request.

### 4.3 `renameOrganization(orgId, rawName)`

`name = rawName.trim()`; blank -> `OrganizationNameUnusableError`, nothing changes. Slug never changes. Names without
any slug-able char (`'&.!'`, `'北京基金'`) ARE accepted on rename. Returns undefined if org gone.

### 4.4 `deleteOrganization(rawId)`

`toOrganizationId` (throws on non-UUID, deleting nothing; uppercase works). Transaction: `revokeGrants(orgId)` then
`DELETE organizations WHERE id` returning; true if a row was removed, false if already gone.

### 4.5 `revokeGrants(tx, orgId, userId?)`

Delete from `oauth_access_tokens`, `oauth_refresh_tokens`, `oauth_consents` where `reference_id = orgId`
(and `user_id = userId` when given). OAuth clients stay registered.

### 4.6 Role policy `checkMemberChange({ actor, change, owners, admins })` — pure function

`change` is `{kind:'invite', organizationId, role}` | `{kind:'role', target, role}` | `{kind:'remove', target}`.
`owners`/`admins` = current counts of owner rows / admin rows (owners excluded from admins).
Rules in order, each refusal returning `{ ok:false, reason }` (reasons are user-facing English messages):

1. Actor's org != change's org -> `That person is not in your organization.`
2. Actor role not exactly owner/admin -> `Only an admin manages members.`
3. For invite/role: role `owner` -> `No one is made owner: the organization has its creator.`; role not exactly
   `admin`/`member` (e.g. `Admin`, `superadmin`) -> `There is no role "<role>".`
4. Invite -> allowed (admins may invite admins).
5. Target is owner: if not self -> `Only the owner changes the owner's role or seat.`; if self and `owners > 1` -> allowed,
   else -> `You are the organization's only owner.`
6. Target is admin: new role `admin` -> allowed (no-op). If not self and actor is not owner ->
   `Only the owner demotes or removes an admin.` If self and `owners + admins - 1 < 1` ->
   `You are the organization's last admin.` Else allowed.
7. Target is member: new role `admin` and actor not owner -> `Only the owner names admins.` Else allowed.

Port `member-policy.spec.ts` verbatim (11 allowed cases, 19 refused cases, plus `isAdminRole` table).

### 4.7 `forOrganization(id).members`

- `list()`: members joined to users -> `{ userId, name, email, image, role, joinedAt }`, ordered
  `members.created_at ASC, members.id ASC`.
- `invitations()`: live invitations (pending AND unexpired) ordered `created_at ASC, id ASC` ->
  `{ id, email, role, sentAt, expiresAt, emailSent }`.
- `invite({ email, role, inviterId })`:
  1. `normalized = normalizeEmail(email)`; `!isWorkEmail` -> `InviteEmailUnusableError`
     (message: `Enter a work email, like name@organization.com: "<raw>" is not one.`).
  2. Transaction: lock the org row `FOR NO KEY UPDATE` (serializes seat checks), read plan.
  3. Policy with actor = inviter's member row in this org (`FOR SHARE`; no row -> role `''` and org `''` -> refused).
     -> `MemberChangeRefusedError(reason)`.
  4. Already a member with that email -> `AlreadyMemberError` (`<email> is already in the organization.`).
  5. Seat check (`requireSeat`): `count(members) + count(live invitations with email != normalized) >= seats(plan)` ->
     `SeatLimitError` with message
     `Your organization's <PlanLabel> plan includes <n> seat|seats, all taken. Upgrade to invite more people.`
     (Free: `Your organization's Free plan includes 1 seat, all taken. Upgrade to invite more people.`).
  6. If a `pending` row for (org, email) exists (expired or not): update `role, inviterId, expiresAt = now()+7d, emailSent=false`
     and return it (same id). Else insert new row (`emailSent=false`).
- `resend(id)`: transaction; lock org; find pending row (even expired) by id in this org, else `undefined`;
  seat check with holding = its email (an expired invite had released its seat, renewing takes one again ->
  `SeatLimitError`); set `expiresAt = now()+7d` (does NOT touch `emailSent`). Returns updated.
- `markEmailSent(id)`: set `email_sent = true` on pending row in this org; undefined if not pending anymore.
- `cancel(id)`: pending row in this org -> `status='canceled'`; false if none (another org's id, already canceled).
- `changeRole(actorUserId, email, role)`: transaction; lock all owner/admin rows of the org `FOR UPDATE` ordered by id
  (deadlock-free); find target by normalized email (`FOR UPDATE OF members`) -> `NoSuchMemberError`
  (`No one in the organization is <email>.`); actor role read from the locked rows (absent -> `''`); run policy with
  counts from locked rows; update role. Concurrency rule: of two last admins (ownerless org) stepping down at once,
  exactly one succeeds.
- `remove(actorUserId, email)`: same checks with `kind:'remove'`; delete member row; `revokeGrants(org, target.userId)`
  in the same transaction (a refused removal keeps grants). (saas-base also deletes the removed member's personal
  "only me" notes; implement when the notes feature exists.)

### 4.8 `invitationFor(invitationId, email)` (not org-scoped)

Live invitation with that id joined to organization and inviter; null when id not a non-empty string, not found,
expired, canceled, accepted, or `invitation.email !== normalizeEmail(email)` (exact match: `jon+x@`, `jon@organization.com.`,
`jo@`, `njon@`, other TLDs all refused). Returns pending view + `organization` + `inviter {name,email}`.

### 4.9 `acceptInvitation({ invitationId, userId, email })`

Transaction:
1. invalid id -> `InvitationNotFoundError`.
2. Lock user row `FOR UPDATE` (double click adds once); missing -> `InvitationNotFoundError`.
3. Live invitation by id `FOR UPDATE OF invitations`, email must equal normalized email -> else `InvitationNotFoundError`.
4. User already has any membership -> `PersonHasOrganizationError` (invitation stays pending).
5. Lock org, `count(members) >= seats(plan)` -> `SeatLimitError` (invitation stays pending). Note: pending invitations
   are NOT counted here, so invitations sent before a downgrade get in first-come-first-served while a seat is left.
6. Insert member with invitation's role; set invitation `status='accepted'`. Return `{ organization, role }`.

### 4.10 Account (`account`, `updateAccount`, `wantsEmail`, `languageOf`)

- `SIGN_IN_METHODS = ['email','google','microsoft']`.
- `account(userId, currentSessionId)`: user `{name,email,language,timeZone,emails:{productNews}}`;
  `signInWith` = provider of the most recently created `accounts` row whose provider is google/microsoft, else `email`;
  `sessions` = unexpired sessions of the user ordered `created_at DESC`, with the current one moved first
  (`{id,userAgent,current}`). Null if user missing.
- `updateAccount(userId, sessionId, { name?, language?, timeZone?, emails?: { productNews? } })`: writes only provided
  keys (no write when all undefined), then re-reads in the same transaction.
- `wantsEmail(email, 'productNews')`: compares `lower(users.email)` to normalized; unknown person -> true.
- `languageOf(userId)`: unknown -> `'en'`.

### 4.11 `deleteAccount(userId)`

Transaction: lock user `FOR UPDATE` (missing -> false). If the user has ANY `members` row with role `owner` (in any org,
not only the first) -> `PersonOwnsOrganizationError`, nothing deleted. Else delete all invitations addressed to their
normalized email (any status, any org), then delete the user row (cascades sessions on every device, accounts,
memberships, invitations they sent). Returns true. (saas-base also deletes their personal notes and nulls authorship of
org notes; apply when notes exist.) The org, its owner and other invites (e.g. `kim@...` invited by the owner) stay.

---

## 5. API (oRPC at `/api/rpc`, Better Auth at `/api/auth/*`)

General rules:

- Every procedure below requires a live Better Auth session (`auth.api.getSession({ headers })`) -> else
  `UNAUTHORIZED` (401).
- **Org-scoped middleware** (port of `OrganizationRoleGuard`): reads `memberOf(user.id)` from DB on every request.
  No membership -> `NOT_FOUND` "Not found in your organization." (404). Level `admin` and role member -> `FORBIDDEN`
  "Only an admin of the organization can do this.". Level `owner` and role != owner -> `FORBIDDEN`
  "Only the organization's owner can do this.". Puts `{ organization, role }` in context. The org is ALWAYS the
  session's; any `organizationId`/`slug` in the body is ignored (Zod `strip`).
- Error mapping (port `member-errors.ts`): `MemberChangeRefusedError`, `SeatLimitError` -> FORBIDDEN with message;
  `AlreadyMemberError`, `InviteEmailUnusableError` -> BAD_REQUEST with message; `NoSuchMemberError` -> NOT_FOUND with
  message; `InvitationNotFoundError` -> NOT_FOUND "This invitation is not open for you."; `PersonHasOrganizationError`
  -> CONFLICT "You already belong to an organization." (on accept) / "You already have an organization." (on create);
  `PersonOwnsOrganizationError` -> CONFLICT
  "You own an organization. Delete the organization first, in Settings → Security and data.".
- **Trusted Origin check** on invite and resend: request `Origin` header must be exactly one of the trusted origins
  (web origin); missing, `null`, or other site -> FORBIDDEN "Invite from the app." with nothing stored or sent.
- Better Auth organization plugin's own HTTP routes (`/api/auth/organization/*`) must be **closed**: a `before` hook
  throws `NOT_FOUND` for any path starting `/organization/` (tests: `POST /organization/create`,
  `POST /organization/update`, `GET /organization/list` -> 404). Orgs are only created via our procedures.
- Suggested oRPC contract names in parentheses; saas-base REST path given for reference.

### 5.1 `me.get` (GET /api/me) — session only

Output:
```ts
{ email: string; name: string; language: 'en'|'es';
  organization: { id: uuid; name; slug; plan } | null;
  role: 'owner'|'admin'|'member' | null;
  plan: Plan | null;
  seats: number | null /* PLAN_OFFERS[plan].seats */ }
```
Before Profile: `{ email, name:'', language:'en', organization:null, role:null, plan:null, seats:null }`.
After create: role `owner`, plan `free`, seats `1`. `name` comes from users.name (Profile personName).

### 5.2 `me.account.get` (GET /api/me/account)

Output `AccountView`:
```ts
{ name: string; email: string; signInWith: 'email'|'google'|'microsoft';
  devices: string[]  /* deviceName(userAgent) per live session, current first */;
  language: 'en'|'es'; timeZone: string|null; emails: { productNews: boolean } }
```
Fresh magic-link user: `{ name:'', email, signInWith:'email', devices:['browser'], language:'en', timeZone:null, emails:{productNews:false} }`.
Two devices: laptop sees `['Mac','iPhone']`, phone sees `['iPhone','Mac']`. User vanished between auth and read -> 401.

### 5.3 `me.account.update` (PATCH /api/me/account)

Input (all optional; empty object returns account unchanged):
```ts
z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(100, 'Keep your name to 100 characters.')
        .regex(/^[^\p{Cc}  ]*$/u, 'Keep your name on one line.').optional(),
  language: z.enum(['en','es']).optional(),
  timeZone: z.string().refine(isTimeZone, 'Pick a time zone from the list.').optional(),
  emails: z.object({ productNews: z.boolean() }).partial().optional(),
})
```
Output: AccountView. 400 for: blank name, name with line break, >100 chars, language `fr`, `europe/madrid`, `+02:00`,
`productNews: 'no'` — saving nothing. Name saved trimmed. Never touches another user. `me.get` reflects the new name.

### 5.4 `me.delete` (DELETE /api/me) — session only

Deletes the account (4.11). Success: 204/void; every session (this and other devices) is invalid from the next request.
Owner -> 409 with the message above; owner stays signed in. Invited admin who deletes their account leaves the org;
owner still owner; members list = owner only.

### 5.5 `organizations.create` (POST /api/organizations) — session only (no org needed)

Input:
```ts
z.object({
  name: z.string().trim().max(200),            // blank allowed -> naming fallback
  personName: z.string().trim().max(200).optional(), // blank keeps current name
  termsAccepted: z.literal(true, { error: 'Accept the Terms and the Privacy Policy.' }),
}) // unknown keys stripped (a client-sent termsAcceptedAt is ignored)
```
Logic: `personName || session.user.name` for the fallback; name = `organizationNameOr(body.name, email, thatName)`;
`createOrganization(name, { userId, personName: body.personName, termsAccepted: true })`.
Output (201): `{ id, name, slug, plan }`.
Errors: termsAccepted false/missing/`'true'` -> 400 (nothing created); already has org -> 409 "You already have an
organization." (original org kept); unusable name -> 400 "Give the organization a name with letters or digits."
(practically unreachable thanks to fallback); 401.
A former owner who deleted their org can create again (becomes owner).

### 5.6 `organizations.skip` (POST /api/organizations/skip) — session only

No input (body ignored entirely, e.g. `{name:'Postmaster', termsAccepted:true}` is ignored).
Name = `organizationNameOnSkip(session.user.email, session.user.name)`, `termsAccepted: false` (terms_accepted_at null).
Output 201 `{ id, name, slug, plan }`. 409 if already has an org (including after Next created one). 401.

### 5.7 `organizations.update` (PATCH /api/organizations) — level admin

Input:
```ts
z.object({ name: z.string().trim().min(1, 'Give the organization a name.').max(200).optional() })
 .refine(b => Object.values(b).some(v => v !== undefined), { error: 'Send a name.' })
```
Output 200 `{ id, name, slug, plan }` (slug unchanged). Errors: `{}` -> 400; `''`/`'   '` -> 400 (unchanged);
member -> 403; no org -> 404; 401; org deleted concurrently -> 404. Body `organizationId`/`slug` ignored.

### 5.8 `organizations.delete` (DELETE /api/organizations) — level owner

1. If org has `stripe_subscription_id`: if Stripe not configured -> 503 SERVICE_UNAVAILABLE; else call
   `stripe.subscriptions.cancel(id)` (end now). Failure -> log `ending subscription <sub> of organization <org> failed: <reason>`
   and 502 BAD_GATEWAY. Message for both:
   `Couldn't cancel your plan with Stripe, so nothing was deleted. Try again in a minute.` Nothing deleted.
2. `deleteOrganization(orgId)`; false -> 404.
3. Queue job `storage-purge` with `{ organizationId, folder: '' }`. Queue failure is logged (message includes
   `organization <id>`) and swallowed: still 204.
Output 204. After: owner and all members get `organization:null, role:null` from `me.get`. Admin/member -> 403 (nothing
deleted, nothing queued). No org -> 404, no session -> 401, nothing queued. Other orgs untouched.

### 5.9 `members.list` (GET /api/members) — level admin

Output `[{ name, email, role }]` oldest first (name `''` when none; web displays local part).

### 5.10 `members.changeRole` (PATCH /api/members/:email) — level admin

Input `{ email: string /* path param, case-insensitive, URL-encoded */, role: 'admin'|'member' }`.
Output `{ name, email, role }`. Errors per policy (403 with reason), 404 no such member (also another org's member).

### 5.11 `members.remove` (DELETE /api/members/:email) — level admin

Output 204/void. The removed person's next request (same cookie) gets 404 on org routes and `organization:null` on me.

### 5.12 `invitations.list` (GET /api/invitations) — level admin

Output `[{ id, email, role, invitedOn: 'YYYY-MM-DD' (UTC, of sentAt), expiresAt: ISO, emailSent: boolean }]`, oldest first,
live only.

### 5.13 `invitations.invite` (POST /api/invitations) — level admin + trusted Origin

Input `{ email: z.string().max(320), role: z.enum(['admin','member']) }` (email normalized server side, e.g.
`'  Jon@Birch.VC '` -> `jon@birch.vc`).
Flow: origin check -> `members.invite` -> send invite email (5.17) -> if sent, `markEmailSent` -> return view.
Output 201 InvitationView. Email failure: invitation kept, error logged with `organization <orgId>` and
`invitation <id>`, response 201 with `emailSent:false`. If `markEmailSent` finds nothing (canceled meanwhile) or throws:
log, still answer `emailSent:true`.
Errors: 400 invalid address (`jon@organization`) or already in org (case-insensitive), nothing sent; 403 member,
403 seat limit (Free: message in 4.7), 403 untrusted origin; 404 no org; 401.

### 5.14 `invitations.resend` (POST /api/invitations/:id/resend) — level admin + trusted Origin

`members.resend(id)`; undefined -> 404 "No such invitation in your organization." (canceled, other org). Send email;
failure -> 503 `The invite to <email> is saved, but its email did not go out. Press Resend to send it again.` (emailSent stays
as it was; expiry already extended). Success -> markEmailSent -> 200 InvitationView with `emailSent:true`.
403 member / seat limit (expired invite whose seat was taken).

### 5.15 `invitations.cancel` (DELETE /api/invitations/:id) — level admin

204; 404 "No such invitation in your organization." when not pending in this org.

### 5.16 `invitations.accept` (POST /api/invitations/:id/accept) — session only (no org needed)

`acceptInvitation({ invitationId: id, userId, email: session.user.email })`.
Output 200 `{ organization: { id, name, slug, plan }, role }`.
Errors: 404 "This invitation is not open for you." (wrong email, unknown id like `nope`, expired, canceled, accepted);
409 "You already belong to an organization." (invitation stays pending); 403 seat limit (stays pending); 401.

### 5.17 Sending the invite email (Better Auth magic link)

The invite email IS a Better Auth magic link: `auth.api.signInMagicLink({ body: { email, callbackURL: join, errorCallbackURL: join }, headers: <inviter's request headers> })`
where `join = ${WEB_ORIGIN}/join/${encodeURIComponent(invitationId)}`. Passing the inviter's headers makes the
trusted-origin check and the work-email rule apply.

In the magic link plugin's `sendMagicLink({ email, url })`:
- Parse the callback from `url`; if it is a trusted origin's `/join/<id>` (regex `^/join/([^/]+)$`) and
  `invitationFor(id, email)` returns a live invitation addressed to that email -> send **MailMember**;
  otherwise send the normal **MailSignin** (a stranger asking for a link with someone else's join callback gets a plain
  sign-in email).
- `expiresInDays = max(1, ceil((invitation.expiresAt - now) / 1 day))`.

Opening the link: Better Auth verifies, creates the session (cookie) and 302-redirects to `${WEB_ORIGIN}/join/<id>`.
Magic links work once, are stored hashed, and expire after MAGIC_LINK_MINUTES (auth spec).
Also in Better Auth `before` hook: `/sign-in/social` and `/sign-in/magic-link` require trusted Origin
(`Sign in from the app.`).

### 5.18 Sign out everywhere

Better Auth built-in `POST /api/auth/revoke-other-sessions` (client: `authClient.revokeOtherSessions()`): ends all
other sessions of the person, keeps this one, other people unaffected; afterwards `me.account.get` devices length 1.
401 without session. Port `sessions.spec.ts`.

---

## 6. Emails

### MailMember (invite)

Input: `to`, `url` (magic link), `organization.name`, `inviter {name,email}`, `expiresInDays`.
Inviter display = `inviter.name.trim()` or email local part.
- Subject: `<firstName(inviter)> invited you to <Org name> on <APP_NAME>` (first word of the inviter display;
  e.g. `Lucía invited you to Halden Capital on Arrakit`; with no name: `ana invited you to Birch on Arrakit`).
- Heading: `Join <Org>` / `on <APP_NAME>.`
- Body: `<inviter> invited you to work with them in <Org>.`
- Button: `Join <Org>` -> url.
- Note: `The invite expires in <n> day|days.`
- Organization branding block (org name) as in the layout. No Reply-To.
Tests: recording mailer capturing `{ to, subject, html, text }` so tests can assert
`[to, subject]` and extract the link (`linkFor(email)`).

### MailSignin (for reference): subject `Your link to sign in to <APP_NAME>`.

Port `mail-member.spec.ts` (3 tests: recipient + subject from inviter's first name + org; carries link and expiry;
local-part fallback).

---

## 7. Background jobs

- `storage-purge` queue (pg-boss; in-process fallback on PGlite). Payload `{ organizationId: string, folder: '' }` for an
  org delete (`''` = every file under the org prefix). Retry policy per files spec; failures logged and rethrown.
  Queue-send failure in org delete is logged ("deleted, but its storage purge was not queued; its files stay in the bucket")
  and does not fail the request.

---

## 8. External integrations

- **Better Auth**: magic link, Google, Microsoft, organization plugin (`creatorRole: 'owner'`, schema mapped to our tables,
  HTTP routes closed), user `additionalFields` (language, timeZone, emailProductNews as non-input fields), sessions with
  user agent, `revoke-other-sessions`.
- **Stripe**: `subscriptions.cancel` on org delete when `stripe_subscription_id` set.
- **Resend** mailer (Mailpit in dev/e2e, recording mailer in tests).
- **pg-boss** for storage purge.
- **S3** (purge target; files spec).

## 9. Env vars involved

`DATABASE_URL` (absent -> PGlite dir), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (API base URL), `WEB_ORIGIN` /
`TRUSTED_ORIGINS` (join URL + Origin checks), `RESEND_API_KEY`, `MAIL_FROM`, `STRIPE_SECRET_KEY` (optional; missing +
paying org -> 503 on delete), `GOOGLE_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET`, `APP_NAME` (email copy),
S3 vars (purge). Use whatever names AGENTS.md fixes; these are the needs.

---

## 10. Web app (TanStack Start, shadcn/ui, i18next)

### 10.1 Current user state

Load `me.get` (TanStack Query, key `['me']`) in the `/app` route `beforeLoad`/loader:
- 401 -> redirect `/signin`.
- `organization === null` -> redirect `/profile` (Profile is where an org is made).
- 403 -> `/unavailable?reason=forbidden`; other failure -> `/unavailable?next=<url>` (report error).
- If `me.language` differs from the active i18n language, switch language before rendering.
Derived: `role`, `isAdmin = role in (owner, admin)`, `isOwner = role === 'owner'`, `planLabel`.
`displayName(name, email) = name.trim() || localPart(email)` used for me, account and members.
Mutations that change name/org name update the `['me']` cache in place (patch) so the app menu reflects them.
After org delete or account delete: clear the cache (`signedOut`).

### 10.2 Routes

| route | screen | access |
| --- | --- | --- |
| `/join/$invitationId` | Join page | public (session optional) |
| `/app/settings` | Settings, section Account | signed in with org |
| `/app/members` | Settings, section Members | admins; a member sees Account instead |
| `/app/billing` | Settings, section Billing | admins; a member sees Account instead |
| `/profile` | Profile (onboarding spec) — calls `organizations.create` / `organizations.skip` | signed in without org |

Page titles: `<APP_NAME> · <t('app.titles.settings')>`, join: `app.titles.joinYourOrganization`.

### 10.3 Settings page shell

Layout: left nav (Back link to `/app` with arrow icon; visually hidden h1 `settings.title`; nav with `aria-label=settings.title`)
and the selected section on the right. Sections switch **in page** (state, not route change). Optional: sync to URL search
param; not required.

Nav groups (`SETTINGS_NAV`):
- `settings.mySettings`: `account` (`settings.account`)
- `settings.organizationSettings`: `general` (`settings.general`), `usage` (`settings.usage`),
  `members` (`settings.members`, **adminOnly**), `billing` (`settings.billing`, **adminOnly**),
  `security` (`settings.security`).
Each group is `role="group"` with `aria-label` = group label; the current item has `aria-current="true"`.
Initial section = route's section if the person may see it, else `account`. Selecting a hidden section is ignored.
Cross-section links: Account's owner text opens `security`; Members' "more seats" link opens `billing`.

Settings section component: title (h2) + optional aside on the same row + content. Setting row: muted label, value,
optional action at end. Use shadcn `Card`, `Separator`, `Button`, `Input`, `Select`, `Switch`, `AlertDialog`, `Sonner` toasts.

### 10.4 Confirm delete dialog (shared)

shadcn `AlertDialog`. Props: `title`, `confirmLabel`, `pending`, `open`, `onConfirm`. Body `confirmDelete.cannotBeUndone`;
buttons: confirm (disabled while pending) and `confirmDelete.keepIt` (closes).

### 10.5 Account section (`settings.accountSettings.*`) — everyone

Loads `me.account.get`. If `timeZone === null`, the client immediately PATCHes the browser's
`Intl.DateTimeFormat().resolvedOptions().timeZone` (errors reported, account shown as is).
Load failure toast: `notLoaded`.

Content:
1. Card: avatar initial of name; Input `yourName` (autocomplete name). Saves **on blur** if changed; blank/whitespace ->
   inline error `enterName`, no save.
2. Heading `signIn`; card rows: `email` (value only, no Change), `signInWith` (`signInGoogle` / `signInMicrosoft` /
   `signInEmail`, no Change), `devices` with value `devicesLine(devices)` and action button `signOutEverywhere`.
   `devicesLine`: none -> `noDevice`; first -> `thisDevice` ("This Mac"); others -> `anDevice` if starts with a vowel
   ("an iPhone") else `aDevice`, joined as a natural list ("This Mac and an iPhone"; use `Intl.ListFormat` with the
   active language).
3. Heading `preferences`; rows: `language` Select (English / Español, labels not translated), `timeZone` Select with
   options Europe/Madrid `zoneMadrid`, Europe/London `zoneLondon`, America/New_York `zoneNewYork`,
   America/Chicago `zoneChicago`, America/Los_Angeles `zoneLosAngeles`, America/Santiago `zoneSantiago`; if the saved
   zone is not in the list, append it with its raw name as label; none selected while null.
   Each saves on change.
4. Heading `emails`; Switch `productNews` with hint `productNewsHint`; saves on change.
5. Danger card: `deleteAccount` title. Owner: text `ownerDeleteFirst` + link-button `securityAndData` (opens security
   section) + `ownerDeleteFirstEnd`, and **no Delete button**. Others: `cannotBeUndone` + Delete button (`delete`) that
   opens confirm dialog (`confirmTitle`, confirm label `deleteAccount`).

Behaviour:
- Any successful save: replace account state, switch UI language to `account.language` without reload, patch me.name.
- Save failure: toast `notSaved` and reload from API to put the setting back.
- Sign out everywhere: single-flight (button disabled while working; multiple presses -> one call). Success: toast
  `signedOut` and reload account (devices: this one alone). Failure: toast `notSignedOut`, devices list kept.
- Delete account: single-flight; call `me.delete`, then `authClient.signOut()` ignoring its failure; success: close dialog,
  toast `deleted`, clear me, navigate `/signin`. 409 -> toast the API message; other failure -> `notDeleted`; stays signed in.

### 10.6 General section (`settings.generalSettings.*`) — everyone reads, admins edit

Data from `me.get` (`organization.name`, `organization.slug`). Card: square logo with initial of org name,
Input `organizationName` (autocomplete organization), caption `slug` (`Slug: {{slug}}`).
Member: input disabled. Admin: saves **on blur** via `organizations.update`; blank -> invalid, not sent. Success: update
state and patch me.organization.name. Failure: toast `notSaved` and reload (saved name back). Load failure: `notLoaded`.

### 10.7 Members section (`settings.membersSettings.*`) — admins only

Loads `members.list` and `invitations.list` in parallel; failure toast `notLoaded`.

Header aside (`data-seats`): `memberCountOne`/`memberCountMany` with member count; when admin and plan has a bigger plan:
` · ` + link-button (`moreSeatsFree` "Pro has up to 3" on free, `moreSeatsPro` "Team has up to 10" on pro; none on
team/internal) that opens the Billing section. Example: `3 members · Team has up to 10`.

Invite card (admins): Input type email label `inviteLabel`, placeholder `name@<my email domain>`, autocomplete off;
Select (aria-label `role`) options `roleMember` then `roleAdmin` (both for admins and owner — the API lets admins invite admins);
Button `invite`; hint `rolesHint`.
Client validation on submit (email trimmed): required + work email regex (same as API, refuses `lucia@cierzo`) ->
error `enterWorkEmail` with `example` = placeholder; already a member (case-insensitive) -> `alreadyInOrganization`;
already in pending invites -> `alreadyInvited`. Error clears when the email changes. Invalid -> no API call, no toast.

List (one card, members then invites):
- Member row: avatar initial (highlighted for me), name (`displayName`), email, role. Role cell: Select (aria-label
  `roleOf` {name}) only when `manages(member) && isOwner`; else role label text (`roleOwner`/`roleAdmin`/`roleMember`).
  `Remove` button when `manages(member)`.
  `manages(m) = isAdmin && m.email !== me.email && m.role !== 'owner' && (m.role !== 'admin' || isOwner)`.
  So: admin manages members only (remove; no role select); owner manages admins and members (select + remove);
  nobody manages self or the owner.
- Invite row: dashed avatar with initial of email, email; subline `invitedToday` / `invitedYesterday` /
  `invitedDaysAgo` ({days}) computed from `invitedOn` vs today (calendar days), OR, when `emailSent === false`, red
  `emailNotSent` instead. Buttons `resend` and `cancel` (admins).

Actions (all except role change are single-flight via a shared `busy` flag disabling buttons; double click sends once):
- Invite: success -> upsert invite by id into list (no list refetch), reset form; if `emailSent` toast `inviteSent`
  {email}; else error toast titled `emailNotSent` with body `inviteSavedNotSent` {email}. Failure: 4xx with API message ->
  toast that message (e.g. "ana.lopez@acme.com is already in the organization."); other (503, 500) -> toast `notInvited`
  {email}; form keeps the typed email.
- Role change (owner): success -> replace member, toast `nowAdmin`/`nowMember` {name}; failure -> toast `roleNotChanged`
  {name} (or API 4xx message) and reset the select to the previous role.
- Remove: success -> drop from list, toast `removed` {name, organization}; failure `notRemoved` {name}.
- Resend: success -> replace invite (emailSent true clears the red mark), toast `inviteResent` {email}; failure `notResent`.
- Cancel: success -> drop, toast `inviteCancelled` {email}; failure `notCancelled`.
General API-call rule (port of `injectApiCall`): on error, show the API `message` for 4xx when present, else the given
fallback copy; report unexpected errors.

A member opening `/app/members`: nav has no Members, section shows Account, no invite form rendered.

### 10.8 Security and data section (`settings.securitySettings.*`) — everyone sees, owner acts

Owner: danger card `deleteOrganization` + hint `deleteOrganizationHint` + Delete button (`delete`) -> confirm dialog
(`confirmTitle`, confirm label `deleteOrganization`). Confirm (single-flight): `organizations.delete`; success -> close,
toast `deleted`, clear me cache, navigate `/profile`. Failure -> toast API message for 4xx/5xx with message (e.g. the
Stripe 502 message) else `notDeleted`.
Non-owner: paragraph `ownerOnly`, no delete control, no dialog.

### 10.9 Join page `/join/$invitationId`

On mount: `invitations.accept(id)`.
States:
- `joining` (initial): `join.joining` with `role="status"`.
- success -> navigate `/app` (replace).
- 401 -> `signed-out`: heading `expiredStart` + muted `expiredEnd`, body `expiredBody`, form with email Input
  (label `yourWorkEmail`, type email, autocomplete email, placeholder `name@organization.com`) and submit `sendNewLink`.
  Submit: trim; invalid/blank -> error `join.workEmail`; single-flight; call
  `authClient.signIn.magicLink({ email, callbackURL: '/join/' + encodeURIComponent(id) })` (web origin path).
  Success -> state `sent`. Failure: Better Auth refused the address -> `join.workEmail`; 429 -> `join.tooManyLinks`;
  other 4xx with message -> that message; else report + `join.linkNotSent`.
- `sent`: heading `checkStart` + `checkEnd`, body `sentBody`.
- 409 -> `taken`: `takenTitle`, `takenBody`, button link `signIn` -> `/signin`.
- 404 -> `closed`: `closedTitle`, `closedBody`, button link `signIn`.
- other -> `failed` (report error): `failedTitle`, `failedBody`, ghost link `signIn`.
Note: in saas-base 403 (seat limit) falls into `failed`. Keep that, or (improvement, optional) show the API message.

### 10.10 i18n keys (copy verbatim from saas-base `apps/web/public/i18n/{en,es}.json`)

Namespaces: `join.*`, `confirmDelete.*`, `settings.{back,title,mySettings,account,organizationSettings,general,usage,members,billing,security}`,
`settings.accountSettings.*`, `settings.generalSettings.*`, `settings.membersSettings.*`, `settings.securitySettings.*`,
`app.titles.settings`, `app.titles.joinYourOrganization`. Interpolation `{{x}}` is i18next-compatible as is.
Full en list (es exists for every key):

- join: joining, expiredStart, expiredEnd, expiredBody, yourWorkEmail, sendNewLink, checkStart, checkEnd, sentBody,
  takenTitle, takenBody, signIn, closedTitle, closedBody, failedTitle, failedBody, workEmail, tooManyLinks, linkNotSent.
- confirmDelete: cannotBeUndone ("This can't be undone."), keepIt ("Keep it").
- settings.accountSettings: title, yourName, signIn, email, signInWith, signInGoogle, signInMicrosoft, signInEmail
  ("A link by email"), devices, noDevice, thisDevice, anDevice, aDevice, signOutEverywhere, preferences, language,
  timeZone, zoneMadrid, zoneLondon, zoneNewYork, zoneChicago, zoneLosAngeles, zoneSantiago, productNews,
  productNewsHint, deleteAccount, ownerDeleteFirst, securityAndData, ownerDeleteFirstEnd, cannotBeUndone, delete,
  confirmTitle, notSaved, notDeleted, notSignedOut, notLoaded, devicesNotLoaded, enterName, signedOut, deleted, emails.
- settings.generalSettings: title, organizationName, notSaved, notLoaded, slug.
- settings.membersSettings: title, memberCountOne, memberCountMany, moreSeatsFree, moreSeatsPro, inviteLabel, role,
  roleOf, roleOwner, roleAdmin, roleMember, invite, rolesHint, remove, invitedToday, invitedYesterday, invitedDaysAgo,
  emailNotSent, resend, cancel, notLoaded, notInvited, inviteSent, inviteSavedNotSent, roleNotChanged, nowAdmin,
  nowMember, notRemoved, removed, notResent, inviteResent, notCancelled, inviteCancelled, enterWorkEmail,
  alreadyInOrganization, alreadyInvited.
- settings.securitySettings: title, deleteOrganization, deleteOrganizationHint, delete, confirmTitle, notDeleted,
  deleted, ownerOnly.

Known es typo to fix while porting: `ownerDeleteFirst` es "Eres el propietario de **este** organización" -> "esta".

---

## 11. Permission matrix

| action | owner | admin | member | no org | no session |
| --- | --- | --- | --- | --- | --- |
| me.get / account get/update | yes | yes | yes | yes | 401 |
| me.delete | 409 (owns) | yes | yes | yes | 401 |
| organizations.create / skip | 409 | 409 | 409 | yes | 401 |
| organizations.update (rename) | yes | yes | 403 | 404 | 401 |
| organizations.delete | yes | 403 | 403 | 404 | 401 |
| members.list, invitations.list | yes | yes | 403 | 404 | 401 |
| invite member | yes | yes | 403 | 404 | 401 |
| invite admin | yes | yes | 403 | 404 | 401 |
| resend / cancel invite | yes | yes | 403 | 404 | 401 |
| promote member -> admin | yes | 403 | 403 | 404 | 401 |
| demote/remove another admin | yes | 403 | 403 | 404 | 401 |
| remove member | yes | yes | 403 | 404 | 401 |
| admin steps down / leaves self | – | yes if an owner or other admin remains | – | | |
| change/remove the owner | only self and only if >1 owner (never in practice) | 403 | 403 | | |
| accept invitation | 409 | 409 | 409 | yes | 401 |
| Settings nav: Members, Billing | shown | shown | hidden | | |

---

## 12. Edge cases and business rules (from tests)

1. Org always the session's; body ids/slugs ignored in rename/delete.
2. Membership read from DB every request; removed member loses access immediately with same cookie (org routes 404,
   me shows no org).
3. One org per person: create/skip/accept refuse with 409 when the person has any membership.
4. Concurrent create by the same person -> one org; concurrent orgs with the same name -> distinct numbered slugs.
5. Terms: only literal `true` accepted on create; timestamp from DB `now()`, never from client. Skip stores null.
6. Rename keeps slug; allows non-sluggable names; refuses blank.
7. Free plan: owner only; invite -> 403 seat message, nothing stored or emailed.
8. Pending invitations hold seats; re-inviting the same address takes no extra seat (and updates role, resets expiry and
   `emailSent=false`, same id); cancel frees the seat; expired invites release seats; resend of an expired one needs a free seat.
9. Accept counts only members against seats (downgrade: first come first served).
10. Internal plan allows > 10 members (100 seats).
11. Invite email address normalized; invitee match on accept is exact normalized equality.
12. Invite from missing/foreign Origin -> 403, nothing stored or sent.
13. Email send failure on invite -> 201 `emailSent:false`, row kept, ids logged; resend failure -> 503, `emailSent`
    unchanged (stays true if it had been sent before); later successful resend -> `emailSent:true`.
14. Invite canceled while its email was going out -> answer 201 `emailSent:true`; list is empty.
15. Another org's invitation/member ids -> 404 (resend, cancel, remove).
16. Org delete ends Stripe subscription first; Stripe failure -> 502 nothing deleted; no Stripe configured with a
    subscription -> 503; purge queued with `{organizationId, folder:''}`; queue failure still 204.
17. Org delete keeps users; their sessions survive with no org; former owner can create a new org.
18. Org delete and member removal revoke OAuth grants (org-wide / that member only); other orgs' grants and the OAuth
    client remain.
19. Account delete: refused to an owner of ANY org (409, still signed in); otherwise ends all sessions on all devices,
    removes memberships, invitations sent by them and invitations addressed to them (any org, any status).
20. Account update: partial; empty update returns current; never affects other users; language only changeable via our
    endpoint, not Better Auth `update-user`.
21. Devices: only unexpired sessions; current first then newest.
22. Better Auth organization plugin endpoints closed (404).
23. Two last admins of an ownerless org stepping down concurrently: exactly one succeeds (row locks).
24. Invalid invitation ids (`''`, SQL-ish strings, random UUID, non-string) -> not found, never an error 500.

---

## 13. saas-base tests worth porting

API integration (Vitest + Hono `app.request` + PGlite + Better Auth test utils for users/sessions + recording mailer + fake
Stripe gateway + fake jobs):

- `apps/api/src/app/organizations/organizations.controller.spec.ts` — ALL (create, skip naming tables, delete with
  Stripe/purge, rename, closed Better Auth org routes).
- `apps/api/src/app/organizations/me.controller.spec.ts` — ALL (me, delete account, account get/patch, devices with Mac/iPhone UAs).
- `apps/api/src/app/members/members.controller.spec.ts` — ALL (list, invite normalization, Free seat 403, admin/owner rules,
  member 403 on every call, owner self-demote refusal, 400 cases, Origin 403, resend/cancel, cross-org 404, 401/404,
  email failure handling, cancel-during-send, resend failure keeps emailSent).
- `apps/api/src/app/members/invite-flow.spec.ts` — ALL (end-to-end: invite -> email -> open magic link -> 302 to
  `/join/<id>` -> accept -> me -> removed -> 404; 409 on accept with existing org; 404 for other email; 401).
- `apps/api/src/app/auth/organization-role.guard.spec.ts` — as middleware tests (owner/admin pass, member 403, no org 404,
  401, membership re-read each request, owner-only override).
- `apps/api/src/app/auth/sessions.spec.ts` — revoke-other-sessions.
- `apps/api/src/app/mail/mail-member.spec.ts`, `organizations/time-zone.spec.ts`, `organizations/device-name.spec.ts` — unit.

Data layer (Vitest + PGlite in-memory):

- `members/member-policy.spec.ts` (pure, verbatim).
- `members/members.int.spec.ts` (invite/list/accept, removal + grants, isolation, emailSent lifecycle, re-invite update,
  seat limits incl. downgrade and internal, accept refusals table, concurrent step-down).
- `members/account.int.spec.ts`, `members/delete-account.int.spec.ts`.
- `organizations/create-organization.int.spec.ts` (slug numbering + concurrency, owner + terms, personName, bare root,
  bySlug, memberOf), `rename-organization.int.spec.ts`, `delete-organization.int.spec.ts` (cascade walk, grants),
  `organization-settings.int.spec.ts` (setPlan, setStripeCustomer — billing spec overlaps).
- `tenancy/tenant-db.int.spec.ts`, `tenancy/organization-id.spec.ts`.
- `libs/shared/address` naming/slug/email specs.

Web (Vitest + React Testing Library, mocking the oRPC client):

- `join/join.page.spec.ts` (9 cases: join -> /app; 409 taken; 404 closed; 401 -> send link -> sent; failure reported;
  429; API message; Better Auth refusal -> workEmail; unexpected send failure).
- `settings/settings.page.spec.ts` (nav sections, switching, member hides Members/Billing and gets Account at their URLs,
  owner sees Members, Back goes /app).
- `settings/members-settings/members-settings.spec.ts` (seat line, rows, unsent mark, admin vs owner capabilities, member
  excluded, invite flows incl. double click, 503, unsent toast, validation, API reason, role change, remove, resend, cancel,
  go to Billing).
- `settings/account-settings/account-settings.spec.ts` (22 cases).
- `settings/general-settings/general-settings.spec.ts`, `settings/security-settings/security-settings.spec.ts`.

E2E (Playwright): owner invites a colleague (link read from Mailpit), colleague opens link and lands in the app as member; owner
changes role and removes; owner deletes the org and lands on /profile; member deletes their account and lands on /signin.
