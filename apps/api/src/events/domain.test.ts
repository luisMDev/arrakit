import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { defineEventDomain } from './domain'

interface Payloads {
  'thing.made': { thingId: string; madeBy: string | null }
}

const made = z.object({ thingId: z.string(), madeBy: z.string().nullable() })
const logFields = ({ thingId }: { thingId: string }) => ({ thingId })

describe('event domains', () => {
  it('keeps the schemas and the log fields of a domain that matches its payloads', () => {
    const domain = defineEventDomain<Payloads>()({ schemas: { 'thing.made': made }, logFields })

    expect(domain.schemas['thing.made']).toBe(made)
    expect(domain.logFields({ thingId: 't1', madeBy: null })).toEqual({ thingId: 't1' })
  })

  it('refuses, when type-checked, a schema that differs from its payload', () => {
    defineEventDomain<Payloads>()({
      // @ts-expect-error the schema drops a field the payload carries
      schemas: { 'thing.made': made.omit({ madeBy: true }) },
      logFields,
    })
    defineEventDomain<Payloads>()({
      // @ts-expect-error the schema demands a field the payload lacks
      schemas: { 'thing.made': made.extend({ madeAt: z.string() }) },
      logFields,
    })
    defineEventDomain<Payloads>()({
      // @ts-expect-error the schema refuses a null the payload may carry
      schemas: { 'thing.made': made.extend({ madeBy: z.string() }) },
      logFields,
    })
    defineEventDomain<Payloads>()({
      // @ts-expect-error an event of the domain has no schema
      schemas: {},
      logFields,
    })
  })
})
