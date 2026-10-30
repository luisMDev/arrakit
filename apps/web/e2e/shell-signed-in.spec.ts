import { expect, test } from '@playwright/test'

import { createOrganization, signIn, uniqueEmail } from './session'

test('a signed-in owner moves around the app from the account menu', async ({ page }) => {
  await signIn(page, uniqueEmail('ana'))
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
  await expect(page).toHaveURL(/\/app\/booking$/)
  await expect(page.getByRole('heading', { name: 'This page does not exist.' })).toBeVisible()

  await menuButton.click()
  await page.locator('#app-menu').getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/signin$/)
  await page.goto('/app')
  await expect(page).toHaveURL(/\/signin$/)
})

test('a free organization opening Welcome without a checkout goes to Plans', async ({ page }) => {
  await signIn(page, uniqueEmail('free'))
  await createOrganization(page, 'Free Co', 'Fran')
  await page.goto('/app/welcome')
  await expect(page).toHaveURL(/\/app\/plans$/)
})

test('a person with no organization is sent to create one', async ({ page }) => {
  await signIn(page, uniqueEmail('new'))
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
