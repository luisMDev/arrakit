import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { RealtimeAccess, UploadTicket } from '@arrakit/contract'
import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

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

test('bytes go to the stack bucket, and a member token reaches nothing there directly', async ({
  page,
}) => {
  const { organizationId } = await signedInOwner(page, { organization: 'Larch Partners' })
  const text = '# Private notes'
  const data = Buffer.from(text)

  const ticket = await rpc<UploadTicket>(page, 'files/requestUpload', {
    name: 'notes.md',
    sizeBytes: data.byteLength,
  })
  const put = await page.request.put(ticket.upload.url, { headers: ticket.upload.headers, data })
  expect(put.ok(), await put.text()).toBe(true)
  const { id } = await rpc<{ id: string }>(page, 'files/completeUpload', { id: ticket.file.id })

  const access = await rpc<RealtimeAccess | null>(page, 'realtime/access')
  expect(access).not.toBeNull()
  expect(new URL(ticket.upload.url).origin).toBe(new URL(access!.url).origin)

  const bucket = createClient(access!.url, access!.publishableKey, {
    accessToken: async () => access!.token,
  }).storage.from('files')
  const key = `${organizationId}/files/${id}`
  const listed = await bucket.list(`${organizationId}/files`)
  expect(listed.data).toEqual([])
  expect((await bucket.download(key)).error).not.toBeNull()
  const written = await bucket.upload(`${organizationId}/files/${randomUUID()}`, 'x', {
    contentType: 'text/plain',
  })
  expect(written.error?.message).toMatch(/row-level security/i)
  expect((await bucket.remove([key])).data).toEqual([])

  const link = await rpc<{ url: string }>(page, 'files/downloadUrl', { id })
  const got = await page.request.get(link.url)
  expect(got.ok()).toBe(true)
  expect(await got.text()).toBe(text)
})
