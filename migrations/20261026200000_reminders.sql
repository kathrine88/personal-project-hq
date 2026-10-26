-- STAGE 3B: Reminders. Run ONCE after Stage 3A. No notifications are sent.
begin;
alter table public.hq_coming_up add constraint hq_coming_id_owner unique(id,owner_id);
create table public.hq_reminders (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 link_kind text not null check(link_kind in ('standalone','task','plan','routine')),
 task_id bigint, plan_id uuid, routine_id uuid, occurrence_date date,
 title text not null check(length(btrim(title)) between 1 and 2000), notes text not null default '' check(length(notes)<=5000),
 timezone text not null, anchor_date date not null check(anchor_date between date '1900-01-01' and date '9998-12-31'),
 anchor_time time(0) not null check(anchor_time<time '24:00'),
 repeat_rule text not null default 'never' check(repeat_rule in ('never','daily','weekly','monthly','yearly')),
 timing text not null default 'custom' check(timing in ('custom','at','hour','day','week')),
 clock_time time(0) not null check(clock_time<time '24:00'),
 sequence integer not null default 0 check(sequence>=0), version integer not null default 1 check(version>0),
 deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(task_id,owner_id) references public.test_tasks(id,owner_id) on delete set null (task_id),
 foreign key(plan_id,owner_id) references public.hq_coming_up(id,owner_id) on delete set null (plan_id),
 foreign key(routine_id,owner_id) references public.hq_routines(id,owner_id) on delete set null (routine_id),
 check(link_kind='standalone' or repeat_rule='never'), check(link_kind<>'standalone' or timing='custom'),
 check(deleted_at is not null or
  (link_kind='standalone' and task_id is null and plan_id is null and routine_id is null and occurrence_date is null) or
  (link_kind='task' and task_id is not null and plan_id is null and routine_id is null and occurrence_date is null) or
  (link_kind='plan' and task_id is null and plan_id is not null and routine_id is null and occurrence_date is null) or
  (link_kind='routine' and task_id is null and plan_id is null and routine_id is not null and occurrence_date is not null and occurrence_date between date '1900-01-01' and date '9998-12-31'))
);
create unique index hq_reminders_one_task on public.hq_reminders(task_id) where deleted_at is null and task_id is not null;
create unique index hq_reminders_one_plan on public.hq_reminders(plan_id) where deleted_at is null and plan_id is not null;
create unique index hq_reminders_one_routine_day on public.hq_reminders(routine_id,occurrence_date) where deleted_at is null and routine_id is not null;
create index hq_reminders_owner on public.hq_reminders(owner_id);
create table public.hq_reminder_occurrences (
 id uuid primary key default gen_random_uuid(), reminder_id uuid not null, owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 sequence integer not null check(sequence>0), title text not null check(length(btrim(title)) between 1 and 2000), repeat_rule text not null default 'never' check(repeat_rule in ('never','daily','weekly','monthly','yearly')), source_kind text not null check(source_kind in ('standalone','task','event')),
 due_at timestamptz not null check(isfinite(due_at)), due_date date not null check(due_date between date '1900-01-01' and date '9998-12-31'), due_time time(0) not null check(due_time<time '24:00'), timezone text not null,
 status text not null default 'pending' check(status in ('pending','dismissed','cancelled')),
 dismissed_at timestamptz, cancelled_at timestamptz, resolution text,
 delivered_at timestamptz, delivery_attempts integer not null default 0 check(delivery_attempts>=0),
 created_at timestamptz not null default now(),
 unique(reminder_id,sequence), foreign key(reminder_id) references public.hq_reminders(id),
 check((status='pending' and dismissed_at is null and cancelled_at is null) or (status='dismissed' and dismissed_at is not null and cancelled_at is null) or (status='cancelled' and cancelled_at is not null and dismissed_at is null))
);
create unique index hq_reminder_one_pending on public.hq_reminder_occurrences(reminder_id) where status='pending';
create index hq_reminder_owner_due on public.hq_reminder_occurrences(owner_id,status,due_at,id);
create index hq_reminder_delivery_due on public.hq_reminder_occurrences(due_at,id) where status='pending' and delivered_at is null;
alter table public.hq_reminders enable row level security;
alter table public.hq_reminders force row level security;
alter table public.hq_reminder_occurrences enable row level security;
alter table public.hq_reminder_occurrences force row level security;
create policy hq_reminders_owner on public.hq_reminders for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy hq_reminder_occurrences_owner on public.hq_reminder_occurrences for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
revoke all on public.hq_reminders,public.hq_reminder_occurrences from public,anon;
grant select,insert,update on public.hq_reminders,public.hq_reminder_occurrences to authenticated;

