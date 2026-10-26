-- Stage 3C-B. Run ONCE after Stage 3B and before deploying reminder-push.
-- Creates no schedule. Does not modify reminders, occurrences or their guards.
begin;
create schema hq_push_private;
revoke all on schema hq_push_private from public,anon,authenticated;

create table hq_push_private.devices (
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 endpoint text not null unique check(length(endpoint) between 1 and 2048),
 subscription jsonb, vapid_key text not null, enabled boolean not null default true,
 enabled_since timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check(not enabled or subscription is not null)
);
create index hq_push_devices_owner on hq_push_private.devices(owner_id);
alter table hq_push_private.devices enable row level security;
alter table hq_push_private.devices force row level security;
create policy push_device_owner on hq_push_private.devices for select to authenticated using(owner_id=(select auth.uid()));
-- No browser table grants: the owner-checked RPC is the only mutation interface.

create table hq_push_private.deliveries (
 id uuid primary key default gen_random_uuid(), device_id uuid not null references hq_push_private.devices(id) on delete cascade,
 occurrence_id uuid references public.hq_reminder_occurrences(id) on delete cascade,
 state text not null default 'ready' check(state in ('ready','claimed','sending','sent','retry','failed','unknown','skipped')),
 token uuid, claimed_at timestamptz, attempts integer not null default 0 check(attempts between 0 and 3),
 next_attempt_at timestamptz not null default clock_timestamp(), http_status integer, device_updated_at timestamptz,
 created_at timestamptz not null default clock_timestamp(), finished_at timestamptz
);
create unique index hq_push_occurrence_device on hq_push_private.deliveries(occurrence_id,device_id) where occurrence_id is not null;
create index hq_push_delivery_queue on hq_push_private.deliveries(next_attempt_at,id) where state in ('ready','retry','claimed','sending');
create index hq_push_delivery_device on hq_push_private.deliveries(device_id,created_at);
alter table hq_push_private.deliveries enable row level security;
alter table hq_push_private.deliveries force row level security;
create policy push_delivery_owner on hq_push_private.deliveries for select to authenticated using(exists(select 1 from hq_push_private.devices s where s.id=device_id and s.owner_id=(select auth.uid())));
revoke all on all tables in schema hq_push_private from public,anon,authenticated;

