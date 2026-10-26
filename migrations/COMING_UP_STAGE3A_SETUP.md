# Coming Up Stage 3A — iPhone setup and testing

**The PR is unmerged. The assistant has not applied the new SQL or written live plans/tasks.** This feature needs one database migration. No bucket, Edge Function, reminder service, notification permission or background worker needs setting up.

## Apply the migration in Safari

1. Open [the Stage 3A SQL file on GitHub](https://github.com/kathrine88/personal-project-hq/blob/coming-up-stage3a/migrations/20261026190000_coming_up.sql). Tap **Raw**, select all and copy the entire file, including begin/commit.
2. In [your existing Supabase SQL Editor](https://supabase.com/dashboard/project/rilqlmsojlplbaoxkztc/sql/new), create a new query, paste it, and **Run once**. Stop and share any error. Do not rerun earlier routine, project, source-upload, meal or Money migrations.
3. Run this **read-only verification** in a new query:

```sql
select to_regclass('public.hq_coming_up') is not null as plans_ready,
       to_regprocedure('public.hq_coming_snapshot()') is not null as reader_ready,
       to_regprocedure('public.hq_coming_change(uuid,integer,text,jsonb)') is not null as editor_ready;

select relrowsecurity,relforcerowsecurity from pg_class
where oid='public.hq_coming_up'::regclass;

select policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename='hq_coming_up';

select column_name,is_nullable from information_schema.columns
where table_schema='public' and table_name='test_tasks' and column_name='project';
```

Expect three readiness values `true`, both RLS flags `true`, an authenticated owner policy with `owner_id = auth.uid()` for reads/writes, and `project` nullable (`YES`). SQL Editor uses elevated privileges, so these checks do **not** demonstrate real end-user isolation. Test with signed-in app accounts below.

The migration requires the existing routines/ordering table `hq_task_positions`, already inspected in this app. It adds no example plans and does not import or reclassify any existing task. Existing project values, scheduled dates, completion flags and routine exceptions remain unchanged.

## How the two views share records

`hq_coming_up` is the persistent personal-plan identity. It stores the explicit Event/To-do type, optional notes/time and revision. Its UUID survives editing, scheduling and type changes.

- **Event:** title and optional start/end dates live in this table. No task row or completion flag exists. An undated event stays in Someday. A multi-day range is inclusive; the same event UUID appears on every covered weekly day, with no copied rows.
- **To-do:** exactly one row in the existing **public.test_tasks** stores the actual title (`task`), date (`scheduled_date`) and `completed` flag. Coming Up keeps a unique owner-checked `task_id` reference, not copies of those fields. Both views read/update this same task. Its usual `task:<id>` key mixes with ordinary tasks and recurring occurrences in the existing saved-order mechanism.
- Coming Up is independent of projects: its new personal tasks use **project = NULL**, with no project selector or category. Existing `project NOT NULL` is relaxed only to allow this new case; deferred database checks require every null-project task to have its matching Coming Up record. Ordinary project tasks cannot be linked into Coming Up. Project task lists exclude personal rows; all scheduled tasks still appear in This Week.
- Existing project tasks and recurring routines are **not imported** into Coming Up or its Someday section. They retain their original weekly/project behaviour. This stage manages new independent personal plans and ideas.
- Editing/rescheduling a to-do preserves its task ID and completion state. Unscheduling clears its optional time and returns it to Someday. Completion from either screen updates the same boolean. Rescheduling removes only that personal task's old position keys, so it can be placed with the destination day's normal ordering.
- Changing Event → To-do atomically creates one task and links it. Changing To-do → Event atomically removes that linked personal task and its position keys; it becomes an event without a checkbox. The Coming Up UUID remains stable. Converting back creates a new incomplete task because events have no task/completion state.
- Deleting a Coming Up to-do removes only its linked personal task/order keys. Directly deleting that task removes its Coming Up reference through the owner-scoped FK. Events never delete planner tasks. This is deliberate deletion, unlike automatic hiding/history.

The new table has forced owner RLS; all RPCs/triggers run as the caller, use an empty search path and accept no owner ID. A composite task/owner FK, unique task reference and constraints prevent cross-owner or project-task linking. No service-role credential is used. Task changes increment the plan's revision, so stale forms reject instead of overwriting newer completion/date changes. Reads bypass REST list truncation without creating rows when browsing weeks.

## Dates, history and overdue behaviour

Dates are local calendar DATE values; weekdays come from the existing safe calendar parser, not UTC timestamp parsing. Optional time is a local wall-clock time, not a reminder or timezone-conversion setting.

- Today’s events remain Upcoming throughout their final local calendar day, even after their start time. They move to History only on the next day. Multi-day events remain upcoming until their final day ends.
- Completed **dated** to-dos are shown in History, even if their scheduled date is in the future. Unchecking one returns it to Upcoming or Overdue according to its date.
- Incomplete dated to-dos before today remain in the expanded **Overdue** section, with completion and Reschedule actions. They are never silently completed or removed.
- Undated events and to-dos remain in the initially expanded **Someday / No date yet** section until scheduled or deliberately deleted. Completing an undated to-do does not hide it. Scheduling it retains its completion state.
- The list refreshes at local midnight while the page is open, and when returning to the tab. No background notification/reminder or service worker is involved. History filters do not delete database records.

Someday stays above dated entries, can be collapsed, and has a sticky-toolbar shortcut. Dated entries group by month/year, with ongoing events grouped at today's position. History groups by final date. Events show start time only on their first weekly day; later timed days say Continues. There is no separate end-time field in this stage; multi-day end dates are whole calendar days.

## iPhone Safari checklist

This repository has no automatic PR preview environment. The unmerged branch is not the current website. Apply SQL first; test on an approved preview or after an explicitly approved deployment. You do not need a terminal, local server or desktop setup. The PR does not deploy/merge the website automatically.

1. Sign in → **Coming Up**. Add an undated Event and undated To-do. Collapse/expand Someday, use its toolbar shortcut, refresh and sign out/in. Both should remain saved. Completing an undated to-do should leave it visible, checked.
2. Add an all-day event, a timed event and a multi-day event crossing several dates (try a month/year boundary). Check calculated weekdays. Add notes, edit them, and change dates. Events must have no checkbox.
3. Open **This Week** and navigate to those dates. Events & Appointments should appear only on days containing events, above normal to-dos. The same multi-day event appears on each included day. Tap an event to edit it; the Coming Up entry and all covered weekly days must update together.
4. Create a dated Coming Up To-do. It should appear once in that daily checklist. Complete it there, then inspect Coming Up → History. Uncomplete it and check it returns. Edit/reschedule it from both screens; it must remain one shared task, not two copies. Try dragging or Move / Reorder alongside a normal task and a recurring occurrence, then refresh to check persistence.
5. In the weekly **Someday ideas** area, choose an idea and Schedule it into a day. The original disappears from Someday and appears as the chosen Event/To-do. Editing during scheduling lets you choose the type. No undated idea should appear on every day.
6. Give a to-do yesterday's date: it must appear in Overdue until completed, rescheduled or removed. Give an event yesterday's final date: it should be in History, not deleted. Today’s timed event must remain in Upcoming after its start time. Leave Safari open across midnight or return the next day and recheck.
7. Change an Event to To-do and back. Check no extra task remains in the week after changing back to Event. Delete a to-do: cancel first, then confirm, and verify only its shared task disappears. Other projects, ordinary tasks and routine occurrences must remain unchanged.
8. Open the same plan in two sessions if available; save in one then try saving the older form. It should ask for a reload instead of overwriting. If a save response is interrupted, cancel and **Reload plans** before adding it again: it may already have saved. Error states must keep the entered form text.
9. With another app account if available, verify the first account's plans/personal tasks are not visible or editable. Check sign-out clears Someday, history and weekly events.
10. Check narrow-screen scrolling, date/time fields, checkbox targets and the four-link navigation. Verify existing project cards/photos/pages/progress, routine occurrence completion and drag order, meals/shopping, Source Library links/notes/files and Money remain functional. Personal Coming Up to-dos should not appear in project task lists.

## Validation limits

The existing task schema, constraints, migration files, routines, ordering and navigation were inspected. The assistant has **not executed the new migration**, written live plans or tested live RLS/persistence. Automated browser tests simulate persistent authenticated Supabase data and mutations; they do not execute the PostgreSQL triggers/RPCs or prove cross-user security. The workspace has no Supabase CLI/local PostgreSQL. Physical iPhone Safari, live migration execution, actual two-account isolation and persistence must be verified manually after setup.

No reminders, notification permissions, push services, service workers/PWA install, traditional calendar grid, project linking, Money changes, Source Library changes or new Storage/Edge Function setup are included.
