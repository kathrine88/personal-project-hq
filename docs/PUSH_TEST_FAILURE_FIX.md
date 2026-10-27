# Fix the manual iPhone push test

Automatic delivery stays OFF. No secrets, subscription registrations, private-schema
permissions, RLS policies, reminder data or scheduled jobs need changing.

## Confirmed cause

The deployed `hq_push_test_claim` declares a PL/pgSQL record named `d` and also
uses `d` as a table alias in the one-minute cooldown query. PostgreSQL cannot
resolve `d.device_id`, and raises **42702: column reference "d.device_id" is
ambiguous**. This happens before INSERT, even with an empty deliveries table.

The project logs contained five matching errors. A controlled probe using the
existing enabled device reproduced exactly 42702 and left zero delivery rows.
The probe automatically rolled back any claim and never contacted a push provider.
The deployed Edge Function core matches the repository apart from whitespace.

The database error occurs AFTER the owned/enabled-device check. Therefore those
failed RPCs had already matched the registered device and authenticated owner;
this is not evidence of an incorrect browser device ID. The browser uses the same
per-account ID for registration/status/test, and the browser regression now checks
that the test request's ID equals the acknowledged registration ID.

The old RPC wrapper discarded the database error code. Its claim catch converted
all errors into HTTP 409, and the frontend then discarded the Edge Function's HTTP
response body too. Successful HTTP 200 config requests only prove configuration
access: they do not execute the claim or contact Apple.

## The complete path

1. Browser obtains its per-account device ID, verifies registration with
   `hq_push_device(status)`, and calls `reminder-push` with `{action:'test',deviceId}`.
2. Edge Function verifies the caller JWT through Supabase Auth, validates VAPID
   configuration, then calls `hq_push_test_claim` as that same user.
3. The owner-checked SECURITY DEFINER claim function enforces the one-minute
   account-wide limit and inserts one `claimed` delivery, returning a one-use token.
4. Only the server role calls `hq_push_begin`; it checks device/claim validity and
   commits `sending` before the network request. The standard Web Push library
   encrypts the generic payload, and the function sends it to the push provider.
5. `hq_push_finish` records the provider status. HTTP 2xx means provider acceptance,
   not proof the phone displayed it. Invalid endpoints are disabled as before.
6. The service worker displays the generic notification and handles its tap.

`hq_push_begin` and `hq_push_finish` have the correct postgres ownership, definer
mode, empty search path and server-only EXECUTE ACL; they do not contain this
record/alias collision. No widening of schema/function grants is needed.

## Small fix

`PUSH_TEST_CLAIM_FIX.sql` is an incremental, rerunnable function repair after the
original Stage 3C-B migration. It uses distinct `v_claim`, `previous_delivery` and
`registered_device` names. CREATE OR REPLACE preserves the existing owner and ACL.
It also gives the two expected rejections explicit PostgREST codes: PT409 for a
missing/disabled/non-owned device, PT429 for the one-minute cooldown. The same
non-owned-device error avoids revealing another user's registration.

The Edge Function now distinguishes these expected cases from unexpected SQL
failures, and returns only safe diagnostic fields: stable code, stage, SQLSTATE or
provider status, and a generated request reference. The browser reads these from
`FunctionsHttpError.context` and displays only allowlisted text/fields. It never
shows/logs raw database messages, queries, subscription endpoints, keys, notes,
provider response bodies, bearer tokens or user/device IDs.

