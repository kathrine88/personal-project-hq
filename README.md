# personal-project-hq
My personal project planning and organisation app

## This Week

Use **This Week** in the header to open the Monday–Sunday planner. Use the arrows to browse weeks and **Current week** to return. Tap **+** beside a day to add a task, its checkbox to complete/uncomplete it, or **Edit** to change its text, project or date, or delete it. General daily tasks default to the existing **Other** project. Clear a task's date to unschedule it. Use **Schedule** in a project list to date an existing task.

Tasks use the existing `public.test_tasks` table and Supabase sign-in. `scheduled_date` is a nullable `DATE`; undated tasks stay undated and remain in project lists. Scheduled tasks also remain accessible through their project. No database migration or data replacement is required. Ownership remains enforced by the existing `owner_id = auth.uid()` RLS policies and column default.

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

Live validation for this change inspected the existing schema and ownership policies and exercised insert, edit, completion, date moves, unscheduling and deletion as the authenticated SQL role in a transaction that was rolled back. No existing tasks were changed. An actual signed-in browser session against the Supabase Auth/Data API and physical iPhone Safari were not available for end-to-end testing.
