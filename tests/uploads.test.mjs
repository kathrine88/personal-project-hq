import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFile,safeFilename,boundedBody,createHandler,MAX_FILE_BYTES,MIME} from '../supabase/functions/source-files/index.ts';
import {checkSelectedFile,createFileAccess} from '../js/source-files.js';
import {sourceValues} from '../js/source-core.js';
const owner='00000000-0000-4000-8000-000000000001',id='00000000-0000-4000-8000-000000000002',operation='00000000-0000-4000-8000-000000000003';
const image=new Uint8Array([255,216,255,224,0,1,2,3,255,217]);
function officeZip(names) {
 const parts=[],central=[];let offset=0;
 for(const name of names){const bytes=new TextEncoder().encode(name),local=new Uint8Array(30+bytes.length),view=new DataView(local.buffer);view.setUint32(0,0x04034b50,true);view.setUint16(26,bytes.length,true);local.set(bytes,30);parts.push(local);const header=new Uint8Array(46+bytes.length),h=new DataView(header.buffer);h.setUint32(0,0x02014b50,true);h.setUint16(28,bytes.length,true);h.setUint32(42,offset,true);header.set(bytes,46);central.push(header);offset+=local.length;}
 const size=central.reduce((n,p)=>n+p.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,names.length,true);e.setUint16(10,names.length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);const out=new Uint8Array(offset+size+22);let at=0;for(const chunk of [...parts,...central,end]){out.set(chunk,at);at+=chunk.length;}return out;
}
test('server validates bytes, extensions, size and OOXML structure instead of trusting client MIME',()=>{
 assert.equal(validateFile(image,'photo.JPEG','image').mime_type,'image/jpeg');
 assert.equal(validateFile(new TextEncoder().encode('%PDF-1.7\nbody'),'report.pdf','file').mime_type,'application/pdf');
 assert.equal(validateFile(new TextEncoder().encode('Plain UTF-8 text £'),'readme.txt','file').mime_type,'text/plain');
 assert.equal(validateFile(officeZip(['[Content_Types].xml','word/document.xml']),'notes.docx','file').extension,'docx');
 assert.equal(validateFile(officeZip(['[Content_Types].xml','xl/workbook.xml']),'sheet.xlsx','file').extension,'xlsx');
 const heic=new Uint8Array(24);new DataView(heic.buffer).setUint32(0,24);heic.set(new TextEncoder().encode('ftypheic'),4);heic.set(new TextEncoder().encode('mif1'),16);assert.equal(validateFile(heic,'photo.heic','image').mime_type,'image/heic');
 for(const [bytes,name,kind] of [[image,'bad.exe','file'],[image,'wrong.pdf','file'],[new TextEncoder().encode('<svg onload="alert(1)">'),'x.svg','image'],[new TextEncoder().encode('<html>Hi'),'x.txt','file'],[new Uint8Array([255,0]),'x.txt','file'],[officeZip(['[Content_Types].xml','word/document.xml','word/vbaProject.bin']),'x.docx','file'],[officeZip(['[Content_Types].xml','xl/workbook.xml']),'x.docx','file']])assert.throws(()=>validateFile(bytes,name,kind));
 assert.throws(()=>validateFile(new Uint8Array(MAX_FILE_BYTES+1),'large.jpg','image'));assert.throws(()=>validateFile(new Uint8Array(),'empty.txt','file'));
 assert.throws(()=>checkSelectedFile(new File([image],'x.pdf'),'image'));
});
test('filenames and optional file metadata are safe and do not require a title',()=>{
 const name=safeFilename('../unsafe\\name\u202e<script>.pdf');assert.ok(!/[\\/<>\u202e]/.test(name));assert.ok(name.length<=180);assert.ok(name.endsWith('.pdf'));
 const values=sourceValues({source_type:'image',original_filename:'photo.jpg'});assert.equal(values.title,'photo.jpg');assert.equal(values.url,null);assert.equal(values.section_id,null);
});
test('bounded request reader enforces stream size without trusting Content-Length and detects timeout',async()=>{
 await assert.rejects(boundedBody(new Request('https://x.test',{method:'POST',body:'123456'}),5),/too large/);
 const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(4));c.enqueue(new Uint8Array(4));c.close();}});
 await assert.rejects(boundedBody(new Request('https://x.test',{method:'POST',body:stream,duplex:'half'}),7),/too large/);
 const hanging=new ReadableStream({start(){}});await assert.rejects(boundedBody(new Request('https://x.test',{method:'POST',body:hanging,duplex:'half'}),10,5),/timed out/);
});
function fixture(flags={}) {
 const calls=[],objects=new Set(),jobs=new Map();let source=null;
 const oldPath=owner+'/'+id+'/00000000-0000-4000-8000-000000000099.jpg';
 if(flags.replace){objects.add(oldPath);source={id,owner_id:owner,project:'Garden',version:1,storage_path:oldPath,file_status:'ready'};}
 const network=async(url,options={})=>{
  const path=new URL(url).pathname;calls.push({path,method:options.method||'GET'});
  const json=(value,status=200)=>Response.json(value,{status});
  if(path==='/auth/v1/user')return flags.badAuth?json({},401):json({id:owner});
  if(path==='/storage/v1/bucket/hq-source-files')return json({public:!!flags.publicBucket,file_size_limit:MAX_FILE_BYTES,allowed_mime_types:Object.values(MIME)});
  if(path==='/rest/v1/rpc/hq_source_file_command'){
   const {p_owner,p_action:action,p_input:p}=JSON.parse(options.body);assert.equal(p_owner,owner);
   if(action==='begin'){
    if(flags.foreignSection)return json({message:'Subsection not found'},400);
    const job={id:p.operation,owner_id:owner,project:p.project,source_id:p.id,state:'staging',candidate_path:owner+'/'+p.id+'/'+p.operation+'.'+p.extension,obsolete_path:source?.storage_path||null,payload:p};jobs.set(job.id,job);return json(job);
   }
   const job=jobs.get(p.operation);
   if(action==='commit'){
    assert.ok(objects.has(job.candidate_path));if(flags.commitFailure)return json({message:'Source changed'},409);
    source={...job.payload,storage_path:job.candidate_path,file_status:'ready',version:2};job.state='committed';
    if(flags.commitResponseLost){flags.commitResponseLost=false;throw Error('Commit response lost');}return json(job);
   }
   if(action==='discard'){if(job?.state==='staging')job.state='discarded';return json(job||{finished:true});}
   if(action==='finish'){if(flags.pendingQuiescence&&job?.state==='discarded')return json({pending:true});if(flags.finishFailure)return json({message:'Finish failed'},503);if(job?.state==='deleting')source=null;jobs.delete(p.operation);return json({finished:true});}
   if(action==='list')return json([...jobs.values()]);
   if(action==='delete'){
    if(!source)return json({already_deleted:true});source.file_status='deleting';const job={id:p.operation,owner_id:owner,project:'Garden',source_id:p.id,state:'deleting',obsolete_path:source.storage_path,payload:p};jobs.set(job.id,job);return json(job);
   }
   throw Error('Unexpected action '+action);
  }
  if(path.startsWith('/storage/v1/object/hq-source-files/')&&options.method==='POST'){
   if(flags.uploadFailure)return json({message:'Upload failed'},503);const object=path.slice('/storage/v1/object/hq-source-files/'.length);assert.equal(options.headers['x-upsert'],'false');assert.equal(options.headers['Content-Type'],'image/jpeg');objects.add(object);return json({Key:object});
  }
  if(path==='/storage/v1/object/hq-source-files'&&options.method==='DELETE'){
   if(flags.cleanupFailure)return json({message:'Storage offline'},503);for(const key of JSON.parse(options.body).prefixes)objects.delete(key);return json([]);
  }
  throw Error('Unexpected path '+path);
 };
 const handler=createHandler({SUPABASE_URL:'https://api.test',SUPABASE_SERVICE_ROLE_KEY:'server-only-test-key'},network);
 const headers={origin:'https://kathrine88.github.io',authorization:'Bearer verified-test-user'};
 const upload=(extra={})=>{const form=new FormData();form.set('file',new File([image],'photo.jpeg',{type:'text/html'}));form.set('metadata',JSON.stringify({id,operation,project:'Garden',source_type:'image',version:flags.replace?1:null,...extra}));return handler(new Request('https://edge.test',{method:'POST',headers,body:form}));};
 const action=body=>handler(new Request('https://edge.test',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)}));
 return {upload,action,handler,flags,jobs,objects,calls,get source(){return source;},oldPath};
}
test('authenticated handler enforces origin, user validation and private bucket settings before upload',async()=>{
 const f=fixture();assert.equal((await f.handler(new Request('https://edge.test',{method:'POST'}))).status,403);
 const bad=fixture({badAuth:true});assert.equal((await bad.upload()).status,401);assert.equal(bad.objects.size,0);
 const publicBucket=fixture({publicBucket:true});assert.equal((await publicBucket.upload()).status,503);assert.equal(publicBucket.objects.size,0);
 const foreign=fixture({foreignSection:true});assert.equal((await foreign.upload({section_id:'foreign'})).status,400);assert.equal(foreign.objects.size,0);
});
test('upload commits only after Storage success and cleans failed candidates without broken sources',async()=>{
 const f=fixture();assert.equal((await f.upload()).status,200);assert.equal(f.source.storage_path,[...f.objects][0]);assert.equal(f.jobs.size,0);
 const uploadFailure=fixture({uploadFailure:true});assert.notEqual((await uploadFailure.upload()).status,200);assert.equal(uploadFailure.source,null);assert.equal(uploadFailure.jobs.size,0);
 const commitFailure=fixture({commitFailure:true});assert.notEqual((await commitFailure.upload()).status,200);assert.equal(commitFailure.source,null);assert.equal(commitFailure.objects.size,0);
});
test('replacement preserves original on failure, commits new before cleanup, and journals failed cleanup for retry',async()=>{
 const failed=fixture({replace:true,commitFailure:true});await failed.upload();assert.equal(failed.source.storage_path,failed.oldPath);assert.deepEqual([...failed.objects],[failed.oldPath]);
 const f=fixture({replace:true,cleanupFailure:true});const result=await(await f.upload()).json();assert.match(result.notice,/cleanup/);assert.equal(f.objects.size,2);assert.notEqual(f.source.storage_path,f.oldPath);assert.equal(f.jobs.size,1);
 f.flags.cleanupFailure=false;assert.equal((await f.action({action:'cleanup',project:'Garden'})).status,200);assert.equal(f.objects.size,1);assert.equal(f.jobs.size,0);assert.ok(f.objects.has(f.source.storage_path));
});
test('lost commit response never deletes the committed new file; partial deletion remains pending until cleanup completes',async()=>{
 const f=fixture({replace:true,commitResponseLost:true});assert.equal((await f.upload()).status,200);assert.equal(f.objects.size,1);assert.ok(f.objects.has(f.source.storage_path));
 f.flags.finishFailure=true;assert.equal((await f.action({action:'delete',project:'Garden',id,version:2,operation})).status,503);assert.equal(f.source.file_status,'deleting');assert.equal(f.objects.size,0);assert.equal(f.jobs.size,1);
 f.flags.finishFailure=false;await f.action({action:'cleanup',project:'Garden'});assert.equal(f.source,null);assert.equal(f.jobs.size,0);
});
test('expired signed URLs refresh in memory; sign-out rejects delayed responses and never reuses access',async()=>{
 let now=0,calls=0;const source={id,version:1};const access=createFileAccess({signedFile:async()=>'/signed/'+(++calls)},{now:()=>now});
 assert.equal(await access.url(source),'/signed/1');assert.equal(await access.url(source),'/signed/1');now=240001;assert.equal(await access.url(source),'/signed/2');assert.equal(await access.url(source,false,true),'/signed/3');
 let resolve;const late=createFileAccess({signedFile:()=>new Promise(r=>resolve=r)});const pending=late.url(source);late.clear();resolve('/old-user');await assert.rejects(pending,/session changed/);
});

test('cleanup keeps an uncertain upload tracked through its settling period and ignores client-supplied owners',async()=>{
 const f=fixture({uploadFailure:true,pendingQuiescence:true});await f.upload({owner_id:'not-the-authenticated-owner'});assert.equal(f.source,null);assert.equal(f.jobs.size,1);assert.equal(f.objects.size,0);
 const pending=await(await f.action({action:'cleanup',project:'Garden'})).json();assert.match(pending.notice,/ten minutes/);assert.equal(f.jobs.size,1);
 f.flags.pendingQuiescence=false;await f.action({action:'cleanup',project:'Garden'});assert.equal(f.jobs.size,0);
});