-- Intentional narrow definer API: auth.uid() supplies ownership; no caller owner_id.
-- Fixed search_path; no dynamic SQL; browser receives metadata, never key material.
create function public.hq_push_device(p_id uuid,p_action text,p_subscription jsonb default null,p_vapid_key text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s hq_push_private.devices; uid uuid:=auth.uid(); ep text;
begin
 if uid is null then raise exception 'Please sign in.' using errcode='42501';end if;
 if p_id is null or p_action is null or p_action not in ('status','enable','disable') then raise exception 'Invalid device action.';end if;
 -- Serialize account/device registration and rate limits, including concurrent tabs.
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 select * into s from hq_push_private.devices where id=p_id and owner_id=uid for update;
 if p_action='enable' then
  ep:=p_subscription->>'endpoint';
  if ep is null or length(ep)>2048 or ep !~ '^https://([a-z0-9-]+\.)*push\.apple\.com/[^[:space:]]+$|^https://fcm\.googleapis\.com/[^[:space:]]+$|^https://updates\.push\.services\.mozilla\.com/[^[:space:]]+$'
   or coalesce(p_subscription#>>'{keys,p256dh}','') !~ '^[A-Za-z0-9_-]{87}=?$'
   or coalesce(p_subscription#>>'{keys,auth}','') !~ '^[A-Za-z0-9_-]{22}(==)?$'
   or coalesce(p_vapid_key,'') !~ '^[A-Za-z0-9_-]{87}$'
  then raise exception 'Invalid push subscription.';end if;
  if s.id is null and (select count(*) from hq_push_private.devices where owner_id=uid and enabled)>=20 then raise exception 'Device limit reached. Disable an unused device first.';end if;
  -- Endpoint uniqueness prevents attaching somebody else's existing subscription.
  insert into hq_push_private.devices(id,owner_id,endpoint,subscription,vapid_key)
   values(p_id,uid,ep,jsonb_build_object('endpoint',ep,'keys',p_subscription->'keys'),p_vapid_key)
  on conflict(id) do update set endpoint=excluded.endpoint,subscription=excluded.subscription,vapid_key=excluded.vapid_key,enabled=true,
   enabled_since=case when not devices.enabled or devices.endpoint<>excluded.endpoint or devices.vapid_key<>excluded.vapid_key then clock_timestamp() else devices.enabled_since end,
   updated_at=clock_timestamp() where devices.owner_id=uid returning * into s;
  if s.id is null then raise exception 'Device belongs to another account.' using errcode='42501';end if;
 elsif p_action='disable' then
  update hq_push_private.devices set enabled=false,subscription=null,updated_at=clock_timestamp() where id=p_id and owner_id=uid returning * into s;
 end if;
 if s.id is null then return null;end if;
 return jsonb_build_object('id',s.id,'enabled',s.enabled,'enabled_since',s.enabled_since,'vapid_key',s.vapid_key,'matches',coalesce(s.subscription->>'endpoint'=p_subscription->>'endpoint' and s.subscription->'keys'=p_subscription->'keys',false));
end $$;

-- Recheck source state as defense in depth (including updates made by server tools
-- without the Stage 3B authenticated-user trigger context). Never edit source data.
create function hq_push_private.eligible(p_occurrence uuid,p_device uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.hq_reminder_occurrences o
  join public.hq_reminders r on r.id=o.reminder_id and r.owner_id=o.owner_id
  join hq_push_private.devices s on s.id=p_device and s.owner_id=o.owner_id
  where o.id=p_occurrence and o.status='pending' and r.deleted_at is null
   and s.enabled and o.due_at>=s.enabled_since and o.due_at<=now() and o.due_at>=now()-interval '15 minutes'
   and (r.link_kind='standalone'
    or (r.link_kind='task' and exists(select 1 from public.test_tasks t where t.id=r.task_id and t.owner_id=r.owner_id and not t.completed))
    or (r.link_kind='plan' and exists(select 1 from public.hq_coming_up c where c.id=r.plan_id and c.owner_id=r.owner_id and
      (c.kind='event' or exists(select 1 from public.test_tasks t where t.id=c.task_id and t.owner_id=r.owner_id and not t.completed))))
    or (r.link_kind='routine' and exists(select 1 from public.hq_routines u where u.id=r.routine_id and u.owner_id=r.owner_id and not u.deleted)
      and not exists(select 1 from public.hq_routine_occurrences x where x.routine_id=r.routine_id and x.occurrence_date=r.occurrence_date and x.owner_id=r.owner_id and (x.completed or x.skipped))))
 );
$$;

create function public.hq_push_claim() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 -- A crashed request after sending is ambiguous: NEVER replay it automatically.
 update hq_push_private.deliveries set state='unknown',finished_at=now() where state='sending' and claimed_at<now()-interval '2 minutes';
 insert into hq_push_private.deliveries(occurrence_id,device_id)
 select o.id,s.id from public.hq_reminder_occurrences o join hq_push_private.devices s on s.owner_id=o.owner_id and s.enabled
 where o.status='pending' and o.due_at between greatest(s.enabled_since,now()-interval '15 minutes') and now()
  and hq_push_private.eligible(o.id,s.id)
  and not exists(select 1 from hq_push_private.deliveries d where d.occurrence_id=o.id and d.device_id=s.id)
 order by o.due_at,o.id,s.id limit 100 on conflict do nothing;
 with candidates as (
  select id from hq_push_private.deliveries
  where occurrence_id is not null and attempts<3 and
   ((state in ('ready','retry') and next_attempt_at<=now()) or (state='claimed' and claimed_at<now()-interval '2 minutes'))
  order by next_attempt_at,id for update skip locked limit 20
 ), claimed as (
  update hq_push_private.deliveries d set state='claimed',token=gen_random_uuid(),claimed_at=clock_timestamp()
  from candidates c where d.id=c.id returning d.id,d.token
 ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into result from claimed;
 return result;
end $$;

-- Authenticated test action: one per account per minute, through the SAME sender.
create function public.hq_push_test_claim(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); d hq_push_private.deliveries;
begin
 if uid is null then raise exception 'Please sign in.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 perform 1 from hq_push_private.devices where id=p_id and owner_id=uid and enabled for update;
 if not found then raise exception 'Enable this device first.';end if;
 if exists(select 1 from hq_push_private.deliveries d join hq_push_private.devices s on s.id=d.device_id where s.owner_id=uid and d.occurrence_id is null and d.created_at>now()-interval '1 minute') then raise exception 'Wait a minute before another test.';end if;
 insert into hq_push_private.deliveries(device_id,state,token,claimed_at) values(p_id,'claimed',gen_random_uuid(),clock_timestamp()) returning * into d;
 return jsonb_build_object('id',d.id,'token',d.token);
end $$;

-- Commit a one-use send authorization BEFORE touching the network. A second worker
-- with the same token cannot send. Expired pre-send claims can be safely reclaimed.
create function public.hq_push_begin(p_id uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare d hq_push_private.deliveries; s hq_push_private.devices;
begin
 select * into d from hq_push_private.deliveries where id=p_id for update;
 if d.id is null or d.state<>'claimed' or d.token is distinct from p_token or d.claimed_at<now()-interval '60 seconds' then return null;end if;
 select * into s from hq_push_private.devices where id=d.device_id for update;
 if not s.enabled or s.subscription is null or (d.occurrence_id is not null and not hq_push_private.eligible(d.occurrence_id,s.id)) then
  update hq_push_private.deliveries set state='skipped',finished_at=clock_timestamp() where id=p_id;return null;
 end if;
 update hq_push_private.deliveries set state='sending',attempts=attempts+1,claimed_at=clock_timestamp(),device_updated_at=s.updated_at where id=p_id;
 return jsonb_build_object('subscription',s.subscription,'vapid_key',s.vapid_key,'occurrence_id',d.occurrence_id);
end $$;

-- Only an explicit HTTP 429 (provider rejection) is retried, at most three attempts.
-- Timeouts, 5xx and lost responses are terminal unknown, favoring no duplicates.
create function public.hq_push_finish(p_id uuid,p_token uuid,p_status integer) returns void language plpgsql security definer set search_path='' as $$
declare d hq_push_private.deliveries;
begin
 select * into d from hq_push_private.deliveries where id=p_id for update;
 if d.id is null or d.state<>'sending' or d.token is distinct from p_token then return;end if;
 update hq_push_private.deliveries set http_status=p_status,
  state=case when p_status between 200 and 299 then 'sent' when p_status=429 and d.attempts<3 and d.occurrence_id is not null then 'retry' when p_status=0 or p_status>=500 then 'unknown' else 'failed' end,
  next_attempt_at=clock_timestamp()+interval '5 minutes',finished_at=clock_timestamp() where id=p_id;
 if p_status in (404,410) then update hq_push_private.devices set enabled=false,subscription=null,updated_at=clock_timestamp() where id=d.device_id and updated_at=d.device_updated_at;end if;
end $$;

revoke all on all functions in schema hq_push_private from public,anon,authenticated,service_role;
revoke all on function public.hq_push_device(uuid,text,jsonb,text),public.hq_push_test_claim(uuid),public.hq_push_claim(),public.hq_push_begin(uuid,uuid),public.hq_push_finish(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.hq_push_device(uuid,text,jsonb,text),public.hq_push_test_claim(uuid) to authenticated;
grant execute on function public.hq_push_claim(),public.hq_push_begin(uuid,uuid),public.hq_push_finish(uuid,uuid,integer) to service_role;
notify pgrst,'reload schema';
commit;
