import { normalizeEmail } from './email'
import { slugOf } from './slug'

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

export const isAddressable = (name: string): boolean => slugOf(name) !== ''

export const domainOf = (email: string): string =>
  (normalizeEmail(email).split('@').at(-1) ?? '').trim().replace(/\.+$/, '')

export const isFreeMail = (email: string): boolean => FREE_MAIL_DOMAINS.has(domainOf(email))

const titleCase = (words: string[]): string =>
  words
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

export function organizationNameFromEmail(email: string): string {
  const labels = domainOf(email).split('.')
  const suffixLength = TWO_LEVEL_SUFFIXES.has(labels.slice(-2).join('.')) ? 2 : 1
  return titleCase((labels.at(-1 - suffixLength) ?? '').split('-'))
}

export function nameFromLocalPart(email: string): string {
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
