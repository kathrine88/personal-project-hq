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

The six unchanged home cards now open photographic project dashboards. Create your own subsections and separate milestone checklists; rename, complete, reorder with touch-sized up/down controls, and delete with scoped confirmation. Progress is calculated from completed milestones (weighted across the whole project); empty projects/subsections show “Not started”. **Project tasks** still opens the existing filtered ordinary task list. Subsection Notes and Purchases remain future spaces; the project-wide Source Library is added in Stage 2A.

Before merging this feature, run only the new SQL and follow [the Project Pages manual setup and verification guide](migrations/PROJECT_PAGES_STAGE1_SETUP.md). Nothing is applied to the live database by this PR. The dedicated `project-core`, `project-repository`, `project-store` and `project-view` modules keep milestones separate from tasks, routines and finances. The migration uses owner RLS and composite parent keys, atomic scoped changes, and snapshot revision checks for concurrent editing.

Run `node --test tests/*.test.mjs` and `node tests/projects-browser.cjs` alongside the four existing browser suites. Browser tests mock Supabase; live RLS, new-table persistence and physical Safari checks remain manual before merge.


## Project Source Library — Stage 2A

Open a project dashboard → **Source Library** to save website links or written notes for that whole project. Optional subsection assignment never creates a separate library. Use Gallery/List (preference remembered when storage allows), combined type/subsection filters, and full details with edit/confirmed deletion. A URL alone is enough to save a website; More details holds optional description, personal notes and subsection. A written note has a title and full text. No tags or uploads are added.

**Before merging:** apply only `20261026150000_project_source_library.sql` and follow [the iPhone-only setup and Safari checklist](migrations/SOURCE_LIBRARY_STAGE2A_SETUP.md). No terminal, desktop setup, Storage configuration or Edge Function deployment is needed from the owner. This repository has no PR preview hosting configured, so the unmerged branch is not a live website; test UI on a provided preview or after an explicitly approved deployment. The assistant has not applied this migration or written live source records.

**Automatic previews are deferred.** Manual link saving works without a preview, and the form explains this limitation. New sources use a domain fallback title, fully editable text and neutral icons. Optional image metadata is supported by the schema/renderers for later integration, with broken-image fallbacks. No browser scrape, proxy, external preview provider or insecure server fetcher is added. See [the future preview security contract](docs/SOURCE_PREVIEWS.md).

`source-core.js`, `source-repository.js`, `source-store.js`, `source-view.js` and scoped CSS keep library logic separate from milestone progress and all existing planners/finances. Owner RLS and a composite subsection FK enforce isolation; deleting a subsection keeps its sources unassigned. Database-owned versions/timestamps prevent stale overwrites. The schema's text type/content constraints can be extended additively for future private uploaded image/document records in Stage 2B.

For maintainers: run `node --test tests/*.test.mjs`, `node tests/sources-browser.cjs`, and all five existing browser suites using the Playwright setup above. New coverage includes link/note CRUD, details, combined filters, view memory, navigation, optional/deleted subsection handling, safe text/URLs, preview rendering/failure, stale/uncertain saves, sessions and mobile layout. Browser persistence and RLS use local fixtures, not live Supabase; verify the migration, real persistence/isolation and physical iPhone Safari before approving deployment.


## Source Library private uploads — Stage 2B

Image / Photograph and Document / File extend the same project-wide library and filters. Choose one file from Photos/Files, inspect its name/preview, then Save. Titles, descriptions, personal notes and subsection remain optional; metadata can be edited without re-uploading. Existing Gallery/List, links/notes and milestone/planner logic are preserved. Images use private thumbnails/full views; PDF originals can open in the browser’s native viewer, and documents download as attachments. HEIC/HEIF previews depend on browser support; originals remain available.

**Before merging, complete three separate steps in Safari:** the source/policy SQL, the private bucket creation SQL, and deployment of the self-contained `source-files` Edge Function. Follow [the iPhone Stage 2B setup and testing guide](migrations/SOURCE_UPLOADS_STAGE2B_SETUP.md). Applying columns alone does not create a bucket or deploy validation. The assistant has not run these migrations, created the bucket, deployed the function or uploaded live files. The branch remains unmerged; this repository has no automatic PR preview hosting.

