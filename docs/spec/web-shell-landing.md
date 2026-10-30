# Spec: web shell, signed-in navigation, Home, Welcome, i18n, stale chunks, landing

Area: `web-shell-landing`. Source studied: `saas-base` (`apps/web/src/app/{app.ts,app.html,app.config.ts,app.routes.ts,web-config.ts}`,
`shared/*`, `signed-in/{shell,app-menu,home,welcome,current-user.state.ts,plan-access.ts}`, `unavailable/*`,
`edge/api-proxy.ts`, `public/i18n/*.json`, `apps/landing/src/*`, README "Make it yours") and every spec next to them.

This file is self-contained: implement from it, do not re-read saas-base. Port **features and screens, not styles**:
build every screen with stock shadcn/ui components and the default shadcn theme. Code, comments and docs in English.

Cross-references to other areas (they own their screens; this area only routes to them): `auth-onboarding`
(`/signin`, `/signup`, `/profile`, `/join/$invitationId`), `oauth-mcp` (`/oauth/signin`, `/oauth/consent`),
`settings` (`/app/settings`, `/app/members`, `/app/billing`), `billing-plans` (`/pricing`, `/app/plans`, `/app/checkout`).

---

## 1. Product configuration ("Make it yours")

One place to rebrand. In arrakit:

| Constant | saas-base value | arrakit location | Used by |
| --- | --- | --- | --- |
| `APP_NAME` | `'SaaS'` | `apps/web/src/config.ts` (and the emails package brand) | Page titles, wordmark, copy that says the product name |
| `SITE_URL` | `'https://example.com'` | `apps/web/src/config.ts`, read from `VITE_SITE_URL` with that default | Wordmark link outside `/app`, Unavailable's "Home" (forbidden) |
| App origin used by the landing | `https://app.example.com` | `apps/landing`, from `PUBLIC_APP_URL` | Landing links (Pricing, Sign in, Get started) |

README "Make it yours" checklist, to be reproduced in arrakit's README/AGENTS.md:
- Product name: `APP_NAME` in the web config and in the emails brand file; texts in `apps/web/src/i18n/locales/*.json`
  (or wherever arrakit keeps them), `apps/landing`, and the icons in `apps/web/public` and `apps/landing/public`.
- Plans and prices: the shared `plans` package, then the Stripe prices script.
- The product itself: an API module (oRPC router under `apps/api`), its tables in the Drizzle schema (each with
  `organization_id`, reached only through the tenancy helper `forOrganization()`), its screens under the `/app`
  route tree, and its MCP tools file.

Note: product copy says "SaaS" in many keys (e.g. `unavailable.unreachableTitle` = "Couldn't reach SaaS."). In arrakit
replace "SaaS" by the product name ("Arrakit") in the locale files, or interpolate `{{appName}}`; tests below quote the
saas-base strings with "SaaS" – substitute the arrakit name.

---

## 2. Root layout (`apps/web/src/routes/__root.tsx`)

Equivalent of saas-base `App` (`app.ts` + `app.html`).

