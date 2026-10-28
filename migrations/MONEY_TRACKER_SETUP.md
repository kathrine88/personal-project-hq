# Money Tracker — manual migration required before merging

This PR must remain unmerged until you have applied the migration and verified the feature. The assistant has **not applied this SQL**, imported history, or written financial test records to live Supabase.

## Apply only this migration

1. In the existing Personal Project HQ Supabase project, open **SQL Editor → New query**.
2. Paste the entire [20261026_money_tracker.sql](20261026_money_tracker.sql) file and run it **once**, including `begin` and `commit`. Its changes are transactional. Do not rerun any earlier task, routine or meal migration.
3. After success, run these read-only checks:

   ```sql
   select c.relname as table_name, c.relrowsecurity as rls_enabled
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public'
     and c.relname in ('hq_money_daily','hq_money_movements','hq_money_purchases');

   select tablename,cmd,roles,qual,with_check
   from pg_policies where schemaname='public'
     and tablename in ('hq_money_daily','hq_money_movements','hq_money_purchases');

   select to_regprocedure('public.hq_money_snapshot()') is not null as snapshot_ready;
   ```

   Expect three tables with RLS enabled, one authenticated owner-only policy per table with both `USING` and `WITH CHECK`, and `snapshot_ready = true`. The new tables start empty, so the available balance is exactly **£0.00**.
4. Test the PR checkout locally or on your preview hosting before merging. For a local checkout, run `python3 -m http.server 8000` from the project folder, then open `http://localhost:8000`. To test on your iPhone, use the computer's local-network address on the same network, or your preview hosting. Sign in with your normal account.
5. Follow the smoke test below. Merge only when you are satisfied with the new tables and behavior. This assistant has not merged or deployed the PR.

If this migration has already completed, do not run it again. Use the checks above. If it fails, the transaction rolls back; resolve the reported error before retrying the full file. Existing planners remain usable when Money Tracker's tables/function are unavailable.

## Suggested manual smoke test

Use disposable, clearly identifiable entries in the new tracker, then delete them when finished:

- Confirm an empty tracker shows **£0.00**, with no imported entries or project allocations.
- Add a daily result of **£100.10**, a different day's loss of **-£20.05**, a manual deposit of **£50.00**, and a withdrawal of **£5.00**. Available funds should be **£125.05**.
- Add a planned purchase estimated at **£40.00**. Funds remain **£125.05**; outstanding estimates show **£40.00**.
- Mark it Purchased with actual cost **£35.00**. Funds become **£90.05**. Refresh and confirm the purchase is deducted only once.
- Edit its actual cost to **£30.00**. Funds become **£95.05**. Changing the estimate alone must not change spending.
- Return it to Planned. Funds return to **£125.05**. Delete it and confirm the pot stays **£125.05**.
- Edit and delete daily/manual entries; confirm totals follow the saved records. Delete all smoke-test records to return the pot to **£0.00**.
- Check sign-out/in, separate-user isolation with another test account if available, duplicate daily dates, project filters, and editing a record in two tabs (the stale edit should be refused).
- Confirm project photos, weekly tasks, routines/dragging, meals and shopping still work.

## Data and calculation design

Each authenticated user has **one shared project pot**, not separate project budgets. Opening balance is the constant zero; no opening-balance record, historical import, allocation or transfer is created.

`available = sum(daily results) + deposits - withdrawals - sum(actual purchased costs)`

Planned purchases never reduce funds. Their estimated costs are summarized separately. Negative available balances are allowed; the tracker does not enforce a spending budget.

- `hq_money_daily`: one combined signed result per owner/calendar date, enforced by a unique constraint. Positive means profit; negative means loss; zero is allowed.
- `hq_money_movements`: positive amount plus Deposit/Withdrawal direction, date and optional note. These stay separate from hustle results.
- `hq_money_purchases`: one master record per purchase, with project, estimated price, optional priority/notes/http(s) source, status, actual cost and optional purchase date. Purchased requires an actual cost. When the form's actual price is blank, it saves a copy of the estimate as actual; later estimate edits cannot change that cost. Returning to Planned clears actual cost and purchase date. An actual cost of £0.00 is valid.
- Projects use existing app keys. **Christmas** displays as Christmas but stores the existing `Christmas Planning` key; **Health & Fitness** uses that existing key. Future project pages can filter this same table without budgets or duplicate purchase records.

All stored amounts are integer **pence**, bounded to ±999,999,999 pence per daily result and 0–999,999,999 for purchase prices (manual movements must be positive). This is a per-record maximum of £9,999,999.99. Inputs are parsed as decimal strings with at most two places. Summation and GBP formatting use `BigInt`; no decimal floating-point arithmetic or rounded currency values are used.

There is no mutable balance or expense ledger. A purchased row contributes its actual price once to a fresh sum. Edits/deletion/status reversal simply change that sum, so there is no second deduction or compensating transaction to get wrong.

`hq_money_snapshot()` is a stable `SECURITY INVOKER` function with an empty search path and fully qualified table references. It reads all three tables in one database snapshot, explicitly filters `auth.uid()` and respects RLS. It returns aggregate arrays, avoiding the REST row-limit truncation that could silently omit older financial records. Snapshot failures show an unavailable balance rather than a misleading partial or zero total. Reload/refresh fetches the latest records; this stage does not add realtime subscriptions.

New records keep a client-generated UUID across retries and use conflict-ignore insertion. If the record already exists, the app confirms matching values instead of inserting a duplicate or overwriting it. Existing edits/deletes match ID **and version**; a stale version is refused. After each mutation the app reloads the authoritative snapshot. If the mutation succeeds but that reload fails, it closes the form, hides the old balance and requires Reload before another write.

## Security and validation limits

All three tables have `owner_id default auth.uid()`, authenticated-owner RLS for reads and changes, and `WITH CHECK` for writes. Anonymous/PUBLIC table and snapshot-function permissions are revoked. No existing tables, policies or saved task/meal/routine data change. No service key is used in the browser.

Automated tests use local/in-memory Supabase doubles. They cover exact arithmetic, high totals, £0.00 actual costs, purchase reversals/deletions, duplicate-safe IDs, version conflicts, failed saves/refresh, session cleanup, refresh/sign-in, project filters and mobile overflow. Existing task/meal/routine suites also pass. **The new migration, RLS and real Supabase persistence have not been executed/tested live.** The existing live schema was inspected read-only. Physical iPhone Safari was unavailable; Chromium mobile/touch tests were used. Perform the manual checks before merging.
