# personal-project-hq
My personal project planning and organisation app

## This Week

Use **This Week** in the header to open the Monday–Sunday planner. Use the arrows to browse weeks and **Current week** to return. Tap **+** beside a day to add a task, its checkbox to complete/uncomplete it, or **Edit** to change its text, project or date, or delete it. General daily tasks default to the existing **Other** project. Clear a task's date to unschedule it. Use **Schedule** in a project list to date an existing task.

Tasks use the existing `public.test_tasks` table and Supabase sign-in. `scheduled_date` is a nullable `DATE`; undated tasks stay undated and remain in project lists. Scheduled tasks also remain accessible through their project. The original weekly planner needs no additional migration beyond that column. The routines and ordering feature requires the separate additive migration described below. No database replacement is required. Ownership remains enforced by the existing `owner_id = auth.uid()` RLS policies and column default.

The homepage's photographic cards and styling remain in `index.html`. Shared persistence lives in `js/task-repository.js`, local calendar-date handling in `js/dates.js`, and planner rendering/editing in `js/weekly-planner.js`. Future Today or recurring-task views can reuse the repository and calendar helpers without changing the project cards.

## Checks

With Node.js 22 or later:

```sh
node --test tests/*.test.mjs
```

For browser regressions, use Playwright 1.62.1 and its Chromium browser:

```sh
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install chromium
node tests/browser.cjs
```

`CHROMIUM_PATH` optionally selects an installed Chromium executable; `PLAYWRIGHT_MODULE` optionally selects the Playwright module path. Screenshots go to the system temporary directory, or `TEST_ARTIFACTS` when set. The browser test serves local files through request interception and uses an in-memory Supabase client, so it does not write to the live database. It covers sign-in/out, week navigation, scheduled/undated tasks, adding, editing, completing/uncompleting, deleting, moving/clearing dates, refresh persistence, project task regressions, errors, local photos, and mobile/desktop overflow.

These baseline browser checks use simulated data. For recurring-task database setup and the current validation limits, see [migrations/README.md](migrations/README.md).


## Routines and task ordering

Before merging this feature, run the single additive migration as described in [migrations/README.md](migrations/README.md). The migration has not been applied to live Supabase by the assistant.

Open **This Week → Manage routines** to add daily, weekly, fortnightly or monthly tasks. Weekly and fortnightly schedules support multiple weekdays. Each occurrence has its own checkbox. **Edit** changes one occurrence; **Skip this occurrence** hides that date, and **Show skipped → Undo** restores it. Use Manage routines to edit the repeating schedule, pause/resume it, or delete unfinished occurrences while retaining completed history.

Press and hold the main body of a task briefly (about a third of a second), then drag it to change its position or day. A quick swipe still scrolls; checkboxes and Edit buttons work normally. The lifted task and green destination indicator show the pending move. The dotted handle still supports dragging, and tapping it (or **Edit → Move / reorder**) opens the date-and-position selector. Ordering mixes ordinary and recurring tasks and is saved for that day only. Future weeks are calculated without inserting tasks into the database.

Additional modules separate recurrence calculation (`js/recurrence.js`), persistence (`js/routine-repository.js`), routine management (`js/routines-view.js`), pointer dragging (`js/task-drag.js`) and the Move dialog (`js/move-editor.js`). The existing task repository and photographic card definitions remain unchanged.

Run all unit tests with the existing Node command above. With Playwright installed, also run:

```sh
node tests/browser.cjs
node tests/routines-browser.cjs
```

The first browser suite checks the original planner with the new schema unavailable. The second checks routine lifecycle, independent completion/moves/skips, future browsing without writes, real Chromium touch gestures within and between days, mixed ordering, failed saves, refresh, ordinary tasks, photos and layout. Both use simulated Supabase clients; neither writes to the live database. See the migration guide for the precise database and device testing limits.

## Meal Planner and weekly shopping

Before merging the Meal Planner PR, follow [the separate meal setup guide](migrations/MEAL_PLANNER_SETUP.md) and run **only** `20261026_meals_and_shopping.sql` in the existing Supabase project. Do not rerun the routines migration. No meal migration has been applied by the assistant.

Open **This Week → Meal Planner**. Edit Lunch and Dinner, then tap **Save meals**. Saved meals appear above that date's tasks in This Week, with no completion controls. Use the matching week arrows or Current week shortcut; unsaved drafts are retained when browsing between weeks during the session. Save before refreshing. Back to week returns to the week you were planning.

The shopping list is manual and belongs to the displayed week. Add, tick/untick or delete items; changes save immediately. Meals do not generate ingredients. Both meals and shopping reload from Supabase after refresh/sign-in and stay separate from tasks/routines.

The feature has its own repository (`js/meal-repository.js`), per-week state/error/session handling (`js/meal-store.js`) and screen (`js/meal-planner.js`). Existing task/routine persistence is unchanged. Run `node --test tests/*.test.mjs` and, with Playwright installed, `node tests/meals-browser.cjs` in addition to the existing browser suites. Browser tests use in-memory Supabase doubles, not live database writes.

## Money Tracker

Money → Dashboard, Daily Money and Purchase List track one shared GBP project pot, starting at exactly £0.00. There are no imported financial entries, daily targets or project allocations. Add one signed combined hustle result per date; occasional deposits/withdrawals are separate. Planned purchases do not reduce funds. Purchased items contribute their saved actual price once; editing, returning to Planned or deleting recalculates the pot from the saved records.

Before merging, apply **only** `20261026_money_tracker.sql` using [the Money Tracker setup guide](migrations/MONEY_TRACKER_SETUP.md) and verify the new tables/RLS and smoke-test balances. This migration has not been applied by the assistant. The PR must remain unmerged for user verification.

Amounts use integer pence in Supabase and BigInt arithmetic/formatting in the browser. The UI, exact-money helpers, repository and state/session handling are separated into `js/money-view.js`, `js/money-core.js`, `js/money-repository.js` and `js/money-store.js`. The master purchase project's existing key supports later project-page filters without duplicating records. Reload money data refreshes the snapshot; no realtime subscription or automatic budget allocation is added.

Run all unit tests with `node --test tests/*.test.mjs`. With the existing Playwright setup, run `node tests/money-browser.cjs` plus the three existing browser suites. These tests do not write to live Supabase. SQL, live RLS and physical Safari validation remain manual as detailed in the setup guide.

## Project Pages — Stage 1

The six unchanged home cards now open photographic project dashboards. Create your own subsections and separate milestone checklists; rename, complete, reorder with touch-sized up/down controls, and delete with scoped confirmation. Progress is calculated from completed milestones (weighted across the whole project); empty projects/subsections show “Not started”. **Project tasks** still opens the existing filtered ordinary task list. Notes, Source Library and Purchases remain future spaces.

Before merging this feature, run only the new SQL and follow [the Project Pages manual setup and verification guide](migrations/PROJECT_PAGES_STAGE1_SETUP.md). Nothing is applied to the live database by this PR. The dedicated `project-core`, `project-repository`, `project-store` and `project-view` modules keep milestones separate from tasks, routines and finances. The migration uses owner RLS and composite parent keys, atomic scoped changes, and snapshot revision checks for concurrent editing.

Run `node --test tests/*.test.mjs` and `node tests/projects-browser.cjs` alongside the four existing browser suites. Browser tests mock Supabase; live RLS, new-table persistence and physical Safari checks remain manual before merge.
