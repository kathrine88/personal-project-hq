# Project Pages Stage 1 — manual database setup before merging

**Keep this PR unmerged until you have run the SQL and tested the branch.**
The assistant has not applied this migration or written project data to your live database.

## 1. Apply only the new migration

In your existing Supabase project, open **SQL Editor → New query**. Copy the entire file
[`20261026130000_project_pages_stage1.sql`](20261026130000_project_pages_stage1.sql), then run it once.
Do not rerun earlier task, routine, meal or money migrations.

It runs in a transaction and adds only:

- `public.hq_project_sections`: your custom subsections and their order, keyed by project.
- `public.hq_project_milestones`: each subsection's milestone checklist, completion and order.
- `hq_project_snapshot(text)` and `hq_project_change(text,text,text,jsonb)`: authenticated, security-invoker functions for reading and atomic changes.
- Owner RLS policies, authenticated grants, foreign keys, indexes and checks for the new tables.

No examples are prefilled. No existing table, photograph, task, routine, financial record, meal or shopping item is modified. Missing migration shows an explanatory error and disables project editing; existing planners, Money and the ordinary **Project tasks** link remain available.

The project key stays compatible with the app: Christmas is stored as `Christmas Planning`; Health & Fitness uses `Health & Fitness` and the existing `wellbeing.jpg`. The homepage's approved Wellbeing card/title is unchanged. There are no new budgets, duplicated purchases, or ordinary task records.

## 2. Verify tables and security

These are read-only checks you can run in SQL Editor:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('hq_project_sections', 'hq_project_milestones');

select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('hq_project_sections', 'hq_project_milestones');

select p.proname, p.prosecdef, p.proconfig
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('hq_project_snapshot', 'hq_project_change');
```

Both tables must have `rowsecurity = true`. Policies must restrict records to `auth.uid()` for both reads and writes. Functions must have `prosecdef = false` (invoker). New tables should initially be empty.

SQL Editor runs with elevated privileges, so those checks **do not demonstrate end-user RLS enforcement**. Test with authenticated app sessions as described below. In SQL Editor without a user JWT, `auth.uid()` is normally null and the mutation function will refuse to run. Do not change functions to SECURITY DEFINER or remove policies to fix a setup error.

## 3. Preview and test before merging

Check out this PR's `project-pages-stage1` branch, then serve the repository root:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000` and sign in with your existing account. For iPhone testing on the same network, use your computer's local IP and port 8000. This preview still uses your existing Supabase project. No automatic production deployment happens before merge.

1. Tap each of the six home cards. Check the correct photograph, project title, and **Not started** state; the home cards must look unchanged.
2. In Garden, create two custom subsections with names of your choosing. Rename them and use the 44px **↑ / ↓** controls to reorder them. Refresh and verify names/order persist.
3. In the first subsection add two milestones, in the second add one. Complete one of the first subsection's milestones: its progress must be **1 of 2 complete (50%)**, and the project **1 of 3 complete (33%)**. Complete/untick milestones and check immediate updates. Empty subsections do not dilute project progress.
4. Rename, reorder, and delete one milestone. Cancel a deletion first to check confirmation. Refresh/sign out and back in: completion, order and names should persist.
5. Add another project's subsection/milestone. Delete a Garden subsection, checking the confirmation lists its milestone count. Only that subsection and its milestones should disappear. The other Garden subsection, other project, tasks and Money records must remain.
6. Open the same project in two tabs. Save in one, then attempt a change in the stale tab. It must request a reload rather than overwrite the first change. If a response is interrupted, reload before trying again: the operation may already have saved.
7. Sign out and sign into a separate test account, if available. That account must not see or edit the first account's subsections/milestones. Sign back in and verify the first account's data remains. An unauthenticated browser must not read the tables/functions.
8. On iPhone Safari, check long names wrap; inputs remain readable; checkbox labels and reorder controls work by touch; scrolling is natural; no horizontal overflow or accidental taps.
9. Use **Project tasks** to open the existing filtered task list. Check ordinary task add/complete/delete/scheduling, weekly planner, recurring-occurrence completion and ordering, meal editing/shopping, and Money Tracker. Milestones must never appear as planner tasks or change the money pot.

Notes, Source Library and Purchases are labelled future spaces only; Stage 1 does not implement them.

## Consistency and deletion scope

Progress is computed from milestones rather than saved percentages. Project progress weights every milestone equally across subsections, not the average of subsection percentages. Empty lists show “Not started”. The client displays changes immediately and rolls back on an error.

The snapshot RPC returns all of the selected project's rows in one database statement, bypassing REST row-limit truncation. The mutation RPC locks the authenticated user's project, checks the previous snapshot revision, validates the requested action/scope, and returns the saved snapshot. New records use stable random UUIDs. After an uncertain or failed response, editing is blocked until a successful reload; the UI will not blindly repeat a possibly committed write.

Every mutation is scoped to the authenticated owner and project, and milestone operations also to their parent subsection. Reordering accepts an exact permutation of that specific list, rejecting missing, duplicate or unrelated IDs. The composite foreign key `(section_id, owner_id, project)` prevents attaching a milestone to another owner's or project's subsection. Its only deletion cascade is from a subsection to its own milestones. Functions run as the signed-in user and retain RLS; neither uses service-role credentials.

Reload project/refresh obtains current data; no realtime subscription is added. In concurrent app sessions a stale project change is rejected, including a deletion whose confirmation would otherwise describe an outdated milestone count.

## Automated coverage and limits

Run `node --test tests/*.test.mjs` and all five browser suites (`projects-browser.cjs`, `browser.cjs`, `routines-browser.cjs`, `meals-browser.cjs`, `money-browser.cjs`) using the repository's Playwright setup.

Unit tests cover empty/weighted progress, safe routes, ordering, immediate updates/rollback, session/project isolation, stale/uncertain responses and repository scope. Browser tests use local, in-memory Supabase fixtures to cover CRUD, touch controls, progress, refresh/sign-in persistence, deletion boundaries, missing-schema recovery and 320–1440px layout. Existing suites retain task, routine, drag, meal, shopping and money coverage.

These fixtures are **not live persistence or RLS tests**. The SQL migration has not been executed by the assistant, and physical iPhone Safari has not been tested. Perform the live SQL/RLS, persistence and device checks above before merging. The Supabase CLI is unavailable in the workspace; the labelled SQL is provided for manual application, not claimed as applied CLI migration history.
