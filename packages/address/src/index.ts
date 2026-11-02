const EMAIL = /^[^\s@]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

export const isWorkEmail = (email: string) => EMAIL.test(normalizeEmail(email))

const MAX_SLUG_LENGTH = 63

export const slugOf = (name: string): string =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '')

export const slugCandidates = (name: string): string[] => {
  const base = slugOf(name)
  if (base === '') return []
  const numbered = Array.from({ length: 49 }, (_, i) => {
    const suffix = `-${i + 2}`
    return `${base.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`
  })
  return [base, ...numbered]
}

// The common ICANN second levels only; a domain under a missing one is read one label too far right.
const TWO_LEVEL_SUFFIXES = new Set(
  [
    'co.uk org.uk ac.uk gov.uk me.uk ltd.uk plc.uk net.uk',
    'com.au net.au org.au edu.au gov.au',
    'com.br net.br org.br',
    'co.nz org.nz net.nz',
    'co.jp or.jp ne.jp ac.jp',
    'com.es org.es nom.es',
    'com.mx com.ar com.co com.pe com.uy com.ec com.ve',
    'co.za co.il co.in co.kr co.id co.th co.ke',
    'com.tr com.sg com.hk com.cn com.tw com.my com.ph com.vn com.pl com.pt com.ua',
  ].flatMap((group) => group.split(' ')),
)

// Matched whole and exact: a suffix match would take `acme.com` for `me.com`.
const FREE_MAIL_DOMAINS = new Set(
  [
    'gmail.com googlemail.com',
    'outlook.com outlook.es outlook.fr outlook.de outlook.it',
    'hotmail.com hotmail.es hotmail.co.uk hotmail.fr hotmail.de hotmail.it',
    'live.com live.co.uk live.fr live.de live.it msn.com',
    'yahoo.com yahoo.es yahoo.co.uk yahoo.fr yahoo.de yahoo.it ymail.com aol.com',
    'icloud.com me.com mac.com',
    'proton.me protonmail.com pm.me',
    'gmx.com gmx.de gmx.net gmx.at gmx.ch web.de t-online.de mail.com',
    'zoho.com yandex.com fastmail.com hey.com',
    'orange.fr wanadoo.fr sfr.fr free.fr laposte.net libero.it telefonica.net',
    'qq.com 163.com naver.com',
  ].flatMap((group) => group.split(' ')),
)

const DEFAULT_ORGANIZATION_NAME = 'My Organization'

const isAddressable = (name: string): boolean => slugOf(name) !== ''

export const domainOf = (email: string): string =>
  (normalizeEmail(email).split('@').at(-1) ?? '').trim().replace(/\.+$/, '')

const isFreeMail = (email: string): boolean => FREE_MAIL_DOMAINS.has(domainOf(email))

const titleCase = (words: string[]): string =>
  words
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

function organizationNameFromEmail(email: string): string {
  const labels = domainOf(email).split('.')
  const suffixLength = TWO_LEVEL_SUFFIXES.has(labels.slice(-2).join('.')) ? 2 : 1
  return titleCase((labels.at(-1 - suffixLength) ?? '').split('-'))
}

function nameFromLocalPart(email: string): string {
  const normalized = normalizeEmail(email)
  const at = normalized.lastIndexOf('@')
  const local = at < 0 ? '' : normalized.slice(0, at)
  return titleCase((local.split('+')[0] ?? '').split(/[._-]/))
}

export function organizationNameOnSkip(email: string, personName = ''): string {
  if (!isFreeMail(email)) {
    const fromDomain = organizationNameFromEmail(email)
    if (isAddressable(fromDomain)) return fromDomain
  }
  if (isAddressable(personName)) return personName
  const fromLocalPart = nameFromLocalPart(email)
  return isAddressable(fromLocalPart) ? fromLocalPart : DEFAULT_ORGANIZATION_NAME
}

export function organizationNameOr(typed: string, email: string, personName = ''): string {
  return isAddressable(typed) ? typed : organizationNameOnSkip(email, personName)
}

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

const PLATFORM = /^Mozilla\/5\.0 \(([^)]*)\)/

const DEVICES: readonly [RegExp, string][] = [
  [/^iPhone$/, 'iPhone'],
  [/^iPad$/, 'iPad'],
  [/^Android\b/, 'Android phone'],
  [/^CrOS\b/, 'browser'],
  [/^Macintosh$/, 'Mac'],
  [/^Windows NT\b/, 'Windows PC'],
  [/^(X11|Linux\b)/, 'Linux computer'],
]

/** The device a user agent names ("Mac", "iPhone"…), or "browser" when it names none. */
export function deviceName(userAgent: string | null | undefined): string {
  const tokens = PLATFORM.exec(userAgent ?? '')?.[1]
    ?.split(';')
    .map((token) => token.trim())
  for (const [pattern, name] of DEVICES) {
    if (tokens?.some((token) => pattern.test(token))) return name
  }
  return 'browser'
}

export const ACCOUNT_LANGUAGES = ['en', 'es'] as const
export type AccountLanguage = (typeof ACCOUNT_LANGUAGES)[number]

export const isAccountLanguage = (value: unknown): value is AccountLanguage =>
  (ACCOUNT_LANGUAGES as readonly unknown[]).includes(value)

/** The trimmed name, or the email's local part when the name is blank. */
export function personName(name: string | null | undefined, email: string): string {
  return name?.trim() || email.split('@')[0] || email
}

export const PERSON_NAME_MAX = 100

const ONE_LINE = /^[^\p{Cc}\u2028\u2029]*$/u

/** Why `name` (already trimmed) cannot be a person's name, or null. */
export function personNameRefusal(name: string): string | null {
  if (name === '') return 'Enter your name.'
  if (name.length > PERSON_NAME_MAX) return `Keep your name to ${PERSON_NAME_MAX} characters.`
  if (!ONE_LINE.test(name)) return 'Keep your name on one line.'
  return null
}
