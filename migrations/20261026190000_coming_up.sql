-- STAGE 3A — Coming Up and shared weekly tasks. Run manually, once.
-- No existing rows are backfilled, reclassified, completed, or deleted.
begin;
-- New personal to-dos have NO project. Existing non-null project values are unchanged.
alter table public.test_tasks alter column project drop not null;
alter table public.test_tasks add constraint test_tasks_id_owner_unique unique(id,owner_id);
alter table public.test_tasks add constraint hq_personal_task_calendar_date check(project is not null or scheduled_date is null or scheduled_date between date '0001-01-01' and date '9999-12-31');
create table public.hq_coming_up (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check(kind in ('event','todo')),
  task_id bigint unique,
  title text,
  notes text not null default '' check(length(notes)<=5000),
  start_date date check(start_date is null or start_date between date '0001-01-01' and date '9999-12-31'),
  end_date date check(end_date is null or end_date between date '0001-01-01' and date '9999-12-31'),
  start_time time(0) check(start_time is null or start_time<time '24:00'),
  all_day boolean not null default true,
  version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(task_id,owner_id) references public.test_tasks(id,owner_id) on delete cascade,
  constraint hq_coming_shape check(
    (kind='event' and task_id is null and title is not null and length(btrim(title)) between 1 and 500
      and (end_date is null or (start_date is not null and end_date>=start_date))
      and ((start_date is null and end_date is null and start_time is null and all_day)
        or (start_date is not null and ((all_day and start_time is null) or (not all_day and start_time is not null)))))
    or (kind='todo' and task_id is not null and title is null and start_date is null and end_date is null and all_day=(start_time is null))
  )
);
create index hq_coming_up_owner_date on public.hq_coming_up(owner_id,start_date,id);
alter table public.hq_coming_up enable row level security;
alter table public.hq_coming_up force row level security;
create policy "Own Coming Up plans" on public.hq_coming_up for all to authenticated
  using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
revoke all on public.hq_coming_up from public,anon;
grant select,insert,update,delete on public.hq_coming_up to authenticated;

create function public.hq_coming_touch()
returns trigger language plpgsql security invoker set search_path='' as $$
declare t public.test_tasks;
begin
  if tg_op='UPDATE' then
    if new.id<>old.id or new.owner_id<>old.owner_id then raise exception 'A plan must keep its owner and identity.';end if;
    new.created_at:=old.created_at;new.version:=old.version+1;
  else new.created_at:=clock_timestamp();new.version:=1;end if;
  if new.kind='todo' then
    select * into t from public.test_tasks where id=new.task_id and owner_id=new.owner_id;
    if not found or t.project is not null then raise exception 'A Coming Up to-do must use its own personal task.';end if;
    if t.scheduled_date is null and new.start_time is not null then raise exception 'Choose a date before adding a time.';end if;
  end if;
  new.updated_at:=clock_timestamp();return new;
end;
$$;
create trigger hq_coming_touch before insert or update on public.hq_coming_up for each row execute function public.hq_coming_touch();

-- Both views read the SAME task. Normal checkbox/date/drag mutations also bump
-- the plan revision, preventing stale forms overwriting newer task changes.
create function public.hq_coming_task_changed()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.project is null or old.project is null then
    if new.scheduled_date is distinct from old.scheduled_date then
      delete from public.hq_task_positions where owner_id=new.owner_id and item_key='task:'||new.id::text;
    end if;
    update public.hq_coming_up set
      start_time=case when new.scheduled_date is null then null else start_time end,
      all_day=case when new.scheduled_date is null then true else all_day end
    where task_id=new.id and owner_id=new.owner_id;
  end if;
  return null;
end;
$$;
create trigger hq_coming_task_changed after update on public.test_tasks for each row execute function public.hq_coming_task_changed();

-- A direct task deletion cascades its plan. A plan deletion/type conversion
-- removes ONLY its linked personal task and that task's saved ordering keys.
create function public.hq_coming_cleanup_task()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.task_id is not null then
    if tg_op='UPDATE' then if new.task_id is not distinct from old.task_id then return null;end if;end if;
    delete from public.hq_task_positions where owner_id=old.owner_id and item_key='task:'||old.task_id::text;
    if pg_trigger_depth()=1 then delete from public.test_tasks where id=old.task_id and owner_id=old.owner_id and project is null;end if;
  end if;
  return null;
end;
$$;
create trigger hq_coming_cleanup_task after delete or update of task_id on public.hq_coming_up for each row execute function public.hq_coming_cleanup_task();

-- Nullable project is reserved for linked Coming Up tasks. Deferral permits an
-- atomic task INSERT followed by the plan INSERT; no unlinked null-project tasks
-- can be committed. Ordinary project tasks keep their existing behaviour.
create function public.hq_coming_task_invariant()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_project text;v_linked boolean;
begin
  select t.project,exists(select 1 from public.hq_coming_up c where c.task_id=t.id and c.owner_id=t.owner_id)
    into v_project,v_linked from public.test_tasks t where t.id=new.id and t.owner_id=new.owner_id;
  if found and ((v_project is null)<>v_linked) then raise exception 'Personal tasks must stay linked to Coming Up; project tasks must remain independent.';end if;
  return null;
