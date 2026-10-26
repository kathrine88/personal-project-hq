# Stage 3C-B — real iPhone Web Push

This PR prepares push notifications. **It does not apply SQL, deploy a function,
set secrets or enable a scheduled job.** Keep automatic delivery off until you
have completed the manual test below. No paid notification provider is used.
Apple Web Push requires an iPhone running iOS 16.4+ and the installed Home Screen
web app; enabling inside a normal Safari tab will show installation instructions.

## What changes and what stays the same

- Reminders → **iPhone notifications** contains Enable Notifications, Disable for
  this device, Send Test Notification and Refresh notification settings.
- Only tapping Enable calls `Notification.requestPermission()`. Opening the app,
  signing in, expanding settings, refreshing or receiving a push never requests it.
- Subscriptions belong to the signed-in account. Up to 20 enabled devices can
  receive the same occurrence independently. Disable and sign-out affect the
  current device. Signing out normally disables server delivery first and removes
  the browser subscription. An offline failure is shown; sign-out is not falsely
  reported as completed. An externally revoked session also attempts local unsubscribe.
- Foreground/settings refresh checks permission, missing subscriptions, server
  status and VAPID key rotation. Expired endpoints are disabled and key material
  erased on HTTP 404/410. Re-enable explicitly to create a fresh subscription.
  The worker cannot silently renew with a user's JWT: it stores no auth token.
- Payloads contain only a type, occurrence UUID and stable tag. Visible text is
  generic, with no reminder titles, notes, project names or private file URLs.
  Notification taps focus an existing app or open its correct GitHub Pages path,
  then show Reminders and focus the occurrence when available. Sign-in is required
  to read it. Deleted/other-account occurrences reveal nothing. An open editor is
  preserved; finish editing and open Reminders manually in that case.
- The existing service worker keeps its lifecycle/update strategy, with no fetch
  handler or private caching. Push handlers extend it. Normal Pages deployments
  remain independent of the Edge Function deployment.

### Due times, repetition and overdue policy

The dispatcher compares the existing occurrence's **`due_at` timestamptz** to
Postgres `now()`; it does not reinterpret dates using the server's local zone.
Existing Stage 3B `Europe/London` schedules therefore follow GMT/BST correctly.
Other explicitly saved zones remain supported. Stage 3B's DST rule is retained:
nonexistent spring times move forward through the gap; an ambiguous autumn time
uses standard time (the second occurrence). No reminder schema or existing RLS,
triggers, task completion or scheduling functions are replaced.

**Repeating reminders retain Stage 3B's one-pending-occurrence rule.** One push
per device is attempted for that occurrence. Dismiss it in Reminders to generate
the next future daily/weekly/monthly/yearly occurrence; missed intervals are not
replayed. Leaving a repeating reminder undismissed does not create daily pushes.
Push acceptance never dismisses it or changes its history. Linked task/event and
routine-occurrence cancellation/rescheduling still comes from Stage 3B.

A device receives only occurrences due **at or after its enable time**, and only
within **15 minutes** after the due instant. Existing overdue reminders remain
visible in-app but are not pushed when notifications are enabled later. Re-enabling
or replacing a subscription starts a new eligibility period. Scheduled outages
longer than 15 minutes do not create an alert storm on recovery. Enabling the
server switch later may catch up within that window for devices already enabled.

### Delivery guarantees and limitations

Database uniqueness on `(occurrence_id, device_id)`, row locks, `SKIP LOCKED`,
expiring claim tokens and a one-use pre-send transition prevent concurrent senders
from duplicating a delivery. The server rechecks pending/deleted/completed/skipped
source state immediately before authorizing each send. Cancellation before this
check skips delivery. A cancellation after that check or after push-service
acceptance cannot retract an in-flight/visible notification.

