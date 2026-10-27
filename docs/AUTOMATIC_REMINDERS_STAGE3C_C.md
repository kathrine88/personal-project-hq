# Stage 3C-C — automatic reminder delivery

This stage reuses the working subscriptions, Web Push sender, service worker and
Stage 3B reminder/occurrence tables. **Nothing is activated by the PR or SQL
upgrade. Keep `PUSH_DELIVERY_ENABLED=false` until the final opt-in step below.**
No paid notification provider or desktop/terminal is needed.

## What changes

- The existing due queue remains owner-scoped, unique per occurrence/device, limited
  to 100 new queue rows and 20 sends per invocation, five at a time. A small queue
  timestamp fix allows freshly enqueued rows to be claimed in the same run.
- One private scheduler-health row and a 90-second lease prevent overlapping
  scheduled batches and record completed checks. Per-delivery one-use claims are
  still the definitive duplicate protection, even after a lease expires/crashes.
- Supabase Cron calls a fixed private wrapper; `pg_net` sends `action: scheduled`
  to the existing Edge Function, authenticated with the existing dedicated dispatch
  secret from Vault. No service-role key goes into Cron or the browser.
- With the delivery flag **false**, scheduled calls are **probes only**: validate
  server authentication/configuration and record a completed database check, but
  never select/claim due reminders or contact any push provider. Manual Send Test
  Notification stays independent and works while automatic delivery is off.
- With the flag **true**, the same scheduled route processes the existing queue.
  RPC failures mark the run unhealthy; other in-flight sends are awaited rather
  than abandoned immediately. Provider rejection is reflected in health metadata.
- The app reports automatic delivery active only when the named one-minute Cron
  job is correctly configured/active AND a successful delivery-mode check completed
  within three minutes. A flag alone, old heartbeat, probe, paused job, manual test
  or manual `dispatch` does not qualify. Settings refresh on return and once per
  minute while visible/open. This is recent evidence, not an uptime guarantee.

Existing reminder tables, data, subscriptions, RLS, authentication, manual test
claim repair and service worker are preserved. The new health RPC returns only a
state and timestamp, never another user's subscriptions/delivery records.

## Delivery rules retained

Only pending, due occurrences belonging to an enabled device's owner qualify.
Deleted/dismissed/cancelled reminders and completed/skipped linked sources are
rechecked immediately before send authorization. Edits cancel the old occurrence;
the replacement has its own ID. A cancellation after send authorization cannot
recall an in-flight/accepted alert.

Due comparisons use the existing `due_at` timestamptz, so Europe/London GMT/BST
rules and explicitly saved other zones remain intact. Spring-gap times move
forward; autumn ambiguous times use standard time, as in Stage 3B.

**Repeats retain dismiss-to-advance behavior.** Sending does not dismiss a reminder
or create another occurrence. Dismiss the current occurrence **inside Reminders**
to create the next future repeat. Closing the iPhone notification is not that
in-app dismissal. Undismissed repeating reminders don't send another alert daily.

Devices receive only reminders due at/after their enable time and at most 15
minutes overdue. No catch-up flood occurs when enabling a device or restoring a
long outage. An existing enabled device may receive due reminders within that
window when the server flag is enabled. Provider HTTP 429 is retried after five
minutes, up to three attempts total, rechecking eligibility. Timeouts, 5xx and
crashes after send authorization are terminal unknown and not blindly replayed;
this favors avoiding duplicates over guaranteed delivery. Expired 404/410 devices
are disabled safely. Nothing changes reminder history on a send failure.

## iPhone deployment — in order

Use Safari, GitHub Raw file views and the existing Supabase project Dashboard.
Landscape / Request Desktop Website can help with editors. PR #22 is unrelated;
this stage does not require merging or changing it.

### 1. Review and deploy frontend

Review/merge this focused PR, then wait for normal GitHub Pages deployment. This
updates the notification status display only. It does not deploy SQL, functions
or schedules. Existing manual notification tests continue working during rollout.

### 2. Run the incremental SQL upgrade

In GitHub open **docs/PUSH_AUTOMATIC_DELIVERY.sql → Raw**, select all and copy.
Supabase → **SQL Editor → New query** → paste the whole file → **Run**.

