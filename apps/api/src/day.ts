export const nowSeconds = (): number => Math.floor(Date.now() / 1000)

/** The UTC calendar day (`YYYY-MM-DD`) of a date or of a Unix time in seconds. */
export const dayOf = (at: Date | number): string =>
  (typeof at === 'number' ? new Date(at * 1000) : at).toISOString().slice(0, 10)