Only an explicit HTTP **429** rejection is retried: five minutes later, up to
**three total attempts**, with eligibility checked again. Network timeouts, 5xx
and lost responses are terminal **unknown** and are never automatically replayed.
A crash before send authorization can be safely reclaimed after two minutes;
a crash after authorization is not replayed. This favors avoiding duplicate alerts
and can miss an alert during a crash/network failure. Exactly-once display cannot
be guaranteed across a network and Apple's service. Stable notification tags
also coalesce repeats where the platform supports them.

`sent` means the push provider accepted it, **not** that the iPhone displayed or
read it. A one-minute cron normally adds 0–60 seconds plus function/provider/iOS
latency. This is not an exact alarm: Focus modes, disabled notifications, offline
phones, provider throttling, project pauses and OS policies can delay or prevent
presentation. Provider TTL is 60 seconds; a phone offline longer may miss it.
No browser tab or active login session is needed for already-enabled devices.
Do not use this feature as the sole reminder for safety-critical deadlines.

## Costs and limits

Standard Web Push and VAPID need no paid third-party service or Apple Developer
membership. Supabase Cron uses the project's database; Edge Functions use its
invocation/compute/egress allowance. One invocation per minute is about 43,200 per
30-day month, plus settings/tests. Current Supabase docs list 500,000 function
invocations/month on Free and 2 million on Pro, with paid overage at $2 per million.
Check your own Dashboard **Usage/Billing** before activation; quotas/prices can
change and other app functions share the allowance. Free projects can pause when
inactive; a paused/unavailable project cannot deliver. This feature does not buy,
upgrade or change your plan.

Each invocation processes at most 20 device deliveries, five concurrently, with a
10-second network timeout. Large bursts may take multiple ticks and the 15-minute
window still applies. Hosted limits currently include 256 MB memory, 2 seconds
CPU/request and 150 seconds Free wall-clock time (400 seconds on paid plans).
Monitor function errors and usage; don't shorten the schedule to work around a
capacity problem. Delivery ledger rows are small but accumulate; see maintenance.

## Deployment from an iPhone — do these in order

Use Safari with the GitHub and Supabase Dashboard websites. Landscape or Safari
**Request Desktop Website** can make their editors easier to use. No terminal is
required. Review the PR first. This repo has no automatic PR preview hosting.

### 1. Review and apply the one migration

1. In GitHub, open `migrations/20261026203000_web_push.sql` on this PR's branch.
   Choose Raw, select all and copy the **entire** SQL. Do not copy the diff markers.
2. Open the existing Supabase project (`rilqlmsojlplbaoxkztc`), **SQL Editor → New
   query**. Paste and run once. It requires the already-applied Stage 3B migration
   `20261026200000_reminders.sql`. **Do not rerun Stage 3B or other migrations.**
3. Confirm success. This migration creates the `hq_push_private` schema, devices,
   delivery ledger and narrowly granted RPCs. It creates no job, extension or push.
   Do not add `hq_push_private` to the Data API's exposed schemas.
4. Run the security verification queries below. If the transaction fails, inspect
   the error before retrying; it is deliberately not an idempotent reset script.

The existing reminder/occurrence tables and their ownership policies are unchanged.
Their Stage 3B `delivered_at`/`delivery_attempts` fields remain untouched; per-device
results live in the new ledger, avoiding changes to the occurrence guard/history.

### 2. Generate VAPID and dispatch keys securely on the iPhone

1. After reviewing and merging/deploying the frontend PR, open
   `https://kathrine88.github.io/personal-project-hq/tools/push-setup.html` in Safari.
   Alternatively, use a trusted local Web Crypto tool you control; don't send keys
   to an online VAPID generator. The committed page has no external dependencies,
   no persistence and CSP `connect-src 'none'`.
2. Tap **Generate keys** once. It creates a matching P-256 VAPID public/private
   pair and a separate random 256-bit dispatch secret locally.