The initial cap is 20 MiB per file (displayed as 20 MB). Supported originals are JPEG/PNG/WebP/HEIC/HEIF, PDF, ordinary macro-free DOCX/XLSX and UTF-8 TXT. No SVG, HTML, executables, arbitrary archives or legacy/macro-enabled Office formats. The Edge Function validates the signed-in user with Auth, checks bounded file contents independently of client MIME, enforces allowed origins, and keeps its service credential exclusively server-side. Browser Storage writes are denied; owner-scoped signing/reads use five-minute URLs cached only in memory.

A server-only RPC and owner-scoped operation journal coordinate creation, safe replacement and deletion across Storage/Postgres. Old files are retained until replacement commits. Failed candidates are deleted best-effort and tracked for retry, including a grace period for remotely finishing timed-out transfers. Pending deletes are labelled and cannot be opened/edited as ready files. Retry file cleanup completes recoverable partial failures; there is no scheduled cleanup worker or resumable upload transport in this stage. Completed jobs retain only compact consumed-ID tombstones to prevent old path reuse during cleanup. See the guide for exact recovery behaviour and limitations.

The two new SQL files are additive; existing source IDs/data, subsection FKs, owner RLS and progress logic remain. There is no webpage metadata fetching. `supabase/functions/source-files/index.ts` is dependency-free for Dashboard deployment; its handler is also imported by Node regression tests. `js/source-files.js` handles picker limits and short-lived access; source repository/store/view retain their existing separation.

Maintainers: run `node --test tests/*.test.mjs`, `node tests/uploads-browser.cjs` and all six existing browser suites. Upload handler tests use simulated Auth/Storage/RPC responses; browser tests use local persistent fixtures (selected bytes are serialized in the fixture transport because Chromium interception omits multipart file bodies). They do not execute live SQL or prove real Storage RLS. Test the deployed function, bucket policies, physical iPhone Safari, real 20 MB transfers and two-account isolation before approving deployment.

## Coming Up — Stage 3A

**Coming Up** in the main navigation is a chronological personal-plan list. Its expanded Someday section retains undated events/to-dos; overdue incomplete to-dos stay accessible; dated entries group by month/year. History retains past events and completed dated to-dos. Today’s events remain all day regardless of start time. Dates/weekday labels use local calendar dates, including month/year and daylight-saving boundaries.

Run only the new `20261026190000_coming_up.sql` manually before merging, following [the iPhone-only setup and Safari checklist](migrations/COMING_UP_STAGE3A_SETUP.md). No terminal, Edge Function, Storage bucket or reminder service is needed from the owner. The assistant has not applied this migration or written live plans. The PR branch is not deployed and this repo has no automatic PR preview hosting.

A personal to-do uses exactly one existing `test_tasks` row, linked uniquely from `hq_coming_up`. Title, date and completion are read from that task in both views; notes/time/type live in the plan. New personal tasks have no project (`project = NULL`), protected by a deferred link invariant. Existing project records are not reclassified or imported and stay in their project/weekly views. Project task lists omit personal rows. Event records have no task/checkbox. Type changes are atomic; stable plan IDs survive conversion, and only the converted/deleted personal task's ordering keys are cleaned.

This Week shows dated events above its normal checklist, including every day of a range, and a compact Someday selector for scheduling. Personal task completion, editing, date moves and mixed saved ordering use the same underlying task and existing move RPC. Routine generation/occurrence overrides are unchanged. A narrow-screen navigation row accommodates the extra main link without changing the project cards or unrelated content.

Shared data/classification/validation lives in `coming-core.js`, the authenticated RPC boundary in `coming-repository.js`, and UI/session/version handling in `coming-view.js`. Local midnight/tab-return refresh only updates display classifications; it does not schedule notifications or delete history. No end-time field, reminders, push permissions, service workers/PWA, calendar grid or project linking is added. Money and Source Library implementations are unchanged.

Maintainers: run `node --test tests/*.test.mjs`, `node tests/coming-browser.cjs` and all seven existing browser suites. Tests cover safe dates/timezones, inclusive ranges, history/overdue/Someday, shared-task state, conversion and scheduling, stale/uncertain saves, normal planner ordering, sessions and mobile layout. Browser persistence/security is simulated, not live Supabase; the new PostgreSQL migration/triggers, real RLS and physical iPhone Safari remain manual verification before approving deployment.
