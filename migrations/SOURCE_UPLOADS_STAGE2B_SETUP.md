# Stage 2B — iPhone-only setup before merging

**Three separate setup steps are required: database, private bucket, and Edge Function.** Creating source columns does not create the bucket or deploy upload validation. None of these steps has been applied by the assistant. Keep the PR unmerged while setting up and verifying it.

All steps use Safari, GitHub and your existing Supabase Dashboard. No terminal or desktop is required. Existing links/notes and planners continue working when uploads are not configured.

## 1. Database and access policies

Open [the record/policy migration](https://github.com/kathrine88/personal-project-hq/blob/source-uploads-stage2b/migrations/20261026170000_source_uploads.sql). Tap **Raw**, select all and copy. In [your Supabase SQL Editor](https://supabase.com/dashboard/project/rilqlmsojlplbaoxkztc/sql/new), paste the **entire file**, including begin/commit, and Run once. Stage 2A must already be installed (it was inspected read-only during development). Do not rerun old migrations.

This adds nullable file metadata to existing sources, supports `image` and `file`, retains all old rows, and adds a private file-operation recovery journal. Owner RLS remains enabled/forced. Browser metadata edits remain possible, but only the server can create file records, alter file pointers or delete uploaded sources. New Storage policies permit signing/reading only the signed-in owner's current ready files. Restrictive guards prevent other broad policies from accidentally permitting direct uploads, overwrites, deletes or cross-user reads in the new bucket. Other buckets are unaffected.

## 2. Explicitly create the private bucket

**This step is separate and mandatory.** Open [the bucket setup SQL](https://github.com/kathrine88/personal-project-hq/blob/source-uploads-stage2b/migrations/20261026170100_source_files_bucket.sql), tap Raw and copy all. Run it in a **new** Supabase SQL Editor query, once.

It creates `hq-source-files` with:

- **Public = OFF** (private).
- Per-file size limit **20,971,520 bytes (20 MiB, displayed as 20 MB in the app)**.
- An explicit allowlist: `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`, `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `text/plain`.

Then open [Storage](https://supabase.com/dashboard/project/rilqlmsojlplbaoxkztc/storage/buckets) and verify the bucket exists and is **Private**. Check its file-size and MIME restrictions. If the bucket already exists, the SQL intentionally fails rather than overwrite its configuration; inspect it in Storage and match the settings above. Do not create a public bucket or add browser upload/delete policies. If your Supabase global file-size setting is lower, the lower limit also applies.

## 3. Deploy the upload-validation Edge Function

The function is necessary: client-side checks and declared MIME types alone do not secure uploads.

1. Open [the exact function file in this PR](https://github.com/kathrine88/personal-project-hq/blob/source-uploads-stage2b/supabase/functions/source-files/index.ts). Tap Raw, select all and copy the **whole file**. It is self-contained; there are no other code files or dependencies to copy.
2. Open [Edge Functions](https://supabase.com/dashboard/project/rilqlmsojlplbaoxkztc/functions). Choose **Deploy a new function → Via Editor**. Name the function exactly **`source-files`**. Replace the template's entire `index.ts` with the copied code and deploy. Do not overwrite the existing `Project-hq-test` function.
3. In this new function's settings, turn **Verify JWT with legacy secret** **off**, matching `supabase/config.toml`. This is not anonymous access: the handler always validates the actual Authorization token through Supabase Auth before reading files or running any operation. It rejects missing/expired tokens and unapproved origins. This custom validation supports the app's existing authentication/key setup.
4. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` **inside the Edge runtime**. Leave these built-ins there. Never copy the service-role key into GitHub, the website, a screenshot or this chat. No key needs to be pasted into client code. If your dashboard reports a missing server built-in, stop and report the error.
5. Production's allowed origin defaults to `https://kathrine88.github.io`. If you use another website/approved preview origin, add an **Edge Function secret** named `ALLOWED_ORIGINS` with exact comma-separated origins (scheme + hostname + optional port, no trailing slash/path). Keep the production origin too. No wildcard `*`. Do not add unrelated origins.

For reference, Supabase documents [deployment via the Dashboard editor](https://supabase.com/docs/guides/functions/quickstart-dashboard). The code is version-controlled in this PR even though it is deployed through the dashboard.

The optional server secret `MAX_FILE_BYTES` can **lower** the initial limit; effective maximum is the lowest of that value, bucket limit, and the hard 20 MiB cap. Raising the cap beyond 20 MiB requires a coordinated code/SQL/bucket change and further memory/network testing, not merely changing one setting. No need to change it for this release.

## 4. Read-only verification

After all setup, run:

```sql
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id='hq-source-files';

select tablename, policyname, permissive, roles, cmd
from pg_policies
where (schemaname='public' and tablename in ('hq_project_sources','hq_source_file_operations'))
   or (schemaname='storage' and tablename='objects' and policyname ilike '%source%');

select to_regprocedure('public.hq_source_file_command(uuid,text,jsonb)') is not null as file_workflow_ready;

select relname, relrowsecurity, relforcerowsecurity from pg_class
where oid in ('public.hq_project_sources'::regclass,'public.hq_source_file_operations'::regclass,'storage.objects'::regclass);
```

Expect exactly the private bucket settings above, the new owner/restrictive policies, `file_workflow_ready=true`, both RLS flags true on both public tables, and RLS enabled on storage.objects (it was already enabled during read-only inspection). SQL Editor runs with elevated privileges: these checks **do not prove authenticated-user isolation**. Test with app accounts below. Edge Functions should show `source-files` deployed; don't use a service-role dashboard test token as if it were a signed-in app user.

## iPhone Safari checklist

The repository has no automatic PR preview hosting. An unmerged branch is not the live website. Apply setup first, then use an approved PR preview or explicitly approved deployment for these checks; no local server or computer setup is required from you. This PR does not deploy or merge the website automatically.

1. Sign in → a project → Source Library → **+ Add Source → Image / Photograph**. Choose a photo from Photos or Files. Check filename/selected preview, Cancel without saving, then choose again and Save. Check the clear uploading state and disabled duplicate submission. Refresh and sign out/in: the photo should remain private and saved.
2. Open the image, check useful viewing size and **Open image / Download original**. Leave the app open/backgrounded for over five minutes; return and check refreshed access. Use **Refresh file access** if needed. HEIC/HEIF may need Open/Download depending on Safari/device support.
3. Add a PDF, DOCX, XLSX and UTF-8 TXT from Files. Check filename/type icons and filters. PDFs use the browser's own viewer when supported; all documents can download as attachments. The app does not execute Office/text contents or embed a document renderer.
4. Add title, description, notes and optional subsection. Edit them later **without selecting a new file**: the metadata should save without a re-upload. Browse Gallery/List, subsection/unassigned filters, another project, and refresh. No subsection is required.
5. Edit an uploaded source and select a replacement of the same source type. Cancel first: the existing file should stay unchanged. Save a replacement: only the new file should be current; the previous object should be removed from Storage. Changing from image to document is not a replacement; add a new source of that type instead.
6. Delete one uploaded source: cancel first, then confirm. Check both the source and associated object disappear, with other sources untouched. For a connection/cleanup error: **Reload library → Retry file cleanup**. A pending deletion is labelled and cannot be opened/edited as if its file were ready.
7. Try a file over 20 MB, an unsupported format, and a renamed invalid file. Clear errors must appear without creating a broken source. Test poor connectivity/refresh during an upload; reload before retrying. An interrupted operation may already have saved—check the library first.
8. Delete a temporary subsection assigned to an uploaded source: the source/file must remain, now **No subsection**. Test a second account if available: it must not list/sign/read/replace/delete the first account's files. Sign out and check the prior source/details disappear.
9. Confirm old links/notes, milestone/project progress, tasks/routines/drag order, Money, meals/shopping and all six home photographs still work.

## Recovery and cleanup

Source rows never become ready until a validated Storage upload exists. An upload receives a collision-resistant `owner UUID/source UUID/operation UUID.extension` path; filenames are display/download metadata, not paths. No overwrites are used.

The database journal records paths before Storage work. A replacement commits its new file pointer before removing the old object. If creating/updating the source fails, the candidate is discarded and deletion is attempted immediately. If either service is unavailable, the journal retains the exact cleanup path. A lost commit response is checked before cleanup, so the committed file is never blindly removed.

Deletion first marks the source **deleting**, preventing access/editing, then removes its object and finally deletes the source/journal record. If database finalization fails after object removal, the pending record is kept and can safely finish later rather than appear as a broken ready file.

**Retry file cleanup** handles a small batch at a time; repeat if the button remains. Abandoned staging uploads become cleanable after **10 minutes**, so active uploads aren't removed. Discarded candidates receive immediate best-effort deletion, but their cleanup intent is kept through the same grace period to catch a timed-out Storage request that finishes remotely. Completed operations retain only a compact consumed-ID tombstone (no copied notes or file metadata); this prevents reuse of an old path during cleanup. Refresh after that interval to see the cleanup action. There is no scheduled background worker in this PR: cleanup failures remain tracked and require a later signed-in retry. Files are therefore never silently forgotten, but cleanup is not guaranteed while nobody returns to the app. Direct manual deletion of source rows/objects in the Supabase dashboard bypasses the app workflow and should not be used for routine deletion.

## Formats and limits

JPEG, PNG, WebP and HEIC/HEIF are accepted as image originals; PDF, macro-free ordinary DOCX/XLSX and UTF-8 TXT as documents. SVG, HTML, scripts, executables, GIF, archives, legacy DOC/XLS, macro-enabled/encrypted Office files and embedded executable objects are not supported. Office containers have bounded entry counts/expanded sizes and must contain the expected OOXML structure. File signatures/content checks run server-side, independent of client MIME labels. These checks are **not antivirus scanning or full document sanitisation**; originals remain untrusted and documents use download/native viewer behaviour, never app-executed content.

One file per save is intentional for reliability. Standard uploads are bounded, but not resumable; an interrupted transfer must be checked/retried. Keep Safari in the foreground on a stable connection for larger files. HEIC/HEIF is stored without lossy conversion; native rendering varies, so unsupported previews show a fallback with original access. Thumbnails use the private original (no paid image-transformation dependency), which can use more bandwidth for large photos. No automatic webpage previews are added.

Signed URLs expire after **five minutes**, refresh in memory before expiry/on return to the tab, and refresh once on image errors. They are not saved in source records or localStorage. Signing out clears in-memory access; an already-issued signed URL can remain valid until expiry. Never make the bucket public to fix an expired URL.

## Validation limits

Existing schema, buckets and policies were inspected read-only. The new migrations, bucket and function have **not** been applied/deployed by the assistant, and no live file was uploaded. Automated Node tests run the actual Edge handler against simulated Auth/Storage/RPC services; browser tests simulate persistence, signing and cleanup. They do not prove real Storage RLS or execute the new PostgreSQL functions. Real deployment, two-account isolation, network behaviour and physical iPhone Safari remain required manual checks.
