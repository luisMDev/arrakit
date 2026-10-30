import { describe, expect, it } from 'vitest'

import { isAdminRole, toOrganizationRole } from './roles'

describe('isAdminRole', () => {
  it.each([
    ['owner', true],
    ['admin', true],
    ['member', false],
    ['', false],
    ['Admin', false],
  ])('%j → %s', (role, expected) => {
    expect(isAdminRole(role)).toBe(expected)
  })
})

describe('toOrganizationRole', () => {
  it.each([
    ['owner', 'owner'],
    ['admin', 'admin'],
    ['member', 'member'],
    ['Admin', 'member'],
    ['superadmin', 'member'],
  ])('%j reads as %j', (stored, role) => {
    expect(toOrganizationRole(stored)).toBe(role)
  })
})
