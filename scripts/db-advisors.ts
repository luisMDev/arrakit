import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export interface Finding {
  name: string
  level: string
  detail: string
  metadata?: { schema?: string; name?: string }
}

/** pg-boss creates and upgrades this schema itself at boot, outside the migrations. */
const ACCEPTED_SCHEMA = 'pgboss'

/** Reads usage statistics, which say nothing on a development database. */
const ACCEPTED_LINT = 'unused_index'

function isFinding(value: unknown): value is Finding {
  if (typeof value !== 'object' || value === null) return false
  const { name, level, detail } = value as Record<string, unknown>
  return typeof name === 'string' && typeof level === 'string' && typeof detail === 'string'
}

export function parseFindings(output: string): Finding[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    throw new Error('supabase db advisors did not print JSON')
  }
  const results =
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as { results?: unknown }).results
      : parsed
  if (!Array.isArray(results) || !results.every(isFinding))
    throw new Error('supabase db advisors printed JSON that is not a list of findings')
  return results
}

export function unexpectedFindings(findings: Finding[]): Finding[] {
  return findings.filter(
    (finding) => finding.metadata?.schema !== ACCEPTED_SCHEMA && finding.name !== ACCEPTED_LINT,
  )
}

function readAdvisors(): string {
  try {
    return execFileSync(
      'pnpm',
      [
        'exec',
        'supabase',
        'db',
        'advisors',
        '--type',
        'all',
        '--level',
        'info',
        '--output-format',
        'json',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    )
  } catch {
    console.error(
      'supabase db advisors failed: the local stack must be running (pnpm supabase:start)',
    )
    process.exit(1)
  }
}

export function checkAdvisors(
  read: () => string = readAdvisors,
  log: (line: string) => void = console.log,
): boolean {
  const findings = parseFindings(read())
  const unexpected = unexpectedFindings(findings)
  for (const finding of unexpected) {
    const object = `${finding.metadata?.schema ?? '?'}.${finding.metadata?.name ?? '?'}`
    log(`${finding.level} ${finding.name} ${object}: ${finding.detail}`)
  }
  if (unexpected.length === 0)
    log(`Database advisors: no unexpected finding (${findings.length} accepted)`)
  return unexpected.length === 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = checkAdvisors() ? 0 : 1
}
