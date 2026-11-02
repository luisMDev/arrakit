# Spec: auth and onboarding

Source of truth for porting the **sign-in, sessions, signup, profile/onboarding, route guards and Unavailable** features of saas-base (NestJS + Angular) to arrakit (Hono + oRPC + Better Auth + TanStack Start). Implementers should be able to work from this file alone, without opening saas-base.

Port behaviour, routes, copy and business rules. **Do not port styles.** Build every screen with default shadcn/ui components (Button, Input, Label, Checkbox, Dialog, Alert, Sonner toasts, Card).

saas-base files covered (for reference only):
`apps/api/src/app/auth/*`, `apps/api/src/app/organizations/{organizations,me}.controller.ts` (create/skip/me only), `apps/api/src/app/mail/mail-signin.ts`, `libs/shared/emails/src/templates/account.ts` (signinEmail), `libs/platform/data/src/auth/*`, `libs/platform/data/src/organizations/create-organization.ts`, `libs/platform/data/src/schema/{auth,organizations,members,invitations}.ts`, `libs/shared/address/*`, `apps/web/src/app/{auth,signup,profile,onboarding,unavailable}`, `apps/web/src/app/app.routes.ts`, `apps/web/src/edge/api-proxy.ts`, `apps/web/functions/*`.

Other specs own related areas: Settings/Account (`/api/me/account`, sign out, sign out everywhere UI, delete account), members/invitations and `/join/:id`, the MCP/OAuth connector screens (`/oauth/signin`, `/oauth/consent`), billing (`/pricing`, `/app/checkout`), and the signed-in shell. This spec covers the auth **server configuration** those areas depend on.

---

## 1. Glossary and constants

| Name                   | Value                                                                                                                                                                | Notes                                                                                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_NAME`             | `"SaaS"` in saas-base. In arrakit, use one shared constant such as `APP_NAME = "Arrakit"` in a shared package. Page titles, emails and copy that say "SaaS" read it. | Copy keys such as `unavailable.unreachableTitle` contain the app name. Interpolate `{{appName}}` or edit the JSON.                                                                                                            |
| `MAGIC_LINK_MINUTES`   | `15`                                                                                                                                                                 | Magic link lifetime. The email copy must read this same constant.                                                                                                                                                             |
| `AUTH_BASE_PATH`       | `/api/auth`                                                                                                                                                          | Better Auth `basePath`.                                                                                                                                                                                                       |
| `MCP_PATH`             | `/api/mcp`                                                                                                                                                           | MCP resource. `mcpResourceURL(baseURL) = new URL('/api/mcp', baseURL)`, so only the origin of the base URL is used.                                                                                                           |
| OAuth issuer           | `new URL('/api/auth', BETTER_AUTH_URL).toString()`                                                                                                                   | e.g. `http://localhost:5200/api/auth`                                                                                                                                                                                         |
| Cookie prefix          | `saas` in saas-base. Use `arrakit`                                                                                                                                   | All Better Auth cookies are `<prefix>.*`, e.g. `arrakit.session_token`. This is required: on localhost, cookies are shared across ports, so another Better Auth app's `better-auth.session_token` must never be read as ours. |
| Session lifetime       | Better Auth default (7 days, refreshed on use)                                                                                                                       | A test moves the clock by 8 days and expects a 401.                                                                                                                                                                           |
| `ORGANIZATION_CLAIM`   | `organization_id`                                                                                                                                                    | The claim name on connector access tokens.                                                                                                                                                                                    |
| `MICROSOFT_UNVERIFIED` | `email_not_verified`                                                                                                                                                 | The error code a refused Microsoft sign-in lands with.                                                                                                                                                                        |
| `SITE_URL`             | The landing (apps/landing) origin, e.g. `https://example.com`                                                                                                        | The wordmark/Home on public pages links here.                                                                                                                                                                                 |

Persona vocabulary used in the copy: a "partner" means a signed-in user.

---

## 2. Environment variables (apps/api)