-- Read the source of truth; never create tasks, plans or routine overrides here.
create function public.hq_reminder_source(r public.hq_reminders) returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.test_tasks; c public.hq_coming_up; u public.hq_routines; o public.hq_routine_occurrences;
begin
 if r.owner_id is distinct from auth.uid() then raise exception 'Please sign in.';end if;
 if r.link_kind='standalone' then return jsonb_build_object('title',r.title,'kind','standalone','date',null,'time',null,'resolved',false);end if;
 if r.link_kind='plan' then
  select * into c from public.hq_coming_up where id=r.plan_id and owner_id=r.owner_id;
  if not found then raise exception 'This plan is no longer available.';end if;
  if c.kind='event' then return jsonb_build_object('title',c.title,'kind','event','date',c.start_date,'time',c.start_time,'resolved',false);end if;
  select * into t from public.test_tasks where id=c.task_id and owner_id=r.owner_id;
 elsif r.link_kind='task' then
  select * into t from public.test_tasks where id=r.task_id and owner_id=r.owner_id;
  if t.project is null then raise exception 'Use the personal plan identifier for this task.';end if;
 else
  select * into u from public.hq_routines where id=r.routine_id and owner_id=r.owner_id;
  if not found or u.deleted then raise exception 'This routine is no longer available.';end if;
  select * into o from public.hq_routine_occurrences where routine_id=r.routine_id and occurrence_date=r.occurrence_date and owner_id=r.owner_id;
  return jsonb_build_object('title',coalesce(o.task,u.task),'kind','task','date',coalesce(o.scheduled_date,r.occurrence_date),'time',null,'resolved',coalesce(o.completed,false) or coalesce(o.skipped,false));
 end if;
 if t.id is null then raise exception 'This task is no longer available.';end if;
 return jsonb_build_object('title',t.task,'kind','task','date',t.scheduled_date,'time',case when r.link_kind='plan' then c.start_time else null end,'resolved',t.completed);
end $$;

create function public.hq_reminder_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare s jsonb;
begin
 if tg_op='UPDATE' then
  if new.id<>old.id or new.owner_id<>old.owner_id or new.link_kind<>old.link_kind or
    (old.deleted_at is not null and new.deleted_at is null) then raise exception 'Reminder identity cannot change.';end if;
  if old.deleted_at is null and new.deleted_at is null and (new.task_id is distinct from old.task_id or new.plan_id is distinct from old.plan_id or new.routine_id is distinct from old.routine_id or new.occurrence_date is distinct from old.occurrence_date) then raise exception 'The linked item cannot change.';end if;
  new.version:=old.version+1;new.created_at:=old.created_at;
 end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.timezone) then raise exception 'Choose a recognised time zone.';end if;
 if new.deleted_at is null then s:=public.hq_reminder_source(new);new.title:=s->>'title';end if;
 new.updated_at:=clock_timestamp();return new;
end $$;
create trigger hq_reminder_guard before insert or update on public.hq_reminders for each row execute function public.hq_reminder_guard();
create function public.hq_reminder_occurrence_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.hq_reminders where id=new.reminder_id and owner_id=new.owner_id and owner_id=auth.uid()) then raise exception 'Reminder not found.';end if;
 if tg_op='UPDATE' then
  if old.status<>'pending' or new.id<>old.id or new.reminder_id<>old.reminder_id or new.owner_id<>old.owner_id or new.sequence<>old.sequence or new.due_at<>old.due_at or new.due_date<>old.due_date or new.due_time<>old.due_time or new.timezone<>old.timezone then raise exception 'An occurrence keeps its identity, due time and history.';end if;
 end if;
 return new;
end $$;
create trigger hq_reminder_occurrence_guard before insert or update on public.hq_reminder_occurrences for each row execute function public.hq_reminder_occurrence_guard();

create function public.hq_reminder_append(p_id uuid,p_date date,p_due timestamptz default null) returns void language plpgsql security invoker set search_path='' as $$
declare r public.hq_reminders; s jsonb;
begin
 select * into r from public.hq_reminders where id=p_id and owner_id=auth.uid() and deleted_at is null for update;
 if not found then raise exception 'Reminder not found.';end if;
 s:=public.hq_reminder_source(r);
 if (s->>'resolved')::boolean then return;end if;
 update public.hq_reminders set sequence=sequence+1 where id=p_id returning * into r;
 insert into public.hq_reminder_occurrences(reminder_id,sequence,title,repeat_rule,source_kind,due_at,due_date,due_time,timezone)
 values(r.id,r.sequence,r.title,r.repeat_rule,s->>'kind',coalesce(p_due,(p_date+r.anchor_time) at time zone r.timezone),p_date,r.anchor_time,r.timezone);
