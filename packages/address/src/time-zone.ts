const ZONES: ReadonlySet<string> = new Set(Intl.supportedValuesOf('timeZone'))

const RENAMED =
  /^(?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)(?:\/[A-Z][a-z]+(?:_[A-Z][a-z]+)*){1,2}$/

function listedName(zone: string): string | null {
  try {
    return new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone
  } catch {
    return null
  }
}

/**
 * An IANA zone written exactly as the zone database writes it. ICU may list a zone under an older
 * name (`Asia/Calcutta` for `Asia/Kolkata`), so a renamed zone is accepted when it resolves to a
 * listed one that is not merely another casing of it.
 */
export function isTimeZone(value: string): boolean {
  if (value === 'UTC' || ZONES.has(value)) return true
  if (!RENAMED.test(value)) return false
  const listed = listedName(value)
  return listed !== null && ZONES.has(listed) && listed.toLowerCase() !== value.toLowerCase()
}
