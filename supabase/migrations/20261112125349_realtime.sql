create function app.broadcast(topic text, event text, payload jsonb) returns void
  language plpgsql security definer set search_path = ''
  as $$
    begin
      if app.org_id() is null or not starts_with(topic, 'org:' || app.org_id()::text || ':') then
        raise insufficient_privilege using message = 'broadcast outside the organization of the claims';
      end if;
      perform realtime.send(payload, event, topic, true);
    end
  $$;
--> statement-breakpoint
revoke execute on function app.broadcast(text, text, jsonb) from public;
--> statement-breakpoint
grant execute on function app.broadcast(text, text, jsonb) to authenticated;
--> statement-breakpoint
create policy "members receive the task signals they may see" on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and (
      (
        (select realtime.topic()) = 'org:' || (select app.org_id())::text || ':tasks'
        and (select app.has_permission('task:read'))
      )
      or (select realtime.topic()) = 'org:' || (select app.org_id())::text || ':user:' || (select app.user_id()) || ':tasks'
    )
  );