end $$;

-- Original day remains the anchor: Jan 31 -> Feb 28 -> Mar 31; leap day recovers.
create function public.hq_reminder_next(p_date date,p_time time,p_zone text,p_rule text,p_after timestamptz) returns date language plpgsql security invoker set search_path='' as $$
declare n integer; d date; local_day date:=(p_after at time zone p_zone)::date;
begin
 if p_rule='never' then return null;end if;
 if p_rule='daily' then n:=greatest(1,local_day-p_date);
 elsif p_rule='weekly' then n:=greatest(1,(local_day-p_date)/7);
 elsif p_rule='monthly' then n:=greatest(1,(extract(year from local_day)::int-extract(year from p_date)::int)*12+extract(month from local_day)::int-extract(month from p_date)::int);
 elsif p_rule='yearly' then n:=greatest(1,extract(year from local_day)::int-extract(year from p_date)::int);
 else raise exception 'Unknown repetition.';end if;
 loop
  d:=case p_rule when 'daily' then p_date+n when 'weekly' then p_date+7*n when 'monthly' then (p_date+make_interval(months=>n))::date when 'yearly' then (p_date+make_interval(years=>n))::date end;
  if d>date '9998-12-31' then return null;end if;
  if (d+p_time) at time zone p_zone>p_after then return d;end if;
  n:=n+1;
 end loop;
end $$;

-- Refresh only pending occurrences. Completed/reopened sources never resurrect one.
create function public.hq_reminder_sync(p_id uuid,p_removed boolean default false) returns void language plpgsql security invoker set search_path='' as $$
declare r public.hq_reminders; o public.hq_reminder_occurrences; s jsonb; d date; tm time; ts timestamptz; why text;
begin
 select * into r from public.hq_reminders where id=p_id and owner_id=auth.uid() and deleted_at is null for update;
 if not found then return;end if;
 select * into o from public.hq_reminder_occurrences where reminder_id=p_id and owner_id=auth.uid() and status='pending' for update;
 if p_removed then
  update public.hq_reminders set deleted_at=clock_timestamp() where id=p_id;
  why:='Linked item removed';
 else
  s:=public.hq_reminder_source(r);
  update public.hq_reminders set title=s->>'title' where id=p_id returning * into r;
  if (s->>'resolved')::boolean then why:='Task completed or skipped';
  elsif r.timing<>'custom' then
   d:=(s->>'date')::date;tm:=(s->>'time')::time;
   if d is null or (r.timing in ('at','hour') and tm is null) then why:='Linked date or time removed';
   else
    if r.timing in ('day','week') then d:=d-case r.timing when 'day' then 1 else 7 end;tm:=r.clock_time;end if;
    ts:=(d+tm) at time zone r.timezone;
    if r.timing='hour' then ts:=ts-interval '1 hour';d:=(ts at time zone r.timezone)::date;tm:=(ts at time zone r.timezone)::time;end if;
    if o.id is not null and (o.due_at is distinct from ts) then
     update public.hq_reminder_occurrences set status='cancelled',cancelled_at=clock_timestamp(),resolution='Rescheduled with linked item' where id=o.id;
     update public.hq_reminders set anchor_date=d,anchor_time=tm where id=p_id;
     perform public.hq_reminder_append(p_id,d,ts);return;
    end if;
   end if;
  end if;
 end if;
 if why is not null and o.id is not null then
  update public.hq_reminder_occurrences set status='cancelled',cancelled_at=clock_timestamp(),resolution=why where id=o.id;
 elsif o.id is not null then update public.hq_reminder_occurrences set title=r.title,source_kind=s->>'kind' where id=o.id;
 end if;
end $$;

create function public.hq_reminder_source_changed() returns trigger language plpgsql security invoker set search_path='' as $$
declare rid uuid; removed boolean:=tg_op='DELETE'; src jsonb; tid bigint; pid uuid; uid uuid; od date;
begin
 if tg_op='DELETE' then src:=to_jsonb(old);else src:=to_jsonb(new);end if;
 if tg_table_name='test_tasks' then tid:=(src->>'id')::bigint;
 elsif tg_table_name='hq_coming_up' then pid:=(src->>'id')::uuid;
 elsif tg_table_name='hq_routines' then uid:=(src->>'id')::uuid;
 else uid:=(src->>'routine_id')::uuid;od:=(src->>'occurrence_date')::date;end if;
 for rid in select id from public.hq_reminders where owner_id=auth.uid() and deleted_at is null and
  ((tg_table_name='test_tasks' and (task_id=tid or plan_id in(select id from public.hq_coming_up where task_id=tid and owner_id=auth.uid()))) or
   (tg_table_name='hq_coming_up' and plan_id=pid) or
   (tg_table_name='hq_routine_occurrences' and routine_id=uid and occurrence_date=od) or
   (tg_table_name='hq_routines' and routine_id=uid))
 loop
  perform public.hq_reminder_sync(rid,removed or (tg_table_name='hq_routines' and coalesce((src->>'deleted')::boolean,false)));
 end loop;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
