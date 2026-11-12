import { generateKeyPairSync, randomUUID } from 'node:crypto'

import { claimsFor, permissionsOf } from '@arrakit/auth/permissions'
import { FILES_BUCKET } from '@arrakit/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type PrivateJwk, type Stack, openStack, signEs256 } from '../testing/stack'

const ownerOf = (organizationId: string) =>
  claimsFor({ userId: randomUUID(), organizationId, permissions: permissionsOf('owner') })

describe('Storage on the local stack', () => {
  let stack: Stack
  const org = randomUUID()
  const path = `files/${randomUUID()}`
  const key = `${org}/${path}`

  const objects = () => stack.data.storage.forOrganization(org)
  const bucketFor = (token: string) => stack.client(token).storage.from(FILES_BUCKET)

  beforeAll(async () => {
    stack = await openStack()
    await objects().put(path, new TextEncoder().encode('private'), 'text/plain')
  })
  afterAll(async () => {
    await objects().removePrefix('')
    await stack.close()
  })

  it.each([
    ['an owner of the same organization', () => org],
    ['an owner of another organization', () => randomUUID()],
  ])(
    "keeps a member token away from every object, its own organization's included: %s",
    async (_who, organizationOf) => {
      const bucket = bucketFor(await stack.tokenFor(ownerOf(organizationOf())))
      const otherKey = `${org}/files/${randomUUID()}`

      const listed = await bucket.listV2({ prefix: `${org}/` })
      expect(listed.data?.objects ?? []).toEqual([])
      expect((await bucket.list(`${org}/files`)).data).toEqual([])
      expect((await bucket.download(key)).error).not.toBeNull()
      expect((await bucket.createSignedUrl(key, 60)).error).not.toBeNull()
      const written = await bucket.upload(otherKey, 'x', { contentType: 'text/plain' })
      expect(written.error?.message).toMatch(/row-level security/i)
      expect((await bucket.createSignedUploadUrl(otherKey)).error).not.toBeNull()
      expect((await bucket.remove([key])).data).toEqual([])

      expect(await objects().head(path)).toMatchObject({ size: 7 })
    },
  )

  it('refuses a token signed by a key the stack does not list', async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const iat = Math.floor(Date.now() / 1000)
    const token = signEs256(
      { ...ownerOf(org), aud: 'authenticated', iat, exp: iat + 600 },
      privateKey.export({ format: 'jwk' }) as PrivateJwk,
      randomUUID(),
    )
    const bucket = bucketFor(token)

    expect((await bucket.listV2({ prefix: `${org}/` })).error).not.toBeNull()
    expect((await bucket.download(key)).error).not.toBeNull()
    expect((await bucket.createSignedUrl(key, 60)).error).not.toBeNull()
    expect(
      (await bucket.upload(`${org}/files/${randomUUID()}`, 'x', { contentType: 'text/plain' }))
        .error,
    ).not.toBeNull()
    expect((await bucket.remove([key])).error).not.toBeNull()

    expect(await objects().head(path)).toMatchObject({ size: 7 })
  })
})