What it renders, on **every** screen:
1. A single `<header>` holding the **wordmark** (the product name `APP_NAME`; optionally a round mark with the
   name's first letter before it). Exactly one `<header>` exists on any screen, signed-in screens included
   (the signed-in shell must not add a second one).
2. The router `<Outlet />`.
3. The global toaster (shadcn `Sonner` `<Toaster />`), mounted once.

Wordmark link rule (tested):
- When the current path's **first segment is `app`** (`/app`, `/app/anything/...`, `/app?tab=1`): the wordmark is an
  internal link to `/app` (Home).
- Anywhere else (`/`, `/pricing`, `/signin`, `/apply`, `/unavailable`...): it is a plain `<a href={SITE_URL}>` to
  the website (full page navigation).
- In both cases it has `aria-label` = `t('app.homeLabel')` ("Home" / "Inicio").
- Note `/application` must NOT count as in-app (segment-based, not prefix-based).

Document shell: `<html lang>` follows the active language (see §6). `<title>` initially `APP_NAME`. Favicon
(`favicon.svg`) and `apple-touch-icon.png` in `apps/web/public` (generic placeholder icons are fine). Also keep
`apps/web/public/icons/google.svg` and `icons/microsoft.svg` (used by the sign-in buttons in the auth area).

### Page titles
Every route sets `<title>` = `` `${APP_NAME} · ${t('app.titles.<key>')}` `` (TanStack `head()` per route, in the
language active at navigation time). Keys and routes:

| Route | Title key | en | es |
| --- | --- | --- | --- |
| `/signin` | `app.titles.signIn` | Sign in | Iniciar sesión |
| `/pricing` | `app.titles.pricing` | Pricing | Precios |
| `/unavailable` | `app.titles.unavailable` | Unavailable | No disponible |
| `/join/$invitationId` | `app.titles.joinYourOrganization` | Join your organization | Únete a tu organización |
| `/oauth/signin` | `app.titles.signInToConnect` | Sign in to connect | Inicia sesión para conectar |
| `/oauth/consent` | `app.titles.connect` | Connect | Conectar |
| `/signup` | `app.titles.whereToWrite` | Where to write | Dónde escribir |
| `/profile` | `app.titles.yourOrganization` | Your organization | Tu organización |
| `/app` (index) | `app.titles.home` | Home | Inicio |
| `/app/settings`, `/app/members`, `/app/billing` | `app.titles.settings` | Settings | Ajustes |
| `/app/plans` | `app.titles.plans` | Plans | Planes |
| `/app/checkout` | `app.titles.checkout` | Checkout | Pago |
| `/app/welcome` | `app.titles.welcome` | Welcome | Bienvenida |

---

## 3. Route table (whole web app)

The app has **no front page of its own**: the website (landing) is the front page.

| Path | Behaviour | Guard | Owner area |
| --- | --- | --- | --- |
| `/` | Redirect to `/signin` | – | this |
| `/start` | Redirect to `/signup` (the landing's "Get started" links here) | – | this |
| `/new` | Redirect to `/signup` (legacy link) | – | this |
| `/signin` | Sign-in screen (same component as signup, "returning" mode) | `skipWhenSignedIn` (signed-in person goes to `/app`, or `/profile` without organization) | auth-onboarding |
| `/signup` | Get-started screen | `skipWhenSignedIn` | auth-onboarding |
| `/profile` | Create organization | `requireAccount` | auth-onboarding |
| `/pricing` | Public price list, no session | – | billing-plans |
| `/unavailable` | API failure screen (§5) | – (public) | this |
| `/join/$invitationId` | Join an organization from an invite link | – (public) | auth-onboarding |
| `/oauth/signin` | Connector sign-in (no `skipWhenSignedIn`) | – | oauth-mcp |
| `/oauth/consent` | Connector consent | – | oauth-mcp |
| `/app` | Signed-in shell (§4) + Home (§7) | `requireUser` | this |
| `/app/settings` | Settings, section `account` | `requireUser` | settings |
| `/app/members` | Same Settings page, section `members` | `requireUser` | settings |
| `/app/billing` | Same Settings page, section `billing` | `requireUser` | settings |
| `/app/plans` | Plans | `requireUser` | billing-plans |
| `/app/checkout?plan=&cycle=` | Checkout | `requireUser` + `canCheckout` | billing-plans |
| `/app/welcome[?session_id=]` | Welcome (§8) | `requireUser` + `onPaidPlan` | this |
| anything else (`**`) | Not found page (404, "Back home" → `/`) | – | this |

Unknown paths under `/app` (e.g. `/app/booking`, `/app/booked`) render the same not-found page inside the signed-in
shell (still behind `requireUser`), keeping the URL. Implement as a catch-all route under `/app`. Test:
`/app/booking` and `/app/booked` keep their URL and show the not-found h1 with the account menu.

Implementation notes for TanStack Start:
- File routes: `routes/index.tsx` (redirect), `routes/start.tsx`, `routes/new.tsx` (redirects in `beforeLoad`),
  `routes/app.tsx` (layout with `beforeLoad` = `requireUser`), `routes/app/index.tsx`, `routes/app/welcome.tsx`, etc.
- Settings: one component reused by three routes, each passing its `section` (`account` | `members` | `billing`).
- Lazy-load route components (code splitting, `autoCodeSplitting`) — that is what makes stale chunk handling (§9)
  relevant.
- Use view transitions on navigation if trivially available (`defaultViewTransition: true`); optional.

---

## 4. Signed-in shell (`/app` layout route)

### 4.1 `requireUser` guard (beforeLoad of `/app`)
Loads the signed-in person **once** (`me.get`, §10) before any `/app/*` screen renders, and stores it in the
current-user state (TanStack Query cache key `['me']` via `orpc.me.get.queryOptions()`, plus helpers). Outcomes:

| API result | Navigation |
| --- | --- |
| OK with `organization != null` | Allow. Before allowing, if `me.language !== activeLanguage`, **switch the UI language to `me.language` and wait for it** (§6) so the first signed-in render is already in the account language. |
| OK with `organization === null` (also `role`/`plan`/`seats` null) — person in no organization, never joined or removed | Redirect to `/profile` |
| `UNAUTHORIZED` (401) | Redirect to `/signin` |
| `FORBIDDEN` (403) | Report error (console/logger), redirect to `/unavailable?reason=forbidden` |
| Any other failure (500, network down, timeout) | Report error, redirect to `/unavailable?next=<requested URL>` (URL-encoded full path + search, e.g. `/unavailable?next=%2Fapp%2Fsettings`) |

A 403 or a 5xx is **never** treated as a sign-out.

### 4.2 Current-user state (`useCurrentUser()` hook)
Derived from the `me` query:
- `user: Me | null`
- `role: 'owner' | 'admin' | 'member' | null`
- `isAdmin = role === 'owner' || role === 'admin'` (owners and admins invite, remove, pay)
- `isOwner = role === 'owner'`
- `planLabel = t('pricing.plan.<plan>')` (Free / Pro / Team / Internal; es: same words), `''` when none
- `reload()`: refetch `me` (a count/setting moved behind the screen's back); failure keeps the loaded person and only reports the error.
- `patch(fn)`: optimistic local update after a save the API already accepted (e.g. Settings renames the person → menu shows new name at once). Use `queryClient.setQueryData`.
- `signedOut()`: clear the `me` cache (`queryClient.removeQueries`/`clear`).
- Before anyone signs in: `isAdmin` and `isOwner` are false.

Display name rule (`Me.name`): Better Auth's `user.name` trimmed; when blank, the local part of the email
(`ana@acme.com` → `ana`). Apply in the API mapper or the client, consistently.

### 4.3 Shell layout
Renders, on the same row as the root header's wordmark (right-aligned), only when the person is loaded:
- A `<nav aria-label={t('shell.account')}>` ("Account" / "Cuenta") containing:
  - **Usage label** `t('shell.usage', { organization, plan: planLabel })` → "Acme · Pro". Visible from the `lg`
    breakpoint only (`hidden lg:inline`); tests read it from the DOM text, so keep it in the DOM.
  - The **app menu** (§4.4).
- Then the `<Outlet />` with the signed-in screens.

### 4.4 App menu (account menu)
A **disclosure**, not an ARIA menu (its entries are links). Build with shadcn `DropdownMenu` or `Popover`, but the
behaviour below must hold (if using Radix DropdownMenu, links must be `asChild` `<Link>`s and tests adapted to
`role="menuitem"`; a `Popover` is closest to the original).

Trigger button:
- `aria-label={t('appMenu.accountMenu')}` ("Account menu" / "Menú de la cuenta"), `aria-controls="app-menu"`,
  `aria-expanded` = `"true"|"false"`.
- Content: the person's **initial** = first character of the trimmed display name, uppercased (`"Ana Ruiz"` → `"A"`).
  Rendered as a round avatar (shadcn `Avatar` + `AvatarFallback`).

Panel (`id="app-menu"`), only in the DOM while open:
1. Header block: person's name ("Ana Ruiz") and `"<organization> · <planLabel>"` ("Acme · Pro").
2. List `aria-label={t('appMenu.yourOrganization')}` ("Your organization"):
   - `Home` → `/app` (`appMenu.home`)
   - `Settings` → `/app/settings` (`appMenu.settings`)
   - `Members` → `/app/members` (`appMenu.members`) — **admins only** (owner or admin)
   - `Billing` → `/app/billing` (`appMenu.billing`) — **admins only**
3. Theme switcher (`appMenu.theme`, "Theme"): a single-choice toggle group Light / Dark / System
   (`appMenu.themeLight|themeDark|themeSystem`), default System.
4. List `aria-label={t('appMenu.more')}` ("More"):
   - Button `Sign out` (`appMenu.signOut`).

Behaviour:
- Click on trigger toggles open/closed.
- Click on any link navigates **and closes** the menu.
- `Escape` closes it (only when open) and **returns focus to the trigger button**.
- A click anywhere outside the menu host closes it.
- The name shown reacts immediately to `patch()` (no refetch).
- **Theme**: `next-themes` (`ThemeProvider` in the root document) toggles the `.dark` class on `<html>`, follows
  `prefers-color-scheme` on System and remembers the choice in `localStorage['arrakit.theme']`. Picking a theme
  keeps the menu open.
- **Sign out**: closes menu, calls Better Auth `authClient.signOut()` (`POST /api/auth/sign-out`). On success: clear
  current user (`signedOut()`), navigate to `/signin`. On failure: error toast `t('appMenu.notSignedOut')`
  ("Couldn't sign you out. Try again.") and stay.

---

## 5. Unavailable screen (`/unavailable`)

Public route. Two modes from the query string:

**`?reason=forbidden`** (account recognised but refused; retrying will not help):
- h1 `unavailable.forbiddenTitle` "Your account can't open SaaS right now." / "Tu cuenta no puede abrir SaaS ahora mismo."
- p `unavailable.forbiddenBody` "Ask your organization's admin to check your access." / "Pide al administrador de tu organización que revise tu acceso."
- Ghost link button `unavailable.home` "Home" → `SITE_URL` (full navigation).
- **No** "Try again" button.

**Otherwise** (API unreachable / failed):
- h1 `unavailable.unreachableTitle` "Couldn't reach SaaS." / "No se ha podido conectar con SaaS."
- p `unavailable.unreachableBody` "Nothing is lost. Try again in a moment." / "No se ha perdido nada. Inténtalo de nuevo en un momento."
- Button `unavailable.tryAgain` "Try again" / "Reintentar": navigates to `next`, which re-runs that route's guards.
  If the API is still down, the guard sends the person back here with the same `next` (URL stays
  `/unavailable?next=%2Fapp%2Fsettings`). Once the API answers, they land on the wanted screen.

`next` sanitising (security, open-redirect guard): accept `next` only if it matches
`^\/(?:app|signup|profile|reading)(?:[/?#]|$)` (keep `reading` for parity, or drop it; it is unused).
Otherwise use `/app`. Rejected examples (all go to `/app`): `/pricing`, `https://evil.example/app`,
`//evil.example/app`, `/application`. Accepted: `/app`, `/app/settings`, `/app?x=1`, `/profile`, `/signup`.

The onboarding guards (`skipWhenSignedIn`, `requireAccount`, auth-onboarding area) also send API failures here with
`next` = their own URL.

---

## 6. i18n (en / es)

Library: `i18next` + `react-i18next`. Languages: `en` (source and fallback) and `es`.

Text files: reuse saas-base `apps/web/public/i18n/en.json` and `es.json` verbatim as the key tree (top-level
namespaces: `app`, `appMenu`, `auth`, `checkout`, `confirmDelete`, `join`, `oauth`, `onboarding`, `plans`, `pricing`,
`profile`, `settings`, `shared`, `shell`, `signup`, `unavailable`, `welcome`, `home`). Interpolation syntax
`{{name}}` is already i18next-compatible. Keep `en` and `es` key sets identical (add a parity unit test).

Loading:
- `en` is **bundled** (imported JSON) so the first render never waits for a request and never shows a raw key.
- `es` is lazy-loaded (dynamic import or fetch of `/locales/es.json`) the first time it is used.
- A switch **loads the target language first, then flips the active language**: nothing ever renders a key.
- All mounted screens re-render on switch with **no page reload** (`useTranslation` does this). Helper `tr(key, params)`
  for non-React code (toasts, titles) reads the active language at call time.
- Missing key in `es` → fall back to `en` text.

Language selection (`Language` service: `use(lang)`, `initial()`):
- `initial()`: the language stored in this browser (`localStorage['arrakit.lang']`, saas-base used `saas.lang`) if it is
  `en`/`es`; else the browser's `navigator.language.slice(0, 2)` if supported (`es-ES` → `es`); else `en` (`fr-FR` → `en`).
- On app start (client): `use(initial())`.
- `use(lang)`: no-op if already active; else load, activate, set `document.documentElement.lang = lang`, and store it
  in `localStorage['arrakit.lang']`. Storage access is wrapped in try/catch (blocked storage must not break anything).
- Once signed in, the **account language wins**: `requireUser` switches to `me.language` before rendering (§4.1).
- Settings → Account (settings area) saves `language` via `me.updateAccount`; on success it calls `use(account.language)`
  so every screen switches immediately, no reload.
- SSR note (TanStack Start): `localStorage`/`navigator` exist only in the browser. Either render the app client-only
  (SPA mode) or render `en` on the server and switch on hydration; never read storage during SSR.

Dates/counts copy helpers (from the shared emails `copy` module): `initial(nameOrEmail)` = first char trimmed and
uppercased; `firstName(name)`; `listing(items, lang)` ("a, b and c" / "a, b y c"); day formatters take the active language.

---

## 7. Home (`/app` index)

The first screen once signed in; placeholder for the product's own dashboard.

Content (only when the person is loaded):
- h1 `home.title` → "Hi, {{name}}." → "Hi, Ana Ruiz." (es "Hola, {{name}}.")
- p `home.organization` → "{{organization}} is on {{plan}}. This is where your product starts." → contains "Acme is on Pro."
  (es "{{organization}} está en {{plan}}. Aquí empieza tu producto.")
- Actions (links styled as buttons):
  - `home.settings` "Settings" → `/app/settings` (primary) — everyone
  - `home.members` "Members" → `/app/members` — admins only
  - `home.plans` "Plans" → `/app/plans` — admins only
- A `member` sees only Settings.

---

## 8. Welcome (`/app/welcome`)

Shown after a successful Stripe Checkout (Checkout's return URL is `/app/welcome?session_id={CHECKOUT_SESSION_ID}`).

Guard `onPaidPlan` (after `requireUser`):
- Organization plan ≠ `free` → allow.
- Plan is `free` and **no** `session_id` query param → redirect `/app/plans` (nothing to welcome to).
- Plan is `free` **with** `session_id` → Stripe's webhook may arrive after the browser: re-fetch `me` every
  **1 second, up to 15 tries** (`PAID_WAIT_TRIES = 15`, first try immediately). As soon as the plan is not `free`,
  allow (and the refreshed `me` is in the cache). After 15 tries still free, or on any fetch error → `/app/plans`.

Content:
- A check icon in a round badge (lucide `Check`).
- h1: `welcome.titleLead` + " " + `welcome.titleRest` with `{{plan}}` = planLabel → "Welcome to Pro." / "Welcome to Team."
  (es "Te damos la bienvenida a Pro."). Tests match the h1 full text "Welcome to Pro.".
- p `welcome.body` (key used by the template; **missing from both JSON files** in saas-base – add it, e.g.
  en "Your organization is all set. Everyone in it has the new plan now." / es "Tu organización está lista. Todos sus miembros tienen ya el nuevo plan.").
- Primary button-link `welcome.goHome` "Go to the app →" / "Ir a la app →" → `/app`.
- Footer line: `welcome.receiptSent` + link `welcome.settings` "Settings" → **`/app/billing`** + `welcome.receiptEnd` (".").
  ("Receipt sent to your email. Manage your plan anytime in Settings.")

---

## 9. Stale chunk recovery

Problem: each deploy renames lazy chunks; a tab opened before the deploy (or a CDN that answers a missing chunk with
`index.html`, cached hours) gets a failed dynamic import when navigating. Recovery: fetch the chunk again bypassing the
HTTP cache, then hard-load the target URL **once**.

`recoverFromStaleChunk(error: unknown, targetUrl: string, win: Window): Promise<boolean>` (pure, testable):
1. Message = `error.message` if `Error`, else `String(error)`. If it does not match
   `/dynamically imported module|Importing a module script failed/i` (Chrome/Firefox, then Safari) → return `false`, do nothing.
2. Loop guard in `sessionStorage['arrakit:stale-chunk-retried-at']`: if `now - stored < 10_000` ms → return `false`
   (a chunk that fails again right after is not stale; let it fail). Else store `now`.
   If `sessionStorage` throws (blocked) → return `false` without reloading (no loop guard, no retry).
3. Extract the chunk URL `/https?:\/\/\S+?\.js/` from the message; if found, `await win.fetch(chunk, { cache: 'reload' })`,
   ignoring any rejection. Safari's message names no URL → skip the fetch.
4. `win.location.assign(new URL(targetUrl, win.document.baseURI).href)`; return `true`. The fetch must happen before the assign.

Wiring in arrakit (React/Vite/TanStack): listen to Vite's `vite:preloadError` window event (call
`event.preventDefault()` when recovered) and to router load errors (route `errorComponent`/`onCatch` for lazy route
components), passing the navigation's target href.

---

## 10. API endpoints used by this area

### `me.get` (oRPC, `POST /api/rpc/me/get` or as the oRPC router defines it)
- Auth: requires a live Better Auth session (oRPC middleware reading `auth.api.getSession({ headers })`); none → `UNAUTHORIZED` (401).
- Input: none.
- Output (Zod):
  ```ts
  {
    email: string;
    name: string;               // Better Auth user.name; may be '' (client falls back to email local part)
    language: 'en' | 'es';
    organization: { id: string; name: string; slug: string; plan: Plan } | null;
    role: 'owner' | 'admin' | 'member' | null;   // null with no organization
    plan: Plan | null;                           // organization.plan
    seats: number | null;                        // PLAN_OFFERS[plan].seats: free 1, pro 3, team 10, internal 100
  }
  ```
  `Plan = 'free' | 'pro' | 'team' | 'internal'`.
- Logic: membership lookup of the session user (one organization per person); with none → all organization fields null.
- Errors: `UNAUTHORIZED`. A `FORBIDDEN` (e.g. banned user) must be propagated as 403 so the web shows the forbidden screen.
- Client mapping: if `organization|role|plan|seats` is null → `NoOrganization` (guard → `/profile`).

### Better Auth (mounted at `/api/auth/*`)
- `POST /api/auth/sign-out` — app menu Sign out (via `authClient.signOut()`).
- (Other auth endpoints belong to auth-onboarding.)

### Referenced, owned by other areas
- `me.updateAccount` (settings) — language switch trigger.
- `organization`/billing endpoints for `/app/plans`, `/app/billing`.

Error toast rule for **all** screens (`useApiMutation` hook, shared): on a failed call, report the error (logger), show
an error toast, then run the screen's own `onError` rollback. The toast says the API's own message when the error is a refusal
(`BAD_REQUEST` 400 or `FORBIDDEN` 403) whose message is a non-blank string, otherwise the screen's fallback text.
5xx, network failures (status 0) and 400 without a message use the fallback. A screen may pass its own `refusal`
reader (any 4xx, payment statuses, 409 only, or none). `run()` ignores a second call while the first is in flight. The same toast (same message+variant)
never stacks: showing it again restarts its timer (Sonner: pass a stable `id` = message). Durations: info 3 s, error 6 s.
`saveOnChange` helper (settings autosave, no Save button): saves each valid change **sequentially in order**; on failure
it reports, toasts the fallback, calls `failed()` to restore server values, and **drops the queued changes** made
before the failure; a change made after the failure is saved normally. (Implement with a promise queue + generation counter.)

---

## 11. Data

Tables read (owned by auth/organizations areas; Better Auth schema via Drizzle):
- `user`: `id`, `name`, `email`, `language` (text, `'en' | 'es'`, not null, default `'en'`, check constraint; declared
  as a Better Auth `additionalFields` entry).
- `member`: `user_id`, `organization_id`, `role` (`owner|admin|member`).
- `organization`: `id`, `name`, `slug`, `plan` (`free|pro|team|internal`, default `free`; additional field).
- `session`: Better Auth session (cookie). No new tables in this area.

Jobs: none. Emails: none in this area (Welcome only says a receipt was emailed; the billing webhook sends it).
External integrations: Stripe only indirectly (Welcome waits for the webhook to move the plan).

---

## 12. Environment variables

| Var | App | Default | Purpose |
| --- | --- | --- | --- |
| `VITE_SITE_URL` | web | `https://example.com` | Website URL for wordmark outside `/app` and Unavailable's Home |
| `VITE_APP_NAME` (optional; or constant) | web | `Arrakit` | Product name |
| `API_ORIGIN` / dev proxy target | web | `http://localhost:5000` | Vite dev server proxies `/api` **and** `/.well-known` (OAuth metadata for MCP) to the API |
| `PUBLIC_APP_URL` | landing | `https://app.example.com` | Host of Pricing / Sign in / Get started links |
| `PUBLIC_SITE_URL` (Astro `site`) | landing | `https://example.com` | Canonical, og:url, og:image, sitemap |
| `VITE_ANALYTICS_SRC` + `VITE_ANALYTICS_DOMAIN` | web | unset (off) | Plausible-compatible script (`defer`, `data-domain`) in the root head |
| `PUBLIC_ANALYTICS_SRC` + `PUBLIC_ANALYTICS_DOMAIN` | landing | unset (off) | Same script on every landing page (`components/Analytics.astro`) |

Production proxy (saas-base `edge/api-proxy.ts`, Cloudflare Pages Functions): web and API must be **one site** so the
Better Auth cookie is first-party; `BETTER_AUTH_URL` = web origin. If arrakit deploys web separately, port
`proxyToApi(request, apiOrigin, send = fetch)`: forwards path+query to `apiOrigin`, keeps method/headers/cookie/origin,
sets `x-forwarded-host` (original host), `x-forwarded-proto` (`https`), `x-forwarded-for` from `cf-connecting-ip` when
present, passes the body for non-GET/HEAD (`duplex: 'half'`), and uses `redirect: 'manual'` so OAuth redirects (Google
consent) reach the browser. Routes: `/api/*`, `/.well-known/oauth-authorization-server/*`,
`/.well-known/oauth-protected-resource/*`. In TanStack Start this can be a server route handler instead.

---

## 13. Landing (`apps/landing`, Astro)

Static site, the product's **front page**. Port content and links; styling with Tailwind (default look) is fine.

### `/` (`src/pages/index.astro`)
- `<html lang="en">`, `<title>` = product name.
- Head: favicons (`/favicon.ico` 48x48 — a real file, not data URI, for Google's favicon crawler; `/favicon.svg`;
  `/favicon-96x96.png`; `/apple-touch-icon.png`), `meta description` ("One sentence on what the product does, for
  search results."), `canonical` = `${SITE_URL}/`, Open Graph (`og:type=website`, `og:url`, `og:title`,
  `og:description` "One sentence on what the product does, for link previews.", `og:image=${SITE_URL}/og-card.png`
  1200x630), `twitter:card=summary_large_image`.
- **Header**: brand block (product name + motto "Nothing in excess.") and nav with two links:
  - "Pricing" → `${APP_URL}/pricing`
  - "Sign in" → `${APP_URL}/signin`
- **Main**: h1 claim in two lines: "**Your product** in one line, / and **the reason** people need it." (bold on
  "Your product" and "the reason"); CTA button-link "Get started" with a right-arrow icon → `${APP_URL}/start`.
- **Footer** (`components/Footer.astro`, shared): "© <product name>", "Terms" → `/terms`, "Privacy" → `/privacy`.
- Responsive: stacks/shrinks under 640 px.
- English only (no i18n on the landing in saas-base).

### 404 (`src/pages/404.astro`)
- `meta robots=noindex`, title "Page not found · <product name>", favicons, logo mark, h1 "This page does not exist.",
  link "Back home" → `/`. Must be served with HTTP 404 for unknown paths (static hosts use `404.html`).

### Legal pages (`src/pages/terms.astro`, `src/pages/privacy.astro`)
- Layout `src/layouts/LegalPage.astro`: title "<page> · <product name>", canonical, product name linking home, "Last
  updated" line, shared footer. Content is a template marked "replace before launch". The web's onboarding links here
  (`TERMS_URL`, `PRIVACY_URL`).

### Static files (`public/`)
- `robots.txt`: allow everything, AI crawlers included (deliberate: marketing site; keep the explanatory comment),
  `Sitemap: ${SITE_URL}/sitemap.xml`.
- `sitemap.xml` with `${SITE_URL}/` (or `@astrojs/sitemap`).
- `og-card.png` (1200x630), `favicon.ico`, `favicon.svg`, `favicon-96x96.png`, `apple-touch-icon.png` (copy from
  saas-base `apps/landing/src/` or generate placeholders).

---

### Empty states (web)
- Every "nothing here yet" in the web uses `EmptyState` (`components/shell/empty-state.tsx`, over shadcn `Empty`):
  lucide icon + title, optional description and action. Used by Settings > Billing invoices and top-ups.

---

## 14. Edge cases and business rules (from tests)

1. Exactly one `<header>` with the wordmark on any screen, signed-in included.
2. Wordmark → `/app` for paths whose first segment is `app` (incl. query); → `SITE_URL` otherwise (`/`, `/pricing`, `/apply`).
3. `/` → `/signin` when signed out (the front page is the website).
4. Signed-in with org: shell shows "Acme · Pro" and trigger text "A"; `aria-expanded="false"` initially, `"true"` when open.
5. Open menu shows "Ana Ruiz", "Acme · Pro", links Home/Settings/Members/Billing (owner/admin), button Sign out.
6. Member's menu: no "Members", no "Billing", has "Settings". Owner's: has both.
7. Escape and outside click close the menu; link click navigates and closes; Home link from `/app/settings` goes to `/app`.
8. Sign out → `/signin`.
9. `me` 401 → `/signin`; 500 → `/unavailable?next=%2Fapp` with h1 "Couldn't reach SaaS." and the error reported;
   403 on `/app/settings` → `/unavailable?reason=forbidden` with h1 "Your account can't open SaaS right now.".
10. Signed in, no organization (or removed) → `/profile`, never into `/app`.
11. Unavailable: Try again returns to `next` once the API answers; stays (same URL) while still down; invalid `next` → `/app`;
    `next=/profile` → `/profile`; forbidden mode has no Try again and contains "Ask your organization's admin".
12. Home: "Hi, Ana Ruiz.", "Acme is on Pro."; admin sees Members and Plans links; member sees neither; Settings → `/app/settings`.
13. Welcome: "Welcome to Pro." / "Welcome to Team."; free without `session_id` → `/app/plans`; "Go to the app →" → `/app`;
    "Settings" → `/app/billing`; free with `session_id` polls up to 15 s.
14. Menu → Settings/Members/Billing each show h1 "Settings" and an h2 section heading "Account"/"Members"/"Billing" at
    `/app/settings`, `/app/members`, `/app/billing`.
15. Language: switching updates already-rendered texts and `<html lang>`, and is remembered; browser `es-ES` → es;
    `fr-FR` → en; account language applied before the first signed-in render.
16. Stale chunk: see §9 cases (Chrome message with URL; Safari message without; fetch failing still reloads; once per 10 s;
    other errors ignored; blocked sessionStorage → no reload).
17. Copy hygiene: no screen or locale text may promise that a deletion can be undone/recovered (regex
    `/\brecoverable\b|\brecover(ed)? (until|for)\b|purged after|\brecuperables?\b/i` must not match any source or locale file).
18. Users the API returns with blank `name` display as their email local part.

---

## 15. saas-base tests worth porting (as Vitest + RTL / Playwright)

| saas-base spec | Port as | Notes |
| --- | --- | --- |
| `app.spec.ts` | RTL: root layout | header + wordmark + outlet; wordmark href per URL (it.each) |
| `app.routes.spec.ts` | RTL/router tests | no-org → `/profile`; `/` → `/signin`; `/app/booking|booked` → not-found page; connector routes open their pages |
| `signed-in/shell/shell.spec.ts` | RTL | all 11 cases (menu content, roles, Escape/outside click, navigation, sign out, 401/500/403 routing) |
| `signed-in/home/home.page.spec.ts` | RTL | add the missing "member sees neither" assertion |
| `signed-in/welcome/welcome.page.spec.ts` | RTL | plus a fake-timers test for the 15-try polling |
| `signed-in/current-user.state.spec.ts` | Vitest | role → isAdmin/isOwner table; account language applied before set; neither before sign-in |
| `signed-in/plan-access.spec.ts` | Vitest | `checkoutChoice`/`plansAbove` (shared with billing-plans) |
| `unavailable/unavailable.page.spec.ts` | RTL | flaky API fake; `next` sanitising it.each |
| `signed-in.flow.spec.ts` | Playwright e2e (PGlite + seeded user via Better Auth test utils) | one header; menu reaches Settings/Members/Billing with right h2; plan switch flow (billing area) |
| `shared/i18n.spec.ts` | Vitest | switch + remember + `<html lang>`; browser language; fallback en |
| `shared/stale-chunk.spec.ts` | Vitest | all 6 cases verbatim (pure function with fake `win`) |
| `shared/api-call.spec.ts` | Vitest/RTL | refusal message for 400/403; fallback for 5xx/0/no message; saveOnChange ordering, drop-after-failure, save-after-failure |
| `signed-in/no-recovery-copy.spec.ts` | Vitest | scan `apps/web/src` + locale files |
| `edge/api-proxy.spec.ts` | Vitest | only if the production proxy is ported |
| new | Vitest | `en`/`es` locale key parity |
| new | Playwright | landing: links point to `${APP_URL}/pricing`, `/signin`, `/start`; 404 page |
| `template-hygiene.spec.ts` | **skip** | DaisyUI/style-specific |

Test fixtures used throughout: person "Ana Ruiz" `ana@acme.com`, organization "Acme" (slug `acme`), plan `pro`, role
`owner` by default.
