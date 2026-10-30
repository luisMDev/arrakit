import { sql } from 'drizzle-orm'

import type { DataContext } from './context'

export type ProbeState = 'up' | 'down'
export interface HealthReport {
  status: 'ok' | 'error'
  postgres: ProbeState
  storage: ProbeState
  queue: ProbeState
}

export const PROBE_TIMEOUT_MS = 3000

async function probe(
  name: string,
  run: (signal: AbortSignal) => Promise<unknown>,
): Promise<ProbeState> {
  const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS)
  const timeout = new Promise<never>((_, reject) =>
    signal.addEventListener('abort', () =>
      reject(new Error(`timed out after ${PROBE_TIMEOUT_MS} ms`)),
    ),
  )
  try {
    await Promise.race([run(signal), timeout])
    return 'up'
  } catch (err) {
    console.error(`[data] health: ${name} is down:`, err)
    return 'down'
  }
}

export async function health(ctx: DataContext): Promise<HealthReport> {
  const [postgres, storage, queue] = await Promise.all([
    probe('postgres', () => ctx.db.execute(sql`select 1`)),
    probe('storage', (signal) => ctx.storage.probe(signal)),
    probe('queue', (signal) => ctx.jobs.probe(signal)),
  ])
  const ok = postgres === 'up' && storage === 'up' && queue === 'up'
  return { status: ok ? 'ok' : 'error', postgres, storage, queue }
}