3. Copy each value directly to the relevant Supabase secret fields below. Keep a
   secure password-manager backup of the VAPID pair. The public key is safe to
   expose; the private and dispatch keys are secrets. Do not send them through
   Codex/chat, commits, issues, screenshots or logs.
4. Use a real monitored `mailto:you@example.com` value for `VAPID_SUBJECT`.
   Apple requires valid VAPID; a localhost subject URL can be rejected.
5. Tap **Clear values**, clear the clipboard, and close the setup tab after saving.
   Do not generate a fresh pair on every deployment. Subscription bindings depend
   on a stable VAPID public key.

The setup page is just reviewed static code. It sends no keys to the app/backend;
copying into the Dashboard is the configuration step. Frontend rollout before
function setup is safe: controls report setup errors, and existing features work.

### 3. Set Edge Function secrets — automatic delivery OFF

In Supabase **Edge Functions → Secrets**, add:

| Name | Value |
| --- | --- |
| `VAPID_PUBLIC_KEY` | The generated 87-character public key |
| `VAPID_PRIVATE_KEY` | The generated private key |
| `VAPID_SUBJECT` | Your real `mailto:` contact |
| `PUSH_DISPATCH_SECRET` | The separately generated dispatch secret |
| `PUSH_DELIVERY_ENABLED` | **`false`** |

Do not create custom secrets whose names start `SUPABASE_`. The function uses
Supabase's provided `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS` and
`SUPABASE_SECRET_KEYS` dictionaries (their `default` entries), with legacy
`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` fallback for older projects.
Confirm the built-in key bindings exist. These privileged keys stay server-side.
Do not rotate existing project keys or change other functions for this feature.

### 4. Deploy the Edge Function through the Dashboard

1. In GitHub, copy the full sources from
   `supabase/functions/reminder-push/index.ts` and `core.js` on the reviewed branch.
2. Supabase **Edge Functions → Deploy a new function → Via Editor**. Name it
   **`reminder-push`**. Replace the template `index.ts` with our source. Add a sibling
   file **`core.js`** in the editor's file list and paste that complete source.
   The import must remain `./core.js`. If the mobile editor hides the file list,
   use landscape/Request Desktop Website; both files are required.
3. Deploy. The pinned `npm:@supabase/supabase-js@2.95.3` and `npm:web-push@3.6.7`
   dependencies are resolved by Supabase's Deno runtime. Web Push encryption uses
   the standard library's RFC8291 `aes128gcm` and VAPID, not custom encryption.
4. In this function's **Details/Settings**, turn **Verify JWT with legacy secret**
   **OFF** (the equivalent of `verify_jwt = false` in `supabase/config.toml`).
   This is necessary for the custom server bearer secret. The handler independently
   validates user JWTs with Supabase Auth for config/test and checks a distinct
   dispatch secret for scheduled calls. Disabling gateway JWT verification does
   **not** make its delivery action unauthenticated.
5. Confirm URL:
   `https://rilqlmsojlplbaoxkztc.supabase.co/functions/v1/reminder-push`.
   Keep GitHub as the source of truth: Dashboard edits have no version history.
   Re-deploy from the committed files to roll back function code.

### 5. Test without a schedule

1. In the installed Home Screen app, sign in, open **Reminders → iPhone
   notifications**, and tap **Refresh notification settings** if needed.
2. Tap **Enable Notifications**, allow the iOS prompt, then **Send Test
   Notification**. It calls the deployed function, an owner-checked account-wide
   one-test/minute database limiter, the real Web Push sender and Apple's push
   service. There is no `new Notification()` or local-only test shortcut.
3. Expect “Push service accepted the test” and a generic alert. Automatic reminder
   delivery should still say it is inactive. Acceptance alone does not certify
   device display; actually observe the iPhone alert. Do not enable the schedule
   until this works.
