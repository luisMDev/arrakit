import { describe, expect, it } from 'vitest'

import { type Finding, checkAdvisors, parseFindings, unexpectedFindings } from './db-advisors.ts'

function finding(name: string, level: string, schema: string, object: string): Finding {
  return {
    name,
    level,
    detail: `${schema}.${object} needs attention`,
    metadata: { schema, name: object },
  }
}

const pgbossFindings = [
  finding('function_search_path_mutable', 'WARN', 'pgboss', 'create_queue'),
  finding('unindexed_foreign_keys', 'INFO', 'pgboss', 'queue'),
  finding('unused_index', 'INFO', 'pgboss', 'job'),
]
const unusedIndexes = [
  finding('unused_index', 'INFO', 'public', 'files'),
  finding('unused_index', 'INFO', 'better_auth', 'sessions'),
]

describe('parseFindings', () => {
  it('reads the results envelope', () => {
    expect(parseFindings(JSON.stringify({ results: unusedIndexes }))).toEqual(unusedIndexes)
  })

  it('reads a bare array', () => {
    expect(parseFindings(JSON.stringify(pgbossFindings))).toEqual(pgbossFindings)
  })

  it('rejects any other output', () => {
    expect(() => parseFindings('No issues found')).toThrow(/did not print JSON/)
    expect(() => parseFindings(JSON.stringify({ issues: [] }))).toThrow(/not a list of findings/)
    expect(() => parseFindings(JSON.stringify([{ name: 'x' }]))).toThrow(/not a list of findings/)
  })
})

describe('unexpectedFindings', () => {
  it('ignores every finding of the pgboss schema', () => {
    expect(unexpectedFindings(pgbossFindings)).toEqual([])
  })

  it('ignores unused indexes on the schemas the migrations own', () => {
    expect(unexpectedFindings(unusedIndexes)).toEqual([])
  })

  it('reports every other finding', () => {
    const others = [
      finding('rls_enabled_no_policy', 'INFO', 'better_auth', 'sessions'),
      finding('unindexed_foreign_keys', 'INFO', 'public', 'files'),
      finding('function_search_path_mutable', 'WARN', 'app', 'broadcast'),
    ]
    expect(unexpectedFindings([...pgbossFindings, ...others, ...unusedIndexes])).toEqual(others)
  })
})

describe('checkAdvisors', () => {
  it('passes and logs no finding when every finding is accepted', () => {
    const lines: string[] = []
    const output = JSON.stringify({ results: [...pgbossFindings, ...unusedIndexes] })
    expect(
      checkAdvisors(
        () => output,
        (line) => lines.push(line),
      ),
    ).toBe(true)
    expect(lines).toEqual(['Database advisors: no unexpected finding (5 accepted)'])
  })

  it('fails and logs a line for each unexpected finding', () => {
    const lines: string[] = []
    const output = JSON.stringify({
      results: [...unusedIndexes, finding('unindexed_foreign_keys', 'INFO', 'public', 'files')],
    })
    expect(
      checkAdvisors(
        () => output,
        (line) => lines.push(line),
      ),
    ).toBe(false)
    expect(lines).toEqual([
      'INFO unindexed_foreign_keys public.files: public.files needs attention',
    ])
  })
})
