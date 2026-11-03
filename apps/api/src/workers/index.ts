import { FILE_SUBSCRIBERS, registerFileSubscribers } from '../files/subscribers'
import { filesExpirePending } from './files-expire-pending'
import { type JobDefinition, type WorkerDeps, registerJobs } from './job'
import { storagePurge } from './storage-purge'

export const JOBS: readonly JobDefinition[] = [storagePurge, filesExpirePending]

export async function registerWorkers(deps: WorkerDeps): Promise<void> {
  await registerJobs(JOBS, deps)
  await registerFileSubscribers(FILE_SUBSCRIBERS, deps)
}
