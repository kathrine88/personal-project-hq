-- Run this entire file ONCE in the Supabase SQL Editor BEFORE merging the PR.
-- Additive only: no changes to test_tasks columns, existing rows or policies.
begin;

create table public.hq_routines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  task text not null check (length(trim(task)) between 1 and 2000),
  project text not null default 'Other' check (length(trim(project)) > 0),
  frequency text not null check (frequency in ('daily','weekly','fortnightly','monthly')),
  weekdays smallint[] not null default '{}',
  start_date date not null,
  end_date date,
  paused boolean not null default false,
  deleted boolean not null default false,
  constraint hq_routines_dates check (end_date is null or end_date >= start_date),
  constraint hq_routines_weekdays check (
    weekdays <@ array[1,2,3,4,5,6,7]::smallint[] and
    array_position(weekdays, null) is null and
    (frequency not in ('weekly','fortnightly') or cardinality(weekdays) between 1 and 7)
  ),
  unique (id, owner_id)
);
create index hq_routines_owner on public.hq_routines(owner_id);

create table public.hq_routine_occurrences (
  routine_id uuid not null,
  occurrence_date date not null,
  owner_id uuid not null default auth.uid() references auth.users(id),
  scheduled_date date not null,
  task text check (task is null or length(trim(task)) between 1 and 2000),
  project text check (project is null or length(trim(project)) > 0),
  completed boolean not null default false,
  skipped boolean not null default false,
  primary key (routine_id, occurrence_date),
  foreign key (routine_id, owner_id) references public.hq_routines(id, owner_id)
);
create index hq_occurrences_owner_day on public.hq_routine_occurrences(owner_id, scheduled_date);

create table public.hq_task_positions (
  owner_id uuid not null default auth.uid() references auth.users(id),
  day date not null,
  item_key text not null check (item_key ~ '^(task:[0-9]+|routine:[0-9a-f-]{36}:[0-9]{4}-[0-9]{2}-[0-9]{2})$'),
  position integer not null check (position >= 0),
  primary key (owner_id, day, item_key)
);

alter table public.hq_routines enable row level security;
alter table public.hq_routine_occurrences enable row level security;
alter table public.hq_task_positions enable row level security;

create policy hq_routines_owner on public.hq_routines for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy hq_occurrences_owner on public.hq_routine_occurrences for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy hq_positions_owner on public.hq_task_positions for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

revoke all on public.hq_routines, public.hq_routine_occurrences, public.hq_task_positions from public, anon;
grant select, insert, update, delete on public.hq_routines, public.hq_routine_occurrences, public.hq_task_positions to authenticated;

-- One transaction moves the task/occurrence and replaces ONLY the target day's
-- ordering. Runs as the caller; it does not bypass RLS or accept an owner ID.
create function public.hq_move_task(p_item_key text, p_day date, p_order text[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_task public.test_tasks;
  v_occurrence public.hq_routine_occurrences;
  v_routine uuid;
  v_original date;
  v_key text;
begin
  if v_owner is null then raise exception 'Please sign in.'; end if;
  if p_day is null or p_item_key is null or p_order is null or
    cardinality(p_order) not between 1 and 2000 or
    array_position(p_order, null) is not null or
    not (p_item_key = any(p_order)) or
    (select count(distinct k) from unnest(p_order) k) <> cardinality(p_order)
  then raise exception 'Invalid task order.'; end if;

  -- Serialize ordering/moves for this user, including concurrent tabs/devices.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text, 0));
  foreach v_key in array p_order loop
    if v_key ~ '^task:[0-9]+$' then
      if not exists(select 1 from public.test_tasks where id = split_part(v_key, ':', 2)::bigint and owner_id = v_owner) then
        raise exception 'Task not found.';
      end if;
    elsif v_key ~ '^routine:[0-9a-f-]{36}:[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      if not exists(select 1 from public.hq_routines where id = split_part(v_key, ':', 2)::uuid and owner_id = v_owner) then
        raise exception 'Routine not found.';
      end if;
    else raise exception 'Invalid task key.';
    end if;
  end loop;

  if p_item_key like 'task:%' then
    update public.test_tasks set scheduled_date = p_day
      where id = split_part(p_item_key, ':', 2)::bigint and owner_id = v_owner returning * into v_task;
    if not found then raise exception 'Task not found.'; end if;
  else
    v_routine := split_part(p_item_key, ':', 2)::uuid;
    v_original := split_part(p_item_key, ':', 3)::date;
    if p_day <> v_original or exists (
      select 1 from public.hq_routine_occurrences where routine_id = v_routine and occurrence_date = v_original and owner_id = v_owner
    ) then
      insert into public.hq_routine_occurrences (routine_id, occurrence_date, scheduled_date, task, project)
        select v_routine, v_original, p_day, task, project from public.hq_routines where id = v_routine and owner_id = v_owner
        on conflict (routine_id, occurrence_date) do update set scheduled_date = excluded.scheduled_date
        returning * into v_occurrence;
    end if;
  end if;

  delete from public.hq_task_positions where owner_id = v_owner and
    (day = p_day or (item_key = p_item_key and day <> p_day));
  insert into public.hq_task_positions (owner_id, day, item_key, position)
    select v_owner, p_day, key, (ordinality - 1)::integer
    from unnest(p_order) with ordinality as entries(key, ordinality);
  return jsonb_build_object(
    'task', case when v_task.id is not null then to_jsonb(v_task) else null end,
    'occurrence', case when v_occurrence.routine_id is not null then to_jsonb(v_occurrence) else null end
  );
end;
$$;
revoke all on function public.hq_move_task(text,date,text[]) from public, anon;
grant execute on function public.hq_move_task(text,date,text[]) to authenticated;

notify pgrst, 'reload schema';
commit;
