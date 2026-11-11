import { registerEventSubscribers } from '../events/subscribers'
import { FILE_SUBSCRIBERS } from '../files/subscribers'
import { TASK_SUBSCRIBERS } from '../tasks/subscribers'
import { filesExpirePending } from './files-expire-pending'
import { type JobDefinition, type WorkerDeps, registerJobs } from './job'
import { storagePurge } from './storage-purge'

export const JOBS: readonly JobDefinition[] = [storagePurge, filesExpirePending]

export async function registerWorkers(deps: WorkerDeps): Promise<void> {
  await registerJobs(JOBS, deps)
  await registerEventSubscribers([...FILE_SUBSCRIBERS, ...TASK_SUBSCRIBERS], deps)
}
