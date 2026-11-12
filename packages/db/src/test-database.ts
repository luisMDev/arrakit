import { fileURLToPath } from 'node:url'

import { PGlite } from '@electric-sql/pglite'
import type { Logger } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'

import type { Database } from './connection'
import * as schema from './schema/index'

const MIGRATIONS = fileURLToPath(new URL('../../../supabase/migrations', import.meta.url))

/** What a Supabase database has before any migration of ours, as far as the migrations use it. */
const SUPABASE_PRELUDE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
  $$;
  grant usage on schema auth to anon, authenticated, service_role;

  alter default privileges in schema public
    grant truncate, references, trigger, maintain on tables to anon, authenticated, service_role;

  create schema realtime;
  create table realtime.messages (
    id uuid not null default gen_random_uuid() primary key,
    topic text not null,
    extension text not null,
    payload jsonb,
    event text,
    private boolean default false,
    inserted_at timestamp not null default timezone('utc', clock_timestamp())
  );
  alter table realtime.messages enable row level security;
  grant usage on schema realtime to anon, authenticated, service_role;
  grant select, insert, update on realtime.messages to anon, authenticated, service_role;

  create function realtime.topic() returns text language sql stable as $$
    select nullif(current_setting('realtime.topic', true), '')::text
  $$;

  create function realtime.send(payload jsonb, event text, topic text, private boolean default true)
    returns void language plpgsql as $$
  declare
    generated_id uuid;
    final_payload jsonb;
  begin
    begin
      generated_id := gen_random_uuid();
      if payload ? 'id' then
        final_payload := payload;
      else
        final_payload := jsonb_set(payload, '{id}', to_jsonb(generated_id));
      end if;
      execute format('set local realtime.topic to %L', topic);
      insert into realtime.messages (id, payload, event, topic, private, extension)
      values (generated_id, final_payload, event, topic, private, 'broadcast');
    exception
      when others then
        raise warning 'WarnSendingBroadcastMessage: %', sqlerrm;
    end;
  end;
  $$;
`

export interface TestDatabase {
  client: PGlite
  db: Database
}

/** A fresh in-memory PGlite that looks like a Supabase database with every migration applied. */
export async function openTestDatabase(options: { logger?: Logger } = {}): Promise<TestDatabase> {
  const client = new PGlite()
  await client.exec(SUPABASE_PRELUDE)
  const db = drizzle({ client, schema, logger: options.logger })
  await migrate(db, { migrationsFolder: MIGRATIONS })
  return { client, db: db as unknown as Database }
}
