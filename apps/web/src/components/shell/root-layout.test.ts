import { describe, expect, it } from 'vitest'

import { isInApp } from './root-layout'

describe('isInApp', () => {
  it.each(['/app', '/app/settings', '/app/anything/deep'])('%s is in the app', (path) => {
    expect(isInApp(path)).toBe(true)
  })

  it.each(['/', '/pricing', '/signin', '/application', '/unavailable'])('%s is not', (path) => {
    expect(isInApp(path)).toBe(false)
  })
})
