import { describe, expect, it } from 'vitest'

import { appLink } from './config'

describe('appLink', () => {
  it('joins the app origin and a path', () => {
    expect(appLink('/pricing')).toMatch(/^https?:\/\/[^/]+\/pricing$/)
  })
})
