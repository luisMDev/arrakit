import { type EventSubscriber, registerEventSubscribers } from '../events/subscribers'
import { filesExpirePending } from './files-expire-pending'
import { type JobDefinition, type WorkerDeps, registerJobs } from './job'
import { storagePurge } from './storage-purge'
import { tasksMaintain } from './tasks-maintain'
import { type TrackedJobDefinition, trackedJob } from './tracked-job'

export const JOBS: readonly JobDefinition[] = [storagePurge, filesExpirePending, tasksMaintain]

/** Background work people follow as tasks. Add a tracked job here, then start it with startTask. */
export const TRACKED_JOBS: readonly TrackedJobDefinition[] = []

/** What reacts to domain events. Add a subscriber here, defined with defineEventSubscriber. */
export const SUBSCRIBERS: readonly EventSubscriber[] = []

export async function registerWorkers(deps: WorkerDeps): Promise<void> {
  await registerJobs([...JOBS, ...TRACKED_JOBS.map((job) => trackedJob(job))], deps)
  await registerEventSubscribers(SUBSCRIBERS, deps)
}
