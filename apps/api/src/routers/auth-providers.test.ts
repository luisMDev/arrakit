import { describe, expect, it } from 'vitest'

import { createTestApp } from '../testing/app'

describe('authProviders.get', () => {
  it('answers both providers when both are configured', async () => {
    const t = await createTestApp({
      env: {
        GOOGLE_CLIENT_ID: 'g',
        GOOGLE_CLIENT_SECRET: 'gs',
        MICROSOFT_CLIENT_ID: 'm',
        MICROSOFT_CLIENT_SECRET: 'ms',
      },
    })
    try {
      expect(await t.client().authProviders.get()).toEqual({ google: true, microsoft: true })
    } finally {
      await t.close()
    }
  })

  it('answers microsoft false without an Azure app', async () => {
    const t = await createTestApp({ env: { GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 'gs' } })
    try {
      expect(await t.client().authProviders.get()).toEqual({ google: true, microsoft: false })
    } finally {
      await t.close()
    }
  })
})
