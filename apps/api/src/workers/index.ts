import { registerEventSubscribers } from '../events/subscribers'
import { FILE_SUBSCRIBERS } from '../files/subscribers'
import { TASK_SUBSCRIBERS } from '../tasks/subscribers'
import { filesExpirePending } from './files-expire-pending'
import { type JobDefinition, type WorkerDeps, registerJobs } from './job'
import { storagePurge } from './storage-purge'
import { tasksMaintain } from './tasks-maintain'
import { type TrackedJobDefinition, trackedJob } from './tracked-job'

export const JOBS: readonly JobDefinition[] = [storagePurge, filesExpirePending, tasksMaintain]

/** Background work people follow as tasks. Add a tracked job here, then start it with startTask. */
export const TRACKED_JOBS: readonly TrackedJobDefinition[] = []

export async function registerWorkers(deps: WorkerDeps): Promise<void> {
  await registerJobs([...JOBS, ...TRACKED_JOBS.map((job) => trackedJob(job))], deps)
  await registerEventSubscribers([...FILE_SUBSCRIBERS, ...TASK_SUBSCRIBERS], deps)
}
