# Meal Planner — required manual setup before merging

This PR is intentionally unmerged. The assistant has **not applied this migration** or written test meal/shopping data to your live Supabase database.

1. Open your existing Personal Project HQ Supabase project → **SQL Editor → New query**.
2. Paste the **entire** contents of [20261026_meals_and_shopping.sql](20261026_meals_and_shopping.sql) and run it once. Run the whole file, including `begin` and `commit`. The changes are transactional.
3. Do **not** rerun the routines migration. It is already installed and is unrelated to this feature.
4. After a successful result, run this read-only check:

   ```sql
   select c.relname as table_name, c.relrowsecurity as rls_enabled
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('hq_meals', 'hq_shopping_items');

   select tablename, cmd, roles, qual, with_check
   from pg_policies
   where schemaname = 'public'
     and tablename in ('hq_meals', 'hq_shopping_items');
   ```

   The first result must contain both tables with `rls_enabled = true`. The second must show an `authenticated` owner policy for each table, with `owner_id = auth.uid()` conditions for both reads/changes and writes.
5. Test the PR version in your preview/local copy before merging. This repository is static HTML/JS, so a local static web server is sufficient; for example `python3 -m http.server 8000` from the PR checkout, then open `http://localhost:8000`. Use the same Supabase sign-in as the current app. To test on your iPhone, open the computer's local-network address on port 8000 while both devices are on the same network, or use your own preview hosting.
6. Sign in and open **This Week → Meal Planner**. Save a lunch/dinner, add a shopping item, tick it, and refresh. Browse the next week and confirm it has a separate plan/list. Return to This Week and confirm the meals appear above the tasks without checkboxes. Sign out/in and verify the data returns. Check task completion, routines and dragging still work. Only merge when you are satisfied.

No additional migration or scheduled job is required. If the file has already run successfully, do not run it again; use the read-only checks instead. The app leaves task functionality usable if the new tables are missing and provides a retry option on Meal Planner.

## What is added

- `public.hq_meals`: one row per authenticated owner/date, with lunch and dinner text. The composite primary key `(owner_id, meal_date)` keeps repeated saves from creating duplicate rows. Each week's seven dates are read/saved independently. Empty text clears a meal.
- `public.hq_shopping_items`: manually entered text, checked state and Monday `week_start`, plus ID/creation time. The owner/week index supports independent weekly lists. The database rejects non-Monday week keys.
- Both tables default `owner_id` to `auth.uid()`, reference the existing authenticated user and enable RLS. Authenticated CRUD is restricted to the same owner through `USING` and `WITH CHECK`. Anonymous/PUBLIC access is revoked.

The SQL does not alter existing tasks, routines, occurrences, task positions, authentication policies or data. Meals and shopping items are never inserted into `test_tasks`, and no ingredients are generated automatically.

## Validation and limits

New unit and Chromium touch-browser tests use simulated Supabase data. They cover week/date boundaries, drafts and saves, independent meals/shopping per week, shopping check/uncheck/delete, refresh and sign-in, loading/error/retry behavior, and responses arriving after navigation/sign-out. Existing task/routine/long-press ordering suites also pass with the meal migration unavailable.

The existing live schema was inspected read-only. This migration has **not been executed or tested against live Supabase**, so the new RLS policies and real Auth/Data API persistence require your manual verification. No physical iPhone Safari was available; responsive Chromium checks cover 320–1440px and touch targets use 44px rows/buttons with 16px entry text.
