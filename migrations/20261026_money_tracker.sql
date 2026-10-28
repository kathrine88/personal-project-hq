-- MONEY TRACKER ONLY: run this whole file ONCE before merging its PR.
-- No imports, opening-balance row, transfers or changes to existing app tables.
begin;
create table public.hq_money_daily (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  entry_date date not null,
  amount_pence integer not null check(amount_pence between -999999999 and 999999999),
  version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(),
  unique(owner_id,entry_date)
);
create table public.hq_money_movements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  entry_date date not null,
  kind text not null check(kind in ('deposit','withdrawal')),
  amount_pence integer not null check(amount_pence between 1 and 999999999),
  note text not null default '' check(length(note)<=2000),
  version integer not null default 1 check(version>0),
  created_at timestamptz not null default now()
);
create index hq_money_movements_owner_date on public.hq_money_movements(owner_id,entry_date,id);
create table public.hq_money_purchases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  item text not null check(length(trim(item)) between 1 and 500),
  project text not null check(project in ('Garden','Book Nook','Christmas Planning','Health & Fitness','Home Projects','Other')),
  estimated_pence integer not null check(estimated_pence between 0 and 999999999),
  priority text check(priority in ('low','medium','high')),
  notes text not null default '' check(length(notes)<=2000),
  source_url text check(source_url is null or (length(source_url)<=2000 and source_url ~* '^https?://')),
  status text not null default 'planned' check(status in ('planned','purchased')),
  actual_pence integer check(actual_pence between 0 and 999999999),
  purchase_date date,
  version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(),
  check((status='planned' and actual_pence is null) or (status='purchased' and actual_pence is not null))
);
create index hq_money_purchases_owner_project on public.hq_money_purchases(owner_id,project,status,id);
alter table public.hq_money_daily enable row level security;
alter table public.hq_money_movements enable row level security;
alter table public.hq_money_purchases enable row level security;
create policy hq_money_daily_owner on public.hq_money_daily for all to authenticated
  using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy hq_money_movements_owner on public.hq_money_movements for all to authenticated
  using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy hq_money_purchases_owner on public.hq_money_purchases for all to authenticated
  using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
revoke all on public.hq_money_daily,public.hq_money_movements,public.hq_money_purchases from public,anon;
grant select,insert,update,delete on public.hq_money_daily,public.hq_money_movements,public.hq_money_purchases to authenticated;
-- Stable, caller-permission function: all rows come from one MVCC snapshot.
-- No stored balance or expense ledger to double-deduct on status changes/retries.
create function public.hq_money_snapshot() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'daily',coalesce((select jsonb_agg(to_jsonb(d) order by d.entry_date desc,d.id) from public.hq_money_daily d where d.owner_id=(select auth.uid())),'[]'::jsonb),
  'movements',coalesce((select jsonb_agg(to_jsonb(m) order by m.entry_date desc,m.id) from public.hq_money_movements m where m.owner_id=(select auth.uid())),'[]'::jsonb),
  'purchases',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id) from public.hq_money_purchases p where p.owner_id=(select auth.uid())),'[]'::jsonb)
 );
$$;
revoke all on function public.hq_money_snapshot() from public,anon;
grant execute on function public.hq_money_snapshot() to authenticated;
notify pgrst,'reload schema';
commit;
