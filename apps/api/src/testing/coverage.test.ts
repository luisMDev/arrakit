import { describe, expect, it } from 'vitest'
import { coverageGaps, NO_GAPS, operationsOf } from './coverage'

describe('operationsOf', () => {
  it('turns each method of each path into a `METHOD /path` key, the path as OpenAPI writes it', () => {
    expect(
      operationsOf({
        '/health': { get: {} },
        '/api/companies/{id}': { get: {}, delete: {} },
      }),
    ).toEqual(['GET /health', 'GET /api/companies/{id}', 'DELETE /api/companies/{id}'])
  })

  it("counts only a path item's HTTP methods, never its parameters, summary, description or servers", () => {
    expect(
      operationsOf({
        '/api/members/{email}': {
          parameters: [{ name: 'email', in: 'path' }],
          summary: 'A member',
          description: 'One member of the organization',
          servers: [{ url: 'http://localhost' }],
          patch: {},
          head: {},
          options: {},
          put: {},
          post: {},
        },
      }),
    ).toEqual([
      'PATCH /api/members/{email}',
      'HEAD /api/members/{email}',
      'OPTIONS /api/members/{email}',
      'PUT /api/members/{email}',
      'POST /api/members/{email}',
    ])
  })

  it('skips a path with no item', () => {
    expect(operationsOf({ '/api/me': undefined })).toEqual([])
  })
})

describe('coverageGaps', () => {
  it('finds no gap when every operation has a case or an exemption', () => {
    expect(coverageGaps(['GET /health', 'GET /api/me'], ['GET /api/me'], ['GET /health'])).toEqual(
      NO_GAPS,
    )
  })

  it.each([
    ['a list route for its item route', 'GET /api/companies/{id}', 'GET /api/companies'],
    ['an item route for its list route', 'GET /api/companies', 'GET /api/companies/{id}'],
    ['another method on the same path', 'DELETE /api/companies/{id}', 'GET /api/companies/{id}'],
    ["Express's `:id` for OpenAPI's `{id}`", 'GET /api/companies/{id}', 'GET /api/companies/:id'],
    ['a trailing slash', 'GET /api/companies', 'GET /api/companies/'],
  ])('does not take %s', (_, operation, caseKey) => {
    expect(coverageGaps([operation], [caseKey], [])).toEqual({
      uncovered: [operation],
      stale: [caseKey],
      both: [],
    })
  })

  it('reads a lower-case method as the same operation, on either side', () => {
    expect(coverageGaps(['get /api/me'], ['GET /api/me'], [])).toEqual(NO_GAPS)
    expect(coverageGaps(['GET /api/me'], ['get /api/me'], [])).toEqual(NO_GAPS)
  })

  it('exempts only the method an exemption names', () => {
    expect(coverageGaps(['GET /health', 'POST /health'], [], ['GET /health'])).toEqual({
      uncovered: ['POST /health'],
      stale: [],
      both: [],
    })
  })

  it('matches tool names whole: list_companies does not cover list_companies_v2', () => {
    expect(coverageGaps(['list_companies', 'list_companies_v2'], ['list_companies'], [])).toEqual({
      uncovered: ['list_companies_v2'],
      stale: [],
      both: [],
    })
  })

  it('reports a case or an exemption for an operation that no longer exists as stale', () => {
    expect(
      coverageGaps(['GET /api/me'], ['GET /api/me', 'GET /api/gone'], ['GET /old-health']),
    ).toEqual({ uncovered: [], stale: ['GET /api/gone', 'GET /old-health'], both: [] })
  })

  it('reports a key that is both a case and an exemption', () => {
    expect(coverageGaps(['GET /health'], ['GET /health'], ['GET /health'])).toEqual({
      uncovered: [],
      stale: [],
      both: ['GET /health'],
    })
  })
})
