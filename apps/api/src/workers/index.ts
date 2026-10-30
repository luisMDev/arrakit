import type { ScopedData } from '@arrakit/db'

import { registerStoragePurge } from './storage-purge'

export async function registerWorkers(data: ScopedData): Promise<void> {
  await registerStoragePurge(data)
}
