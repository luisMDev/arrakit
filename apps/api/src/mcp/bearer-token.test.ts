import { describe, expect, it } from 'vitest'

import { bearerToken } from './bearer-token'

const JWT = 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJl'

describe('bearerToken', () => {
  it.each([
    ['Bearer abc', 'abc'],
    ['bearer abc', 'abc'],
    ['BEARER abc', 'abc'],
    [`Bearer ${JWT}`, JWT],
    ['Bearer  abc', 'abc'],
    ['Bearer abc==', 'abc=='],
  ])('reads %j', (header, token) => {
    expect(bearerToken(header)).toBe(token)
  })

  it.each([
    'Basic abc',
    'Token abc',
    'Bearerabc',
    'Bearer',
    'Bearer    ',
    'Bearer a b',
    'Bearer x, Bearer y',
    'Bearer a"b',
    'Bearer a=b',
    '',
    undefined,
    null,
  ])('refuses %j', (header) => {
    expect(bearerToken(header)).toBeNull()
  })
})