4. In the function's Dashboard **Test** panel, send `{"action":"dispatch"}`
   without a valid Authorization header: expect **401**. A normal user JWT must
   also get **401** for dispatch. With `Authorization: Bearer YOUR_DISPATCH_SECRET`,
   expect **409** while `PUSH_DELIVERY_ENABLED=false`. Never put the secret in the
   URL or request body. Do not capture/share screenshots containing it.

### 6. Prepare a disabled schedule — not automatic activation

Only after review and successful test delivery:

1. Open **Integrations → Vault** (or search for Vault in the Dashboard). Add a
   secret named **`hq_push_dispatch_secret`** whose value is the **same** dispatch
   secret as `PUSH_DISPATCH_SECRET`. Use Vault's secret form rather than embedding
   it in saved SQL/query history. Do not store the VAPID private key in this job.
2. Open `docs/PUSH_SCHEDULE_DISABLED.sql` in GitHub, copy the entire file and run
   it in SQL Editor. It enables `pg_cron` and `pg_net` if needed and creates exactly
   one job **inactive**, within a single transaction. It refuses an existing job
   name rather than silently replacing it. No secrets are committed in that SQL.
3. Its final query must show `active = false`. Leave it false for now.
4. For a manual real reminder test, temporarily set `PUSH_DELIVERY_ENABLED=true`
   in Edge Function Secrets, create a reminder due a few minutes ahead, close the
   app, and invoke dispatch once from the Dashboard Test panel **after** it is due,
   using the server bearer secret. The disabled schedule will not run itself.
   Repeat to verify no duplicate. Switch the secret back to `false` afterwards.

### 7. Explicit final activation — only when you choose

After all device/security tests pass, set `PUSH_DELIVERY_ENABLED=true`, then run:

```sql
select cron.alter_job(jobid, active := true)
from cron.job where jobname = 'hq-reminder-push-minute';
```

Confirm `active=true`. The schedule is `* * * * *`; it checks absolute due instants
so cron's timezone does not shift London reminders. Do not create a second job
in the Cron UI. Keep the secret out of the job definition: it reads Vault at run
time. Nothing in the PR or migration performs this activation.

## Verify security and health without displaying secrets

Run in SQL Editor after applying the migration:

```sql
-- Must both show RLS=true and force_RLS=true.
select n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='hq_push_private' and c.relkind='r';

-- All false: browsers cannot read key material or run delivery RPCs.
select
 has_schema_privilege('authenticated','hq_push_private','USAGE') as browser_schema,
 has_function_privilege('anon','public.hq_push_device(uuid,text,jsonb,text)','EXECUTE') as anonymous_device,
 has_function_privilege('authenticated','public.hq_push_claim()','EXECUTE') as browser_dispatch,
 has_function_privilege('authenticated','public.hq_push_begin(uuid,uuid)','EXECUTE') as browser_send;

-- Both true: narrow owner operations and server claim are granted separately.
select
 has_function_privilege('authenticated','public.hq_push_device(uuid,text,jsonb,text)','EXECUTE') as owner_device,
 has_function_privilege('service_role','public.hq_push_claim()','EXECUTE') as server_claim;

-- Metadata/counts only. NEVER select subscription, endpoint, private keys or Vault values.
select enabled,count(*) from hq_push_private.devices group by enabled;
select state,http_status,count(*) from hq_push_private.deliveries group by state,http_status;
select occurrence_id,device_id,count(*) from hq_push_private.deliveries
where occurrence_id is not null group by occurrence_id,device_id having count(*)>1;
-- Last query must return no rows.
```

Use **Advisors → Security** after migration and review any findings. The public
push RPCs intentionally use `SECURITY DEFINER` with fixed empty search paths:
owner RPCs check `auth.uid()` and never accept an owner ID; dispatcher RPCs revoke
PUBLIC/anon/authenticated and grant only service_role. The private schema is not
exposed and table access is revoked. RLS is additional defense. Do not “fix” errors
by granting private-schema/table access or delivery functions to browser roles.
The built-in server key is privileged; it is confined to the function, which
exposes only these bounded actions and validates permitted push-service hosts.