It requires the deployed Stage 3C-B SQL and its already-applied manual test repair.
It is rerunnable: no reset, deletion or re-registration is needed. It creates the
private health table/functions and updates the existing queue function. It creates
**no extensions, recurring job or push**, and changes no environment flags.
Do not rerun the original Stage 3B/3C-B migrations. Keep the private schema unexposed
and do not grant USAGE/table access to `authenticated`.

### 3. Update the Edge Function

Copy **supabase/functions/reminder-push/core.js → Raw** from the reviewed PR.
Supabase → **Edge Functions → reminder-push → Code**: replace **core.js** with the
whole source and tap **Deploy updates**. Leave `index.ts`, dependency versions,
VAPID keys and **Verify JWT with legacy secret = OFF** unchanged. The function
continues to authenticate both the user path and server path itself.

In **Edge Functions → Secrets**, keep:

| Setting | Value |
| --- | --- |
| `PUSH_DELIVERY_ENABLED` | **`false`** |
| `PUSH_DISPATCH_SECRET` | Existing dedicated dispatch secret; do not paste it into GitHub/chat |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Existing working values; do not regenerate |

Reopen the installed app after saving edits. **Refresh notification settings** and
**Send Test Notification** once to verify the existing manual flow. Automatic
status must still say it is off/inactive. Wait a minute before any further test.

### 4. Prepare ONE inactive Cron job

1. In Supabase **Integrations → Vault**, create/edit **hq_push_dispatch_secret**.
   Its value must equal the existing `PUSH_DISPATCH_SECRET` in Edge Function Secrets.
   Use Vault's form and your secure saved value; never embed it in saved SQL. Keep
   exactly one entry with that name. No VAPID private key is needed in Vault.
2. Copy **docs/PUSH_SCHEDULE_DISABLED.sql → Raw** into a new SQL Editor query and
   run it **only when you choose to prepare the scheduler**. It enables native
   `pg_cron`/`pg_net` and creates or updates the existing named job
   `hq-reminder-push-minute`. Its transaction leaves that job **inactive**.
   Rerunning intentionally pauses the same job, not a duplicate. If another role
   owns that job name, it stops for inspection rather than creating a second job.
3. The final result must show schedule `* * * * *`, **active=false**. The command
   calls `hq_push_private.invoke_scheduler()`; the secret stays in Vault.

This preparation script is separate from the SQL upgrade and was not executed by
Codex. No live recurring job is created or activated as part of implementation.

### 5. Verify safely while live delivery stays OFF

First, optional manual probe: function **Test** panel → POST body
`{"action":"scheduled"}` with `Authorization: Bearer YOUR_DISPATCH_SECRET`.
Expect HTTP 200 with `mode: probe, checked: true`. With a missing/wrong secret,
expect 401. Never share a screenshot containing that header. Unlike a manual
notification test, this probe sends no push and creates no delivery claims.

Now explicitly enable **probe scheduling only**, still leaving the flag false:
Supabase **Integrations → Cron**, find `hq-reminder-push-minute` and turn it on,
or run this secret-free query in SQL Editor:

```sql
select cron.alter_job(jobid, active := true)
from cron.job where jobname='hq-reminder-push-minute';
```

Wait for two one-minute ticks without making further manual probes. Check:

```sql
-- Use only safe operational fields; do not dump Cron commands/Vault/request headers.
select jobname, schedule, active from cron.job
where jobname='hq-reminder-push-minute';
select last_started_at, last_completed_at, last_mode, last_ok
from hq_push_private.scheduler_health;
```

Expect advancing `last_completed_at`, `last_mode=probe`, `last_ok=true`, and no
new push deliveries caused by those probes. A green Cron run alone only proves an
HTTP request was enqueued; the Edge Function's completed heartbeat proves it
reached authenticated server code and database checks. The app should say
**Automatic reminder delivery is off. Scheduled checks are working.**

If you are not ready for live delivery, leave the flag false; you may turn the
probe job off to stop using invocations. Do not proceed merely because the frontend
loads or a manual test worked.

### 6. Explicit live activation — only when YOU choose

After the probes and manual notification test succeed, change **only**
`PUSH_DELIVERY_ENABLED` to **`true`** in Edge Function Secrets. If you paused the
Cron job after probe verification, turn on that same job again. Do not create a
second schedule. Secrets normally apply without a function-code redeployment.

