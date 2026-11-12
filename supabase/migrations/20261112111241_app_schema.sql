create schema app;
--> statement-breakpoint
create function app.org_id() returns uuid
  language sql stable set search_path = ''
  as $$ select nullif(auth.jwt() ->> 'org_id', '')::uuid $$;
--> statement-breakpoint
create function app.user_id() returns text
  language sql stable set search_path = ''
  as $$ select auth.jwt() ->> 'sub' $$;
--> statement-breakpoint
create function app.is_system() returns boolean
  language sql stable set search_path = ''
  as $$ select coalesce(auth.jwt() ->> 'actor' = 'system', false) $$;
--> statement-breakpoint
create function app.has_permission(permission text) returns boolean
  language sql stable set search_path = ''
  as $$
    select coalesce(
      auth.jwt() ->> 'actor' = 'system' or (auth.jwt() -> 'permissions') ? permission,
      false
    )
  $$;
--> statement-breakpoint
revoke execute on all functions in schema app from public;
--> statement-breakpoint
grant usage on schema app to authenticated;
--> statement-breakpoint
grant execute on all functions in schema app to authenticated;
--> statement-breakpoint
revoke all on all tables in schema public from anon, authenticated;
--> statement-breakpoint
grant select, insert, update, delete on all tables in schema public to authenticated;
--> statement-breakpoint
alter default privileges in schema public revoke all on tables from anon, authenticated;
--> statement-breakpoint
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
--> statement-breakpoint
grant usage on schema better_auth to authenticated;
--> statement-breakpoint
grant select (id, name, email, image) on better_auth.users to authenticated;
