import { type Page, expect, test } from '@playwright/test'

import { WEB_ORIGIN } from './origins'

async function signIn(page: Page, email: string) {
  const sent = await page.request.post('/api/auth/sign-in/magic-link', {
    data: { email, callbackURL: '/app' },
    headers: { origin: WEB_ORIGIN },
  })
  expect(sent.ok(), await sent.text()).toBe(true)
  const outbox = await page.request.get(`/api/dev/outbox?to=${encodeURIComponent(email)}`)
  const [mail] = (await outbox.json()) as { text: string }[]
  const link = mail?.text.match(/https?:\/\/\S+\/api\/auth\/magic-link\/verify\S+/)?.[0]
  expect(link).toBeTruthy()
  await page.goto(link!)
}

async function createOrganization(page: Page, name: string, personName: string) {
  const created = await page.request.post('/api/rpc/organizations/create', {
    data: { json: { name, personName, termsAccepted: true } },
    headers: { origin: WEB_ORIGIN },
  })
  expect(created.ok(), await created.text()).toBe(true)
}

test('a signed-in owner moves around the app from the account menu', async ({ page }) => {
  await signIn(page, `ana-${Date.now()}@acme.test`)
  await createOrganization(page, 'Acme', 'Ana Ruiz')

  await page.goto('/app')
  await expect(page.getByRole('heading', { level: 1, name: 'Hi, Ana Ruiz.' })).toBeVisible()
  await expect(page.getByText('Acme is on Free.', { exact: false })).toBeVisible()
  await expect(page).toHaveTitle('Arrakit · Home')
  await expect(page.locator('header')).toHaveCount(1)
  await expect(page.locator('header').getByRole('link', { name: 'Home' })).toHaveAttribute(
    'href',
    '/app',
  )

  const menuButton = page.getByRole('button', { name: 'Account menu' })
  await expect(menuButton).toHaveText('A')

  for (const [item, path, section] of [
    ['Settings', '/app/settings', 'Account'],
    ['Members', '/app/members', 'Members'],
    ['Billing', '/app/billing', 'Billing'],
  ] as const) {
    await menuButton.click()
    await page.locator('#app-menu').getByRole('link', { name: item }).click()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: section })).toBeVisible()
    await expect(page.locator('#app-menu')).toHaveCount(0)
  }

  await page.goto('/app/booking')
  await expect(page).toHaveURL(/\/app$/)

  await menuButton.click()
  await page.locator('#app-menu').getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/signin$/)
  await page.goto('/app')
  await expect(page).toHaveURL(/\/signin$/)
})

test('a free organization opening Welcome without a checkout goes to Plans', async ({ page }) => {
  await signIn(page, `free-${Date.now()}@acme.test`)
  await createOrganization(page, 'Free Co', 'Fran')
  await page.goto('/app/welcome')
  await expect(page).toHaveURL(/\/app\/plans$/)
})

test('a person with no organization is sent to create one', async ({ page }) => {
  await signIn(page, `new-${Date.now()}@acme.test`)
  await page.goto('/app')
  await expect(page).toHaveURL(/\/profile/)
})

test('the unavailable screen never sends Try again off the app', async ({ page }) => {
  await page.goto('/unavailable?next=https%3A%2F%2Fevil.example%2Fapp')
  await expect(page.getByRole('heading', { name: "Couldn't reach Arrakit." })).toBeVisible()
  await expect(page).toHaveTitle('Arrakit · Unavailable')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page).toHaveURL(/\/signin$/)
})
