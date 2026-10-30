import type { Data } from '@arrakit/db'

import { registerStoragePurge } from './storage-purge'

export async function registerWorkers(data: Data): Promise<void> {
  await registerStoragePurge(data)
}
