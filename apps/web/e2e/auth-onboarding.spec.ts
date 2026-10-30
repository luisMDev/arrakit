import { type Page, expect, test } from '@playwright/test'

import { WEB_ORIGIN } from './origins'

const uniqueEmail = (who: string) =>
  `${who}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@acme.test`

async function linkFor(page: Page, email: string) {
  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/dev/outbox?to=${encodeURIComponent(email)}`)
      return ((await res.json()) as unknown[]).length
    })
    .toBeGreaterThan(0)
  const res = await page.request.get(`/api/dev/outbox?to=${encodeURIComponent(email)}`)
  const [mail] = (await res.json()) as { text: string }[]
  const link = mail?.text.match(/https?:\/\/\S+\/api\/auth\/magic-link\/verify\S+/)?.[0]
  expect(link).toBeTruthy()
  return link!
}

async function askForLink(page: Page, email: string) {
  await page.getByRole('textbox', { name: 'Work email' }).fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Check your email.' })).toBeVisible()
  await expect(page.getByText(`We sent a sign-in link to ${email}.`)).toBeVisible()
  return linkFor(page, email)
}

test('a new person signs up with a magic link, skips Profile and lands on Home', async ({
  page,
}) => {
  const email = uniqueEmail('new')
  await page.goto('/start')
  await expect(page).toHaveURL(/\/signup$/)
  await expect(page).toHaveTitle('Arrakit · Where to write')
  const link = await askForLink(page, email)
  expect(new URL(link).searchParams.get('callbackURL')).toBe(`${WEB_ORIGIN}/profile`)

  await page.goto(link)
  await expect(page).toHaveURL(/\/profile$/)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Tell us about your organization.' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Skip' }).click()
  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByRole('heading', { level: 1, name: /^Hi/ })).toBeVisible()
})

test('Profile Next creates the organization with the terms and the person name', async ({
  page,
}) => {
  const email = uniqueEmail('next')
  await page.goto('/signup')
  await page.goto(await askForLink(page, email))
  await expect(page).toHaveURL(/\/profile$/)

  const next = page.getByRole('button', { name: 'Next' })
  await expect(next).toBeDisabled()
  await page.getByRole('textbox', { name: 'Your name' }).fill('Ana Ibarra')
  await page.getByRole('textbox', { name: 'Organization' }).fill('Seaya Ventures')
  await page.getByRole('checkbox', { name: 'I agree to the' }).click()
  await next.click()
  await expect(page).toHaveURL(/\/app$/)

  const me = await page.request.post('/api/rpc/me/get', {
    data: { json: null },
    headers: { origin: WEB_ORIGIN },
  })
  const { json } = (await me.json()) as {
    json: { name: string; organization: { name: string }; role: string }
  }
  expect(json).toMatchObject({
    name: 'Ana Ibarra',
    organization: { name: 'Seaya Ventures' },
    role: 'owner',
  })
})

test('a returning person signs in on /signin and is kept out of the sign-in pages', async ({
  page,
}) => {
  const email = uniqueEmail('back')
  await page.goto('/signup')
  await page.goto(await askForLink(page, email))
  await page.getByRole('button', { name: 'Skip' }).click()
  await expect(page).toHaveURL(/\/app$/)
  await page.context().clearCookies()

  await page.goto('/signin')
  await expect(page).toHaveTitle('Arrakit · Sign in')
  const link = await askForLink(page, email)
  expect(new URL(link).searchParams.get('callbackURL')).toBe(`${WEB_ORIGIN}/signin`)
  await page.goto(link)
  await expect(page).toHaveURL(/\/app$/)

  await page.goto('/')
  await expect(page).toHaveURL(/\/app$/)
  await page.goto('/signin')
  await expect(page).toHaveURL(/\/app$/)
})

test('a used link comes back to /signup with the refusal', async ({ page, browser }) => {
  const email = uniqueEmail('used')
  await page.goto('/signup')
  const link = await askForLink(page, email)
  await page.goto(link)
  await expect(page).toHaveURL(/\/profile$/)

  const other = await browser.newPage()
  await other.goto(link)
  await expect(other).toHaveURL(/\/signup\?error=INVALID_TOKEN$/)
  await expect(other.getByRole('alert')).toHaveText(
    'That link was already used or has expired. Enter your email for a new one.',
  )
  await other.close()
})

test('a paid plan chosen before signup goes to checkout after Profile', async ({ page }) => {
  const email = uniqueEmail('plan')
  await page.goto('/signup?plan=team&cycle=monthly')
  const link = await askForLink(page, email)
  const url = new URL(link)
  expect(url.searchParams.get('callbackURL')).toBe(`${WEB_ORIGIN}/profile?plan=team&cycle=monthly`)
  expect(url.searchParams.get('errorCallbackURL')).toBe(
    `${WEB_ORIGIN}/signup?plan=team&cycle=monthly`,
  )
  await page.goto(link)
  await expect(page).toHaveURL(/\/profile\?plan=team&cycle=monthly$/)
  await page.getByRole('button', { name: 'Skip' }).click()
  await expect(page).toHaveURL(/\/app\/checkout\?plan=team&cycle=monthly$/)
})

for (const legacy of ['/start', '/new']) {
  test(`${legacy} lands on /signup keeping the whole query`, async ({ page }) => {
    await page.goto(`${legacy}?plan=pro&cycle=yearly&utm_source=news`)
    await expect(page).toHaveURL(/\/signup\?/)
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({
      plan: 'pro',
      cycle: 'yearly',
      utm_source: 'news',
    })
  })
}

test('an invalid email shows the inline error and sends nothing', async ({ page }) => {
  let sent = false
  page.on('request', (request) => {
    if (request.url().includes('/api/auth/sign-in/magic-link')) sent = true
  })
  await page.goto('/signup')
  const input = page.getByRole('textbox', { name: 'Work email' })
  await input.fill('ana@acme')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Enter your work email, like name@company.com.')).toBeVisible()
  await expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(sent).toBe(false)
})

test('the API going down sends the person to Unavailable, and Try again recovers', async ({
  page,
}) => {
  const email = uniqueEmail('down')
  await page.goto('/signup')
  await page.goto(await askForLink(page, email))
  await page.getByRole('button', { name: 'Skip' }).click()
  await expect(page).toHaveURL(/\/app$/)

  await page.route('**/api/rpc/**', (route) => route.abort())
  await page.goto('/app/settings')
  await expect(page).toHaveURL(/\/unavailable\?next=%2Fapp%2Fsettings$/)
  await page.unroute('**/api/rpc/**')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page).toHaveURL(/\/app\/settings$/)
})
