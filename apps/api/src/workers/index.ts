import { type JobDefinition, type WorkerDeps, registerJobs } from './job'
import { storagePurge } from './storage-purge'

export const JOBS: readonly JobDefinition[] = [storagePurge]

export const registerWorkers = (deps: WorkerDeps) => registerJobs(JOBS, deps)
