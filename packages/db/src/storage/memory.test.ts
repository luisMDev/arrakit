import { describe, expect, it } from 'vitest'

import { memoryStorage } from './memory'

const ORG_A = '0f8fad5b-d9cb-469f-a165-70867728950e'
const ORG_B = '01890a5d-ac96-774b-bcce-b302099a8057'

describe('memoryStorage', () => {
  it('removes a folder but not a sibling sharing its prefix, nor another organization', async () => {
    const storage = memoryStorage()
    storage.put(ORG_A, 'c1/a.pdf')
    storage.put(ORG_A, 'c1x/b.pdf')
    storage.put(ORG_A, 'notes.txt')
    storage.put(ORG_B, 'c1/a.pdf')
    const a = storage.forOrganization(ORG_A)

    await a.removePrefix('c1/')
    expect(await a.list('')).toEqual([{ path: 'c1x/b.pdf' }, { path: 'notes.txt' }])
    await a.removePrefix('')
    expect(await a.list('')).toEqual([])
    expect(await storage.forOrganization(ORG_B).list('')).toEqual([{ path: 'c1/a.pdf' }])
  })

  it('refuses unusable folders and organization ids', async () => {
    const files = memoryStorage().forOrganization(ORG_A)
    for (const folder of ['../x/', 'a', '/a/', 'a//']) {
      await expect(files.removePrefix(folder)).rejects.toThrow('not a usable folder')
    }
    await expect(memoryStorage().forOrganization('nope').list('')).rejects.toThrow(
      'not an organization id',
    )
  })

  it('stores, heads and removes an object of one organization only', async () => {
    const storage = memoryStorage()
    const a = storage.forOrganization(ORG_A)
    await a.put('files/1', new TextEncoder().encode('hello'), 'text/plain')

    expect(await a.head('files/1')).toEqual({ size: 5, contentType: 'text/plain' })
    expect(await storage.forOrganization(ORG_B).head('files/1')).toBeUndefined()
    await a.remove('files/1')
    await a.remove('files/1')
    expect(await a.head('files/1')).toBeUndefined()
  })

  it('presigns URLs for the object key, the download named as asked', async () => {
    const a = memoryStorage().forOrganization(ORG_A)
    const upload = await a.presignPut('files/1', {
      contentType: 'application/pdf',
      contentLength: 3,
      expiresInSeconds: 60,
    })
    expect(upload.url).toBe(`memory://${ORG_A}/files/1`)
    expect(upload.headers).toEqual({ 'content-type': 'application/pdf' })
    expect(upload.expiresAt.getTime()).toBeGreaterThan(Date.now())

    const download = await a.presignGet('files/1', { downloadName: 'a.pdf', expiresInSeconds: 60 })
    expect(decodeURIComponent(download.url)).toContain('attachment; filename="a.pdf"')
  })

  it('refuses unusable object paths', async () => {
    const a = memoryStorage().forOrganization(ORG_A)
    for (const path of ['', 'files/', '../x', '/x', 'a//b']) {
      await expect(a.head(path)).rejects.toThrow('not a usable object path')
    }
  })
})
