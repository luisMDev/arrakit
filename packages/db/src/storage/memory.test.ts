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
})
