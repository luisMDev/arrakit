import { memoryStorage } from '@arrakit/db/testing'
import { describe, expect, it } from 'vitest'

import { createTestApp } from '../testing/app'

describe('the local storage presigned URLs', () => {
  const ORG = '0f8fad5b-d9cb-469f-a165-70867728950e'

  it('serves a signed GET and PUT through the API, and refuses unsigned access', async () => {
    const storage = memoryStorage({
      signing: { secret: 'test', baseUrl: 'http://localhost:5200' },
    })
    const t = await createTestApp({ storage })
    const files = storage.forOrganization(ORG)
    const upload = new URL(await files.putUrl('a.txt', { contentType: 'text/plain' }))
    const put = await t.request(upload.pathname, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: 'hello',
    })
    expect(put.status).toBe(200)
    const download = new URL(await files.getUrl('a.txt'))
    const got = await t.request(download.pathname)
    expect(got.status).toBe(200)
    expect(got.headers.get('content-type')).toBe('text/plain')
    expect(await got.text()).toBe('hello')
    expect((await t.request('/api/files/local/unsigned')).status).toBe(403)
    await t.close()
  })

  it('does not exist when the storage does not sign URLs', async () => {
    const t = await createTestApp()
    expect((await t.request('/api/files/local/anything')).status).toBe(404)
    await t.close()
  })
})
