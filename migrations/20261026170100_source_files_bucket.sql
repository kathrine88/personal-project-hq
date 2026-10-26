-- STAGE 2B, STEP 2: explicitly create/configure the PRIVATE bucket.
-- Run separately AFTER the record/policy migration. It does not deploy the function.
-- If this bucket already exists, stop and inspect its settings rather than overwrite it.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('hq-source-files','hq-source-files',false,20971520,array[
 'image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain'
]);
commit;
