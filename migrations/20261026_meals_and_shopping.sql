-- MEAL PLANNER: run this whole file ONCE in the existing Supabase SQL Editor.
-- Do not rerun the earlier routines migration. No existing tables/data change.
begin;
create table public.hq_meals (
  owner_id uuid not null default auth.uid() references auth.users(id),
  meal_date date not null,
  lunch text not null default '' check (length(lunch) <= 1000),
  dinner text not null default '' check (length(dinner) <= 1000),
  primary key (owner_id, meal_date)
);
create table public.hq_shopping_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  week_start date not null check (extract(isodow from week_start) = 1),
  item text not null check (length(trim(item)) between 1 and 500),
  checked boolean not null default false,
  created_at timestamptz not null default now()
);
create index hq_shopping_owner_week on public.hq_shopping_items(owner_id, week_start, created_at, id);
alter table public.hq_meals enable row level security;
alter table public.hq_shopping_items enable row level security;
create policy hq_meals_owner on public.hq_meals for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy hq_shopping_owner on public.hq_shopping_items for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
revoke all on public.hq_meals, public.hq_shopping_items from public, anon;
grant select, insert, update, delete on public.hq_meals, public.hq_shopping_items to authenticated;
notify pgrst, 'reload schema';
commit;
