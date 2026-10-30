import { describe, expect, it } from 'vitest'

import { toOrganizationId } from './organization-id'

describe('toOrganizationId', () => {
  it('accepts v4 and v7 and lowercases', () => {
    expect(toOrganizationId('0F8FAD5B-D9CB-469F-A165-70867728950E')).toBe(
      '0f8fad5b-d9cb-469f-a165-70867728950e',
    )
    expect(toOrganizationId('01890a5d-ac96-774b-bcce-b302099a8057')).toBeTruthy()
  })

  it.each([
    '',
    ' ',
    'undefined',
    'null',
    '*',
    '%',
    'a/b',
    '0f8fad5b-d9cb-469f-a165-70867728950e/',
    ' 0f8fad5b-d9cb-469f-a165-70867728950e',
    '0f8fad5b-d9cb-469f-a165-7086772895',
    '{0f8fad5b-d9cb-469f-a165-70867728950e}',
  ])('refuses %j', (value) => {
    expect(() => toOrganizationId(value)).toThrow('[data] not an organization id')
  })
})
