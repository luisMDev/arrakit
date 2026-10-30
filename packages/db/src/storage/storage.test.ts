import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { FileNotFoundError } from '../errors'
import { localStorage } from './local'
import { memoryStorage } from './memory'
import type { Storage } from './types'

const ORG_A = '0f8fad5b-d9cb-469f-a165-70867728950e'
const ORG_B = '01890a5d-ac96-774b-bcce-b302099a8057'
const text = (value: string) => new TextEncoder().encode(value)
const read = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'arrakit-storage-'))
})
afterAll(() => rm(dir, { recursive: true, force: true }))

describe.each([
  ['memory', () => memoryStorage()],
  ['local', () => localStorage(join(dir, String(Math.random())))],
] as const)('%s storage', (_kind, make: () => Storage) => {
  let storage: Storage
  beforeAll(() => {
    storage = make()
  })

  const a = () => storage.forOrganization(ORG_A)
  const b = () => storage.forOrganization(ORG_B)

  it('stores and reads bytes, a fresh copy each time', async () => {
    await a().put('notes/a.txt', text('hello'), 'text/plain')
    const first = await a().get('notes/a.txt')
    expect(read(first)).toBe('hello')
    first[0] = 0
    expect(read(await a().get('notes/a.txt'))).toBe('hello')
  })

  it('keeps organizations apart', async () => {
    await a().put('shared.txt', text('a'), 'text/plain')
    await expect(b().get('shared.txt')).rejects.toBeInstanceOf(FileNotFoundError)
    await expect(b().get('shared.txt')).rejects.toThrow('[data] no file stored under "shared.txt"')
    await b().remove(['shared.txt'])
    expect(read(await a().get('shared.txt'))).toBe('a')
  })

  it('copies inside the organization, names needing encoding included', async () => {
    await a().put('src/año 2026 #1.txt', text('copy me'), 'text/plain')
    await a().copy('src/año 2026 #1.txt', 'dst/año 2026 #1.txt')
    expect(read(await a().get('dst/año 2026 #1.txt'))).toBe('copy me')
    await expect(a().copy('missing.txt', 'x.txt')).rejects.toBeInstanceOf(FileNotFoundError)
  })

  it('removes names (missing ones are fine) and validates them all first', async () => {
    await a().put('r/one.txt', text('1'), 'text/plain')
    await a().put('r/two.txt', text('2'), 'text/plain')
    await expect(a().remove(['r/one.txt', '../escape'])).rejects.toThrow('not a usable file name')
    expect(read(await a().get('r/one.txt'))).toBe('1')
    await a().remove(['r/one.txt', 'r/never.txt'])
    await expect(a().get('r/one.txt')).rejects.toBeInstanceOf(FileNotFoundError)
    expect(read(await a().get('r/two.txt'))).toBe('2')
  })

  it('removes a folder but not a sibling sharing its prefix', async () => {
    await a().put('companies/c1/a.pdf', text('a'), 'application/pdf')
    await a().put('companies/c1/deep/b.pdf', text('b'), 'application/pdf')
    await a().put('companies/c1x/c.pdf', text('c'), 'application/pdf')
    await a().removePrefix('companies/c1/')
    expect((await a().list('companies/')).map((f) => f.path)).toEqual(['companies/c1x/c.pdf'])
    await a().removePrefix('empty/')
  })

  it('lists paths relative to the organization, subfolders included, in key order', async () => {
    await b().put('l/z.txt', text('zz'), 'text/plain')
    await b().put('l/a/b.txt', text('b'), 'text/plain')
    const listed = await b().list('l/')
    expect(listed.map((f) => [f.path, f.size])).toEqual([
      ['l/a/b.txt', 1],
      ['l/z.txt', 2],
    ])
    expect(new Date(listed[0]!.modifiedAt).toISOString()).toBe(listed[0]!.modifiedAt)
    expect(await b().list('nothing/')).toEqual([])
  })

  it('refuses unusable names before touching storage', async () => {
    await expect(a().put('../x', text('x'), 'text/plain')).rejects.toThrow('not a usable file name')
    expect(() => storage.forOrganization('not-an-org')).toThrow('[data] not an organization id')
  })

  it('probes healthy', async () => {
    await expect(storage.probe()).resolves.toBeUndefined()
  })
})
