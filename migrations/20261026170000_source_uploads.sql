-- STAGE 2B: source records, recovery journal and private Storage access.
-- Run once, manually. This file DOES NOT create the bucket or deploy the Edge Function.
begin;
alter table public.hq_project_sources
  add column storage_path text,
  add column original_filename text,
  add column mime_type text,
  add column file_size bigint,
  add column file_status text not null default 'ready' check (file_status in ('ready','deleting'));
alter table public.hq_project_sources drop constraint hq_project_sources_type;
alter table public.hq_project_sources drop constraint hq_project_sources_content;
alter table public.hq_project_sources add constraint hq_project_sources_type check (source_type in ('link','note','image','file'));
alter table public.hq_project_sources add constraint hq_project_sources_content check (
  (source_type='link' and url is not null and length(url)<=2048 and url ~ '^https?://[^/@[:space:]]+(/|$)' and url !~ '[[:space:]]')
  or (source_type='note' and url is null and preview_image_url is null and description='' and length(btrim(note_content))>0)
  or (source_type in ('image','file') and url is null and preview_image_url is null)
);
alter table public.hq_project_sources add constraint hq_project_sources_file_fields check (
  (source_type in ('link','note') and storage_path is null and original_filename is null and mime_type is null and file_size is null and file_status='ready')
  or (source_type in ('image','file') and storage_path is not null and original_filename is not null and mime_type is not null and file_size is not null and file_size between 1 and 20971520
    and length(original_filename) between 1 and 180 and original_filename !~ '[[:cntrl:]/\\]'
    and storage_path ~ ('^'||owner_id::text||'/'||id::text||'/[0-9a-f-]{36}\.(jpg|png|webp|heic|heif|pdf|docx|xlsx|txt)$')
    and ((source_type='image' and mime_type in ('image/jpeg','image/png','image/webp','image/heic','image/heif'))
      or (source_type='file' and mime_type in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain'))))
);
create unique index hq_project_sources_storage_path on public.hq_project_sources(storage_path) where storage_path is not null;
-- Keep authentication/RLS on ALL rows. Browser writes can edit metadata but not file pointers.
drop policy "Own project sources" on public.hq_project_sources;
create policy "Read own sources" on public.hq_project_sources for select to authenticated using (owner_id=(select auth.uid()));
create policy "Add own links and notes" on public.hq_project_sources for insert to authenticated
  with check (owner_id=(select auth.uid()) and source_type in ('link','note'));
create policy "Edit own ready source metadata" on public.hq_project_sources for update to authenticated
  using (owner_id=(select auth.uid()) and file_status='ready') with check (owner_id=(select auth.uid()) and file_status='ready');
create policy "Delete own links and notes" on public.hq_project_sources for delete to authenticated
  using (owner_id=(select auth.uid()) and source_type in ('link','note'));
revoke update on public.hq_project_sources from authenticated;
grant update(source_type,url,title,description,note_content,section_id) on public.hq_project_sources to authenticated;
grant all on public.hq_project_sources to service_role;
create or replace function public.hq_source_timestamps()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if new.id is distinct from old.id or new.owner_id is distinct from old.owner_id or new.project is distinct from old.project or new.source_type is distinct from old.source_type then
      raise exception 'A source must keep its original identity and type.' using errcode='22023';
    end if;
    new.created_at:=old.created_at;new.version:=old.version+1;
  else new.created_at:=clock_timestamp();new.version:=1;
  end if;
  new.updated_at:=clock_timestamp();return new;
end;
$$;

-- A durable journal is essential: Storage and Postgres cannot share a transaction.
-- No source FK: recovery must survive an interrupted creation/deletion.
create table public.hq_source_file_operations (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  project text not null check (project in ('Garden','Book Nook','Christmas Planning','Health & Fitness','Home Projects','Other')),
  source_id uuid not null,
  state text not null check (state in ('staging','committed','discarded','deleting','finished')),
  candidate_path text,
  obsolete_path text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index hq_source_file_operations_owner_project on public.hq_source_file_operations(owner_id,project,created_at);
create unique index hq_source_file_operations_one_staging on public.hq_source_file_operations(owner_id,source_id) where state='staging';
alter table public.hq_source_file_operations enable row level security;
alter table public.hq_source_file_operations force row level security;
create policy "Read own file recovery status" on public.hq_source_file_operations for select to authenticated using (owner_id=(select auth.uid()));
revoke all on public.hq_source_file_operations from public,anon,authenticated;
grant select on public.hq_source_file_operations to authenticated;
grant all on public.hq_source_file_operations to service_role;

-- Only the server's service role can invoke this RPC. Edge validates the real user
-- with Auth first and supplies that verified UUID. No SECURITY DEFINER functions.
create function public.hq_source_file_command(p_owner uuid,p_action text,p_input jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare
  j public.hq_source_file_operations;
  s public.hq_project_sources;
  v_id uuid:=(p_input->>'id')::uuid;
  v_op uuid:=(p_input->>'operation')::uuid;
  v_project text:=p_input->>'project';
  v_path text;
  v_result jsonb;
begin
  if current_user<>'service_role' or p_owner is null then raise exception 'Server access only.' using errcode='42501';end if;
  -- Serialize all file operations for this owner, including cleanup and deletes.
  perform pg_advisory_xact_lock(hashtextextended('source-files:'||p_owner::text,0));
  if p_action='list' then
    select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v_result from
      (select * from public.hq_source_file_operations where owner_id=p_owner and project=v_project
       and state<>'finished' and (state<>'staging' or created_at<now()-interval '10 minutes') order by created_at limit 3) q;
    return v_result;
  end if;
  if p_action='begin' then
    if v_id is null or v_op is null or v_project not in ('Garden','Book Nook','Christmas Planning','Health & Fitness','Home Projects','Other') then raise exception 'Invalid upload identity.';end if;
    if p_input->>'extension' not in ('jpg','png','webp','heic','heif','pdf','docx','xlsx','txt') or p_input->>'source_type' not in ('image','file')
      or (p_input->>'file_size')::bigint not between 1 and 20971520 or p_input->>'sha256' !~ '^[0-9a-f]{64}$' then raise exception 'Invalid file metadata.';end if;
    v_path:=p_owner::text||'/'||v_id::text||'/'||v_op::text||'.'||(p_input->>'extension');
    select * into s from public.hq_project_sources where id=v_id and owner_id=p_owner and project=v_project for update;
    if found and s.storage_path=v_path and s.file_status='ready' then return jsonb_build_object('already_saved',true,'source',to_jsonb(s));end if;
    if s.id is not null then
      if s.version is distinct from (p_input->>'version')::integer or s.source_type<>p_input->>'source_type' or s.file_status<>'ready' then raise exception 'This source changed. Reload before replacing it.' using errcode='40001';end if;
    elsif p_input->>'version' is not null then raise exception 'Source not found.' using errcode='40001';end if;
    if p_input->>'section_id' is not null and not exists(select 1 from public.hq_project_sections where id=(p_input->>'section_id')::uuid and owner_id=p_owner and project=v_project) then raise exception 'Subsection not found in this project.' using errcode='23503';end if;
    select * into j from public.hq_source_file_operations where id=v_op;
    if found then
      if j.owner_id<>p_owner or j.source_id<>v_id or j.payload<>p_input then raise exception 'Upload identity conflict. Reload before retrying.';end if;
      return to_jsonb(j);
    end if;
    if exists(select 1 from storage.objects where bucket_id='hq-source-files' and name=v_path) then raise exception 'File path already exists. Reload and choose the file again.';end if;
    insert into public.hq_source_file_operations(id,owner_id,project,source_id,state,candidate_path,obsolete_path,payload)
      values(v_op,p_owner,v_project,v_id,'staging',v_path,s.storage_path,p_input) returning * into j;
    return to_jsonb(j);
  end if;
  if p_action='delete' then
    select * into j from public.hq_source_file_operations where owner_id=p_owner and source_id=v_id and project=v_project and state='deleting';
    if found then return to_jsonb(j);end if;
    select * into s from public.hq_project_sources where id=v_id and owner_id=p_owner and project=v_project for update;
    if not found then return jsonb_build_object('already_deleted',true);end if;
    if s.source_type not in ('image','file') or s.version is distinct from (p_input->>'version')::integer then raise exception 'This source changed. Reload before deleting it.' using errcode='40001';end if;
    update public.hq_project_sources set file_status='deleting' where id=s.id;
    insert into public.hq_source_file_operations(id,owner_id,project,source_id,state,obsolete_path,payload)
      values(v_op,p_owner,v_project,v_id,'deleting',s.storage_path,p_input) returning * into j;
    return to_jsonb(j);
  end if;
  select * into j from public.hq_source_file_operations where id=v_op and owner_id=p_owner for update;
  if not found then return jsonb_build_object('finished',true);end if;
  if p_action='discard' then
    -- Never discard an upload that committed while its response was lost.
    if j.state='staging' then update public.hq_source_file_operations set state='discarded' where id=j.id returning * into j;end if;
    return to_jsonb(j);
  elsif p_action='commit' then
    if j.state='committed' then return to_jsonb(j);end if;
    if j.state<>'staging' then raise exception 'Upload was cancelled. Reload before retrying.';end if;
    if not exists(select 1 from storage.objects where bucket_id='hq-source-files' and name=j.candidate_path) then raise exception 'File upload did not finish.';end if;
    select * into s from public.hq_project_sources where id=j.source_id and owner_id=p_owner and project=j.project for update;
    if s.id is not null then
      if s.version is distinct from (j.payload->>'version')::integer or s.file_status<>'ready' then raise exception 'This source changed. Reload before replacing it.' using errcode='40001';end if;
      update public.hq_project_sources set title=j.payload->>'title',description=j.payload->>'description',note_content=j.payload->>'note_content',section_id=(j.payload->>'section_id')::uuid,
        storage_path=j.candidate_path,original_filename=j.payload->>'original_filename',mime_type=j.payload->>'mime_type',file_size=(j.payload->>'file_size')::bigint where id=s.id;
    else
      if j.payload->>'version' is not null then raise exception 'Source no longer exists.' using errcode='40001';end if;
      insert into public.hq_project_sources(id,owner_id,project,source_type,url,title,description,note_content,section_id,storage_path,original_filename,mime_type,file_size)
        values(j.source_id,p_owner,j.project,j.payload->>'source_type',null,j.payload->>'title',j.payload->>'description',j.payload->>'note_content',(j.payload->>'section_id')::uuid,j.candidate_path,j.payload->>'original_filename',j.payload->>'mime_type',(j.payload->>'file_size')::bigint);
    end if;
    update public.hq_source_file_operations set state='committed' where id=j.id returning * into j;return to_jsonb(j);
  elsif p_action='finish' then
    if j.state='staging' then raise exception 'An active upload cannot be cleaned.';end if;
    -- A timed-out Storage POST may still finish remotely. Keep its cleanup intent
    -- through a grace period, even after an immediate best-effort deletion.
    if j.state='discarded' and j.created_at>now()-interval '10 minutes' then return jsonb_build_object('pending',true);end if;
    if j.state='deleting' then
      delete from public.hq_project_sources where id=j.source_id and owner_id=p_owner and project=j.project and storage_path=j.obsolete_path and file_status='deleting';
    end if;
    -- Retain a small consumed-ID tombstone so a retry can NEVER reuse an old
    -- object path while another operation may still be cleaning it. No note text
    -- or file metadata is retained in completed operation history.
    update public.hq_source_file_operations set state='finished',candidate_path=null,obsolete_path=null,payload='{}'::jsonb where id=j.id;
    return jsonb_build_object('finished',true);
  end if;
  raise exception 'Unknown file operation.';
end;
$$;
revoke all on function public.hq_source_file_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.hq_source_file_command(uuid,text,jsonb) to service_role;

-- Clients can sign/read only their CURRENT ready file. All upload/overwrite/delete
-- requests go through server validation, not client-supplied MIME labels.
create policy "Read own current source files" on storage.objects for select to authenticated
  using (bucket_id='hq-source-files' and (storage.foldername(name))[1]=(select auth.uid())::text
    and exists(select 1 from public.hq_project_sources s where s.owner_id=(select auth.uid()) and s.storage_path=name and s.file_status='ready'));
-- Restrictive guards also prevent a pre-existing broad Storage policy granting
-- unintended access to this new bucket. Service-role validation is not bypassable.
create policy "Guard private source file reads" on storage.objects as restrictive for select to authenticated
  using (bucket_id<>'hq-source-files' or ((storage.foldername(name))[1]=(select auth.uid())::text
    and exists(select 1 from public.hq_project_sources s where s.owner_id=(select auth.uid()) and s.storage_path=name and s.file_status='ready')));
create policy "No anonymous source files" on storage.objects as restrictive for select to anon using (bucket_id<>'hq-source-files');
create policy "Source uploads require validation" on storage.objects as restrictive for insert to anon,authenticated with check (bucket_id<>'hq-source-files');
create policy "Source files cannot be overwritten" on storage.objects as restrictive for update to anon,authenticated using (bucket_id<>'hq-source-files') with check (bucket_id<>'hq-source-files');
create policy "Source removal requires cleanup workflow" on storage.objects as restrictive for delete to anon,authenticated using (bucket_id<>'hq-source-files');
create or replace function public.hq_source_library(p_project text)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'sources',coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc,s.id) from public.hq_project_sources s where s.owner_id=(select auth.uid()) and s.project=p_project),'[]'::jsonb),
    'sections',coalesce((select jsonb_agg(to_jsonb(s) order by s.position,s.id) from public.hq_project_sections s where s.owner_id=(select auth.uid()) and s.project=p_project),'[]'::jsonb),
    'file_cleanup_pending',exists(select 1 from public.hq_source_file_operations o where o.owner_id=(select auth.uid()) and o.project=p_project and o.state<>'finished' and (o.state<>'staging' or o.created_at<now()-interval '10 minutes'))
  );
$$;
notify pgrst,'reload schema';
commit;
