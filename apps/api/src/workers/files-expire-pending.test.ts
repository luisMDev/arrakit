import { UPLOAD_URL_SECONDS, objectPathOf } from '@arrakit/db'
import {
  type TestData,
  insertOrganization,
  insertUser,
  openTestData,
  rawSql,
} from '@arrakit/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { noErrorReporter } from '../observability/error-reporter'
import { recordingLogger } from '../observability/logger'

import { PENDING_UPLOAD_TTL_SECONDS, filesExpirePending } from './files-expire-pending'
import { registerJobs } from './job'

describe('expiring pending uploads', () => {
  let data: TestData
  const { log } = recordingLogger()

  beforeAll(async () => {
    data = await openTestData()
    await registerJobs([filesExpirePending], { data, log, errors: noErrorReporter })
  })
  afterAll(() => data.close())

  it('runs on a schedule', () => {
    expect(data.jobs.schedules.get(filesExpirePending.name)?.cron).toBe('*/15 * * * *')
  })

  it('keeps a pending file longer than its upload link lasts', () => {
    expect(PENDING_UPLOAD_TTL_SECONDS).toBeGreaterThan(UPLOAD_URL_SECONDS)
  })

  it('drops uploads never completed after three hours, with any bytes sent, and keeps the rest', async () => {
    const owner = await insertUser(data, 'owner@expire.vc')
    const { id: organizationId } = await insertOrganization(data, { slug: 'expire-co' })
    const scope = data.asSystem(organizationId)
    const reserve = (name: string) =>
      scope.files.reserve({
        workspaceId: null,
        name,
        contentType: 'text/plain',
        sizeBytes: 1,
        uploadedBy: owner,
      })
    const stale = await reserve('stale.txt')
    const late = await reserve('late.txt')
    const fresh = await reserve('fresh.txt')
    const done = await reserve('done.txt')
    await scope.files.complete(done.id)
    await rawSql(data)(
      "update files set created_at = now() - interval '4 hours' where id = any($1::uuid[])",
      [[stale.id, done.id]],
    )
    await rawSql(data)(
      "update files set created_at = now() - interval '150 minutes' where id = $1::uuid",
      [late.id],
    )
    data.storage.put(organizationId, objectPathOf(stale))

    await data.jobs.send(filesExpirePending.name, {})
    await data.jobs.run(filesExpirePending.name)

    expect(await scope.files.get(stale.id)).toBeUndefined()
    expect(data.storage.objects.has(`${organizationId}/${objectPathOf(stale)}`)).toBe(false)
    expect(await scope.files.get(late.id)).toMatchObject({ status: 'pending' })
    expect(await scope.files.get(fresh.id)).toMatchObject({ status: 'pending' })
    expect(await scope.files.get(done.id)).toMatchObject({ status: 'ready' })
  })
})