Wait for the next tick and refresh app settings. It must show a recent confirmed
active status, not just that the flag is enabled. `last_mode` becomes **delivery**.
The first tick may process recent eligible reminders within the 15-minute window.
This activation step is not run by the PR, migration or Codex.

### 7. Test ONE future reminder with the app closed

Create a disposable standalone reminder due three to five minutes ahead. Save it,
then close/swipe away Project HQ. After its due time, expect one generic iPhone
notification, normally within the next minute plus network/OS latency. Tap it to
open the reminder. Do not create several near-identical reminders for this test.

Verify the occurrence still appears pending in Reminders until you dismiss it.
Let another Cron tick pass: it must not send the same occurrence/device again.
Then remove the disposable reminder. Also test a reminder cancelled/completed
before its due time and a repeat advanced by in-app dismissal. Each enabled device
receives its own copy; disabling one device does not affect the others.

## Stop delivery / rollback immediately

Turn the Cron job off in the Dashboard and set **PUSH_DELIVERY_ENABLED=false**.
Equivalent pause query:

```sql
select cron.alter_job(jobid, active := false)
from cron.job where jobname='hq-reminder-push-minute';
```

An already-running bounded batch may finish; accepted notifications cannot be
recalled and may arrive within their short provider TTL. Keep the flag false even
if you later resume the job for diagnosis. Manual Send Test Notification remains
available. No reminder/subscription deletion, key rotation or table reset is needed.
To roll back code, redeploy the previous `core.js` and revert this frontend PR;
keep the job paused. Retain the private tables/ledger for audit/deduplication.

## Inspect failures safely

- App **paused/not configured**: check the ONE named job, its owner, one-minute
  schedule and canonical wrapper command. A flag alone cannot fix a missing job.
- **Waiting for first check**: allow a tick after activation. **Overdue checks**:
  inspect Cron history and Edge Function invocations; health expires after three
  minutes, with up to another minute before a visible settings refresh.
- HTTP **401** on scheduled calls: Vault and Edge dispatch secrets differ/missing.
  Manual test JWTs and publishable/service-role keys are not the dispatch secret.
- HTTP **503** / health **error**: use the function's safe stage/SQLSTATE/request
  reference. Provider rejection/failure can also mark a completed run unhealthy.
  Manual test failures retain their distinct diagnostics from Stage 3C-B.
- Cron succeeded but no heartbeat: it may only have queued HTTP. SQL Editor can
  inspect recent `net._http_response` fields **status_code, timed_out, created**.
  Do not select request headers, Vault values or arbitrary error/provider bodies.
- Delivery summaries, for the project owner only:

```sql
select state, http_status, count(*)
from hq_push_private.deliveries where occurrence_id is not null
 group by state, http_status;
```

Do not export endpoints, auth/p256dh keys, raw subscription rows or personal reminder
contents. `sent` means push-provider acceptance, not proof of phone presentation.
Timeout/5xx/unknown states are deliberately not automatically replayed.

## Limits and automated verification

One-minute scheduling is approximately 43,200 Edge Function invocations per
30 days, even in probe mode. Check the project's shared **Usage/Billing** allowance;
there is no paid push provider. Free-project pauses, infrastructure/provider
outages, Focus settings and offline iPhones can prevent/delay delivery. Provider
TTL remains 60 seconds. This is a best-effort reminder, not an exact alarm.
Large bursts are processed in bounded batches and the 15-minute window still
applies. The 90-second scheduler lease recovers after a crash; the original
per-delivery leases/unknown states continue to prevent blind duplicate replay.

Automated tests use in-memory Postgres, fake Cron/Vault/HTTP functions and mocked
push providers; no real jobs or pushes run. They cover eligibility, disabled devices,
owners, bounds, overlapping one-use claims and scheduler leases, retries/unknown
outcomes, edits/completion/dismissal, repeat behavior, SQL London DST, health status,
probe mode, and the working manual notification path. PGlite serializes database
commands; constraints/row locks and one-use transitions provide the concurrency
safeguards, while tests simulate overlapping invocations. Actual hosted extensions,
Vault integration and physical iPhone delivery are verified manually above.
