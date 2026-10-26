# Stage 3B — Reminders: iPhone setup and testing

**Do not merge this PR yet.** Stage 3A must already be installed. This feature adds in-app reminders only: it does not send iPhone notifications, request permissions, install a Home Screen app, or send email/SMS.

## One manual Supabase step

1. In Safari, open [the new SQL migration](https://github.com/kathrine88/personal-project-hq/blob/reminders-stage3b/migrations/20261026200000_reminders.sql) in GitHub. Tap **Raw**, select all and copy the complete file (from `begin;` through `commit;`, including the comments if convenient).
2. Open your **existing** Supabase project → **SQL Editor** → **New query**. Paste the complete SQL and tap **Run**, once. Save the query as “Stage 3B reminders”. Do not rerun older migrations or create another project/database.
3. If SQL reports an error, stop and retain the exact message. This migration runs in one transaction; a failed run should roll back. Do not run isolated fragments to bypass an error.
4. Run the read-only checks below in a new query. Both tables should have `rls_enabled = true` and `rls_forced = true`, and both RPC names should be present. New tables begin empty; no existing tasks or plans are imported, completed or deleted.

```sql
select relname, relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
from pg_class where oid in ('public.hq_reminders'::regclass,
                           'public.hq_reminder_occurrences'::regclass);
select proname from pg_proc where pronamespace='public'::regnamespace
and proname in ('hq_reminder_snapshot','hq_reminder_change');
select tablename, policyname, qual, with_check from pg_policies
where schemaname='public' and tablename in ('hq_reminders','hq_reminder_occurrences');
```

No terminal, cron job, Edge Function, Storage bucket, secret or push setup is needed. The assistant has **not** applied this migration. Keep the PR unmerged while reviewing setup and arranging an approved preview. GitHub Pages does not automatically publish this branch; applying SQL alone does not deploy the new interface. Use a supplied/approved preview for the checklist, then approve deployment separately.

## How reminders work

- **Standalone:** a separate reminder; never added to Coming Up or the weekly checklist. Optional repetition is daily, weekly, monthly or yearly.
- **Ordinary task:** links the existing `test_tasks.id`; no task copy. A personal Coming Up to-do instead links its existing plan UUID, which already references that same task. This prevents a second reminder through the other view.
- **Event:** links the same Coming Up UUID used in the weekly event section. Event↔to-do conversions retain the reminder association. Its pending label/timing follows the new item type; completed history retains the original title/type/due time.
- **Routine occurrence:** links the routine UUID plus its **original occurrence date**, matching the existing completion/move key. It is a one-off reminder for that occurrence, not a repeating reminder for every future routine. Setting one never generates task copies or other future reminders. Editing/pausing the routine does not retarget that explicit occurrence; deleting the routine cancels its reminders.

In the weekly or Coming Up editor, tick **Also set / edit a reminder**, then save the item. The original item saves first; the reminder form opens separately. Cancelling or failing the reminder save keeps the original item saved. To remove a reminder without removing its item, use **Delete reminder** in that form or **Delete** on the Reminders page.

The page separates **Needs Attention**, **Upcoming** and **History**. Due reminders remain outstanding indefinitely until explicitly dismissed, edited/deleted, or resolved by their task. Dismissal does not complete a task. Completing or skipping a task cancels its outstanding reminder, even if already due. Reopening/undoing a skip never resurrects it: explicitly set a new reminder if wanted. Deleting an item cancels its reminder and retains history. There is no history expiry or automatic cleanup.

**Relative timing:** At the scheduled time / one hour before require an actual task/event time. One day/week before use the source's calendar date (the **start** for multi-day events) and an explicitly displayed clock time. Custom is an absolute date/time and stays unchanged when its source moves. All-day items cannot use At time / One hour before. Removing a required source date/time cancels the pending relative reminder; explicitly set another after scheduling again. A new relative due time replaces the pending occurrence atomically and records the old one as cancelled history. Date changes and completion are handled by database triggers, including existing Move/Reorder/drag operations and writes from another session.

## Recurrence, concurrent sessions and time zones

Each reminder has at most **one pending occurrence**, enforced by a partial unique index. Every occurrence has its own UUID and monotonically increasing sequence, plus an immutable original due timestamp. Browsing and refreshing only read records; they do not create occurrences.

Dismissing a repeating standalone reminder atomically acknowledges that occurrence and inserts **one next future** occurrence. If several dates were missed, the original overdue occurrence remains visible until dismissed; missed intervening dates are skipped rather than creating a backlog. Version checks, row locks and unique indexes prevent concurrent/double dismissals from advancing twice. An uncertain save is not retried automatically: close, reload and check what saved.

Monthly/yearly dates stay anchored to the date chosen when the schedule is saved: **31 January → 28/29 February → 31 March**; **29 February → 28 February in non-leap years**, returning to the 29th in leap years. Editing the date/repeat rule deliberately sets a new anchor for future occurrences and retains all old history. Choose **Never** to stop repetition while keeping the current reminder as a one-off. Delete it to cancel the current occurrence as well; history stays.

The form captures an IANA time zone, such as `Europe/London`, and saves both the intended civil date/time and an unambiguous `timestamptz`. Repetitions use the stored zone's wall clock, so a 9am reminder stays at 9am as daylight saving changes. Travelling does not silently change the schedule's zone; displayed timestamps use the device's current zone, with a source-zone label where different. To adopt another zone, delete/recreate the reminder in that zone (history is retained).

For clock changes PostgreSQL's standard-time interpretation is used: a nonexistent spring-forward time moves forward by the gap; a repeated autumn time uses its **later** occurrence. The form previews the effective due time and zone. Avoid the transition hour if a different interpretation is desired. These rules were checked against read-only PostgreSQL calculations for London; no reminder records were written.

## iPhone Safari checklist

Use an approved preview after SQL setup. Refresh and, where noted, sign out/in.

1. Open **Reminders** from the main navigation. Add a standalone reminder for a few minutes ago with notes. It appears in **Needs Attention**, stays after refresh/sign-out/in, and appears in neither This Week nor Coming Up. Add a future reminder and check ordering and the exact displayed time/zone.
2. Dismiss the due reminder. Verify History shows its original due time and dismissal time. Create an overdue repeating standalone reminder; refresh several times (one outstanding occurrence only), dismiss, and check exactly one **future** occurrence appears. Try the same dismissal from two tabs: only one should succeed; reload the stale tab.
3. Edit a repeating reminder's title/date/repeat rule, then choose **Never**. Verify old dismissed history remains unchanged. Cancel and then confirm deletion; the pending item disappears, cancelled history remains, and no new occurrence is generated.
4. Weekly **Edit** an ordinary task → tick **Also set / edit a reminder** → Save. Set a custom date/time. Open its linked reminder, edit/remove it, and verify the task remains. Repeat while adding a new task.
5. Add/edit a Coming Up to-do with a reminder. Verify the same task appears once in the weekly checklist. Complete it in either view; the pending reminder moves to cancelled History. Uncomplete it: no reminder returns without an explicit new save.
6. Set relative one-day/week-before reminders with a clear clock time. Move a task using drag and Move/Reorder; change an event's start date/time. Check the new due timestamp in Reminders. For a timed event test At time / One hour before. Repeat with Custom and verify it **does not move**. Clear the source date/time and verify a dependent relative reminder cancels.
7. Add a reminder to an all-day, multi-day event. Check the reference is its start date, the actual reminder time is visible, and unavailable timed options are disabled. Convert Event↔To-do; confirm a single association persists. Delete the event/task; no active orphan remains and history stays.
8. Set a reminder on one routine occurrence, move that occurrence, complete/skip it, then undo. Check only that occurrence is affected; other dates/completion overrides/order stay unchanged. Deleting a routine should cancel its pending occurrence reminders.
9. Check narrow portrait layouts, long titles/notes, date/time pickers, keyboard scrolling and all touch targets. Verify six homepage photos, project progress, Coming Up/Someday/history, meals, shopping, Money and private Source Library uploads still work.
10. Test a second account: it sees none of the first account's reminders/history. Return to the first account and verify persistence. If a save is interrupted, preserve the draft, close/reload, and check for the saved occurrence before trying again. Test London month ends, leap dates and DST as appropriate for your own plans.

## Checks performed and limits

Automated unit and browser regression tests cover validation, IANA/DST calculations, classification, owner/session boundaries, shared links, relative/absolute schedules, dismissal/history, repeat advancement UI, uncertain writes and narrow layouts. Browser Supabase/recurrence behaviour is simulated; these tests do **not** execute migration triggers or prove live RLS/concurrent PostgreSQL behaviour. The live schema and existing owner policies were inspected read-only; read-only month-end/leap/DST expressions were verified. No new SQL migration or live reminder save/dismissal was executed. A local PostgreSQL runtime could not be provisioned under this environment's network restrictions. Physical iPhone Safari, real persistence, migration execution, trigger/concurrency behaviour and two-account RLS checks remain necessary before approval.

## Stage 3C contract

`hq_reminder_occurrences` exposes stable occurrence UUID/sequence, reminder/owner association, title/type snapshot, intended civil time/zone, exact `due_at`, pending/dismissed/cancelled state and resolution timestamps. `delivered_at` and `delivery_attempts` are reserved fields; Stage 3B never marks a delivery or claims one occurred. A due index supports a future server worker querying pending, undelivered occurrences without an open browser.

Stage 3C must implement a secured server-side due worker with atomic delivery claims/leases and idempotency, delivery retries/receipts, push subscription ownership/security, delivery-field write restrictions, rechecking cancellation before sending, notification actions, iPhone permission/install UX, and the service worker/Home Screen work. None is implemented here. Delivery must not acknowledge or advance a repeating reminder: only dismissal advances it. There is no push guarantee in Stage 3B.
