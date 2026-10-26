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

Drag the dotted handle to change a task's position or day. Tap that same handle (or **Edit → Move / reorder**) for a date-and-position selector. Ordering mixes ordinary and recurring tasks and is saved for that day only. Future weeks are calculated without inserting tasks into the database.

Additional modules separate recurrence calculation (`js/recurrence.js`), persistence (`js/routine-repository.js`), routine management (`js/routines-view.js`), pointer dragging (`js/task-drag.js`) and the Move dialog (`js/move-editor.js`). The existing task repository and photographic card definitions remain unchanged.

Run all unit tests with the existing Node command above. With Playwright installed, also run:

```sh
node tests/browser.cjs
node tests/routines-browser.cjs
```

The first browser suite checks the original planner with the new schema unavailable. The second checks routine lifecycle, independent completion/moves/skips, future browsing without writes, real Chromium touch gestures within and between days, mixed ordering, failed saves, refresh, ordinary tasks, photos and layout. Both use simulated Supabase clients; neither writes to the live database. See the migration guide for the precise database and device testing limits.
