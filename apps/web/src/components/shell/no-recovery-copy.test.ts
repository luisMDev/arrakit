import { readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

const RECOVERY = /\brecoverable\b|\brecover(ed)? (until|for)\b|purged after|\brecuperables?\b/i

const SRC = join(__dirname, '..', '..')
const SOURCES = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .map((file) => file.replaceAll(sep, '/'))
  .filter((file) => /\.(tsx?|json)$/.test(file) && !/\.(test|spec)\.tsx?$/.test(file))

describe('Copy that promises a delete can be undone', () => {
  it.each(['Recoverable for 7 days', 'Recoverable until Oct 16', 'purged after 7 days'])(
    'catches %j',
    (copy) => {
      expect(copy).toMatch(RECOVERY)
    },
  )

  it.each([
    'The invite expires in 7 days.',
    'Recovery codes',
    'recovery email',
    "This can't be undone.",
    'Delete in one click',
    '2026-10-16',
  ])('lets %j through', (copy) => {
    expect(copy).not.toMatch(RECOVERY)
  })

  it('reads the app sources and texts', () => {
    expect(SOURCES).toEqual(
      expect.arrayContaining(['routes/__root.tsx', 'i18n/locales/en/settings.json']),
    )
  })

  it('is in no screen or text of the app', () => {
    const found = SOURCES.flatMap((file) =>
      readFileSync(join(SRC, file), 'utf8')
        .split('\n')
        .flatMap((line, i) => (RECOVERY.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [])),
    )
    expect(found).toEqual([])
  })
})
