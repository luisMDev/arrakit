import { type ScopedData, openData } from '@arrakit/db'
import { memoryJobs } from '@arrakit/db/testing'

import { DATABASE_URL } from './origins'

const silent = { info: () => undefined, error: () => undefined }

/**
 * Hands `work` the tasks of `organizationId` on the local stack, as a worker sees them. No
 * procedure starts a task yet, so specs move one through the data layer the way a worker would;
 * no job runs, since jobs go to an in-memory fake.
 */
export async function drivingTasks<T>(
  organizationId: string,
  work: (tasks: ReturnType<ScopedData['asSystem']>['tasks']) => Promise<T>,
): Promise<T> {
  const data = await openData({ databaseUrl: DATABASE_URL }, { jobs: memoryJobs(), log: silent })
  try {
    return await work(data.asSystem(organizationId).tasks)
  } finally {
    await data.close()
  }
}