| Diagnostic | Meaning / action |
| --- | --- |
| `PUSH_DATABASE_ERROR; test_claim; 42702` (503) | Old SQL function still deployed; run the incremental repair. |
| `PUSH_DEVICE_NOT_ENABLED` (409) | The owner has no enabled registration for that ID; refresh settings/re-enable if needed. |
| `PUSH_TEST_RATE_LIMITED` (429) | A test was claimed in the last minute; wait a full minute. |
| `PUSH_DATABASE_ERROR; begin` or `finish` (503) | Server RPC/database failure at that specific step; use the SQLSTATE/reference, not new browser grants. |
| `PUSH_PROVIDER_REJECTED; provider; HTTP …` (502) | Claim worked, but the provider rejected the encrypted request. Inspect that status/configuration. |
| `PUSH_DELIVERY_UNKNOWN` (503) | Network result is uncertain; check the phone before trying another test. No automatic resend. |
| `PUSH_SUBSCRIPTION_EXPIRED` (409) | Provider returned 404/410; re-enable the device subscription. |

A finish failure can occur AFTER provider acceptance, so do not blindly repeat the
test. A claim-stage failure has not reached the provider. Safe references correlate
app messages with `reminder-push failure` entries in Edge Function logs.

## Deploy from your iPhone

1. **Review/merge this PR**, then wait for the usual GitHub Pages deployment.
   This updates the app's error display only; GitHub does not deploy the SQL or
   Edge Function automatically. The existing service worker is unchanged.
2. In GitHub open **docs/PUSH_TEST_CLAIM_FIX.sql → Raw**, select all and copy.
   In the existing Supabase project open **SQL Editor → New query**, paste the
   entire script, and tap **Run**. Do not rerun the original Stage 3C-B migration.
   This repairs only `public.hq_push_test_claim(uuid)` and reloads the RPC schema.
3. In GitHub copy **supabase/functions/reminder-push/core.js → Raw**. In Supabase
   **Edge Functions → reminder-push → Code**, replace only the sibling **core.js**
   file with that complete source, then **Deploy updates**. Leave `index.ts` and
   **Verify JWT with legacy secret = OFF** as before: the handler still performs
   its own user/server authentication.
4. Leave **PUSH_DELIVERY_ENABLED = false** and any Cron job inactive. Do not alter
   VAPID/dispatch secrets, rotate keys, expose the private schema, grant USAGE to
   authenticated, recreate tables or reinstall the Home Screen app.
5. Reopen/reload the installed app after saving any edits. Open **Reminders →
   iPhone notifications → Refresh notification settings**. The existing device
   should remain enabled. Tap **Send Test Notification** once.
6. Expect **Push service accepted the test** and observe the iPhone alert. The
   automatic-delivery-inactive message should remain. If it fails, the new message
   identifies the failing stage; share just that diagnostic/reference, not keys,
   subscription records or screenshots containing secrets.

To verify the RESULT (rather than repeating registration/permission checks), SQL
Editor can show only delivery status aggregates:

```sql
select state, http_status, count(*)
from hq_push_private.deliveries
where occurrence_id is null
group by state, http_status;
```

There should now be a test row. `sent` with provider HTTP 2xx means accepted;
`failed`/`unknown` plus the app diagnostic identifies the next step. A deliberate
second test within one minute should show `PUSH_TEST_RATE_LIMITED` and create no
second claim or push. No schedule activation is part of this fix.

## Verification and rollback

The unit/browser tests cover exact device ID forwarding, claim-stage 42702 with
no provider call, typed device/cooldown rejections, begin/finish failures, provider
status reporting and redaction of malicious/raw error fields.

`tests/push-database.test.mjs` now first reproduces 42702 with the original migration,
then applies the repair and verifies a claim can be inserted with the same private
schema isolation. It checks cooldown, another user's denial, server-only begin /
finish, deduplication and existing reminder behavior. The PR workflow runs this
against pinned, isolated PGlite Postgres without production credentials or pushes;
it configures the dependency so the database regression cannot silently skip.

For rollback, retain the SQL naming fix (restoring the collision would break every
test again). If the diagnostic/UI changes cause trouble, redeploy the previous
`core.js` from GitHub and revert the frontend commit; the repaired SQL is compatible
with the previous handler. Keep automatic delivery off. No device, reminder/history
or key reset is needed.
