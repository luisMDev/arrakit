const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

declare const brand: unique symbol
export type OrganizationId = string & { readonly [brand]: 'OrganizationId' }

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/** Lowercased, branded organization id; throws `[data] not an organization id: "<value>"`. */
export function toOrganizationId(value: unknown): OrganizationId {
  if (!isUuid(value)) throw new Error(`[data] not an organization id: ${JSON.stringify(value)}`)
  return value.toLowerCase() as OrganizationId
}
