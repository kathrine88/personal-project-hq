-- STAGE 2A — PROJECT SOURCE LIBRARY. Run manually in Supabase SQL Editor, once.
-- Links + written notes only. No Storage, uploads, metadata fetching or existing data rewrites.
begin;
do $$ begin
  if to_regclass('public.hq_project_sections') is null then
    raise exception 'Project Pages Stage 1 must be installed before Source Library.';
  end if;
  if current_setting('server_version_num')::integer < 150000 then
    raise exception 'This migration requires PostgreSQL 15 or later for scoped ON DELETE SET NULL.';
  end if;
end $$;

create table public.hq_project_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project text not null check (project in ('Garden','Book Nook','Christmas Planning','Health & Fitness','Home Projects','Other')),
  section_id uuid,
  -- Text + named checks can be extended additively for Stage 2B; no fixed enum or file columns yet.
  source_type text not null,
  url text,
  title text not null check (length(btrim(title)) between 1 and 300),
  description text not null default '' check (length(description) <= 2000),
  note_content text not null default '' check (length(note_content) <= 50000),
  preview_image_url text check (preview_image_url is null or
    (length(preview_image_url) <= 2048 and preview_image_url ~ '^https://[^/@[:space:]]+(/|$)' and preview_image_url !~ '[[:space:]]')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hq_project_sources_type check (source_type in ('link','note')),
  constraint hq_project_sources_content check (
    (source_type = 'link' and url is not null and length(url) <= 2048
      and url ~ '^https?://[^/@[:space:]]+(/|$)' and url !~ '[[:space:]]')
    or (source_type = 'note' and url is null and preview_image_url is null and description = '' and length(btrim(note_content)) > 0)
  ),
  -- Preserve project/owner on deletion; only the optional subsection is cleared.
  -- The composite FK prevents cross-owner AND cross-project assignments on insert/update.
  constraint hq_project_sources_section foreign key (section_id,owner_id,project)
    references public.hq_project_sections(id,owner_id,project) on delete set null (section_id)
);
create index hq_project_sources_owner_project_type_created on public.hq_project_sources(owner_id,project,source_type,created_at desc,id);
create index hq_project_sources_owner_project_section on public.hq_project_sources(owner_id,project,section_id);

alter table public.hq_project_sources enable row level security;
alter table public.hq_project_sources force row level security;
create policy "Own project sources" on public.hq_project_sources for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
revoke all on public.hq_project_sources from public, anon;
grant select,insert,update,delete on public.hq_project_sources to authenticated;

-- Server-owned timestamps/revision also update when a deleted subsection clears its FK.
create function public.hq_source_timestamps()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.owner_id is distinct from old.owner_id or new.project is distinct from old.project then
      raise exception 'A source must stay with its original owner and project.' using errcode = '22023';
    end if;
    new.created_at := old.created_at;
    new.version := old.version + 1;
  else
    new.created_at := clock_timestamp();
    new.version := 1;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger hq_project_sources_timestamps before insert or update on public.hq_project_sources
  for each row execute function public.hq_source_timestamps();
revoke all on function public.hq_source_timestamps() from public, anon, authenticated;

-- Sources and subsection names from one consistent, complete read (no REST row-limit truncation).
create function public.hq_source_library(p_project text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'sources', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc,s.id)
      from public.hq_project_sources s where s.owner_id = (select auth.uid()) and s.project = p_project),'[]'::jsonb),
    'sections', coalesce((select jsonb_agg(to_jsonb(s) order by s.position,s.id)
      from public.hq_project_sections s where s.owner_id = (select auth.uid()) and s.project = p_project),'[]'::jsonb)
  );
$$;
revoke all on function public.hq_source_library(text) from public, anon;
grant execute on function public.hq_source_library(text) to authenticated;
notify pgrst, 'reload schema';
commit;
