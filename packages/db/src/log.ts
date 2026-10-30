/** Where the data layer reports what it recovers from. A pino logger fits it. */
export interface DataLog {
  error(fields: object, message: string): void
}

export const consoleLog: DataLog = {
  error: (fields, message) => console.error(`[data] ${message}`, fields),
}