For two-account testing, enable devices while signed into each account. Account B
must get `null` for account A's device status and must fail attempts to enable or
test A's device ID; it cannot query private tables or delivery RPCs. Disabling B
must not disable A's other device. Use your own disposable accounts, never another
person's subscription. No anonymous request should send a push.

In **Integrations → Cron** inspect this job's run history; also check Edge Function
invocations/status. A pg_net queue request being created is not proof of successful
HTTP delivery: inspect recent `net._http_response` **status_code/timed_out/error_msg**
and the function's aggregate response. Do not dump request headers, Vault values
or provider bodies into logs. The handler logs no subscription/reminder contents.
The Dashboard and job metadata are administrator-only; treat cron headers as
secrets even though application logs omit them.

## Detailed iPhone checklist

Use disposable reminders/tasks and remove them afterward. Test while the schedule
is disabled, using controlled manual dispatch, before opting into cron.

- [ ] Current iOS; open installed Home Screen app. Safari tab shows installation
  instructions. Unsupported browsers show a useful status and disabled controls.
- [ ] Fresh install/session: no permission prompt on load/sign-in/opening Reminders
  or expanding settings. Prompt appears only after Enable is tapped.
- [ ] Allow permission: enabled status. Send Test: observe a real alert. Double-tap
  test/another device test within a minute: rate limit, no test flood.
- [ ] Close/swipe away the app. Send test from another signed-in device or manual
  dispatch a due reminder in the Dashboard. Observe delivery with no tab open.
- [ ] Tap the alert: correct Home Screen app/subpath, sign-in if needed, reminder
  focused when present. Existing editor draft is retained if the app was open.
- [ ] Standalone reminder: before due, no alert; after due, one. Dispatch twice and
  concurrently from two Dashboard tests: one ledger row per occurrence/device and
  one authorized provider send. Confirm it remains pending in-app until dismissed.
- [ ] Repeating London reminder: dismiss current occurrence and verify the next
  date/time retains its anchor. Next due occurrence gets one push. Undismissed
  occurrences don't generate invented repeats. Month-end/leap-day behavior remains.
- [ ] London winter/summer 09:00 maps to 09:00Z/08:00Z; spring gap and autumn fold
  match the Stage 3B rules above. Test in an isolated test database rather than
  changing the iPhone's clock or modifying production history.
- [ ] Linked project task, Coming Up event/to-do and routine occurrence: push when
  due. Complete/skip/delete/dismiss before dispatch: no alert. Reschedule: old
  occurrence cancelled, only replacement eligible. Reopening a completed task does
  not resurrect its old reminder.
- [ ] Enable after an existing overdue reminder: no old-alert flood. Reminder due
  more than 15 minutes ago is not sent even after an outage; it remains in-app.
- [ ] Second device: each enabled device gets one alert. Disable one: the other
  still receives. Sign out: current device stops receiving; sign into another
  account and enable explicitly. No automatic account/subscription transfer.
- [ ] Disable: server status off and local unsubscribe. Re-enable: future reminders
  work. Simulate an offline disable: visible failure, no false success.
- [ ] Deny permission, then change it in iPhone Settings → Notifications → Project
  HQ. Return/refresh: blocked/off status reconciles; re-enable after allowing.
  No repeated surprise prompts. Remove/reinstall the app and verify re-enabling.
- [ ] Expired HTTP 404/410 subscription: disabled server-side and keys cleared;
  re-enable establishes a fresh endpoint. VAPID rotation asks for re-enabling.
- [ ] Offline/Focus: understand possible delay/drop within TTL. Provider acceptance
  does not falsely claim delivery/read. A notification already accepted cannot be
  recalled when you subsequently cancel the reminder.
- [ ] Simulated 429: at most three attempts, five-minute spacing; timeout/5xx/crash
  after send: terminal unknown, no blind replay. Reminder history is unaffected.
