import type { AppDeps } from '../deps'
import { registerStoragePurge } from './storage-purge'

export async function registerWorkers(deps: Pick<AppDeps, 'data' | 'log'>): Promise<void> {
  await registerStoragePurge(deps.data, deps.log.child({ worker: 'storage-purge' }))
}
