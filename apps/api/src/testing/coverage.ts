/**
 * Whether a hand-written table of cases covers every operation the API serves
 * (or every tool the MCP server lists). Keys are `METHOD /path`, the path as
 * OpenAPI writes it (`{id}`), or a tool's name. They match whole: a prefix,
 * another method, `:id` or a trailing slash is another key. Only the method is
 * normalised, upper-cased, on both sides.
 */

/** The keys of an OpenAPI path item that are operations (OpenAPI 3, "Path Item Object"). */
const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']

/** An OpenAPI document's `paths`: each path's item, keyed by method among other fields. */
export type OpenApiPaths = Record<string, object | undefined>

/** Every operation in `paths`, as `METHOD /path`. A path item's other fields are not operations. */
export const operationsOf = (paths: OpenApiPaths): string[] =>
  Object.entries(paths).flatMap(([path, item]) =>
    Object.keys(item ?? {})
      .filter((key) => METHODS.includes(key))
      .map((method) => `${method.toUpperCase()} ${path}`),
  )

export interface CoverageGaps {
  /** Operations with neither a case nor an exemption. */
  uncovered: string[]
  /** Cases and exemptions naming an operation that does not exist. */
  stale: string[]
  /** Keys that are both a case and an exemption. */
  both: string[]
}

/** No gaps: what a complete table of cases answers. */
export const NO_GAPS: CoverageGaps = { uncovered: [], stale: [], both: [] }

const OPERATION = /^([a-z]+) (\/.*)$/i

/** `get /x` and `GET /x` are one key; a tool name is kept as it is. */
const normalise = (key: string): string => {
  const match = OPERATION.exec(key)
  return match ? `${match[1]?.toUpperCase()} ${match[2]}` : key
}

/** What `cases` and `exempt` leave uncovered of `operations`, and what they name that is not there. */
export const coverageGaps = (
  operations: readonly string[],
  cases: readonly string[],
  exempt: readonly string[],
): CoverageGaps => {
  const served = new Set(operations.map(normalise))
  const cased = new Set(cases.map(normalise))
  const exempted = new Set(exempt.map(normalise))
  return {
    uncovered: [...served].filter((key) => !cased.has(key) && !exempted.has(key)),
    stale: [...cased, ...exempted].filter((key) => !served.has(key)),
    both: [...cased].filter((key) => exempted.has(key)),
  }
}
