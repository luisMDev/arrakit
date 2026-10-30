import { timestamp } from 'drizzle-orm/pg-core'

/** `created_at timestamptz not null default now()`. */
export const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()

/** `updated_at timestamptz not null default now()`, refreshed by Drizzle on update. */
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())

/** A nullable `timestamptz` column. */
export const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })
