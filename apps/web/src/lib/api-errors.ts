export function statusOf(err: unknown): number {
  if (err && typeof err === 'object' && 'status' in err && typeof err.status === 'number') {
    return err.status
  }
  return 0
}

/** Logs an unexpected failure (one place to plug an error reporter later). */
export function reportError(context: string, err: unknown): void {
  console.error(context, err)
}