- [ ] Existing projects, planner, Coming Up, routines, meals/shopping, Money Tracker,
  Source Library/private files, reminder edits/history and sign-in/out still work.
- [ ] Later normal GitHub Pages deployment: UI updates on normal reopen/reload,
  worker updates without forced page reload and still handles pushes. No private
  Cache Storage entries or Supabase response interception are added.

## Rollback, rotation and maintenance

**First stop delivery**, without changing any reminders:

```sql
select cron.alter_job(jobid, active := false)
from cron.job where jobname='hq-reminder-push-minute';
```

Set Edge Function `PUSH_DELIVERY_ENABLED=false`. In-flight/accepted notifications
may still arrive for up to their short TTL. Test pushes remain possible for
signed-in users; to stop those too, temporarily disable/delete `reminder-push` in
the Dashboard, or disable all devices (next SQL). Removing the function does not
change reminder data. Do not rotate project-wide Supabase credentials as a routine
rollback; other app features depend on them.

```sql
-- Optional full push stop; reminders and history are untouched.
update hq_push_private.devices
set enabled=false,subscription=null,updated_at=clock_timestamp();
```

Revert the frontend PR through GitHub and deploy the previous service worker if
needed. Existing workers can remain until a normal app launch/update; disabling
server delivery is the reliable first step. Keep the private tables/ledger to
preserve deduplication/audit evidence while diagnosing. Do not delete ledger rows
and retry ambiguous sends. To remove the unused job entirely after disabling:
`select cron.unschedule(jobid) from cron.job where jobname='hq-reminder-push-minute';`.
Do not disable shared extensions or drop existing reminder tables.

For a dispatch-secret leak, stop the job, generate a new independent secret,
update both Edge Function Secrets and the existing Vault entry (do not create a
second same-name entry), verify the old secret gets 401, then reactivate explicitly.
For VAPID private-key rotation/leak, stop delivery and disable all push devices,
generate a new pair, update secrets, and ask each device to re-enable. Existing
subscriptions are bound to the old public key; swapping only the private key
cannot work. Keep schedules off until fresh-device tests pass.

The ledger is intentionally separate and does not mutate reminder history.
For this small personal app, inspect its size periodically. If needed, manually
prune terminal rows older than 30 days (never recent/active/unknown rows during
incident review); deduplication no longer needs them after the 15-minute eligibility
window. No retention job is enabled by this PR. Never export subscription secrets
for debugging.

## Maintainer validation

`node --test tests/*.test.mjs` covers auth, CORS, payload privacy, SSRF checks,
worker taps and London DST alongside existing unit tests. With Playwright:
`node tests/push-browser.cjs`, `node tests/pwa-browser.cjs` and all existing browser
suites use local/mocked data and do not write to live Supabase.

The optional `tests/push-crypto.test.mjs` runs real encryption/VAPID verification
when `WEB_PUSH_MODULE` points to installed `web-push@3.6.7` or its ESM bundle.
The optional `tests/push-database.test.mjs` runs the migration plus Stage 3B against
isolated Postgres when `PGLITE_MODULE` points to an installed
`@electric-sql/pglite@0.3.14` ESM entry file URL. They skip explicitly when their
optional dependencies aren't configured. Never point a test at production.

Actual Supabase Deno deployment, new SQL execution, live RLS checks, Apple service
acceptance and physical iPhone presentation require the staged Dashboard/device
checks above. No live push or automatic schedule is used in implementation tests.

References: [Dashboard deploy](https://supabase.com/docs/guides/functions/quickstart-dashboard),
[secrets](https://supabase.com/docs/guides/functions/secrets),
[scheduling](https://supabase.com/docs/guides/functions/schedule-functions),
[limits](https://supabase.com/docs/guides/functions/limits),
[pricing](https://supabase.com/docs/guides/functions/pricing).
