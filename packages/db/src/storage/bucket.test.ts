import { readFileSync } from 'node:fs'

import { FILE_POLICIES } from '@arrakit/plans'
import { StorageClient } from '@supabase/storage-js'
import { describe, expect, it } from 'vitest'

import { FILES_BUCKET } from './supabase'

const policies = Object.values(FILE_POLICIES)
const widestLimit = Math.max(...policies.map((policy) => policy.maxBytes))
const planTypes = [...new Set(policies.flatMap((policy) => Object.values(policy.types)))].sort()

function bucketSection(): string {
  const lines = readFileSync(new URL('../../../../supabase/config.toml', import.meta.url), 'utf8')
    .split('\n')
    .map((line) => line.trim())
  const start = lines.indexOf(`[storage.buckets.${FILES_BUCKET}]`)
  expect(start).toBeGreaterThanOrEqual(0)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith('['))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

describe('the files bucket in supabase/config.toml', () => {
  const section = bucketSection()

  it('is private', () => {
    expect(section).toMatch(/^public = false$/m)
  })

  it('carries the widest plan limit, in bytes', () => {
    expect(/^file_size_limit = "(\d+)"$/m.exec(section)?.[1]).toBe(String(widestLimit))
  })

  it('allows exactly the content types the plans allow', () => {
    const list = /^allowed_mime_types = (\[[^\]]*\])/m.exec(section)?.[1]
    expect(list).toBeDefined()
    expect((JSON.parse(list!) as string[]).sort()).toEqual(planTypes)
  })
})

const { SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY } = process.env

describe.runIf(SUPABASE_URL && SUPABASE_SECRET_KEY && SUPABASE_PUBLISHABLE_KEY)(
  'the files bucket on the local stack',
  () => {
    it('was seeded from config.toml', async () => {
      const client = new StorageClient(`${SUPABASE_URL}/storage/v1`, {
        apikey: SUPABASE_SECRET_KEY!,
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      })
      const { data, error } = await client.getBucket(FILES_BUCKET)
      expect(error).toBeNull()
      expect(data?.public).toBe(false)
      expect(data?.file_size_limit).toBe(widestLimit)
      expect([...(data?.allowed_mime_types ?? [])].sort()).toEqual(planTypes)
    })
  },
)
