import type { z } from 'zod'

/** What a module declares about the events its data layer publishes. */
export interface EventDomain<Payloads> {
  schemas: { [E in keyof Payloads]: z.ZodType<Payloads[E]> }
  /** Fields that identify a payload in the log lines of its subscribers. */
  logFields: (payload: Payloads[keyof Payloads]) => Record<string, unknown>
}

type Schemas<Payloads> = EventDomain<Payloads>['schemas']

/** `never` in place of a schema that would refuse a payload the data layer publishes. */
type Accepting<Payloads, S extends Schemas<Payloads>> = {
  [E in keyof Payloads]: Payloads[E] extends z.input<S[E]> ? S[E] : never
}

/**
 * Ties each schema to the payload `Payloads` declares for its event, both ways: a field the
 * payload gains, loses or widens fails to compile here, instead of being dropped or dead-lettered
 * at run time. Curried because TypeScript infers the schemas only when `Payloads` is given alone.
 */
export const defineEventDomain =
  <Payloads>() =>
  <S extends Schemas<Payloads>>(domain: {
    schemas: S & Accepting<Payloads, S>
    logFields: EventDomain<Payloads>['logFields']
  }): EventDomain<Payloads> =>
    domain