| Var                                               | Required                                                             | Rules                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                              | always                                                               | Must be **at least 32 characters**, otherwise boot fails with an error that mentions `32`. It signs cookies, encrypts OAuth tokens and the JWKS private key, and is also used to derive other secrets (`derivedSecret(secret, purpose, parts) = HMAC-SHA256(secret, [purpose, ...parts].join('\n')).base64url`).                                           |
| `BETTER_AUTH_URL`                                 | always                                                               | The public origin where the browser reaches `/api/auth`, and the origin of every magic link. Locally this is the **web dev server** (e.g. `http://localhost:5000` or whatever port apps/web uses), which proxies `/api` to the API so the cookie and the app share an origin. Boot fails if it is not a URL: `[auth] BETTER_AUTH_URL is not a URL: "..."`. |
| `WEB_URL`                                         | optional                                                             | The web app origin when it differs from `BETTER_AUTH_URL`. `webOrigin = origin(WEB_URL) ?? origin(BETTER_AUTH_URL)`. A trailing slash or path is stripped to the origin.                                                                                                                                                                                   |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`       | a pair. **Required when `NODE_ENV=production`**. Optional otherwise. | Never half set: if either is set, both are required. Redirect URI: `<BETTER_AUTH_URL>/api/auth/callback/google`.                                                                                                                                                                                                                                           |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | a pair, optional even in production                                  | Never half set. Redirect URI: `<BETTER_AUTH_URL>/api/auth/callback/microsoft`. The Azure app must emit the optional ID token claims `email` and `xms_edov`.                                                                                                                                                                                                |
| `RESEND_API_KEY`                                  | required in production                                               | Without it, mail goes to Mailpit (`MAILPIT_URL`) in dev and e2e, else it is only logged. In production a missing key fails boot: `[mail] missing env: RESEND_API_KEY (production never logs sign-in links)`.                                                                                                                                               |
| `MAIL_FROM`                                       | optional                                                             | Default `App <hello@example.com>`.                                                                                                                                                                                                                                                                                                                         |
| `NODE_ENV`                                        |                                                                      | `production` makes Google and Resend mandatory.                                                                                                                                                                                                                                                                                                            |

Config loading (`loadAuthConfig(env)`) is a pure function and is unit tested:

- Collect missing names in this order: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, then the Google pair if it is wanted, then the Microsoft pair if it is wanted. Throw **one** error that names all of them: `[auth] missing env: A, B, C`. An empty string counts as missing.
- Google is wanted when `NODE_ENV==='production'` or either Google variable is set. Microsoft is wanted when either Microsoft variable is set.
- `trustedOrigins = unique([origin(BETTER_AUTH_URL), webOrigin])`.
- Result: `{ secret, baseURL, trustedOrigins, webOrigin, google?, microsoft? }`. Omit `google`/`microsoft` (leave them undefined) when they are not wanted.
- Validate the config **at boot** so that a deploy with a missing variable fails before it serves (saas-base calls `ready()` in `main.ts`). Tests that never sign in must not need the env, so build it lazily or inject the config.

Web (apps/web):

- The dev server proxies `/api/*` and `/.well-known/*` to the API (`http://localhost:<api port>`).
- In production the web origin must also proxy `/api/*` and `/.well-known/oauth-authorization-server/*` and `/.well-known/oauth-protected-resource/*` to the API (see section 10). Otherwise the session cookie becomes third party.

---

## 3. Data model (Drizzle, Postgres; PGlite in dev, tests and e2e)

Better Auth's Drizzle adapter, with `provider: 'pg'`, **`usePlural: true`**, `transaction: true`. Table and column names are snake_case. Property names are Better Auth field names.

### `users`

| column                 | type                                                   | notes                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| id                     | text PK                                                | Better Auth id                                                                                                                                                                                                     |
| name                   | text not null                                          | `''` after a first magic link, until Profile. Google or Microsoft supply a name.                                                                                                                                   |
| email                  | text not null unique                                   | always stored normalized (trimmed, lowercased)                                                                                                                                                                     |
| email_verified         | boolean not null default false                         | true after a magic link, or after Google, or after Microsoft when Microsoft vouches for the email                                                                                                                  |
| image                  | text null                                              |                                                                                                                                                                                                                    |
| language               | text not null default `'en'`, CHECK in (`'en'`,`'es'`) | Better Auth `user.additionalFields.language = { type: ['en','es'], defaultValue: 'en', input: false }`. **`input:false`**: Better Auth's `/update-user` must NOT change it (tested). Only Settings → Account does. |
| time_zone              | text null                                              | owned by Settings                                                                                                                                                                                                  |
| email_product_news     | boolean not null default false                         | owned by Settings                                                                                                                                                                                                  |
| created_at, updated_at | timestamptz not null default now()                     | `updated_at` is set on update                                                                                                                                                                                      |

### `sessions`

id text PK, expires_at timestamptz, token text unique, created_at, updated_at, ip_address text null, user_agent text null, user_id text FK→users **on delete cascade** (index `sessions_user_id_idx`). `active_organization_id` uuid null FK→organizations **on delete set null** and `active_team_id` text null FK→teams on delete set null (organization plugin). A new session starts in the person's earliest organization (`databaseHooks.session.create.before`); the API re-reads the membership on every request (§5).

### `accounts`

id text PK, account_id text, provider_id text (`google` | `microsoft` | Better Auth's own `credential` is unused), user_id FK→users cascade (index), access_token, refresh_token, id_token, access_token_expires_at, refresh_token_expires_at, scope, password (unused), created_at, updated_at.
**OAuth tokens are stored encrypted** (`account.encryptOAuthTokens: true`). A test asserts that the stored `access_token` is not the raw provider token.

### `verifications`

id text PK, identifier text (indexed), value text, expires_at, created_at, updated_at. Magic link tokens live here **hashed** (`storeToken: 'hashed'`). A consumed link leaves no row behind.

### `organizations` (Better Auth organization plugin)

id uuid PK default random, name text not null, slug text not null **unique**, logo, metadata, plan text not null default `'free'` CHECK in (free, pro, team, internal), stripe_customer_id unique, stripe_subscription_id, usage_anchor timestamptz, created_at. Only `plan` is declared to Better Auth (`input: false`); the Stripe and usage columns stay invisible to it.

### `members`

id text PK (default randomUUID), organization_id uuid FK cascade, user_id text FK cascade, role text default `'member'` (`owner` | `admin` | `member`), role string (`owner` | `admin` | `member` | custom roles, several joined by `,`), **terms_accepted_at timestamptz null** (declared `input: false`; set by the plugin's `beforeAddMember` hook on the creator's seat when `organization/create` was sent `termsAccepted: true`, never taken from the client), created_at. UNIQUE (organization_id, user_id), index on user_id.

### `invitations`

(owned by the members spec. Auth reads it for the MailMember choice.) id, organization_id, email, role, team_id, status default 'pending', email_sent bool default false, expires_at, created_at, inviter_id FK users. Teams, team members and custom roles: organizations spec §2.7.

### OAuth / JWT tables

(owned by the MCP spec but registered in the same adapter): `jwks`, `oauth_clients`, `oauth_resources`, `oauth_client_resources`, `oauth_refresh_tokens`, `oauth_access_tokens`, `oauth_consents`, `oauth_client_assertions`. Use the Better Auth CLI (`@better-auth/cli generate`) to get the exact columns for `jwt()` and `@better-auth/oauth-provider` for the installed version. Better Auth refuses **every** request if a table declared by a plugin is missing from the adapter schema, or if a required column has no default.

Generate the schema with the Better Auth CLI, then adjust names to plural snake_case, and keep it in the db package. Migrations use drizzle-kit and work on both Postgres and PGlite.

### Data functions (db package)

- `memberOf(userId) → { organization, role } | null`: the **earliest joined** membership.
- `membershipIn(userId, organizationId)`: that membership or null.
- `activeMembership(userId, sessionId)`: the membership in the session's active organization read from the database, else `memberOf`. Read on every oRPC call (never trusted from the cookie cache).
- Organizations are created by Better Auth (`auth.api.createOrganization`), see §6.2.

## 4. Shared package: address rules (`packages/address` or similar, pure TS, runs in web and api)

Port **verbatim**. The tables and regexes matter.

```ts
const EMAIL = /^[^\s@]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/
normalizeEmail(email) = email.trim().toLowerCase()
isWorkEmail(email) = EMAIL.test(normalizeEmail(email))
```

"Work email" in saas-base only means "an address we can write to". **Free mail is accepted** for sign-in.

- Accepted: `ana@acme.com`, `' Ana@Sub.Acme.io '`, `first.last+ic@organization.co.uk` (the `+` alias is kept as typed), `ana@xn--mxail5aa.com` (punycode).
- Refused: `''`, `ana`, `ana@`, `ana@acme`, `a b@acme.com`, `ana@-acme.com`, `lucia@cierzo`, `a@b@c.com`, `lucia gomez@cierzo.vc`, `lucia@-cierzo.vc`, `lucia@cierzo.vc.` (trailing dot), `@cierzo.vc`, `iñigo@mesalia.es` (non-ASCII domain chars fail the regex; the local part `iñigo` passes `[^\s@]+`, so the web check accepts it and the API refusal path shows the field error. Keep both checks.)

Slug:

```ts
MAX_SLUG_LENGTH = 63
slugOf(name) = name.normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase()
  .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,63).replace(/-+$/,'')
slugCandidates(name) = base==='' ? [] : [base, base-2 … base-50]  // each numbered slug is truncated so it still fits in 63 chars, trailing '-' trimmed before the suffix
```

Tests: `'  Ácme Ventures, S.L. '` → `acme-ventures-s-l`. `'北京'` → `''`. 100×`a` → length 63. `slugCandidates('Acme').slice(0,3)` = `['acme','acme-2','acme-3']`. `slugCandidates('!!')` = `[]`.

Organization naming:

- `TWO_LEVEL_SUFFIXES`: co.uk org.uk ac.uk gov.uk me.uk ltd.uk plc.uk net.uk, com.au net.au org.au edu.au gov.au, com.br net.br org.br, co.nz org.nz net.nz, co.jp or.jp ne.jp ac.jp, com.es org.es nom.es, com.mx com.ar com.co com.pe com.uy com.ec com.ve, co.za co.il co.in co.kr co.id co.th co.ke, com.tr com.sg com.hk com.cn com.tw com.my com.ph com.vn com.pl com.pt com.ua.
- `FREE_MAIL_DOMAINS` (exact whole-domain match only): gmail.com googlemail.com; outlook.com outlook.es outlook.fr outlook.de outlook.it; hotmail.com hotmail.es hotmail.co.uk hotmail.fr hotmail.de hotmail.it; live.com live.co.uk live.fr live.de live.it msn.com; yahoo.com yahoo.es yahoo.co.uk yahoo.fr yahoo.de yahoo.it ymail.com aol.com; icloud.com me.com mac.com; proton.me protonmail.com pm.me; gmx.com gmx.de gmx.net gmx.at gmx.ch web.de t-online.de mail.com; zoho.com yandex.com fastmail.com hey.com; orange.fr wanadoo.fr sfr.fr free.fr laposte.net libero.it telefonica.net; qq.com 163.com naver.com.
- `domainOf(email)`: the part after the last `@`, normalized, with trailing dots stripped.
- `isFreeMail(email)` = the set has `domainOf(email)`. `a@gmailventures.com` → false.
- `organizationNameFromEmail(email)`: the label just left of the public suffix (a two-level suffix counts as one). Split on `-` and title-case each word. `ana@alder.vc`→`Alder`. `x@mail.alder.co.uk`→`Alder`. `x@alder-ventures.com`→`Alder Ventures`. `x@co.uk`→`''`. `x@team.rowan.com.au`→`Rowan`. `x@info.co.uk`→`Info`.
- `nameFromLocalPart(email)`: the local part, with the `+tag` dropped, split on `[._-]` and title-cased. `ana.perez+x@gmail.com`→`Ana Perez`.
- `organizationNameOnSkip(email, personName='')`:
  1. If the domain is not free mail and `organizationNameFromEmail` is addressable (`slugOf ≠ ''`), use that name.
  2. Else, if `personName` is addressable, use `personName`.
  3. Else, if the local-part name is addressable, use it.
  4. Else `'My Organization'`.
- `organizationNameOr(typed, email, personName='')` = `typed` if it is addressable, else `organizationNameOnSkip(email, personName)`.

---

## 5. Better Auth server configuration (apps/api)

`createAuth({ config, data, mailer, organizations })` returns `betterAuth({...})` (`data`: the data layer, whose `authDatabase` is the Drizzle adapter and `invitationFor` feeds the invite email; `organizations: OrganizationDeps`, organizations spec §4):

- `appName: APP_NAME`, `baseURL: config.baseURL`, `basePath: '/api/auth'`, `secret`, `trustedOrigins: config.trustedOrigins`, `database: drizzleAdapter(...)`.
- `emailAndPassword: { enabled: false }`. No passwords exist anywhere.
- `disabledPaths: ['/token']`. The JWT plugin's `/api/auth/token` must return **404**. Tokens come only from the OAuth flow.
- `socialProviders`:
  - `google: { clientId, clientSecret }`, only when it is configured.
  - `microsoft: { clientId, clientSecret, tenantId: 'common', disableProfilePhoto: true, mapProfileToUser: (profile) => ({ emailVerified: microsoftVouches(profile) }) }`, only when it is configured.
- `user.additionalFields`: `language` (see §3).
- `user.validateUserInfo` (or the current Better Auth equivalent hook that runs before a user is created or an account is linked): when `source.oauth?.providerId==='microsoft' && !microsoftVouches(profile)`, return error `email_not_verified`. **Nothing may be written in that case.**
- `microsoftVouches(claims) = claims.email_verified === true || [true,'1','true'].includes(claims.xms_edov)`. `verified_primary_email` is **never** trusted (nOAuth).
- `account: { encryptOAuthTokens: true, accountLinking: { trustedProviders: [] } }`. No provider links on its word alone. Linking needs the email to be verified by that provider.
- `telemetry: { enabled: false }`.
- `session: { cookieCache: { enabled: true, maxAge: 300 } }`: the session is cached in a signed cookie for 5 minutes, so most requests skip the sessions table. `update-user` rewrites the cached session, so a renamed person or a changed language shows at once. `me.get` still reads the session with `disableCookieCache: true`, so a session ended on another device answers 401 there at once.
- `advanced: { cookiePrefix: 'arrakit', disableOriginCheck: false, ipAddress: { ipAddressHeaders: ['x-real-ip','x-forwarded-for'] }, database: { generateId: () => randomUUID() } }`. `disableOriginCheck:false` is spelled out because Better Auth skips origin checks when `NODE_ENV=test`, and the tests must run the production checks.
- `hooks.before` (`createAuthMiddleware`):
  1. `ctx.path === '/sign-in/social' || '/sign-in/magic-link'` → `isTrustedOrigin`: the `Origin` header must **exactly equal** one of `trustedOrigins`, otherwise `APIError('FORBIDDEN', { message: 'Sign in from the app.' })` (403). The check runs before Google or Microsoft are contacted and before any email goes out. This includes requests with no Origin, `'null'`, a lookalike host (`http://localhost:5200.evil.example`), another scheme or another port. Server calls (`auth.api.*` with no `request`, e.g. the invite email) skip it.
  2. `ctx.path === '/sign-in/magic-link'`: replace the body's email with `normalizeEmail(email)`. If `!isWorkEmail`, throw `APIError('BAD_REQUEST', { message: 'Enter a work email, like name@company.com.' })` (400). No email is sent.
  3. Organization paths (`/organization/create`, `/organization/invite-member`, `/organization/update-role`, `/organization/delete-role`): naming, slug and terms, invite address, custom role changes (organizations spec §4.2). The member change policy runs in the plugin's `organizationHooks` (§4.3).
- `hooks.after`: `/organization/create` rewrites the session cookie; `/organization/leave` revokes the leaver's grants; `/organization/invite-member` (new invite and `resend: true`) sends the invite email and answers 503 when it failed.
- `databaseHooks.session.create.before`: `activeOrganizationId` = the earliest organization joined (or null).
- Plugins:
  - `magicLink({ expiresIn: 15*60, storeToken: 'hashed', sendMagicLink })` (see §7 for the email choice).
  - `jwt({ disableSettingJwtHeader: true, jwt: { issuer: oauthIssuer(baseURL) } })`.
  - `organization({...})` (`packages/auth/src/organization.ts`): `ac`/`roles` from `@arrakit/auth/permissions`, `creatorRole: 'owner'`, `membershipLimit` = plan seats, invitations expire after 7 days, `cancelPendingInvitationsOnReInvite`, `requireEmailVerificationOnInvitation`, teams (no default team), dynamic access control (20 roles), `organizationHooks` (organizations spec §4.2). No `sendInvitationEmail`: the after hook sends it. The web client adds `organizationClient` with the same `ac`, `roles` and schema (`@arrakit/auth/client`).
  - `oauthProvider({...})` from `@better-auth/oauth-provider` (configuration details in the MCP spec): `loginPage: ${webOrigin}/oauth/signin`, `consentPage: ${webOrigin}/oauth/consent`, dynamic and unauthenticated client registration, `grantTypes: ['authorization_code','refresh_token']` (no `client_credentials`), `resources` and `clientRegistrationDefaultResources: [mcpResourceURL]`. `postLogin`: `{ page: consentPage, shouldRedirect: no usable org, consentReferenceId: the session's active organization while the person is in it, else their earliest one, or throw FORBIDDEN access_denied "You are not in an organization here." }`, `customAccessTokenClaims: ({referenceId}) => referenceId ? { organization_id: referenceId } : {}`.

Hono mount: `app.on(['GET','POST'], '/api/auth/*', c => auth.handler(c.req.raw))` plus `/.well-known/oauth-authorization-server/*` → `auth.handler` (oauth-provider serves the RFC 8414 metadata there). CORS is not needed because everything is same-origin through the proxy.

Trusted origin helper `isTrustedOrigin(origin, trusted) = typeof origin === 'string' && trusted.includes(origin)`, exported from `@arrakit/auth`. Besides the sign-in hook, the API's `/api/rpc/*` CSRF middleware uses it: any write from an untrusted Origin → 403 `Use the app.` (platform spec, section 4). Procedures do no Origin checks of their own.

Organizations, members, invitations, teams and custom roles are the organization plugin's endpoints under `/api/auth/organization/*` (organizations spec §5.8). Creating one (Profile's Next/Skip and the shell dialog) is `organization/create` too.

### Session middleware for oRPC

- `getSession(headers)` = `auth.api.getSession({ headers })`. It returns `null` for no cookie, a forged token, an unsigned token, a token signed with another secret, the cookie under another name (`better-auth.session_token=…`), an expired session, or a session whose user row was deleted (sessions cascade).
- oRPC middleware `requireSession` → `ORPCError('UNAUTHORIZED')` (401). It puts `{ user, session }` in the context.
- oRPC middleware `requireMember(wanted?: Permissions)` (builder `member(wanted?)`), which runs after `requireSession`:
  - `activeMembership(user.id, session.id)` is read **fresh on every call**. A member removed between two requests gets 404 on the next request, even though the cookie is still valid.
  - No membership → `NOT_FOUND` with message `'Not found in your organization.'` (404).
  - The role's permissions (static roles, plus the organization's custom roles when the role is not static) lacking `wanted` → `FORBIDDEN` `"You don't have permission to do this."` (403).
  - On success, put `{ activeOrganization, role, permissions, scope }` in the context.
  - A handler-level requirement adds to a router-level one.

---

## 6. API endpoints

### 6.1 Better Auth routes (`/api/auth/*`, served by Better Auth; the web calls them via `better-auth/react` `createAuthClient` or plain fetch)

| Method & path                                                                              | Used by                                      | Input                                                                                                                   | Output / behaviour                                                                                                                       | Errors                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/auth/sign-in/magic-link`                                                        | Signup, Sign in, oauth signin, invite resend | `{ email, callbackURL, errorCallbackURL }` (absolute URLs on the web origin). Optional `name` (the web never sends it). | 200 `{status:true}`. Sends the email (§7).                                                                                               | 403 when Origin is missing or not trusted (no email sent). 400 for an unwritable email (no email sent). 403 when callbackURL/errorCallbackURL is not on a trusted origin (Better Auth's own check).                      |
| `GET /api/auth/magic-link/verify?token&callbackURL&errorCallbackURL`                       | the link in the email                        |                                                                                                                         | 302 to `callbackURL` with the session cookie set. Creates the user on first use (`emailVerified: true`, `name: ''`).                     | Used, expired or unknown token → 302 to `errorCallbackURL` + `?error=INVALID_TOKEN` (or `&error=` when the URL already has a query), with no cookie.                                                                     |
| `POST /api/auth/sign-in/social`                                                            | Continue with Google/Microsoft               | `{ provider: 'google'                                                                                                   | 'microsoft', callbackURL, errorCallbackURL }`                                                                                            | 200 `{ url, redirect: true }`. The web sets `window.location.href = url`.                                                                                                                                                | 403 for an untrusted or missing Origin, or for a callbackURL **or** errorCallbackURL that points off a trusted origin: another site (`https://evil.example/profile`), protocol-relative (`//evil.example/profile`), userinfo (`http://localhost:5200@evil.example/profile`), or a lookalike host. 404 when the provider is not configured. |
| `GET /api/auth/callback/google` / `.../microsoft`                                          | provider redirect                            | `code`, `state` (+ the state cookie)                                                                                    | 302 to callbackURL with the cookie set.                                                                                                  | 302 to errorCallbackURL + `error=<code>`: `access_denied` (the user said no), `email_not_verified` (new Microsoft user who is not vouched), `account_not_linked` (an existing user plus an unvouched Microsoft account). |
| `GET /api/auth/get-session`                                                                | (not used by the web; guards read `me.get`)  | cookie                                                                                                                  | `{ session, user }                                                                                                                       | null` (`null` without a session; this is not an error).                                                                                                                                                                  |                                                                                                                                                                                                                                                                                                                                            |
| `POST /api/auth/sign-out`                                                                  | app menu, delete account                     | `{}`                                                                                                                    | 200                                                                                                                                      |                                                                                                                                                                                                                          |
| `POST /api/auth/revoke-other-sessions`                                                     | Settings → "Sign out everywhere"             | `{}` + Origin                                                                                                           | 200. Ends every session of this user **except this one**. Other users stay signed in. Afterwards the account's device list has length 1. | 401 without a session.                                                                                                                                                                                                   |
| `POST /api/auth/update-user`                                                               | (not used by the web)                        |                                                                                                                         | Must NOT change `language` (`input:false`).                                                                                              |                                                                                                                                                                                                                          |
| `GET /api/auth/token`                                                                      | —                                            |                                                                                                                         | **404** (disabled).                                                                                                                      |                                                                                                                                                                                                                          |
| `/api/auth/organization/*`                                                                 | Settings, org switcher, join page            |                                                                                                                         | The organization plugin (organizations spec §5.8).                                                                                       |                                                                                                                                                                                                                          |
| `/api/auth/oauth2/*`, `/api/auth/jwks`, `/.well-known/oauth-authorization-server/api/auth` | MCP spec                                     |                                                                                                                         |                                                                                                                                          |                                                                                                                                                                                                                          |

### 6.2 oRPC procedures (contract-first with `@orpc/contract`, mounted at `/api/rpc`)

Names are suggestions. Keep them consistent with the contract package. Map errors with `ORPCError` codes, whose HTTP statuses match those of saas-base.

**`authProviders.get`** (public, no session)

- Input: none.
- Output: `{ google: boolean, microsoft: boolean }`. `google` = Google is configured, `microsoft` = Microsoft is configured.
- Tests: both configured → `{google:true, microsoft:true}`. No Azure app → `{google:true, microsoft:false}`.
- (saas-base path: `GET /api/auth-providers`. It lives outside `/api/auth` because Better Auth owns that prefix.)

**`me.get`** (session required)

- Output:
  ```ts
  {
    email: string;
    name: string;               // '' after a magic link until Profile/Settings
    language: 'en' | 'es';
    organization: { id: uuid; name: string; slug: string; plan: 'free'|'pro'|'team'|'internal' } | null;
    role: string | null;                      // Better Auth role string; null with no org
    permissions: Record<string, readonly string[]>; // what the role grants; {} with no org
    plan: Plan | null;                        // null with no org
    seats: number | null;                     // PLAN_OFFERS[plan].seats (free = 1); null with no org
  }
  ```
- Reads the session once, past the cookie cache (`requireLiveSession`: a session revoked elsewhere is 401 at once), and the membership with `activeMembership` (the active organization).
- Errors: 401 without a session.
- Tests: right after sign-in → `{ email, name:'', language:'en', organization:null, role:null, permissions:{}, plan:null, seats:null }`. After Profile Next with name `'Ana Ibarra'` and organization `'Seaya Ventures'` → name `'Ana Ibarra'`, organization `{ name:'Seaya Ventures', slug:'seaya-ventures', plan:'free' }`, role `'owner'`, plan `'free'`, seats `1`.

**Creating an organization** (Profile → Next / Skip, shell dialog): Better Auth's `POST /api/auth/organization/create` (`authClient.organization.create`, through `createOrganization()` in `#/lib/organization-queries`). There is no oRPC procedure.

- Body: `{ name, slug, termsAccepted? }`. `name` is the Organization field and may be blank; the `slug` sent is ignored. `termsAccepted`, when present, must be the literal `true` (`false` or `"true"` → 400 "Accept the Terms and the Privacy Policy.", nothing created). Unknown keys (e.g. `termsAcceptedAt`) are stripped by Better Auth.
- Before hook (`packages/auth/src/hooks.ts`): `orgName = organizationNameOr(body.name, session.user.email, session.user.name)` (the only place the rule runs) and the first free slug. The plugin makes the creator owner and the organization active.
- `termsAccepted: true` is kept in Better Auth's request state by the before hook (Better Auth strips it from the body); the plugin's `beforeAddMember` then returns `{ data: { termsAcceptedAt: new Date() } }` for the creator's seat, only on `/organization/create` (never on add-member or accept-invitation).
- After hook: the session cookie is rewritten with the new `activeOrganizationId`, so no `set-active` call follows.
- **Next** first saves a non-blank "Your name" with `authClient.updateUser({ name })` (which rewrites the cached session, so the hook names a free-mail organization after it), then creates with `termsAccepted: true`. **Skip** creates with `name: ''` and no terms: `organizationNameOr('', …)` is `organizationNameOnSkip(email, user.name)`.
- Errors: 401 without a session. There is no organization limit: someone already in organizations gets another one, made active.
- Behaviour tests (`apps/api/src/organizations/create-organization.test.ts`):
  - Next `{name:'Alder Ventures'}` after naming the person `Lucía Gómez` → `{name:'Alder Ventures', slug:'alder-ventures', plan:'free'}`. The member row has role owner, `terms_accepted_at` is non-null, and the user name is `Lucía Gómez`.
  - A name that is not addressable falls back to the email domain: `''`+`dana@elm.vc`→`Elm`/`elm`. `'   '`+`dana@oak-partners.com`→`Oak Partners`/`oak-partners`. `'&.!'`+`dana@mail.yew.co.uk`→`Yew`/`yew`. `'北京基金'`+`dana@pine.vc`→`Pine`/`pine`.
  - Free mail falls back to the person: `ana.perez@gmail.com`, person named `'Ana Pérez'` → `Ana Pérez`/`ana-perez`. `x@outlook.com`, session name `'Marta Ruiz'` → `Marta Ruiz`. `bruno.diaz@hotmail.com`, no names → `Bruno Diaz`.
  - `dana@co.uk` with name `'&.!'` and the person named `'Lucía Gómez'` → `Lucía Gómez`.
  - A second create by the same user makes a second organization and makes it active; the first stays.
  - Same-named organizations get `alder`, `alder-2`, `alder-3`. A client slug is ignored.
  - Skip: `lucia@alder.vc`→`Alder`/`alder`. `x@mail.cedar.co.uk`→`Cedar`. `x@birch-ventures.com`→`Birch Ventures`. `x@team.rowan.com.au`→`Rowan`. `x@info.co.uk`→`Info`. `ana.perez@gmail.com`→`Ana Perez`/`ana-perez` (never a slug containing gmail/hotmail). `x@outlook.com` with session name `Marta Ruiz`→`Marta Ruiz`. `_@gmail.com`→`My Organization`/`my-organization` (never a 400). `sara@oak.vc` with name `Sara Gil`→`Oak` (the domain wins). `x@co.uk` with name `Ana Pérez`→`Ana Pérez`, slug starting `ana`. Skip after Next makes another organization (`poplar-2`). `terms_accepted_at` stays NULL.

Renaming and deleting organizations, `me.account.get`, profile updates (`update-user`) and account deletion (`delete-user`) belong to the organization/settings spec.

### 6.3 Plain Hono routes

- `/api/auth/*` and `/.well-known/oauth-authorization-server/*` → Better Auth (above).
- Seed helper (dev only, not a route): `personId(email, name)` finds or creates a verified user through the adapter directly (bypassing `validateUserInfo`), for a local seed script. Nothing in a request may reach it.

---

## 7. Emails

Mailer interface: `send(mail: { to: string|string[]; cc?; subject; html; text; from?; replyTo? }): Promise<void>`.

- With `RESEND_API_KEY`: POST `https://api.resend.com/emails` with `from` (mail.from ?? MAIL_FROM ?? `App <hello@example.com>`), `to[]`, `subject`, `html`, `text`, `reply_to` only when set, `cc` only when non-empty.
- Without a key (dev/e2e): send to Mailpit at `MAILPIT_URL`, where Playwright reads the magic link; without that either, only log `"Neither RESEND_API_KEY nor MAILPIT_URL is set, so nothing is sent. From … to …: <subject>\n<text>"`. Tests use a recording mailer. Production without a key fails boot.

### MailSignin (`signinEmail({ minutes, links: { signIn } })`)

- Subject: **`Your link to sign in to ${APP_NAME}`**
- Heading: `Sign in` / `to ${APP_NAME}.`
- Paragraph: `The link works once, for 15 minutes.` (`count(minutes,'minute')`, pluralised).
- Button: `Sign in` → the exact magic link URL. In the HTML, `&` must be escaped as `&amp;` inside the href. The text part must contain the raw URL.
- Note: `Didn't ask for this? Ignore this email.`
- Tests: the email goes to the normalized address, the text contains the exact URL, the HTML href is the escaped URL, and both parts contain `works once` and `15 minutes`.

### Choosing MailSignin vs MailMember (in `sendMagicLink({ email, url, metadata }, ctx)`)

- A server call (no `ctx.request`) with `metadata.invitationId` calls `invitationFor(id, email)`. This returns the pending invitation addressed to that email, or null. Metadata sent over HTTP is ignored.
- If an invitation is found, send **MailMember** (owned by the members spec) with `{ to, url, organization:{name}, inviter, expiresInDays: max(1, ceil((expiresAt-now)/1 day)) }`. Subject example: `owner invited you to Oak on ${APP_NAME}`.
- Otherwise send MailSignin. Someone else asking with another person's join link, or a non-existent invitation id, gets an ordinary MailSignin.
- `links.send(email, invitationId)` (used by the members spec): calls `auth.api.signInMagicLink({ body: { email, callbackURL: joinURL, errorCallbackURL: joinURL, metadata: { invitationId } }, headers: new Headers() })` (a server call: no Origin check). `joinURL = ${webOrigin}/join/${encodeURIComponent(id)}`.

---

## 8. Web screens (apps/web, TanStack Start file routes)

Global layout for public pages: a header with a wordmark (APP_NAME) that links to `SITE_URL` outside `/app`, and to `/app` inside it (aria-label `app.homeLabel`). Then the page content. Then a Sonner `<Toaster/>`. The document title is `${APP_NAME} · ${t('app.titles.<page>')}`.

i18n: i18next with `en` (bundled) and `es`. Before sign-in the language is the one in localStorage key `arrakit.lang`, else `navigator.language` if it is en/es, else en. Once signed in, the account's `me.language` wins: switch to it before rendering, set `<html lang>`, and store it. Missing keys fall back to en.

### Route table

| Route                                                                                                       | Access / guard                                                          | Title key                     | Renders                                                   |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------- |
| `/`                                                                                                         | redirect → `/signin`                                                    | —                             | The front page is the landing site, not the app.          |
| `/signin`                                                                                                   | `skipWhenSignedIn`                                                      | `app.titles.signIn`           | SignupPage in **returning** mode                          |
| `/signup`                                                                                                   | `skipWhenSignedIn`                                                      | `app.titles.whereToWrite`     | SignupPage                                                |
| `/profile`                                                                                                  | `requireAccount`                                                        | `app.titles.yourOrganization` | ProfilePage                                               |
| `/unavailable`                                                                                              | public                                                                  | `app.titles.unavailable`      | UnavailablePage                                           |
| `/app/**`                                                                                                   | `requireUser`                                                           | (other specs)                 | signed-in shell                                           |
| `/pricing`, `/join/$invitationId`, `/oauth/signin`, `/oauth/consent`                                        | public (other specs)                                                    |                               |                                                           |
| anything else (`*`, including the legacy `/reading`, `/ready`, `/ready/:id`, `/app/booking`, `/app/booked`) | not-found page (unknown `/app/*` renders it inside the signed-in shell) |                               | "Back home" → `/`, which forwards to `/signin` or `/app`. |

### Data the guards use

- `loadMe(queryClient)` (`#/lib/current-user`) = `me.get` through the query cache → `Me`, or `null` on a 401 (signed out); any other failure throws.
- `guardedMe(queryClient, next)` (private to `#/lib/guards.ts`) = `loadMe`, but any failure other than a 401 (network, 403, 5xx, …) redirects to `/unavailable?next=<next>` (`next` = the current `location.href`). The web never signs a person out because the API failed.
- `checkoutChoice(search)` = `{ plan, cycle }` only when `plan ∈ {pro, team}` (paid plans: every plan except free and internal) and `cycle ∈ {monthly, yearly}`, else null (an `enterprise`, `free` or misspelled plan is dropped).
- `appLanding(choice)` = `{ to: '/app/checkout', search: choice }` or `{ to: '/app' }`.
- `profileLanding(choice)` = `'/profile'` or `'/profile?plan=…&cycle=…'`.

### Guard: `skipWhenSignedIn` (`/signup`, `/signin`) — beforeLoad

1. `me = guardedMe(...)`. Signed out (null) → render the page (visitor).
2. Signed in with no org → redirect `/profile`, carrying `?plan&cycle` when there is a valid choice.
3. Signed in with an org → `appLanding(choice)`.
4. Any non-401 failure → `/unavailable?next=<current url>` (from `guardedMe`); no toast.
5. This applies on `/signup?error=…` too: a signed-in user with an org who lands back on a refused sign-in URL still goes to `/app`.

### Guard: `requireAccount` (`/profile`)

1. `me = guardedMe(...)`. Signed out → redirect `/signup`.
2. If the user has an org → `appLanding(choice)`. The organization form is never shown to someone who has an org.
3. Otherwise render Profile.
4. Any non-401 failure → `/unavailable?next=<current url>`.

### Guard: `requireUser` (`/app` layout)

1. `me = guardedMe(...)`; signed out → `/signin`.
2. No organization (`organization`, `role` or `plan` null; also when the user was removed from their org) → `/profile`.
3. Apply the account language (`loadLanguage(me.language)`; a file that fails to load keeps the current language and is reported).
4. Any non-401 failure → `/unavailable?next=<url>`.

- `useCurrentUser()` then reads `me.get` from the query cache (`role`, `isAdmin` = owner|admin, `isOwner`, `patch`, `refresh`).
- Test: a direct load of `/app/settings` with the API returning 500 → `/unavailable?next=%2Fapp%2Fsettings`.

### Screen: Signup / Sign in (`/signup`, `/signin`)

Purpose: "Where should we write to you?" Sign in with Google, Microsoft or a magic link. No password.

- State A (form):
  - H1: `signup.titleStart` + muted `signup.titleEnd` ("Where should we" / "write to you?").
  - **SignInOptions** component (also reused by `/oauth/signin`):
    - Refusal alert (`role="alert"`, shadcn Alert destructive) **above the buttons**, read from the search params:
      - `error` present and `via ∈ {google, microsoft}` → `auth.signInOptions.providerRefused` with `{provider: 'Google'|'Microsoft'}`: "Couldn't sign you in with Google. Try again, or use your email."
      - `error` present otherwise → `auth.signInOptions.linkRefused`: "That link was already used or has expired. Enter your email for a new one."
      - The two messages never show together.
    - Button "Continue with Google" (`continueWithGoogle`, with a Google icon), only if `providers.google`.
    - Button "Continue with Microsoft" (`continueWithMicrosoft`, with a Microsoft icon), only if `providers.microsoft`.
    - The "OR" divider (`auth.signInOptions.or`) shows only if at least one provider button is shown.
    - Email form: one `type="email"` input, `autocomplete="email"`, visually hidden label `workEmail` ("Work email"), placeholder `yourWorkEmail`, submit button `continue` ("Continue").
    - Providers come from `authProviders.get`, asked **once per app load** (cache only successes; a failure is retried next time). Until it answers, and when it fails, assume `{ google: true, microsoft: false }`.
  - Under the options: `signup.noPassword` ("No password. We'll email you a link to sign in.").
- Actions:
  - **Continue (email)**: mark the field touched. If `!isWorkEmail(value)`, show the field error `auth.signInOptions.workEmailError` ("Enter your work email, like name@company.com."), set `aria-invalid="true"`, and send nothing. Otherwise `email = normalizeEmail(value)` and POST magic-link with `callbackURL = absolute(landing)` and `errorCallbackURL = absolute(refusedLanding(landing))`.
    - Success → State B with the normalized email.
    - API 400 → the same field error, and the button is re-enabled.
    - Any other failure → toast `linkNotSent` ("Couldn't send your link. Try again."), and the button is re-enabled.
  - **Continue with Google / Microsoft**: POST sign-in/social `{ provider, callbackURL: absolute(landing), errorCallbackURL: absolute(refusedLanding(landing, provider)) }`, then `window.location.href = res.url` (a full-page redirect). The app itself does not navigate. If the request fails (e.g. 404 when the provider is not configured), stay on the page, show the toast `notSignedIn` ("Couldn't sign you in. Try again."), and re-enable the buttons.
  - **Pending lock**: while any sign-in is in flight, **all** buttons (Google, Microsoft, Continue) are disabled, and clicks are ignored (one request only). They are re-enabled after a failure. After a social redirect starts they stay disabled.
  - **bfcache restore**: on the `pageshow` event with `event.persisted === true` (the user pressed Back from the provider), re-enable all buttons. `persisted === false` changes nothing.
- `landing`:
  - `/signin` (returning mode) → `'/signin'`. After sign-in, the user lands back on `/signin` and its guard decides between `/app` and `/profile`.
  - `/signup` → `profileLanding(checkoutChoice(search))`, i.e. `/profile` or `/profile?plan=team&cycle=monthly`.
  - `/oauth/signin` → `/api/auth/oauth2/authorize?<filtered params>` (MCP spec).
- `refusedLanding(landing, via?)`:
  - landing starts with `/api/auth/oauth2/authorize?` → `/oauth/signin?<same params>[&via=…]`
  - landing === `/signin` → `/signin[?via=…]`
  - otherwise `/signup`, carrying the query from `/profile?…` (e.g. `/signup?plan=pro&cycle=yearly`), plus `via` when present.
  - Examples: (`/profile`) → `/signup`. (`/profile`, google) → `/signup?via=google`. (`/signin`, google) → `/signin?via=google`. (`/api/auth/oauth2/authorize?client_id=claude`, microsoft) → `/oauth/signin?client_id=claude&via=microsoft`.
  - Better Auth then appends `error=<code>`.
  - All callback URLs are **absolute** on the web origin (`new URL(path, document.baseURI)`), so the link lands on the app wherever the API lives.
- State B (**CheckYourEmail** component, also reused by `/oauth/signin`):
  - H1 `auth.checkYourEmail.titleStart` + muted `titleEnd` ("Check your" / "email.").
  - `sentTo` with `{email}`: "We sent a sign-in link to {{email}}. Open it in this browser to carry on."
  - Ghost button `useDifferentEmail` → back to State A, with the input prefilled with the last email sent and Continue enabled.
  - Small text `linkWorksOnce`: "The link works once. Nothing there? Look in spam."
  - The email input is not rendered in this state.
- Copy keys: `signup.*`, `auth.signInOptions.*`, `auth.checkYourEmail.*`, `app.titles.signIn|whereToWrite`.

### Screen: Profile (`/profile`)

Purpose: "Tell us about your organization." This is the first screen after a first sign-in. It creates the user's organization.

- H1 `profile.titleStart` + muted `profile.titleEnd` ("Tell us" / "about your organization.").
- Form (a 2-column grid on wide screens):
  - Input "Your name" (`profile.yourName`, `autocomplete=name`), optional, prefilled empty.
  - Input "Organization" (`profile.organization`, `autocomplete=organization`), optional.
  - Checkbox: `profile.agreeTo` "I agree to the" + link-button `profile.terms` "Terms" + `profile.andThe` "and the" + link-button `profile.privacyPolicy` "Privacy Policy" + `profile.agreeEnd` ".".
    - Terms and Privacy Policy are links to the landing's `/terms` and `/privacy` (`TERMS_URL`, `PRIVACY_URL` in `apps/web/src/config.ts`), opened in a new tab. Following them must **not** tick the checkbox.
  - Buttons: primary **Next** (`profile.next`), disabled while the Terms box is unticked or while a request is pending. Ghost **Skip** (`profile.skip`), always enabled except while pending.
  - The page shows nothing else (no radio groups, no extra questions).
- Actions:
  - **Next**: a non-blank name → `authClient.updateUser({ name: name.trim() })` (a name past 100 characters or on several lines is refused in the form, toasting `profile.organizationNotSaved`); then `createOrganization({ name: organization.trim(), termsAccepted: true })`. A blank organization is fine (`name:''` is sent).
  - **Skip**: `createOrganization({ name: '' })`, with nothing asked and no terms.
  - Then `reloadForOrganization(queryClient)` (Better Auth already made it active).
  - After either succeeds: if `checkoutChoice(search)` → navigate `/app/checkout?plan&cycle`, else `/app`.
  - On failure: re-read `me.get`. If the user now **has** an org (a 409, or a create whose answer was lost), continue as on success. Otherwise the mutation fails and its `meta.failure` toasts the API's message, or `profile.organizationNotSaved` for Next ("Couldn't save your organization. Check its name and try again.") / `profile.notSkipped` for Skip ("Couldn't skip this step. Try again."); the buttons re-enable so the user can retry.
  - Pending lock: one request at a time. Next and Skip are both disabled while pending, and extra clicks are ignored.
- Copy keys: `profile.*`, `app.titles.yourOrganization`.

### Screen: Unavailable (`/unavailable`)

- H1 `unavailable.unreachableTitle` ("Couldn't reach {APP}.").
- Body `unreachableBody` ("Nothing is lost. Try again in a moment.").
- Button `tryAgain` ("Try again") → client navigation to `next`.
- There is no `reason=forbidden` variant: a 403 from `me.get` is treated like any other failure.
- `next` sanitising: use the value only if it matches `^\/(?:app|signup|signin|profile)(?:[/?#]|$)`, else use `/app`. Ignored examples: `/pricing`, `https://evil.example/app`, `//evil.example/app`, `/application`.
- Try again re-runs the target's guard. If the API is still down, the user lands back on `/unavailable?next=…`. Once the API answers, the user reaches the target (e.g. `/app/settings`, `/profile`).
- Copy keys: `unavailable.*`, `app.titles.unavailable`.

### Stale chunk recovery (app-wide, nice to have)

If a lazy route chunk fails to load (`/dynamically imported module|Importing a module script failed/i`), retry once per 10 s window (tracked by the sessionStorage key `arrakit:stale-chunk-retried-at`): refetch the chunk with `cache:'reload'` if a URL can be found in the message, then `location.assign(target)`. If sessionStorage is unavailable, do nothing.

### Copy (en / es). Reuse from saas-base `apps/web/public/i18n/{en,es}.json`

```
app.homeLabel: Home / Inicio
app.titles.{signIn,unavailable,whereToWrite,yourOrganization}: Sign in|Unavailable|Where to write|Your organization / Iniciar sesión|No disponible|Dónde escribir|Tu organización
auth.checkYourEmail: titleStart "Check your"/"Revisa tu", titleEnd "email."/"email.", sentTo, useDifferentEmail, linkWorksOnce
auth.signInOptions: linkRefused, providerRefused{{provider}}, continueWithGoogle, continueWithMicrosoft, or ("OR"/"O"), workEmail, yourWorkEmail, workEmailError, continue, linkNotSent, notSignedIn
signup: titleStart, titleEnd, noPassword
profile: titleStart, titleEnd, yourName, organization, agreeTo, terms, andThe, privacyPolicy, agreeEnd, next, skip, organizationNotSaved, notSkipped, termsBody, privacyBody
unavailable: unreachableTitle, unreachableBody, tryAgain
```

Copy the full en/es strings from the saas-base JSON files, replacing "SaaS" with the app name.

---

## 9. End-to-end flows (they must work exactly like this)

1. **New user via magic link**: landing "Get started" → `/signup`. Enter `ana@acme.com` → Continue → "Check your email." The link in the email goes to `GET /api/auth/magic-link/verify?...&callbackURL=<web>/profile`, which returns a 302 to `<web>/profile` with the cookie set. Profile → Skip → `/app` (Home shows "Hi, …").
2. **New user via Google**: `/signup` → Continue with Google → `sign-in/social` with callback `/profile` → Google → `/api/auth/callback/google` → 302 `<web>/profile` signed in → Profile.
3. **Returning user**: `/signin` → magic link with landing `/signin` → the link lands on `/signin` → the guard sends a user with an org to `/app` (or to `/profile` if they have no org). Once signed in, `/` and `/signin` both go to `/app`.
4. **Refusals**:
   - User says no at Google → `<web>/signup?via=google&error=access_denied`, signed out, with the provider alert.
   - Used link → `<web>/signup?error=INVALID_TOKEN`, with the link alert.
   - Microsoft without vouching (new user) → `/signup?via=microsoft&error=email_not_verified`. No user row or account row is created.
   - Microsoft without vouching (existing user) → `/signup?via=microsoft&error=account_not_linked`. Nothing is linked.
5. **Pricing → paid plan → signup**: `/signup?plan=team&cycle=monthly` → magic link landing `/profile?plan=team&cycle=monthly`, error landing `/signup?plan=team&cycle=monthly` → Profile → Next/Skip → `/app/checkout?plan=team&cycle=monthly`. If the user already has an org, `/profile?plan=…` goes straight to checkout. An invalid plan (`enterprise`) is dropped, so the landing is `/profile`.
6. **Account linking**: a user who first came by magic link and later uses Google with the same email is the **same user** (same id). With Microsoft, the accounts link only when Microsoft vouches for the email (`xms_edov` true/'1'/'true' or `email_verified` true). After linking, the account's `signInWith` reads `microsoft` (the newest provider wins; Settings spec).

---

## 10. Edge proxy (production deploy of apps/web)

`proxyToApi(request, apiOrigin, send = fetch)`:

- Target is `apiOrigin + pathname + search`.
- Copy all headers (cookie and origin included). Set `x-forwarded-host` = the request host and `x-forwarded-proto` = the scheme without the `:`. If `cf-connecting-ip` is present, set `x-forwarded-for` to it.
- Forward the method. Forward the body for anything other than GET/HEAD, with `duplex:'half'`.
- `redirect: 'manual'`: pass 302s (Google consent, callback redirects) back to the browser, and never follow them.
- Proxy these paths: `/api/*`, `/.well-known/oauth-authorization-server/*`, `/.well-known/oauth-protected-resource/*`. Any other `/.well-known` file stays static.
- In TanStack Start this can be a server route or middleware in apps/web (or the hosting platform's rewrite), configured with `API_ORIGIN`. The API's `BETTER_AUTH_URL` is the **web** origin, so cookies, magic links and OAuth callbacks all live on the web origin.
- The API reads the client IP from `x-real-ip`, then from `x-forwarded-for`. A multi-hop X-Forwarded-For is dropped by Better Auth, which is why X-Real-IP comes first. Test: with `x-real-ip: 203.0.113.9` and `x-forwarded-for: 203.0.113.9, 162.158.1.1`, the session's `ip_address` is `203.0.113.9`.

---

## 11. Background jobs / external integrations

- **Jobs**: none in this area.
- **External**: Google OAuth (`https://accounts.google.com/o/oauth2/v2/auth`, token endpoint `https://oauth2.googleapis.com/token`). Microsoft Entra `common` (`https://login.microsoftonline.com/common/oauth2/v2.0/authorize`, token endpoint `.../common/oauth2/v2.0/token`). Resend.
- **Rate limiting**: Better Auth's built-in limiter (it needs the IP, hence the header config).

---

## 12. Business rules and edge cases (from the tests)

1. A magic link works **once**. Better Auth consumes it atomically: of two parallel clicks exactly one signs in, and the other gets `error=INVALID_TOKEN`.
2. A link works for **15 minutes inclusive**. Opened at 14:59 or at exactly 15:00 it works. At 15:00 + 1 ms or at 15:01 it fails with INVALID_TOKEN.
3. Asking again sends a **new** link, and the earlier one keeps working until it is used or expires. Each link works once.
4. A link for A never signs in B.
5. Emails are trimmed and lowercased: `'  Ana.Ibarra@Seaya.CAPITAL '` and `ana.ibarra@seaya.capital` are the same user.
6. `+` aliases and punycode domains are kept as typed.
7. Origin is checked on every magic-link and social sign-in, even without a cookie. No email goes out and no provider is contacted for a foreign or missing Origin.
8. callbackURL and errorCallbackURL must be on a trusted origin (403 otherwise).
9. Microsoft is trusted only through `email_verified===true` or `xms_edov ∈ {true,'1','true'}`. `verified_primary_email` never counts.
10. When Microsoft is not configured: `sign-in/social` with microsoft returns 404, and Google and the magic link still work. `authProviders.get` says `microsoft:false`, so the web hides the button. Same for Google (the web hides it, and the OR divider disappears).
11. Sessions are refused when: there is no cookie, the token is forged or unsigned, it is signed with another secret, the cookie has a different name (prefix), the session has expired (+8 days), or the user was deleted.
12. Revoke other sessions keeps the current session and ends the user's other sessions only.
13. Membership and role are read fresh on every request (removal takes effect immediately).
14. A user may create several organizations; each new one becomes active. Skip never reads the client body. The Terms timestamp is set by the DB and only when accepted through Next.
15. `/api/auth/organization/*` is the organization plugin. `/api/auth/token` is 404.
16. Google access tokens are stored encrypted.
17. `language` cannot be changed through `/api/auth/update-user`.
18. The web distinguishes "signed out" (`me.get` answers 401) from "API down" (any other failure → Unavailable). It never signs a user out because the API failed.

---

## 13. Tests to port (Vitest + PGlite + Better Auth `testUtils`; RTL; Playwright)

Better Auth 1.7.x ships `testUtils` in `better-auth/plugins` (`ctx.test.createUser / saveUser / login({userId}) → {headers, cookies, token} / getAuthHeaders / deleteUser`, `captureOTP`), and also `better-auth/test` (`getTestInstance`). Add `testUtils()` only to a **test-only** auth instance. Use it for "signed-in as X" setups. For flows whose behaviour **is** the sign-in (magic link, social), drive the real HTTP routes as saas-base does: request a link with an Origin header, read it from the recording mailer, then GET it. Mock social token endpoints by stubbing `globalThis.fetch` for the token URL and returning `{ access_token, id_token: <unsigned JWT with claims>, scope, expires_in, token_type }`. Better Auth decodes the provider id_token without verifying the signature in this flow. Check this again against the installed version.

API integration (port all of these):

- `auth.config.spec` (pure): every case in §2, plus `mcpResourceURL` for `http://localhost:5200`, `https://app.example.com/` and `https://app.example.com/some/path` → `<origin>/api/mcp`.
- `magic-link.spec`: every rule 1–7 and 15 in §12. Also: the Account endpoint shows `signInWith:'email'` and `name:''` after a magic link. X-Real-IP is used. The MailSignin vs MailMember choice. The organization routes are closed.
- `google-signin.spec`: the consent URL and redirect_uri. Origin refusals (6 cases). Callback refusals (4 URLs × 2 fields). Success lands on `/profile`. The name and email come from Google, and `signInWith:'google'`. A denial goes to `/signup?via=google&error=access_denied`. Linking to an existing magic-link user. The encrypted token.
- `microsoft-signin.spec`: the authorize URL uses `common`. Origin refusals. Three unvouched-claim cases create nothing. Four vouched-claim cases succeed. Account linking only when vouched. `verified_primary_email` alone → `account_not_linked`. Without an Azure app → 404, while Google and the link still work.
- `session.guard.spec` → oRPC `requireSession` middleware (six refusal cases).
- `organization-role.guard.spec` → `requireMember` middleware (permissions of owner/admin/member and a custom role, no-org/no-session, removal between requests, handler adds to router).
- `sessions.spec`: revoke-other-sessions.
- `auth-providers.spec`: two cases (`apps/api/src/routes/auth.test.ts` with both providers, `app.test.ts` with none).
- `organizations create/skip spec` and `me.get spec`: every case in §6.2.
- `auth-database.int.spec` (with PGlite): the user and session are persisted with email_verified. A consumed link leaves no verification row. Of two parallel clicks one wins. Deleting the user kills the session. Claude's dynamic client registration is stored (MCP). JWKS.
- `create-organization.int.spec` (now `apps/api/src/organizations/create-organization.test.ts` through Better Auth): the slug equals the name. Numbered slugs. Owner with terms stamped. Skip with no terms. A second org is made and becomes active. A client slug is ignored. personName is applied or kept. `memberOf` returns null for a user without an org (`packages/db/src/data/membership.test.ts`).
- `mail-signin.spec`: four cases.
- Address package specs: `email.spec`, `slug.spec`, `naming.spec` (every example in §4).

Web (Vitest + React Testing Library, with the API mocked via MSW or a fake client):

- `signup.page.spec`: the whole list. Initial copy. Providers shown and hidden (and the divider). Microsoft and Google start with landing `/profile` and disable every button. Refusal alerts for both providers and for a link. Client-side email refusal with aria-invalid. A successful link → Check your email, with the normalized email and no input. Plan carry-over and an invalid plan dropped. Use a different email. API 400 → field error. Retry after failure. The bfcache pageshow re-enable. Pending lock for the link and for Google. Retry after a Google failure. Sign in mode: the landing is `/signin` for both the link and Google.
- `http-auth.api.spec` → the auth client wrapper: request bodies with absolute callback/errorCallback URLs (including the plan carry-over, the connector resume and the via param). 400 → EmailRefusedError, while 500 is a different error. The redirect only happens after the response. A Google start failure does not redirect. Providers are asked once, with the fallback `{google:true,microsoft:false}` and a retry after failure. Session parsing: null, and the name defaults to `''`. A network error rejects. sign-out and revoke-other-sessions.
- `profile.page.spec`: the heading, and no other inputs. Next is disabled until the terms are ticked. Next sends `{name, organization}` trimmed and goes to `/app`. A blank name is allowed. Skip sends nothing and goes to `/app`. Plan → checkout. A 409 with an existing org continues. The Terms/Privacy dialog does not tick the box and keeps its text while closing. Pending lock. Retry after a Skip failure.
- `lib/guards.test.ts`: every case in §8 for `/profile`, `/signup` and `/signin` (visitor, no org with plan carry-over, member to `/app` or checkout, refused-sign-in URLs), and any failure but a 401 (network, 403, 503) → `/unavailable?next=`.
- Unavailable page (in `components/shell/pages.test.tsx`): Try again once the API answers, `next` sanitising.
- `app.routes.spec`: `/` → `/signin`. `/app` with no org → `/profile`. Unknown `/app/x` → `/app`.
- `api-proxy.spec`: three cases (Playwright `e2e/proxy.spec.ts`, through the real web server).

Playwright e2e (PGlite + Mailpit, no Docker):

1. Get started → signup → read the link from Mailpit → open it → Profile → Skip → Home.
2. Profile → Next with terms → Home, and `me` shows the org name and the user's name.
3. Returning user: `/signin` → link → `/app`. Then `/` and `/signin` redirect to `/app`.
4. Used link → `/signup?error=INVALID_TOKEN` shows the refusal alert.
5. `/signup?plan=team&cycle=monthly` → link → Profile → Skip → `/app/checkout?plan=team&cycle=monthly`.
6. Invalid email shows the inline error, and nothing is sent.
7. API down (stop the API or route-abort `/api/rpc/*`) on `/app/settings` → Unavailable → Try again once it is back.

---

## 14. Dependencies (install with pnpm at their latest versions)

api: `better-auth`, `@better-auth/oauth-provider`, `hono`, `@orpc/server`, `@orpc/contract`, `zod`, `drizzle-orm`, `drizzle-kit`, `pg` (or `postgres`), `@electric-sql/pglite`, `resend` (or a plain fetch).
web: `better-auth` (`better-auth/react` client), `@orpc/client`, `@orpc/tanstack-query`, `@tanstack/react-query`, `@tanstack/react-router`, `@tanstack/react-start`, `i18next`, `react-i18next`, `sonner`, shadcn components (button, input, label, checkbox, dialog, alert, sonner, card).
test: `vitest`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`, `msw`, `@playwright/test`.
