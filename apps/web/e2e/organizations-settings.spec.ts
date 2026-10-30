import { expect, test } from '@playwright/test'

import { WEB_ORIGIN } from './origins'
import { createOrganization, signIn, uniqueEmail } from './session'

test('an owner manages the organization from Settings and deletes it', async ({ page }) => {
  const email = uniqueEmail('owner')
  await signIn(page, email)
  await createOrganization(page, 'Halden Capital', 'Lucía Gómez')

  await page.goto('/app/settings')
  await expect(page).toHaveTitle('Arrakit · Settings')
  await expect(page.getByRole('heading', { level: 2, name: 'Account' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Your name' })).toHaveValue('Lucía Gómez')
  await expect(page.getByText(email)).toBeVisible()
  await expect(page.getByText('A link by email')).toBeVisible()
  await expect(page.getByText(/You own this organization/)).toBeVisible()

  const nav = page.getByRole('navigation', { name: 'Settings' })
  await nav.getByRole('button', { name: 'General' }).click()
  const name = page.getByRole('textbox', { name: 'Organization name' })
  await expect(name).toHaveValue('Halden Capital')
  await expect(page.getByText('Slug: halden-capital')).toBeVisible()
  await name.fill('Halden Partners')
  await name.blur()
  await expect
    .poll(async () => {
      const me = await page.request.post('/api/rpc/me/get', {
        data: { json: null },
        headers: { origin: WEB_ORIGIN },
      })
      return ((await me.json()) as { json: { organization: { name: string } } }).json.organization
        .name
    })
    .toBe('Halden Partners')

  await nav.getByRole('button', { name: 'Members' }).click()
  await expect(page.getByText('1 member · Pro has up to 3')).toBeVisible()
  await page
    .getByRole('textbox', { name: 'Invite someone from your organization' })
    .fill('jon@halden')
  await page.getByRole('button', { name: 'Invite' }).click()
  await expect(page.getByText(/Enter their work email/)).toBeVisible()
  await page
    .getByRole('textbox', { name: 'Invite someone from your organization' })
    .fill('jon@halden.vc')
  await page.getByRole('button', { name: 'Invite' }).click()
  await expect(page.getByText(/Free plan includes 1 seat, all taken/)).toBeVisible()

  await nav.getByRole('button', { name: 'Security and data' }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Delete the organization?' })
  await dialog.getByRole('button', { name: 'Delete the organization' }).click()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByText('Your organization is deleted.')).toBeVisible()
})
