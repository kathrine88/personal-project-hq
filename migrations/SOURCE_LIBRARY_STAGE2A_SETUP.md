# Source Library Stage 2A — iPhone setup before merging

**This PR is unmerged. The new SQL has not been applied by the assistant.** Your current website stays unchanged until an approved deployment. All setup below can be done in Safari; no terminal, computer, Storage bucket or Edge Function is required.

## Apply the SQL in Safari

1. Open [the Stage 2A migration on GitHub](https://github.com/kathrine88/personal-project-hq/blob/source-library-stage2a/migrations/20261026150000_project_source_library.sql). Tap **Raw**, then select all and copy the entire SQL, including `begin` and `commit`.
2. Open [your existing Supabase project's SQL Editor](https://supabase.com/dashboard/project/rilqlmsojlplbaoxkztc/sql/new) in another Safari tab. Sign in to Supabase if asked. Create a new query, paste the whole file and tap **Run**. Run it once. If it reports an error, stop and share that error rather than rerunning older migrations.
3. Do **not** rerun Stage 1, Money, routine or meal migrations. Stage 1 is required and was found installed during read-only inspection. The existing PostgreSQL 17 instance supports the scoped foreign-key action used here.
4. After success, paste and run this **read-only verification** in a new query:

```sql
select c.relname, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='hq_project_sources';

select policyname, roles, cmd, qual, with_check
from pg_policies where schemaname='public' and tablename='hq_project_sources';

select to_regprocedure('public.hq_source_library(text)') is not null as library_reader_ready;
```

Expect one table with both RLS flags `true`, an `authenticated` policy restricting reads and writes to `owner_id = auth.uid()`, and `library_reader_ready = true`.

No source data is prefilled. The new `hq_project_sources` table should be empty until you save a source through the app. The SQL Editor uses elevated privileges, so these checks confirm setup, **not actual end-user isolation**. Check isolation using app accounts below when available.

## Deployment and testing access

This repository currently has no automatic PR preview environment. **The PR branch is not the production website**, and this change does not add a deployment workflow or change hosting. Applying SQL alone does not reveal the new screen on the current website. Keep the PR unmerged until the SQL succeeds and you approve the next deployment step. If a preview is provided for this PR, use that URL; otherwise the feature checklist below runs after an explicitly approved deployment. You do not need to install tools or set up a local server.

No Edge Function needs deploying for this release. Automatic website metadata retrieval is explicitly deferred; see the preview limitations below. No Supabase Storage configuration is needed, and there are no file upload controls.

## Concise iPhone Safari checklist

Using the PR preview or an approved deployed version, sign in to Personal Project HQ:

- Tap each main project card → **Source Library**. Check the correct project name, Back to project, and useful empty state. Switch **Gallery / List**, refresh and check the preference is remembered where Safari allows storage.
- Tap **+ Add Source**, paste a full website URL and save without entering anything else. It should use the website's domain as its title. Open it, tap **Open website**, then return to the app. A missing preview must not block saving.
- Edit the link's title, description, personal notes and optional subsection in **More details**. Save, refresh, and sign out/in to check persistence. All applicable fields should be editable; no subsection is required.
- Add a **Written note** with a title and several paragraphs. Open and edit the full note. Check line breaks, long text, comfortable scrolling and no horizontal overflow at iPhone widths.
- Try Website links / Written notes, an individual subsection, **No subsection**, and All subsections. Filters should combine correctly. Returning from a source detail keeps the collection view/filters; entering from a project starts with all sources.
- Delete one source: cancel first, then confirm. Only that source should disappear. Create a source assigned to a temporary subsection; delete that subsection from the project. The source must remain in the project library as **No subsection**. Other sources/projects stay unchanged.
- If a second account is available, sign out/in as it: the first account's sources must be invisible. Check that another project's library stays separate. Check sign-out clears the library.
- Check project/milestone progress, ordinary project tasks, weekly tasks/routines/dragging, meals/shopping and Money still work. Sources must never change progress, tasks or the money pot.

If a save or connection fails, the form keeps your text and shows an error. Cancel and **Reload library** before retrying, because an interrupted response may already have saved. If saving succeeded but refreshing failed, the form closes and the screen explains that the saved library needs reloading. Do not add the same item again before reloading.

## What the SQL changes

One new user-owned table stores UUID, project, nullable subsection, text source type, HTTP(S) URL where applicable, title, description, note content, optional preview image URL, timestamps and an optimistic-concurrency version. Links and written notes have separate constraints; title/content lengths are bounded. Indexes support owner/project/type/date and subsection filtering. There are no custom tags, example data, uploads, file columns or separate subsection libraries.

A composite `(section_id, owner_id, project)` foreign key matches Stage 1, preventing cross-owner or cross-project association on both insert and update. Deleting a subsection uses `ON DELETE SET NULL (section_id)`: **only the optional subsection reference clears**; the source, project and owner are retained. This does not change Stage 1's milestone cascade or progress logic. Sources have immutable owner/project identity, server-controlled created/updated timestamps and versions; automatic unassignment also increments the version so a stale editor cannot restore a deleted association.

RLS is enabled and forced, with both `USING` and `WITH CHECK`. Anonymous table/RPC access is revoked. The snapshot function is **SECURITY INVOKER** with an empty search path and reads the current user's project only. It returns sources and sections together without truncating lists at the REST row limit. Updates/deletes filter by project, UUID and version; adds use a stable UUID to prevent duplicate retries. No service-role credentials are used in the browser.

Existing keys stay unchanged: Christmas uses `Christmas Planning`, Health & Fitness uses `Health & Fitness`; the approved Wellbeing homepage card and all six photos are untouched. Existing SQL files, tables, planner queries and project progress calculations are unchanged.

## Automatic preview limitation — intentional Stage 2A fallback

**This release does not retrieve Open Graph titles, descriptions or images.** Pasting a link saves it immediately with a domain fallback; you can supply/change its title, description and notes. No website metadata request is made from the browser, and no fetch proxy or third-party scraping service is introduced. The form explicitly explains that automatic previews are unavailable.

The schema and Gallery/List/detail renderers already support optional preview image metadata. New manual sources have no preview image. Broken/unsupported images fall back to a neutral source icon. The UI does not pretend to upload files or offer a nonworking preview button.

A secure future preview implementation must authenticate callers, rate-limit requests and validate/pin public network destinations including every redirect, with bounded response sizes and timeouts. DNS checks alone followed by a normal hostname fetch do not address rebinding. Those protections could not be reliably implemented and validated in this environment, so the permitted manual fallback is used. See [the future preview contract](../docs/SOURCE_PREVIEWS.md). There are **no Edge Function deployment steps** for this PR.

Stage 2B can add uploaded image/document types and private Storage object references through an additive migration. Stage 2A uses extensible text type checks rather than a fixed enum, and keeps sources independent of tasks/milestones. Stage 2B is not implemented here.

## Validation limits

The existing schema/version and Edge Functions were inspected read-only. The new migration, live RLS, real new-table persistence and physical iPhone Safari have not been tested by the assistant. Automated browser tests use local Supabase fixtures, including simulated refresh/sign-in persistence and subsection unassignment; they are not real database security tests. SQL execution and the checklist above remain required after setup.

Developer test commands remain in README for maintainers; you do not need to run them on your iPhone. The Supabase CLI/local PostgreSQL are unavailable in the workspace; this labelled SQL is supplied for manual application, not claimed as applied migration history.