-- BEFORE DELETE resolves reminders before FK SET NULL / Coming Up task cleanup.
create trigger hq_reminder_task_update after update on public.test_tasks for each row execute function public.hq_reminder_source_changed();
create trigger hq_reminder_task_delete before delete on public.test_tasks for each row execute function public.hq_reminder_source_changed();
create trigger hq_reminder_plan_update after update on public.hq_coming_up for each row execute function public.hq_reminder_source_changed();
create trigger hq_reminder_plan_delete before delete on public.hq_coming_up for each row execute function public.hq_reminder_source_changed();
create trigger hq_reminder_routine_update after update on public.hq_routines for each row execute function public.hq_reminder_source_changed();
create trigger hq_reminder_routine_delete before delete on public.hq_routines for each row execute function public.hq_reminder_source_changed();
create trigger hq_reminder_override_update after insert or update on public.hq_routine_occurrences for each row execute function public.hq_reminder_source_changed();
create trigger hq_reminder_override_delete after delete on public.hq_routine_occurrences for each row execute function public.hq_reminder_source_changed();

create function public.hq_reminder_snapshot() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('reminders',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.hq_reminders r where owner_id=auth.uid()),'[]'::jsonb),'occurrences',coalesce((select jsonb_agg(to_jsonb(o) order by o.due_at,o.id) from public.hq_reminder_occurrences o where owner_id=auth.uid()),'[]'::jsonb));
$$;
create function public.hq_reminder_change(p_id uuid,p_version integer,p_action text,p_values jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.hq_reminders; candidate public.hq_reminders; s jsonb; o public.hq_reminder_occurrences; d date; tm time; ts timestamptz; v_owner uuid:=auth.uid();
begin
 if v_owner is null then raise exception 'Please sign in.';end if;
 if p_id is null or p_action is null or p_action not in ('save','delete','dismiss') or jsonb_typeof(p_values) is distinct from 'object' then raise exception 'Invalid reminder action.';end if;
 -- Lock source before reminder, matching ordinary source updates. No owner supplied.
 select * into candidate from public.hq_reminders where id=p_id and owner_id=v_owner;
 if candidate.id is null then
  candidate.owner_id:=v_owner;candidate.link_kind:=p_values->>'link_kind';candidate.task_id:=nullif(p_values->>'task_id','')::bigint;candidate.plan_id:=nullif(p_values->>'plan_id','')::uuid;candidate.routine_id:=nullif(p_values->>'routine_id','')::uuid;candidate.occurrence_date:=nullif(p_values->>'occurrence_date','')::date;
 end if;
 if candidate.link_kind='plan' then
  perform 1 from public.test_tasks where id=(select task_id from public.hq_coming_up where id=candidate.plan_id and owner_id=v_owner) and owner_id=v_owner for update;
  perform 1 from public.hq_coming_up where id=candidate.plan_id and owner_id=v_owner for update;
 elsif candidate.link_kind='task' then perform 1 from public.test_tasks where id=candidate.task_id and owner_id=v_owner for update;
 elsif candidate.link_kind='routine' then
  perform 1 from public.hq_routines where id=candidate.routine_id and owner_id=v_owner for update;
  perform 1 from public.hq_routine_occurrences where routine_id=candidate.routine_id and occurrence_date=candidate.occurrence_date and owner_id=v_owner for update;
 end if;
 select * into r from public.hq_reminders where id=p_id and owner_id=v_owner for update;
 if r.id is null then
  if p_version is not null or p_action<>'save' then raise exception 'Reminder changed. Reload.' using errcode='40001';end if;
 else
  if p_version is distinct from r.version or r.deleted_at is not null then raise exception 'Reminder changed. Reload.' using errcode='40001';end if;
 end if;
 if p_action='delete' then
  update public.hq_reminder_occurrences set status='cancelled',cancelled_at=clock_timestamp(),resolution='Reminder removed' where reminder_id=p_id and owner_id=v_owner and status='pending';
  update public.hq_reminders set deleted_at=clock_timestamp(),repeat_rule='never' where id=p_id;
 elsif p_action='dismiss' then
  select * into o from public.hq_reminder_occurrences where id=(p_values->>'occurrence_id')::uuid and reminder_id=p_id and owner_id=v_owner and status='pending' for update;
  if o.id is null or o.due_at>clock_timestamp() then raise exception 'This occurrence is no longer due. Reload.' using errcode='40001';end if;
  update public.hq_reminder_occurrences set status='dismissed',dismissed_at=clock_timestamp(),resolution='Dismissed' where id=o.id;
  update public.hq_reminders set updated_at=clock_timestamp() where id=p_id;
  if r.link_kind='standalone' and r.repeat_rule<>'never' then
   d:=public.hq_reminder_next(r.anchor_date,r.anchor_time,r.timezone,r.repeat_rule,greatest(clock_timestamp(),o.due_at));
   if d is not null then perform public.hq_reminder_append(p_id,d);end if;
  end if;
 else
  candidate.id:=p_id;candidate.title:=btrim(p_values->>'title');candidate.notes:=coalesce(p_values->>'notes','');
  candidate.timezone:=p_values->>'timezone';candidate.anchor_date:=(p_values->>'date')::date;candidate.anchor_time:=(p_values->>'time')::time(0);
  candidate.repeat_rule:=coalesce(p_values->>'repeat_rule','never');candidate.timing:=coalesce(p_values->>'timing','custom');candidate.clock_time:=candidate.anchor_time;
  s:=public.hq_reminder_source(candidate);
  if (s->>'resolved')::boolean then raise exception 'This task is completed or skipped. Reopen it before explicitly setting a new reminder.';end if;
  if candidate.link_kind<>'standalone' then candidate.title:=s->>'title';candidate.notes:='';end if;
  if candidate.timing<>'custom' then
   d:=(s->>'date')::date;tm:=(s->>'time')::time;
   if d is null or (candidate.timing in ('at','hour') and tm is null) then raise exception 'Choose Custom, or add the required date/time to the item first.';end if;
   if candidate.timing in ('day','week') then d:=d-case candidate.timing when 'day' then 1 else 7 end;tm:=candidate.clock_time;end if;
   ts:=(d+tm) at time zone candidate.timezone;
   if candidate.timing='hour' then ts:=ts-interval '1 hour';d:=(ts at time zone candidate.timezone)::date;tm:=(ts at time zone candidate.timezone)::time;end if;
   candidate.anchor_date:=d;candidate.anchor_time:=tm;
  end if;
  if r.id is null then
   insert into public.hq_reminders(id,link_kind,task_id,plan_id,routine_id,occurrence_date,title,notes,timezone,anchor_date,anchor_time,repeat_rule,timing,clock_time)
   values(p_id,candidate.link_kind,candidate.task_id,candidate.plan_id,candidate.routine_id,candidate.occurrence_date,candidate.title,candidate.notes,candidate.timezone,candidate.anchor_date,candidate.anchor_time,candidate.repeat_rule,candidate.timing,candidate.clock_time);
  else
   update public.hq_reminder_occurrences set status='cancelled',cancelled_at=clock_timestamp(),resolution='Reminder edited' where reminder_id=p_id and owner_id=v_owner and status='pending';
   update public.hq_reminders set title=candidate.title,notes=candidate.notes,timezone=candidate.timezone,anchor_date=candidate.anchor_date,anchor_time=candidate.anchor_time,repeat_rule=candidate.repeat_rule,timing=candidate.timing,clock_time=candidate.clock_time where id=p_id;
  end if;
  perform public.hq_reminder_append(p_id,candidate.anchor_date,case when candidate.timing<>'custom' then ts else null end);
 end if;
 return public.hq_reminder_snapshot();
end $$;
-- Invoker helpers are owner-scoped; trigger functions cannot be called as RPCs.
revoke all on function public.hq_reminder_guard(),public.hq_reminder_occurrence_guard(),public.hq_reminder_source_changed() from public,anon,authenticated;
revoke all on function public.hq_reminder_source(public.hq_reminders),public.hq_reminder_append(uuid,date,timestamptz),public.hq_reminder_next(date,time,text,text,timestamptz),public.hq_reminder_sync(uuid,boolean),public.hq_reminder_snapshot(),public.hq_reminder_change(uuid,integer,text,jsonb) from public,anon;
grant execute on function public.hq_reminder_source(public.hq_reminders),public.hq_reminder_append(uuid,date,timestamptz),public.hq_reminder_next(date,time,text,text,timestamptz),public.hq_reminder_sync(uuid,boolean),public.hq_reminder_snapshot(),public.hq_reminder_change(uuid,integer,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