end;
$$;
create constraint trigger hq_coming_task_invariant after insert or update on public.test_tasks deferrable initially deferred for each row execute function public.hq_coming_task_invariant();

create function public.hq_coming_snapshot()
returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]'::jsonb) from public.hq_coming_up c where c.owner_id=(select auth.uid());
$$;
create function public.hq_coming_change(p_id uuid,p_version integer,p_action text,p_values jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare
  v_owner uuid:=auth.uid();c public.hq_coming_up;t public.test_tasks;
  v_old_task bigint;v_task bigint;v_kind text;v_title text;v_notes text;
  v_date date;v_end date;v_time time(0);v_all_day boolean;
begin
  if v_owner is null then raise exception 'Please sign in.' using errcode='42501';end if;
  if p_id is null then raise exception 'Missing plan ID.';end if;
  perform pg_advisory_xact_lock(hashtextextended('coming:'||v_owner::text,0));
  -- Match the existing task-update -> plan-update lock order to avoid deadlocks.
  select task_id into v_old_task from public.hq_coming_up where id=p_id and owner_id=v_owner;
  if v_old_task is not null then perform 1 from public.test_tasks where id=v_old_task and owner_id=v_owner for update;end if;
  select * into c from public.hq_coming_up where id=p_id and owner_id=v_owner for update;
  if c.id is not null then
    if p_version is distinct from c.version then raise exception 'This plan changed. Reload before editing.' using errcode='40001';end if;
  elsif p_version is not null or p_action='delete' then raise exception 'This plan was deleted. Reload.' using errcode='40001';end if;
  if p_action='delete' then
    delete from public.hq_coming_up where id=p_id and owner_id=v_owner;
    return jsonb_build_object('entry_id',p_id,'entry',null,'task',null,'removed_task_id',v_old_task);
  end if;
  if p_action is distinct from 'save' or jsonb_typeof(p_values) is distinct from 'object' then raise exception 'Unknown plan action.';end if;
  v_kind:=p_values->>'kind';v_title:=btrim(p_values->>'title');v_notes:=coalesce(p_values->>'notes','');
  if v_kind is null or v_kind not in ('event','todo') or v_title is null or length(v_title) not between 1 and 500 or length(v_notes)>5000 then raise exception 'Choose a type and a title of 1–500 characters; notes must be under 5,001 characters.';end if;
  v_date:=nullif(p_values->>'start_date','')::date;v_end:=nullif(p_values->>'end_date','')::date;
  v_all_day:=coalesce((p_values->>'all_day')::boolean,true);v_time:=nullif(p_values->>'start_time','')::time(0);
  if v_date is not null and (v_date<date '0001-01-01' or v_date>date '9999-12-31') then raise exception 'Choose a finite calendar date.';end if;
  if v_date is null then v_time:=null;v_all_day:=true;end if;
  if v_kind='todo' then
    if v_end is not null then raise exception 'To-dos use one scheduled date.';end if;
    if c.task_id is not null then
      update public.test_tasks set task=v_title,scheduled_date=v_date where id=c.task_id and owner_id=v_owner and project is null returning * into t;
      if not found then raise exception 'Task not found.';end if;
    else insert into public.test_tasks(project,task,completed,scheduled_date) values(null,v_title,false,v_date) returning * into t;end if;
    v_task:=t.id;
  end if;
  if c.id is null then
    insert into public.hq_coming_up(id,kind,task_id,title,notes,start_date,end_date,start_time,all_day)
      values(p_id,v_kind,v_task,case when v_kind='event' then v_title else null end,v_notes,case when v_kind='event' then v_date else null end,case when v_kind='event' then v_end else null end,v_time,v_all_day) returning * into c;
  else
    update public.hq_coming_up set kind=v_kind,task_id=v_task,title=case when v_kind='event' then v_title else null end,notes=v_notes,
      start_date=case when v_kind='event' then v_date else null end,end_date=case when v_kind='event' then v_end else null end,start_time=v_time,all_day=v_all_day
      where id=p_id and owner_id=v_owner returning * into c;
  end if;
  return jsonb_build_object('entry_id',p_id,'entry',to_jsonb(c),'task',case when v_task is not null then to_jsonb(t) else null end,'removed_task_id',case when v_old_task is distinct from v_task then v_old_task else null end);
end;
$$;
revoke all on function public.hq_coming_touch(),public.hq_coming_task_changed(),public.hq_coming_cleanup_task(),public.hq_coming_task_invariant() from public,anon,authenticated;
revoke all on function public.hq_coming_snapshot(),public.hq_coming_change(uuid,integer,text,jsonb) from public,anon;
grant execute on function public.hq_coming_snapshot(),public.hq_coming_change(uuid,integer,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
