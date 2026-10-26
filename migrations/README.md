# Required before merging this PR

1. Open the existing Personal Project HQ project in Supabase, then open **SQL Editor → New query**.
2. Copy the entire contents of **20261026_routines_and_ordering.sql** into the editor and run it once. It includes `begin` / `commit`, so the additions succeed together or roll back together. Do not run just a selection of the file.
3. Check that the query completed successfully. Then run this read-only check:

   ```sql
   select
     to_regclass('public.hq_routines') is not null as routines_ready,
     to_regclass('public.hq_routine_occurrences') is not null as occurrences_ready,
     to_regclass('public.hq_task_positions') is not null as ordering_ready,
     to_regprocedure('public.hq_move_task(text,date,text[])') is not null as move_function_ready;
   ```

   All four values should be `true`. Confirm the three new tables have RLS enabled in the Table Editor.
4. Merge/deploy the PR only after the SQL succeeds. Refresh the website and sign in. Create one routine, move an occurrence using **Move / reorder**, and refresh to confirm it is saved. This assistant has **not merged or deployed** the PR.

No other SQL files are required. No changes were applied to the live database during development of this PR. If the SQL was already run successfully, do not run it again; use the read-only check instead. The app keeps ordinary tasks usable if the additions are missing or unavailable.

## What the migration does

- Adds `hq_routines`: one row per routine definition.
- Adds `hq_routine_occurrences`: one row per original routine/date only when that occurrence is changed. The unique primary key makes retries idempotent. Moving it retains its original identity. Completion and other changes snapshot its text/project so later routine edits preserve those individual plans.
- Adds `hq_task_positions`: saved positions keyed by owner, day and task/occurrence identity. A future occurrence has a different key and is unaffected.
- Adds `hq_move_task`: a caller-permission function that moves a task/occurrence and saves the destination day's order in one transaction. It checks ownership, serializes moves for the same user, and retains completion/text when moving an occurrence. Reordering an unchanged recurring occurrence on its original day only saves positions, not an occurrence override.
- Enables RLS on all three new tables; `authenticated` users can access only their own rows. Composite foreign keys prevent attaching an occurrence to someone else's routine. Anonymous users have no table or function access. The function uses `SECURITY INVOKER`, an empty search path, and no caller-supplied owner ID.

It does **not** change `test_tasks` columns or existing policies, backfill dates, alter existing tasks, or create scheduled jobs. Browsing weeks calculates only that week's occurrences in memory and performs no database writes. Definitions and explicitly edited occurrences are paginated when loaded.

Routine deletion is a soft deletion: unfinished occurrences disappear, completed history is retained, and no ordinary tasks are deleted. Pausing suppresses upcoming unchanged occurrences; saved individual plans and past occurrences remain. Resuming uses the original schedule. Routine edits affect unchanged occurrences, including past unchecked occurrences. Monthly routines use the start date's day number and clamp to the last day in shorter months. Fortnightly schedules use alternating Monday-first weeks starting with the start-date week. End dates are inclusive.

## Validation limits

The live schema and existing RLS policies were inspected read-only. This new migration and its RPC have **not been executed against live Supabase**. Browser tests use a persistent in-memory Supabase double; they validate UI and refresh behavior, not the real Auth/Data API or database transaction. An embedded PostgreSQL test runtime could not be fully obtained in this environment, so SQL execution and live RLS checks remain to be performed after applying the migration. Physical iPhone Safari was not available; Chromium touch input was tested.
