-- PROJECT PAGES — STAGE 1. Run manually in the Supabase SQL Editor, once.
-- Additive only. No existing tasks, routines, meals, shopping or money rows change.
begin;

create table public.hq_project_sections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project text not null check (project in ('Garden','Book Nook','Christmas Planning','Health & Fitness','Home Projects','Other')),
  name text not null check (length(btrim(name)) between 1 and 200),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  unique (id, owner_id, project)
);
create index hq_project_sections_owner_project_order on public.hq_project_sections(owner_id, project, position, id);

create table public.hq_project_milestones (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project text not null,
  section_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 200),
  completed boolean not null default false,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  foreign key (section_id, owner_id, project) references public.hq_project_sections(id, owner_id, project) on delete cascade
);
create index hq_project_milestones_owner_project_section_order on public.hq_project_milestones(owner_id, project, section_id, position, id);

alter table public.hq_project_sections enable row level security;
alter table public.hq_project_milestones enable row level security;
create policy "Own project sections" on public.hq_project_sections for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Own project milestones" on public.hq_project_milestones for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
revoke all on public.hq_project_sections, public.hq_project_milestones from public, anon;
grant select, insert, update, delete on public.hq_project_sections, public.hq_project_milestones to authenticated;

-- One statement/snapshot: complete arrays are not truncated by the REST row limit.
-- Revision is an optimistic concurrency token, not an authorization credential.
create function public.hq_project_snapshot(p_project text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with snapshot as (
    select jsonb_build_object(
      'sections', coalesce((select jsonb_agg(to_jsonb(s) order by s.position, s.id)
        from public.hq_project_sections s where s.owner_id = (select auth.uid()) and s.project = p_project), '[]'::jsonb),
      'milestones', coalesce((select jsonb_agg(to_jsonb(m) order by m.section_id, m.position, m.id)
        from public.hq_project_milestones m where m.owner_id = (select auth.uid()) and m.project = p_project), '[]'::jsonb)
    ) as data
  ) select data || jsonb_build_object('revision', md5(data::text)) from snapshot;
$$;

-- All app writes for one owner/project are serialized, scoped and atomic.
-- A stale snapshot cannot rename/delete/reorder over another session's changes.
create function public.hq_project_change(p_project text, p_revision text, p_action text, p_values jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_id uuid;
  v_section uuid;
  v_name text;
  v_ids uuid[];
  v_current uuid[];
  v_snapshot jsonb;
  v_rows integer;
begin
  if v_owner is null then raise exception 'Please sign in to save your project.' using errcode = '42501'; end if;
  if p_project is null or p_project not in ('Garden','Book Nook','Christmas Planning','Health & Fitness','Home Projects','Other') then
    raise exception 'Unknown project.' using errcode = '22023';
  end if;
  if p_values is null or jsonb_typeof(p_values) <> 'object' then raise exception 'Invalid project change.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text || ':' || p_project, 0));
  v_snapshot := public.hq_project_snapshot(p_project);
  if p_revision is null or p_revision <> (v_snapshot->>'revision') then
    raise exception 'This project changed. Reload before making more changes.' using errcode = '40001';
  end if;
  if p_action in ('save_section','delete_section','save_milestone','delete_milestone','complete_milestone') then
    v_id := (p_values->>'id')::uuid;
    if v_id is null then raise exception 'Missing record ID.' using errcode = '22023'; end if;
  end if;
  if p_action in ('save_milestone','delete_milestone','complete_milestone','order_milestones') then
    v_section := (p_values->>'section_id')::uuid;
    perform 1 from public.hq_project_sections where id = v_section and owner_id = v_owner and project = p_project;
    if not found then raise exception 'Subsection not found in this project.' using errcode = '22023'; end if;
  end if;
  if p_action in ('save_section','save_milestone') then
    if jsonb_typeof(p_values->'name') is distinct from 'string' then raise exception 'Enter a name.' using errcode = '22023'; end if;
    v_name := btrim(p_values->>'name');
    if length(v_name) not between 1 and 200 then raise exception 'Enter a name between 1 and 200 characters.' using errcode = '22023'; end if;
  end if;

  case p_action
  when 'save_section' then
    update public.hq_project_sections set name = v_name where id = v_id and owner_id = v_owner and project = p_project;
    if not found then
      insert into public.hq_project_sections(id, owner_id, project, name, position)
        select v_id, v_owner, p_project, v_name, coalesce(max(position), -1) + 1
        from public.hq_project_sections where owner_id = v_owner and project = p_project;
    end if;
  when 'delete_section' then
    -- Composite FK cascades only this owner's subsection's milestones.
    delete from public.hq_project_sections where id = v_id and owner_id = v_owner and project = p_project;
    if not found then raise exception 'Subsection not found.' using errcode = '22023'; end if;
  when 'save_milestone' then
    update public.hq_project_milestones set name = v_name where id = v_id and owner_id = v_owner and project = p_project and section_id = v_section;
    if not found then
      insert into public.hq_project_milestones(id, owner_id, project, section_id, name, position)
        select v_id, v_owner, p_project, v_section, v_name, coalesce(max(position), -1) + 1
        from public.hq_project_milestones where owner_id = v_owner and project = p_project and section_id = v_section;
    end if;
  when 'complete_milestone' then
    if jsonb_typeof(p_values->'completed') is distinct from 'boolean' then raise exception 'Invalid completion value.' using errcode = '22023'; end if;
    update public.hq_project_milestones set completed = (p_values->>'completed')::boolean
      where id = v_id and owner_id = v_owner and project = p_project and section_id = v_section;
    if not found then raise exception 'Milestone not found.' using errcode = '22023'; end if;
  when 'delete_milestone' then
    delete from public.hq_project_milestones where id = v_id and owner_id = v_owner and project = p_project and section_id = v_section;
    if not found then raise exception 'Milestone not found.' using errcode = '22023'; end if;
  when 'order_sections', 'order_milestones' then
    if jsonb_typeof(p_values->'ids') is distinct from 'array' then raise exception 'Invalid order.' using errcode = '22023'; end if;
    select coalesce(array_agg(x::uuid order by ord), '{}'::uuid[]) into v_ids from jsonb_array_elements_text(p_values->'ids') with ordinality as t(x, ord);
    if p_action = 'order_sections' then
      select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_current from public.hq_project_sections where owner_id = v_owner and project = p_project;
    else
      select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_current from public.hq_project_milestones where owner_id = v_owner and project = p_project and section_id = v_section;
    end if;
    -- Exact permutation only: cannot include duplicates, omit rows, or cross scope.
    if cardinality(v_ids) <> cardinality(v_current) or
       (select coalesce(array_agg(distinct x order by x), '{}'::uuid[]) from unnest(v_ids) as t(x)) is distinct from v_current then
      raise exception 'The list changed. Reload before reordering.' using errcode = '40001';
    end if;
    if p_action = 'order_sections' then
      update public.hq_project_sections s set position = t.ord::integer - 1 from unnest(v_ids) with ordinality as t(id, ord)
        where s.id = t.id and s.owner_id = v_owner and s.project = p_project;
    else
      update public.hq_project_milestones m set position = t.ord::integer - 1 from unnest(v_ids) with ordinality as t(id, ord)
        where m.id = t.id and m.owner_id = v_owner and m.project = p_project and m.section_id = v_section;
    end if;
    get diagnostics v_rows = row_count;
    if v_rows <> cardinality(v_ids) then raise exception 'The list changed. Reload before reordering.' using errcode = '40001'; end if;
  else raise exception 'Unknown project action.' using errcode = '22023';
  end case;
  return public.hq_project_snapshot(p_project);
end;
$$;
revoke all on function public.hq_project_snapshot(text), public.hq_project_change(text, text, text, jsonb) from public, anon;
grant execute on function public.hq_project_snapshot(text), public.hq_project_change(text, text, text, jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
