# Spec: Organizations, members, invitations, account and security settings

Source of truth: saas-base (NestJS + Angular). This file is implementation-ready for arrakit
(Hono + oRPC + Zod, Drizzle, Better Auth, TanStack Start + shadcn/ui). Port **behaviour, copy and
rules**, not styles. Where saas-base paths are cited, they are for traceability only.

Scope:

- Organization create (Profile "Next" / "Skip"), rename, delete.
- Roles `owner` / `admin` / `member`, custom roles, teams, the role policy, several organizations per person.
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

### 1.1 Roles and permissions (`@arrakit/auth/permissions`)

Organizations, members, invitations, teams and roles belong to the Better Auth `organization` plugin. Access
control is shared by API and web from `@arrakit/auth/permissions` (pure; imports only Better Auth's access helpers):

```ts
statements = { ...defaultStatements /* organization, member, invitation, team, ac */,
               billing: ['read', 'manage'], usage: ['read'] }
ac = createAccessControl(statements)
roles = { owner, admin, member }   // Better Auth roles
STATIC_ROLES = ['owner', 'admin', 'member']
permissionsOf(role, customRoles?) // union over a role string (`a,b`), static + custom; unknown roles grant nothing
allows(granted, wanted)           // every wanted action is granted
isOwnerRole(role)                 // the role string includes `owner`
```

| role | grants |
| --- | --- |
| `owner` | everything: `organization:update,delete`, `member:*`, `invitation:*`, `team:*`, `ac:*`, `billing:read,manage`, `usage:read` |
| `admin` | the owner's grants minus `organization:delete` |
| `member` | `ac:read`, `usage:read` |
| custom | what the owner gave it (Better Auth dynamic access control, at most 20 per organization) |

- `owner` is the creator (`creatorRole: 'owner'`); no one else is ever made owner (no ownership transfer).
- Owner and admin manage custom roles (`ac:*`), but nobody grants permissions they don't have: a role's permissions must
  be within the actor's when it is created, updated, deleted or given to someone (4.2, 4.3).
- Role names are case-sensitive and Better Auth stores several as `a,b`.

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

All timestamps `timestamp with time zone`. Better Auth's Drizzle adapter (`usePlural`) maps its user, session,
account, verification, JWT, OAuth and organization plugin models (`organization`, `member`, `invitation`, `team`,
`teamMember`, `organizationRole`) onto these tables. Ids come from `generateId: randomUUID()`.

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
user_id -> users.id ON DELETE CASCADE (index),
`active_organization_id uuid null -> organizations.id ON DELETE SET NULL`,
`active_team_id text null -> teams.id ON DELETE SET NULL`. A new session starts in the person's earliest
organization (`databaseHooks.session.create.before`). The API never trusts it blindly: see 5 (org-scoped middleware).

### 2.3 `accounts` (Better Auth `account`)

Standard Better Auth columns; `provider_id` values used here: `google`, `microsoft`, `credential`/magic link.
user_id -> users.id ON DELETE CASCADE.

### 2.4 `organizations` (tenant root; Better Auth `organization`)

| column | type | notes |
| --- | --- | --- |
| id | uuid PK default random | Must stay a UUID (tenancy checks UUID shape) |
| name | text not null | trimmed |
| slug | text not null **unique** | lowercase, never changes after creation |
| logo | text null | plugin field, refused on update |
| metadata | text null | plugin field, refused on update |
| plan | text not null default `'free'` | CHECK `plan in ('free','pro','team','internal')`; declared to Better Auth with `input: false` |
| stripe_customer_id | text unique null | billing spec; not declared to Better Auth (never returned by it) |
| stripe_subscription_id | text null | billing spec; used by org delete |
| usage_anchor | timestamptz null | billing/usage spec |
| created_at | timestamptz not null default now() | |

### 2.5 `members` (Better Auth `member`)

| column | type | notes |
| --- | --- | --- |
| id | text PK | |
| organization_id | uuid not null -> organizations.id ON DELETE CASCADE | |
| user_id | text not null -> users.id ON DELETE CASCADE | index `members_user_id_idx` |
| role | text not null default `'member'` | Better Auth role string |
| terms_accepted_at | timestamptz null | declared `input: false`; stamped by `onboarding.create` (Postgres `now()`); null on Skip |
| created_at | timestamptz not null default now() | |

Unique `(organization_id, user_id)`. A person may be in several organizations; the session says which one is active.

### 2.6 `invitations` (Better Auth `invitation` + our `email_sent`)

| column | type | notes |
| --- | --- | --- |
| id | text PK | |
| organization_id | uuid not null -> organizations.id ON DELETE CASCADE | index |
| email | text not null | normalized (trim + lowercase); index |
| role | text null | role string the invitee gets |
| team_id | text null | plugin field (comma-separated team ids, no FK) |
| status | text not null default `'pending'` | `pending` -> `accepted` / `canceled` / `rejected` |
| email_sent | boolean not null default false | declared `input: false`; true once the invite email went out |
| expires_at | timestamptz not null | `now() + 7 days` (`invitationExpiresIn`) |
| created_at | timestamptz not null default now() | |
| inviter_id | text not null -> users.id ON DELETE CASCADE | |

"Live" = `status = 'pending' AND expires_at > now()`. Re-inviting a pending address cancels the old row
(`cancelPendingInvitationsOnReInvite`) and stores a new one (new id).

### 2.7 `teams`, `team_members`, `organization_roles` (Better Auth plugin)

- `teams`: id text PK, name, organization_id -> organizations ON DELETE CASCADE (index), member_count int default 0,
  created_at, updated_at null. No default team is made (`defaultTeam.enabled: false`); every team may be removed.
- `team_members`: id text PK, team_id -> teams ON DELETE CASCADE (index), user_id -> users ON DELETE CASCADE (index),
  membership_key text unique null, created_at null. A tenancy exception: reached through `teams.organization_id`.
- `organization_roles`: id text PK, organization_id -> organizations ON DELETE CASCADE, role, permission (JSON of the
  role's statements), created_at, updated_at null; unique `(organization_id, role)`.

### 2.8 OAuth grant tables (from the MCP/OAuth provider spec)

`oauth_access_tokens`, `oauth_refresh_tokens`, `oauth_consents` carry `reference_id` (= organization id, **no FK**)
and `user_id`. They are deleted explicitly (org delete, member removal, leaving).

### 2.9 Cascades summary (delete organization)

Every table with `organization_id` references `organizations.id ON DELETE CASCADE`: members, invitations, teams (and so
their team members), custom roles, and every product table (usage ledger and levels, …). Sessions pointing at it get
`active_organization_id = null`. OAuth grants are deleted by the after-delete hook. Users/accounts/sessions survive.
Schema test: "every table with `organization_id` has an FK to organizations with ON DELETE CASCADE" (sessions'
`active_organization_id` is the only SET NULL reference).

---

## 3. Tenancy layer (`forOrganization`)

- `toOrganizationId(value)`: must match UUID regex `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`;
  returns lowercased branded `OrganizationId`. Throws (before any query) on `''`, `not-a-uuid`, wildcards, slashes,
  padding, braces. Accepts v4 and v7. Uppercase input -> lowercase (one storage prefix per org).
- `forOrganization(id)` validates the id synchronously and returns the organization's scope, composed from one file per
  domain in `packages/db/src/organization/`: `organization()` (own row), `setPlan(...)`, `setStripeCustomer(...)`,
  `files`, `members` (section 4), `customRoles()`, `teamMembers(teamId)`, `usage`. Callers never get raw SQL or a
  database handle (app code is typed against `ScopedData`).
- Better Auth writes the organization tables through its adapter; the app reads them through `forOrganization`.

---

## 4. Data operations and rules

Organization, member, invitation, team and role changes are Better Auth endpoints (`/api/auth/organization/*`). Our
rules live in its options and hooks (`packages/auth/src/organization.ts`, `hooks.ts`, `organization-policy.ts`); the
data they need comes through `OrganizationDeps` (`apps/api/src/organizations/organization-deps.ts`).

### 4.1 Data functions (`packages/db`)

- `memberOf(userId)`: earliest membership `{ organization, role }`, or null.
- `membershipIn(userId, organizationId)`: that membership, or null (also for a non-UUID id).
- `activeMembership(userId, sessionId)`: the membership in the session's `active_organization_id` read from the
  database (the session cookie cache may be stale), else `memberOf`.
- `revokeGrants(organizationId, userId?)`: deletes from `oauth_access_tokens`, `oauth_refresh_tokens`,
  `oauth_consents` where `reference_id = orgId` (and `user_id` when given). OAuth clients stay registered.
- `forOrganization(id).members`: `list()` (members joined to users, oldest first, `role` string),
  `seatsTaken(exceptEmail)` (members + live invitations to other addresses), `markInvitationEmailSent(id, sent)`,
  `acceptTerms(userId)`.
- `forOrganization(id).customRoles()`, `forOrganization(id).teamMembers(teamId)` (empty for another org's team).
- `invitationFor(invitationId, email)`: the live invitation addressed exactly to that normalized email, with
  organization and inviter (the invite email reads it).

### 4.2 Rules by endpoint

| rule | where |
| --- | --- |
| Create: name falls back like Profile (`organizationNameOr(name, email, user.name)`); the client's slug is ignored and the first free `slugCandidates(name)` is used (`x`, `x-2`, …) | `hooks.before /organization/create` |
| Create makes the creator `owner` and the new organization active; no organization limit | plugin |
| Rename: only `name` changes (`slug`, `logo`, `metadata` -> 400 "Only the name changes."); trimmed; blank -> 400 "Give the organization a name." | `beforeUpdateOrganization` |
| Delete: owner only (`organization:delete`) | static roles |
| Delete: end the Stripe subscription first; Stripe failure -> 502 "Couldn't reach Stripe. Try again in a minute.", not set up -> 503 "Payments are not set up yet."; nothing deleted | `beforeDeleteOrganization` -> `beforeDelete(orgId)` |
| Delete: revoke all its OAuth grants, queue `storage-purge {organizationId, folder: ''}` (queue failure only logged) | `afterDeleteOrganization` -> `afterDelete(orgId)` |
| Member changes (invite, role change, removal), see 4.3 | `hooks.before` on `/organization/invite-member`, `/organization/update-member-role`, `/organization/remove-member` |
| Invite: address normalized; not a work email -> 400 `Enter a work email, like name@organization.com: "<raw>" is not one.`; already a member -> 400 | `hooks.before` + plugin |
| Invite seats: members + live invitations to other addresses >= plan seats -> 403 `Your organization's <Plan> plan includes <n> seat(s), all taken. Upgrade to invite more people.` | `beforeCreateInvitation` |
| Re-invite of a pending address: old invitation canceled, new id, no extra seat | `cancelPendingInvitationsOnReInvite` + seat rule |
| Resend (`resend: true`, live invite): new expiry and email, no seat check. An expired invite is a new invite (seat check) | plugin |
| Invite email: a magic link to `${WEB_ORIGIN}/join/<id>` (4.4); success -> `email_sent = true`; failure -> logged (`invite email not sent`, `organizationId`, `invitationId`), `email_sent = false`, the invitation is kept and the call answers 503 `The invite to <email> is saved, but its email did not go out. Press Resend to send it again.` | `sendInvitationEmail` + `hooks.after /organization/invite-member` |
| Cancel: pending invitation of this org only (`invitation:cancel`) | plugin |
| Accept: invitee email must match, email verified, invitation pending and unexpired (else 400/403); only members count against seats (`membershipLimit` = plan seats); already in that org -> 409 "You're already in <org>."; makes the org active | plugin + `beforeAcceptInvitation` |
| Removal revokes the removed member's grants in that org | `afterRemoveMember` |
| Leaving revokes the leaver's grants in that org; the only owner cannot leave | `hooks.after /organization/leave` + plugin |
| Teams: `team:create/update/delete`, team members need `member:update` (add) / `member:delete` (remove) | plugin |
| Custom roles: `ac:*` (owner, admin); the new permissions must be within the actor's (plugin, create/update), no static names, no unknown resources, a role still given cannot be deleted | plugin |
| Changing or deleting a custom role that holds permissions the actor lacks -> 403 "You can't change a role with permissions you don't have." | `hooks.before /organization/update-role`, `/organization/delete-role` |
| CSRF: every `/api/auth/*` POST from a foreign Origin -> 403 | Better Auth origin check |

### 4.3 Member change policy (`memberChangeRefusal`, pure)

Input `{ actorRole, targetRole?, newRole?, self, custom }` (`targetRole` absent for an invite, `newRole` absent for a
removal). Better Auth already checks `member:*` / `invitation:create`, unknown roles, and keeps the sole owner.
Refusals (403, in order):

1. `newRole` includes `owner` -> `No one is made owner: the organization has its creator.`
2. Target is the owner: self -> `You are the organization's only owner.`, else `Only the owner changes the owner's role or seat.`
3. Actor is the owner -> allowed.
4. `newRole` includes `admin` -> `Only the owner names admins.`
5. Target is another admin -> `Only the owner demotes or removes an admin.`
6. `newRole` grants more than the actor's role (static or custom) -> `You can't give permissions you don't have.`
7. Target (not self) holds more than the actor's role -> `Only the owner changes someone with more rights than yours.`

### 4.4 Sending the invite email (Better Auth magic link)

`sendInvitationEmail` calls `auth.api.signInMagicLink({ body: { email, callbackURL: join, errorCallbackURL: join },
headers: { origin: WEB_ORIGIN } })` with `join = ${WEB_ORIGIN}/join/${encodeURIComponent(invitationId)}`.

In the magic link plugin's `sendMagicLink({ email, url })`:
- Parse the callback from `url`; if it is a trusted origin's `/join/<id>` (regex `^/join/([^/]+)$`) and
  `invitationFor(id, email)` returns a live invitation addressed to that email -> send **MailMember**;
  otherwise send the normal **MailSignin** (a stranger asking for a link with someone else's join callback gets a plain
  sign-in email).
- `expiresInDays = max(1, ceil((invitation.expiresAt - now) / 1 day))`.

Opening the link: Better Auth verifies, creates the session (cookie) and 302-redirects to `${WEB_ORIGIN}/join/<id>`.

### 4.5 Account (`account`, `updateAccount`, `wantsEmail`, `languageOf`)

- `SIGN_IN_METHODS = ['email','google','microsoft']`.
- `account(userId, currentSessionId)`: user `{name,email,language,timeZone,emails:{productNews}}`;
  `signInWith` = provider of the most recently created `accounts` row whose provider is google/microsoft, else `email`;
  `sessions` = unexpired sessions of the user ordered `created_at DESC`, with the current one moved first
  (`{id,userAgent,current}`). Null if user missing.
- `updateAccount(userId, sessionId, { name?, language?, timeZone?, emails?: { productNews? } })`: writes only provided
  keys (no write when all undefined), then re-reads in the same transaction.
- `wantsEmail(email, 'productNews')`: compares `lower(users.email)` to normalized; unknown person -> true.
- `languageOf(userId)`: unknown -> `'en'`.

### 4.6 `deleteAccount(userId)`

Transaction: lock user `FOR UPDATE` (missing -> false). If the user has ANY `members` row with role `owner` (in any org)
-> `PersonOwnsOrganizationError`, nothing deleted. Else delete all invitations addressed to their normalized email (any
status, any org), then delete the user row (cascades sessions on every device, accounts, memberships, team memberships,
invitations they sent). Returns true.

---

## 5. API (oRPC at `/api/rpc`, Better Auth at `/api/auth/*`)

General rules:

- Every oRPC procedure below requires a live Better Auth session -> else `UNAUTHORIZED` (401).
- **Org-scoped middleware** `member(wanted?: Permissions)` (`apps/api/src/orpc/context.ts`): reads
  `activeMembership(user.id, session.id)` from the database on every request (the session's active organization while
  the person is still in it, else their earliest one). No membership -> `NOT_FOUND` "Not found in your organization."
  (404). The role's permissions (custom roles read from `organization_roles` only when the role is not static) lacking
  `wanted` -> `FORBIDDEN` "You don't have permission to do this." (403). Puts `{ activeOrganization, role, permissions,
  scope }` in context. Organization ids in the input are ignored.
- Billing: `billing.get` needs `{ billing: ['read'] }`, every other billing procedure `{ billing: ['manage'] }`; usage
  needs `{ usage: ['read'] }`.
- Error mapping: `DomainError`s and Better Auth `APIError`s below 500 become `ORPCError`s with the same status and
  message (`reportErrors`).
- **CSRF**: `/api/rpc/*` writes from a missing, `null` or foreign `Origin` -> 403 "Use the app."; `/api/auth/*` POSTs
  go through Better Auth's origin check.

### 5.1 `me.get` — session only

Output:
```ts
{ email: string; name: string; language: 'en'|'es';
  organization: { id: uuid; name; slug; plan } | null;  // the active organization
  role: string | null;                                   // Better Auth role string
  permissions: Record<string, readonly string[]>;        // what the role grants there ({} without one)
  plan: Plan | null;
  seats: number | null /* PLAN_OFFERS[plan].seats */ }
```
Before Profile: `{ email, name:'', language:'en', organization:null, role:null, permissions:{}, plan:null, seats:null }`.
After create: role `owner`, plan `free`, seats `1`.

### 5.2 `me.account.get`

Output `AccountView`:
```ts
{ name: string; email: string; signInWith: 'email'|'google'|'microsoft';
  devices: string[]  /* deviceName(userAgent) per live session, current first */;
  language: 'en'|'es'; timeZone: string|null; emails: { productNews: boolean } }
```
Fresh magic-link user: `{ name:'', email, signInWith:'email', devices:['browser'], language:'en', timeZone:null, emails:{productNews:false} }`.
Two devices: laptop sees `['Mac','iPhone']`, phone sees `['iPhone','Mac']`. User vanished between auth and read -> 401.

### 5.3 `me.account.update`

Input (all optional; empty object returns account unchanged):
```ts
z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(100, 'Keep your name to 100 characters.')
        .regex(/^[^\p{Cc}\u2028\u2029]*$/u, 'Keep your name on one line.').optional(),
  language: z.enum(['en','es']).optional(),
  timeZone: z.string().refine(isTimeZone, 'Pick a time zone from the list.').optional(),
  emails: z.object({ productNews: z.boolean() }).partial().optional(),
})
```
Output: AccountView. 400 for: blank name, name with line break, >100 chars, language `fr`, `europe/madrid`, `+02:00`,
`productNews: 'no'` — saving nothing. Name saved trimmed. Never touches another user. `me.get` reflects the new name.

### 5.4 `me.delete` — session only

Deletes the account (4.6). Success: void; every session is invalid from the next request. Owner -> 409 "You own an
organization. Delete the organization first, in Settings → Security and data."; owner stays signed in.

### 5.5 `onboarding.create` — session only

Input:
```ts
z.object({
  name: z.string().trim().max(200),                  // blank allowed -> naming fallback
  personName: z.string().trim().max(200).optional(), // blank keeps current name
  termsAccepted: z.literal(true, { error: 'Accept the Terms and the Privacy Policy.' }),
})
```
Logic: a non-blank `personName` updates `users.name`; name = `organizationNameOr(body.name, email, personName ||
user.name)`; `auth.api.createOrganization({ headers, body: { name, slug } })` (the hook fixes the slug); stamp
`terms_accepted_at`. Output `{ id, name, slug, plan }`. Works for someone already in organizations: the new one becomes
active. termsAccepted false/missing/`'true'` -> 400, nothing created.

### 5.6 `onboarding.skip` — session only

No input. Name = `organizationNameOnSkip(email, user.name)`; terms not stamped. Output `{ id, name, slug, plan }`.

### 5.7 `teams.members({ teamId })` — member of the active organization

The people on one of the active organization's teams (`{ userId, name, email, image }`, oldest first; empty for another
organization's team). Better Auth's `list-team-members` only answers members of that team.

### 5.8 Better Auth organization endpoints (`/api/auth/organization/*`, client `authClient.organization.*`)

`create`, `update`, `delete`, `list`, `get-full-organization`, `set-active`, `leave`, `list-members`,
`update-member-role`, `remove-member`, `invite-member` (also `resend: true`), `cancel-invitation`,
`accept-invitation`, `reject-invitation`, `get-invitation`, `list-invitations`, `list-user-invitations`,
`create-team`, `update-team`, `remove-team`, `list-teams`, `add-team-member`, `remove-team-member`,
`create-role`, `update-role`, `delete-role`, `list-roles`, `get-role`, `has-permission`. Rules: section 4.2. The
plugin writes `active_organization_id` without refreshing the session cookie cache, so the web calls `set-active`
after create/accept/delete/leave.

### 5.9 Sign out everywhere

Better Auth built-in `POST /api/auth/revoke-other-sessions` (client: `authClient.revokeOtherSessions()`): ends all
other sessions of the person, keeps this one, other people unaffected; afterwards `me.account.get` devices length 1.
401 without session.

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
  org delete (`''` = every file under the org prefix), sent after the delete commits. Retry policy per platform spec;
  failures logged and rethrown. Queue-send failure in org delete is logged ("storage purge not queued; its files stay in
  the bucket") and does not fail the request.

---

## 8. External integrations

- **Better Auth**: magic link, Google, Microsoft, the organization plugin (teams, dynamic access control), user `additionalFields` (language, timeZone, emailProductNews as non-input fields), sessions with
  user agent, `revoke-other-sessions`.
- **Stripe**: `endNow` (`subscriptions.cancel`) on org delete when `stripe_subscription_id` set.
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

Load `me.get` (TanStack Query, `orpc.me.get.queryOptions()`) in the `/app` route `beforeLoad` (`requireUser` →
`guardedMe`):
- 401 -> redirect `/signin`.
- `organization === null` -> redirect `/profile` (Profile is where an org is made).
- any other failure -> `/unavailable?next=<url>`.
- If `me.language` differs from the active i18n language, switch language before rendering.
Derived: `role` (Better Auth's role string), `can(wanted)` = `allows(me.permissions, wanted)`,
`isOwner = isOwnerRole(role)`, `managesMembers = can(member:update) || can(invitation:create)`,
`managesBilling = can(billing:manage)`, `planLabel`. Every gated screen, link and button reads `can`.
`displayName(name, email) = name.trim() || localPart(email)` used for me, account and members.
Mutations that change name/org name update the `me.get` cache in place (`patch`) so the app menu reflects them.
After account delete or sign out: clear every query (`signedOut`). After creating, joining, deleting or leaving an
organization, or picking another: `switchOrganization(queryClient, id | null)` (`#/lib/organization-queries`) calls
`organization.setActive` (Better Auth changes the active organization in the database without refreshing its cookie
cache) and then `queryClient.resetQueries()`.

The organization plugin's endpoints are called with the Better Auth client (`authClient.organization.*`) through
`authCall()` (`#/lib/auth-call`): it unwraps `{ data, error }` and throws an error carrying `status`, `code` and a
message — our copy `orgErrors.<CODE>` for the plugin's codes we translate, else the API's own message — so the query
client's toasts work as for oRPC. Queries are keyed `['org', organizationId, 'members' | 'invitations' | 'roles' |
'teams']` and `['org', 'list']` (`organizationQueries`); invitations are filtered to pending and unexpired.

### 10.2 Routes

| route | screen | access |
| --- | --- | --- |
| `/join/$invitationId` | Join page | public (session optional) |
| `/app/settings?section=<id>` | Settings on that section (default `account`) | signed in with org; a hidden section shows Account |
| `/app/members` | redirect -> `/app/settings?section=members` | |
| `/app/billing` | redirect -> `/app/settings?section=billing`, keeping `top_up` | |
| `/profile` | Profile (onboarding spec) — calls `onboarding.create` / `onboarding.skip`, then `switchOrganization` | signed in without org |

Page titles: `<APP_NAME> · <t('app.titles.settings')>`, join: `app.titles.joinYourOrganization`.

### 10.3 Settings page shell

Layout: left nav (Back link to `/app` with arrow icon; visually hidden h1 `settings.title`; nav with `aria-label=settings.title`)
and the selected section on the right. The section lives in the URL search (`?section=account|general|usage|members|
teams|roles|billing|security`, validated by `settingsSearch`); nav items are links to `/app/settings?section=<id>`.

Nav groups (`SETTINGS_NAV`):
- `settings.mySettings`: `account` (`settings.account`)
- `settings.organizationSettings`: `general`, `usage` (when `can(usage:read)`), `members` (when `managesMembers`),
  `teams` (everyone; changes gated), `roles` (when `can(ac:create)`), `billing` (when `can(billing:read)`),
  `security`.
Each group is `role="group"` with `aria-label` = group label; the current item has `aria-current="page"`.
Shown section = the URL's section if the person may see it, else `account` (a member never sees Members, Roles or
Billing; a custom role with `billing:read` sees Billing).
Cross-section links: Account's owner text opens `security`; Members' "more seats" link opens `billing`.

Settings section component: title (h2) + optional aside on the same row + content. Setting row: muted label, value,
optional action at end. Use shadcn `Card`, `Separator`, `Button`, `Input`, `Select`, `Switch`, `AlertDialog`, `Sonner` toasts.

### 10.4 Confirm delete dialog (shared)

shadcn `AlertDialog`. Props: `title`, `confirmLabel`, `pending`, `open`, `onConfirm`. Body `confirmDelete.cannotBeUndone`;
buttons: confirm (disabled while pending) and `confirmDelete.keepIt` (closes).

### 10.5 Account section (`settings.accountSettings.*`) — everyone

Loads `me.account.get`. If `timeZone === null`, the client immediately PATCHes the browser's
`Intl.DateTimeFormat().resolvedOptions().timeZone` (errors reported, account shown as is).
Load failure toast: `notLoaded` (query `meta.failure`).

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
- Autosave is one mutation with `scope: { id: 'account' }`, so saves run one at a time in order (no hand-made queue).
  Each save updates the cached account optimistically; on success the server answer replaces it only when no other
  save is pending; me.name/language are patched and the UI language switches without reload.
- Save failure: toast `notSaved` (`meta.failure`) and invalidate the account query to put the setting back.
- Sign out everywhere: single-flight (button disabled while working; multiple presses -> one call). Success: toast
  `signedOut` and reload account (devices: this one alone). Failure: toast `notSignedOut`, devices list kept.
- Delete account: single-flight; call `me.delete`, then `authClient.signOut()` ignoring its failure; success: close dialog,
  toast `deleted`, clear me, navigate `/signin`. 409 -> toast the API message; other failure -> `notDeleted`; stays signed in.

### 10.6 General section (`settings.generalSettings.*`) — everyone reads, `organization:update` edits

Data from `me.get` (`organization.name`, `organization.slug`). Card: square logo with initial of org name,
Input `organizationName` (autocomplete organization), caption `slug` (`Slug: {{slug}}`).
Without `organization:update`: input disabled. With it: saves **on blur** via
`organization.update({ organizationId, data: { name } })`; blank -> invalid, not sent. Success: patch
me.organization.name and reload the organizations list. Failure: toast the API's message or `notSaved` and show the
saved name back.

### 10.7 Members section (`settings.membersSettings.*`) — when `managesMembers`

Loads `organization.listMembers`, `organization.listInvitations` (pending, unexpired) and, with `ac:read`,
`organization.listRoles`, for the active organization; failure toast `notLoaded`.

Header aside (`data-seats`): `memberCountOne`/`memberCountMany` with member count; when admin and plan has a bigger plan:
` · ` + link-button (`moreSeatsFree` "Pro has up to 3" on free, `moreSeatsPro` "Team has up to 10" on pro; none on
team/internal) that opens the Billing section. Example: `3 members · Team has up to 10`.

Invite card (`invitation:create`): Input type email label `inviteLabel`, placeholder `name@<my email domain>`,
autocomplete off; Select (aria-label `role`) with the **assignable roles** (`assignableRoles(role, permissions,
customRoles)`): `roleMember`, `roleAdmin` (owner only), then the custom roles by name — an admin only sees roles within
their own permissions; Button `invite`; hint `rolesHint`.
Client validation on submit (email trimmed): required + work email regex (same as API, refuses `lucia@cierzo`) ->
error `enterWorkEmail` with `example` = placeholder; already a member (case-insensitive) -> `alreadyInOrganization`;
already in pending invites -> `alreadyInvited`. Error clears when the email changes. Invalid -> no API call, no toast.

List (one card, members then invites):
- Member row: avatar initial (highlighted for me), name (`displayName`), email, role. Role cell: Select (aria-label
  `roleOf` {name}, assignable roles) when `can(member:update) && manages(member)`; else the role label (built-in roles
  translated, custom roles by name, several joined with `, `). `Remove` button when `can(member:delete) && manages(member)`.
  `manages(m)`: not me, not an owner, an admin only for the owner, and (unless I am the owner) `m`'s permissions
  within mine. So: an admin changes and removes members; the owner also admins; nobody manages self or the owner.
- Invite row: dashed avatar with initial of email, email; subline `invitedToday` / `invitedYesterday` /
  `invitedDaysAgo` ({days}) from `createdAt` vs today (local calendar days), OR, when `emailSent === false`, red
  `emailNotSent` instead; role label. Buttons `resend` (`invitation:create`) and `cancel` (`invitation:cancel`).

Actions (all except role change are single-flight via a shared `busy` flag disabling buttons; double click sends once):
- Invite (`organization.inviteMember({ email, role, organizationId })`): success -> reset form, toast `inviteSent`
  {email}. Failure: the API's message (work email, seats full, "can't give permissions you don't have", the 503 "saved,
  but its email did not go out") or our `orgErrors.*` copy, else `notInvited` {email}; the form keeps the email. The
  invitations list reloads either way (a 503 invite is saved with `emailSent` false and listed as `emailNotSent`).
- Role change (`organization.updateMemberRole({ memberId, role, organizationId })`): success -> toast
  `nowAdmin`/`nowMember`/`nowRole` {name, role}; failure -> the API's message or `roleNotChanged` {name}. The members
  list reloads either way, so the select shows the saved role.
- Remove (`organization.removeMember({ memberIdOrEmail: memberId, organizationId })`): success -> reload, toast
  `removed` {name, organization}; failure `notRemoved` {name}.
- Resend (`organization.inviteMember({ ..., resend: true })`): success -> toast `inviteResent` {email}, reload;
  failure `notResent`.
- Cancel (`organization.cancelInvitation({ invitationId })`): success -> reload, toast `inviteCancelled` {email};
  failure `notCancelled`.
General API-call rule: mutations run through `useApiMutation` (`run()` drops a second call while one is running;
`busy`); a failure is handled once by the query client's MutationCache: it reports the error and toasts the API
`message` when present, else the mutation's `meta.failure` copy (a 401 is never toasted). Queries do the same through
the QueryCache with `meta.failure`.

A member opening `/app/members` (→ `/app/settings?section=members`): nav has no Members, section shows Account, no
invite form rendered.

### 10.8 Security and data section (`settings.securitySettings.*`) — everyone sees, owner deletes, others leave

Owner: danger card `deleteOrganization` + hint `deleteOrganizationHint` + Delete button (`delete`) -> confirm dialog
(`confirmTitle`, confirm label `deleteOrganization`). Confirm (single-flight): `organization.delete({ organizationId })`;
success -> close, `switchOrganization` to the person's next organization (`organization.list`), toast `deleted`,
navigate `/app`, or `/profile` when none is left. Failure -> toast the API's message (e.g. the Stripe 502 message) else
`notDeleted`, and make the organization active again (the plugin cleared it before refusing).
Non-owner: card `leaveOrganization` + `leaveHint` {organization} + button `leave` -> confirm dialog
(`confirmLeaveTitle`, confirm label `leaveOrganization`) -> `organization.leave({ organizationId })`; success as for a
delete with toast `left` {organization}; failure -> our `orgErrors.*` copy or `notLeft`. Then paragraph `ownerOnly`.

### 10.8b Teams section (`settings.teamsSettings.*`) — everyone reads

Hint `hint`. With `team:create`: form `teamName` + `create` (`organization.createTeam({ name, organizationId })`;
blank -> `enterName`). `empty` when there are none. One card per team (`organization.listTeams`):
- name: with `team:update` an Input (aria-label `nameOf` {team}) + `save` (`organization.updateTeam`); else the title.
- `deleteTeam` {team} (with `team:delete`) -> confirm dialog `confirmDeleteTitle` -> `organization.removeTeam`.
- the team's people from `teams.members({ teamId })` (oRPC: Better Auth lists them only to the team's own members),
  list `membersOf` {team}, `noMembers` when empty; `remove` per person (aria-label `removeFrom` {name, team}, with
  `member:delete`) -> `organization.removeTeamMember`.
- with `member:update`: Select `addTo` {team} of the organization's members not in the team + `add` ->
  `organization.addTeamMember`.
Toasts: `created`, `renamed`, `deleted`, `added`, `removed`; failures the API's words, `orgErrors.*` or `not*`.

### 10.8c Roles section (`settings.rolesSettings.*`) — with `ac:create`

Hint `hint`; card `builtIn` (Owner, Admin, Member; `builtInHint`, read-only). List `custom` of
`organization.listRoles` rows: name, `permissionCountOne|Many`, `edit` (aria `editOf`, with `ac:update`), `delete`
(aria `deleteOf`, with `ac:delete`) -> confirm `confirmDeleteTitle` -> `organization.deleteRole({ roleId })`. Aside
`newRole` (with `ac:create`).
Role dialog: name (create only; required, no comma — Better Auth stores several roles as `a,b`; it lowercases names)
and a checkbox grid built from `statements`: one row per resource (`resources.<resource>`), one checkbox per action
(`actions.<action>`, aria-label `permission` {resource, action}); **only actions the person holds are enabled**. At
least one permission (`pickPermission`). Create -> `organization.createRole({ role, permission, organizationId })`;
edit -> `organization.updateRole({ roleId, data: { permission }, organizationId })`. Refusals come back in our words
(`orgErrors.YOU_ARE_NOT_ALLOWED_TO_CREATE_A_ROLE`, `ROLE_IS_ASSIGNED_TO_MEMBERS`, ...).

### 10.9 Join page `/join/$invitationId`

On mount (once): `organization.acceptInvitation({ invitationId })`, then `switchOrganization(member.organizationId)`.
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
- 409 (already a member of that organization) -> `already`: `alreadyTitle`, the API message ("You're already in
  Birch.") or `alreadyBody`, button link `openApp` -> `/app`.
- `INVITATION_NOT_FOUND`, `YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION`, an unverified email, or 404 -> `closed`:
  `closedTitle`, `closedBody`, button link `signIn`.
- other -> `failed` (report error): `failedTitle`, the API message when there is one (a full organization:
  `orgErrors.ORGANIZATION_MEMBERSHIP_LIMIT_REACHED`) else `failedBody`, ghost link `signIn`.

### 10.10 i18n keys (copy verbatim from saas-base `apps/web/public/i18n/{en,es}.json`)

Namespaces: `join.*`, `confirmDelete.*`, `settings.{back,title,mySettings,account,organizationSettings,general,usage,members,teams,roles,billing,security}`,
`settings.accountSettings.*`, `settings.generalSettings.*`, `settings.membersSettings.*`, `settings.securitySettings.*`,
`settings.teamsSettings.*` (teams.json), `settings.rolesSettings.*` (roles.json), `orgErrors.*` (organizations.json),
`orgSwitcher.*` and `createOrganization.*` (shell.json), `app.titles.settings`, `app.titles.joinYourOrganization`. Interpolation `{{x}}` is i18next-compatible as is.
Full en list (es exists for every key):

- join: joining, expiredStart, expiredEnd, expiredBody, yourWorkEmail, sendNewLink, checkStart, checkEnd, sentBody,
  alreadyTitle, alreadyBody, openApp, signIn, closedTitle, closedBody, failedTitle, failedBody, workEmail, tooManyLinks, linkNotSent.
- confirmDelete: cannotBeUndone ("This can't be undone."), keepIt ("Keep it").
- settings.accountSettings: title, yourName, signIn, email, signInWith, signInGoogle, signInMicrosoft, signInEmail
  ("A link by email"), devices, noDevice, thisDevice, anDevice, aDevice, signOutEverywhere, preferences, language,
  timeZone, zoneMadrid, zoneLondon, zoneNewYork, zoneChicago, zoneLosAngeles, zoneSantiago, productNews,
  productNewsHint, deleteAccount, ownerDeleteFirst, securityAndData, ownerDeleteFirstEnd, cannotBeUndone, delete,
  confirmTitle, notSaved, notDeleted, notSignedOut, notLoaded, devicesNotLoaded, enterName, signedOut, deleted, emails.
- settings.generalSettings: title, organizationName, notSaved, notLoaded, slug.
- settings.membersSettings: title, memberCountOne, memberCountMany, moreSeatsFree, moreSeatsPro, inviteLabel, role,
  roleOf, roleOwner, roleAdmin, roleMember, invite, rolesHint, remove, invitedToday, invitedYesterday, invitedDaysAgo,
  emailNotSent, resend, cancel, notLoaded, notInvited, inviteSent, roleNotChanged, nowAdmin,
  nowMember, nowRole, notRemoved, removed, notResent, inviteResent, notCancelled, inviteCancelled, enterWorkEmail,
  alreadyInOrganization, alreadyInvited.
- settings.securitySettings: title, deleteOrganization, deleteOrganizationHint, delete, confirmTitle, notDeleted,
  deleted, ownerOnly, leaveOrganization, leaveHint, leave, confirmLeaveTitle, left, notLeft.

Known es typo to fix while porting: `ownerDeleteFirst` es "Eres el propietario de **este** organización" -> "esta".

---

## 11. Permission matrix

Static roles; a custom role gets exactly what the owner gave it. "plugin" rows are `/api/auth/organization/*`.

| action | owner | admin | member | no org | no session |
| --- | --- | --- | --- | --- | --- |
| me.get / account get/update | yes | yes | yes | yes | 401 |
| me.delete | 409 (owns) | yes | yes | yes | 401 |
| onboarding.create / skip | yes (new org) | yes | yes | yes | 401 |
| rename (plugin `update`) | yes | yes | 403 | 400 | 401 |
| delete (plugin) | yes | 403 | 403 | 400 | 401 |
| list members / invitations (plugin) | yes | yes | yes | 403 | 401 |
| invite member or custom role within own rights | yes | yes | 403 | 400 | 401 |
| invite admin | yes | 403 | 403 | 400 | 401 |
| resend / cancel invite | yes | yes | 403 | 400 | 401 |
| promote member -> admin | yes | 403 | 403 | | 401 |
| demote/remove another admin | yes | 403 | 403 | | 401 |
| remove member | yes | yes | 403 | | 401 |
| admin steps down / leaves | – | yes | yes (leave) | | |
| change/remove/leave as the owner | 403/400 (only owner) | 403 | 403 | | |
| teams: create/rename/remove, add/remove people | yes | yes | 403 | | 401 |
| teams: list, `teams.members` | yes | yes | yes | 404 | 401 |
| custom roles: create/update/delete (within own permissions) | yes | yes | 403 | | 401 |
| custom roles: list | yes | yes | yes | | 401 |
| billing.get | yes | yes | 403 | 404 | 401 |
| other billing procedures | yes | yes | 403 | 404 | 401 |
| usage.get | yes | yes | yes | 404 | 401 |
| accept invitation | yes (joins another org) | yes | yes | yes | 401 |
| set-active | own orgs only (403 otherwise) | | | | 401 |

---

## 12. Edge cases and business rules (from tests)

1. The org-scoped oRPC middleware reads the active membership from the database every request: a removed member gets
   404 on the next call with the same cookie; a stale or foreign `active_organization_id` falls back to the earliest
   membership.
2. A person may be in several organizations; create, skip and accept add one and make it active; `set-active` switches
   (and only to an organization they are in). A new session starts in the earliest one.
3. Concurrent orgs with the same name get distinct numbered slugs (a unique race answers 500 once; accepted).
4. Terms: only literal `true` accepted on create; timestamp from DB `now()`, never from client. Skip stores null.
5. Rename keeps the slug, refuses `slug`/`logo`/`metadata` and blank names; `plan` in the body is ignored.
6. Free plan: owner only; invite -> 403 seat message, nothing stored or emailed.
7. Live invitations hold seats; re-inviting the same address replaces its invitation without an extra seat; cancel and
   expiry free the seat; re-inviting an expired address needs a free seat.
8. Accept counts only members against seats (downgrade: first come first served). Internal allows > 10 members.
9. Invite email address normalized; the invitee must match it and have a verified email to accept.
10. Invite email failure -> 503 with the "is saved" message, row kept with `email_sent = false`; a later successful
    resend sets it true.
11. Org delete ends the Stripe subscription first (502/503 keep the org); afterwards grants are revoked and the purge
    queued (queue failure only logged). Users and their other organizations stay.
12. Member removal and leaving revoke that person's OAuth grants in that organization only.
13. Account delete: refused to an owner of ANY org (409, still signed in); otherwise ends all sessions, removes
    memberships, invitations sent by them and addressed to them.
14. Account update: partial; never affects other users; language only changeable via our endpoint.
15. Devices: only unexpired sessions; current first then newest.
16. An MCP connector grant is bound to the organization active at consent; switching organizations later does not move
    it; the token stops working once the person leaves or is removed from that organization.

---

## 13. saas-base tests worth porting

API integration (Vitest + Hono `app.request` + PGlite + Better Auth test utils for users/sessions + recording mailer + fake
Stripe gateway + fake jobs):

- `apps/api/src/app/organizations/organizations.controller.spec.ts` — ALL (create, skip naming tables, delete with
  Stripe/purge, rename).
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
- `tenancy/organization-id.spec.ts`.
- `libs/shared/address` naming/slug/email specs.

Web (Vitest + React Testing Library, mocking the oRPC client):

- `join/join.page.spec.ts` (9 cases: join -> /app; 409 taken; 404 closed; 401 -> send link -> sent; failure reported;
  429; API message; Better Auth refusal -> workEmail; unexpected send failure).
- `settings/settings.page.spec.ts` (nav sections, switching via `?section=`, member hides Members/Billing and gets
  Account at their sections, owner sees Members, Back goes /app).
- `settings/members-settings/members-settings.spec.ts` (seat line, rows, unsent mark, admin vs owner capabilities, member
  excluded, invite flows incl. double click, 503, unsent toast, validation, API reason, role change, remove, resend, cancel,
  go to Billing).
- `settings/account-settings/account-settings.spec.ts` (22 cases).
- `settings/general-settings/general-settings.spec.ts`, `settings/security-settings/security-settings.spec.ts`.

E2E (Playwright): owner invites a colleague (link read from Mailpit), colleague opens link and lands in the app as member; owner
changes role and removes; owner deletes the org and lands on /profile; member deletes their account and lands on /signin.
