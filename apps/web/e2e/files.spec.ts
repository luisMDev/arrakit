import { readFile } from 'node:fs/promises'

import { expect, test } from '@playwright/test'

import { magicLinkFor } from './mailpit'
import { inviteMember, payFor, rpc, signedInOwner, uniqueEmail } from './session'

const markdown = (name: string, text: string) => ({
  name,
  mimeType: 'text/markdown',
  buffer: Buffer.from(text),
})

test('files go straight to storage for the organization and each workspace', async ({
  page,
  browser,
  baseURL,
}) => {
  const { organizationId } = await signedInOwner(page, { organization: 'Rowan Partners' })
  await payFor(page, organizationId, 'team_monthly')

  await page.goto('/app')
  await page.getByRole('button', { name: 'Workspace menu' }).click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  await page
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('link', { name: 'Library' })
    .click()
  await expect(page).toHaveURL(/\/app\/settings\?section=library$/)
  await expect(page.getByRole('heading', { level: 2, name: 'Library' })).toBeVisible()
  await expect(page.getByText('No files yet.')).toBeVisible()

  const choose = page.getByLabel('Choose files', { exact: true }).and(page.locator('input'))
  await choose.setInputFiles([
    markdown('notes.md', '# Board notes'),
    { name: 'tool.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') },
  ])
  await expect(page.getByText('notes.md uploaded.')).toBeVisible()
  await expect(page.getByText(/This type of file can't be uploaded/)).toBeVisible()
  const notes = page.locator('[data-file="notes.md"]')
  await expect(notes).toContainText('13 byte')

  await notes.getByRole('button', { name: 'Actions for notes.md' }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Download' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe('notes.md')
  expect(await readFile((await download.path())!, 'utf8')).toBe('# Board notes')

  await notes.getByRole('button', { name: 'Actions for notes.md' }).click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  const rename = page.getByRole('dialog', { name: 'Rename file' })
  await rename.getByRole('textbox', { name: 'Name' }).fill('minutes.md')
  await rename.getByRole('button', { name: 'Rename' }).click()
  await expect(page.getByText('Renamed to minutes.md.')).toBeVisible()

  const deals = await rpc<{ id: string }>(page, 'workspaces/create', {
    name: 'Deals',
    description: '',
  })
  await page.goto('/app/workspaces')
  await page.locator('[data-workspace="Deals"]').getByRole('link', { name: 'Deals' }).click()
  await expect(page).toHaveURL(new RegExp(`/app/workspaces/${deals.id}$`))
  await expect(page.getByRole('heading', { level: 1, name: 'Deals' })).toBeVisible()
  const library = page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name: 'Library' })
  await library.click()
  await expect(page).toHaveURL(new RegExp(`/app/workspaces/${deals.id}/library$`))
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()
  await expect(library).toHaveAttribute('aria-current', 'page')
  await choose.setInputFiles([markdown('term-sheet.md', 'Terms')])
  await expect(page.getByText('term-sheet.md uploaded.')).toBeVisible()
  await expect(page.locator('[data-file="term-sheet.md"]')).toBeVisible()

  await page.goto('/app/settings?section=library')
  await expect(page.locator('[data-file]')).toHaveCount(1)
  await expect(page.locator('[data-file="minutes.md"]')).toBeVisible()

  const memberEmail = uniqueEmail('member')
  await inviteMember(page, organizationId, memberEmail)
  const memberContext = await browser.newContext({ baseURL })
  const memberPage = await memberContext.newPage()
  try {
    await memberPage.goto(await magicLinkFor(page.request, memberEmail))
    await expect(memberPage).toHaveURL(/\/app(\/.*)?$/)
    await memberPage.goto('/app/settings?section=library')
    await memberPage
      .getByLabel('Choose files', { exact: true })
      .and(memberPage.locator('input'))
      .setInputFiles([markdown('mine.md', 'Mine')])
    await expect(memberPage.getByText('mine.md uploaded.')).toBeVisible()

    await memberPage.getByRole('button', { name: 'Actions for minutes.md' }).click()
    await expect(memberPage.getByRole('menuitem')).toHaveText(['Download'])
    await memberPage.keyboard.press('Escape')
    await memberPage.getByRole('button', { name: 'Actions for mine.md' }).click()
    await expect(memberPage.getByRole('menuitem')).toHaveText(['Download', 'Rename', 'Delete'])
  } finally {
    await memberContext.close()
  }

  await page.reload()
  await page.getByRole('button', { name: 'Actions for minutes.md' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page
    .getByRole('alertdialog', { name: 'Delete minutes.md?' })
    .getByRole('button', { name: 'Delete' })
    .click()
  await expect(page.getByText('minutes.md deleted.')).toBeVisible()
  await expect(page.locator('[data-file]')).toHaveCount(1)
  await expect(page.locator('[data-file="mine.md"]')).toBeVisible()
})
