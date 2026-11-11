import { readFile } from 'node:fs/promises'

import { expect, test } from '@playwright/test'

import { rpc, signedInOwner } from './session'

/** A page that proves its script runs and reports whether it reached the app or the network. */
const probePage = (version: number) => `<!doctype html>
<html><head><title>Probe</title></head>
<body>
  <h1>Pipeline v${version}</h1>
  <p id="ran"></p>
  <p id="parent"></p>
  <p id="network"></p>
  <script>
    document.getElementById('ran').textContent = 'script ran'
    try {
      void window.parent.document.title
      document.getElementById('parent').textContent = 'parent reachable'
    } catch {
      document.getElementById('parent').textContent = 'parent isolated'
    }
    fetch('/api/rpc/me/get').then(
      () => { document.getElementById('network').textContent = 'network reached' },
      () => { document.getElementById('network').textContent = 'network blocked' },
    )
  </script>
</body></html>`

test('artifacts are published, versioned and viewed in an isolated frame', async ({ page }) => {
  await signedInOwner(page, { organization: 'Larch Partners' })
  const deals = await rpc<{ id: string }>(page, 'workspaces/create', {
    name: 'Deals',
    description: '',
  })

  await page.goto(`/app/workspaces/${deals.id}`)
  const artifactsLink = page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name: 'Artifacts' })
  await artifactsLink.click()
  await expect(page).toHaveURL(new RegExp(`/app/workspaces/${deals.id}/artifacts$`))
  await expect(page.getByRole('heading', { level: 1, name: 'Artifacts' })).toBeVisible()
  await expect(page.getByText('No artifacts yet.')).toBeVisible()

  await page.getByRole('button', { name: 'New artifact' }).click()
  const create = page.getByRole('dialog', { name: 'New artifact' })
  await create.getByRole('textbox', { name: 'Title' }).fill('Pipeline review')
  await create.getByRole('textbox', { name: 'Content' }).fill(probePage(1))
  await create.getByRole('button', { name: 'Create artifact' }).click()
  await expect(page.getByText('Pipeline review created.')).toBeVisible()

  const row = page.locator('[data-artifact="Pipeline review"]')
  await expect(row).toContainText('v1')
  await row.getByRole('link', { name: 'Pipeline review' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Pipeline review' })).toBeVisible()

  const frame = page.frameLocator('iframe[title="Pipeline review"]')
  await expect(frame.getByRole('heading', { name: 'Pipeline v1' })).toBeVisible()
  await expect(frame.getByText('script ran')).toBeVisible()
  await expect(frame.getByText('parent isolated')).toBeVisible()
  await expect(frame.getByText('network blocked')).toBeVisible()

  await page.getByRole('button', { name: 'New version' }).click()
  const publish = page.getByRole('dialog', { name: 'New version of Pipeline review' })
  await publish
    .getByLabel('Load from file', { exact: true })
    .and(page.locator('input'))
    .setInputFiles({
      name: 'pipeline.html',
      mimeType: 'text/html',
      buffer: Buffer.from(probePage(2)),
    })
  await expect(publish.getByRole('textbox', { name: 'Content' })).toHaveValue(/Pipeline v2/)
  await publish.getByRole('button', { name: 'Publish version' }).click()
  await expect(page.getByText('Version 2 of Pipeline review published.')).toBeVisible()
  await expect(frame.getByRole('heading', { name: 'Pipeline v2' })).toBeVisible()

  await page.getByRole('combobox', { name: 'Version' }).click()
  await page.getByRole('option', { name: /^Version 1 ·/ }).click()
  await expect(frame.getByRole('heading', { name: 'Pipeline v1' })).toBeVisible()

  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download source' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe('Pipeline review.html')
  expect(await readFile((await download.path())!, 'utf8')).toContain('Pipeline v1')

  await page.getByRole('button', { name: 'Delete' }).click()
  await page
    .getByRole('alertdialog', { name: 'Delete Pipeline review?' })
    .getByRole('button', { name: 'Delete' })
    .click()
  await expect(page).toHaveURL(new RegExp(`/app/workspaces/${deals.id}/artifacts$`))
  await expect(page.getByText('Pipeline review deleted.')).toBeVisible()
  await expect(page.getByText('No artifacts yet.')).toBeVisible()
})
