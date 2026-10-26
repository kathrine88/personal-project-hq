// @ts-nocheck
// Single-file deployment: paste this entire file into the Supabase Dashboard editor.
// No dependencies. Service credentials stay ONLY inside this server function.
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MIME = {
  jpg:'image/jpeg', png:'image/png', webp:'image/webp', heic:'image/heic', heif:'image/heif', pdf:'application/pdf',
  docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', txt:'text/plain'
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const projects = ['Garden','Book Nook','Christmas Planning','Health & Fitness','Home Projects','Other'];
const fail = (message,status=400) => {const e = new Error(message);e.status=status;throw e;};
export function safeFilename(value) {
  const name = String(value||'file').normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069/\\:"<>|?*]/g,'_').replace(/^\.+/,'').trim();
  const dot=name.lastIndexOf('.'), suffix=dot>=0?name.slice(dot).toLowerCase():'';
  return (name.slice(0,Math.min(dot>=0?dot:name.length,160))||'file')+suffix.slice(0,12);
}
const ascii=(bytes,start,end)=>new TextDecoder().decode(bytes.subarray(start,end));
function zipNames(bytes) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0||view.getUint16(end+4,true)||view.getUint16(end+6,true))fail('Use an ordinary DOCX or XLSX file, not a split archive.');
  const count=view.getUint16(end+10,true),size=view.getUint32(end+12,true),start=view.getUint32(end+16,true);
  if(!count||count>2048||start+size>end||end+22+view.getUint16(end+20,true)!==bytes.length)fail('This Office file is unsupported or damaged.');
  let pos=start,total=0;const names=new Set();
  for(let n=0;n<count;n++) {
    if(pos+46>start+size||view.getUint32(pos,true)!==0x02014b50)fail('This Office file is damaged.');
    const flags=view.getUint16(pos+8,true),method=view.getUint16(pos+10,true),length=view.getUint16(pos+28,true),extra=view.getUint16(pos+30,true),comment=view.getUint16(pos+32,true),unpacked=view.getUint32(pos+24,true),local=view.getUint32(pos+42,true);
    total+=unpacked;
    if(flags&65||![0,8].includes(method)||total>100*1024*1024||pos+46+length+extra+comment>start+size||local+30>start||view.getUint32(local,true)!==0x04034b50)fail('Encrypted, oversized or unsupported Office files cannot be uploaded.');
    const name=ascii(bytes,pos+46,pos+46+length);
    if(name.includes('..')||name.includes('\\')||name.startsWith('/')||/\.(bin|exe|dll|js|vbs|ps1|html?|svg|jar|com|bat|cmd|scr)$/i.test(name)||/vbaProject/i.test(name))fail('Office files with macros or embedded executable objects are not supported.');
    names.add(name);pos+=46+length+extra+comment;
  }
  if(pos!==start+size||!names.has('[Content_Types].xml'))fail('This is not a supported Office document.');
  return names;
}
export function validateFile(bytes,filename,kind,maximum=MAX_FILE_BYTES) {
  if(!['image','file'].includes(kind)||!bytes.length||bytes.length>maximum)fail('Choose a supported file up to '+Math.floor(maximum/1048576)+' MB.');
  const ext=String(filename).split('.').pop()?.toLowerCase(),extension=ext==='jpeg'?'jpg':ext;
  if(!Object.hasOwn(MIME,extension)||(kind==='image')!==['jpg','png','webp','heic','heif'].includes(extension))fail('Choose JPEG, PNG, WebP, HEIC/HEIF for images, or PDF, DOCX, XLSX, TXT for files.');
  let valid=false;
  if(extension==='jpg')valid=bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(extension==='png')valid=bytes.length>=24&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)&&ascii(bytes,12,16)==='IHDR';
  if(extension==='webp')valid=bytes.length>=16&&ascii(bytes,0,4)==='RIFF'&&ascii(bytes,8,12)==='WEBP'&&['VP8 ','VP8L','VP8X'].includes(ascii(bytes,12,16));
  if(extension==='heic'||extension==='heif') {
    if(bytes.length>=24&&ascii(bytes,4,8)==='ftyp') {
      const length=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(0),brands=[];
      if(length>=24&&length<=Math.min(bytes.length,256))for(let i=8;i+4<=length;i+=4)if(i!==12)brands.push(ascii(bytes,i,i+4));
      valid=brands.some(b=>['heic','heix','hevc','hevx','mif1','msf1'].includes(b))&&!brands.some(b=>['avif','avis'].includes(b));
    }
  }
  if(extension==='pdf')valid=bytes.length>=8&&/^%PDF-\d\.\d/.test(ascii(bytes,0,8));
  if(extension==='txt') {
    let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('TXT files must use UTF-8 text.');}
    valid=!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)&&!/^\s*(<!doctype|<html|<svg|<script|<\?xml|#!)/i.test(text);
  }
  if(extension==='docx'||extension==='xlsx') {
    if(bytes.length<22)fail('This Office file is damaged.');const names=zipNames(bytes);
    valid=extension==='docx'?names.has('word/document.xml'):names.has('xl/workbook.xml');
  }
  if(!valid)fail('The file contents do not match a supported '+extension.toUpperCase()+' file. Export it again or choose another file.');
  return {extension,mime_type:MIME[extension],file_size:bytes.length,original_filename:safeFilename(filename)};
}
function values(input,filename) {
  const clean=(name,max,fallback='')=>{const value=String(input[name]??fallback).trim();if(value.length>max)fail(name+' is too long.');return value;};
  const section_id=input.section_id||null;if(section_id&&!uuid.test(section_id))fail('Invalid subsection.');
  return {title:clean('title',300)||filename,description:clean('description',2000),note_content:clean('note_content',50000),section_id};
}
export async function boundedBody(request,maximum,timeout=90000) {
  const declared=Number(request.headers.get('content-length'));if(declared>maximum)fail('The upload is too large.',413);
  if(!request.body)fail('Choose a file.');const reader=request.body.getReader(),chunks=[];let size=0;
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;void reader.cancel('timeout');},timeout);
  try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maximum){await reader.cancel();fail('The upload is too large.',413);}chunks.push(value);}if(timedOut)fail('The upload timed out. Reload the library before retrying.',408);}
  finally {clearTimeout(timer);reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
export function createHandler(env,network=fetch) {
  const base=env.SUPABASE_URL?.replace(/\/$/,''),key=env.SUPABASE_SERVICE_ROLE_KEY;
  const origins=(env.ALLOWED_ORIGINS||'https://kathrine88.github.io').split(',').map(s=>s.trim()).filter(Boolean);
  const maximum=Math.min(MAX_FILE_BYTES,Math.max(1,Number(env.MAX_FILE_BYTES)||MAX_FILE_BYTES));
  async function api(path,options={}) {
    const response=await network(base+path,{...options,signal:AbortSignal.timeout(options.timeout||15000),headers:{apikey:key,Authorization:'Bearer '+key,...options.headers}});
    let data;try{data=await response.json();}catch{data=null;}
    if(!response.ok){const e=new Error(data?.message||data?.error||'Storage service is unavailable.');e.status=response.status;e.code=data?.code||data?.error;throw e;}return data;
  }
  const rpc=(owner,action,input)=>api('/rest/v1/rpc/hq_source_file_command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_owner:owner,p_action:action,p_input:input})});
  async function bucket() {
    const data=await api('/storage/v1/bucket/hq-source-files');
    if(data.public!==false||!data.file_size_limit||data.file_size_limit>MAX_FILE_BYTES||!Array.isArray(data.allowed_mime_types)||!data.allowed_mime_types.length||data.allowed_mime_types.some(m=>!Object.values(MIME).includes(m)))fail('Uploads are not configured safely yet. Check the private bucket settings.',503);
    return Math.min(maximum,data.file_size_limit);
  }
  async function cleanup(owner,job) {
    if(job.finished)return;
    if(job.state==='staging')job=await rpc(owner,'discard',{operation:job.id});
    const path=job.state==='discarded'?job.candidate_path:job.obsolete_path;
    if(path) {
      if(!path.startsWith(owner+'/'+job.source_id+'/')||path.includes('..'))fail('Invalid cleanup path.',500);
      try {await api('/storage/v1/object/hq-source-files',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[path]})});}
      catch(error){if(error.status!==404)throw error;}
    }
    return await rpc(owner,'finish',{operation:job.id});
  }
  return async request=>{
    const origin=request.headers.get('origin'),cors={'Access-Control-Allow-Origin':origins.includes(origin)?origin:'null','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
    const reply=(data,status=200)=>Response.json(data,{status,headers:cors});
    try {
      if(!origins.includes(origin))return reply({error:'This app origin is not allowed.'},403);
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
      if(request.method!=='POST')return reply({error:'POST required.'},405);
      if(!base||!key)fail('Uploads are not configured yet.',503);
      const token=request.headers.get('authorization');if(!/^Bearer \S+$/i.test(token||''))fail('Please sign in again.',401);
      // Never trust decoded JWT claims or a client-supplied owner ID.
      const auth=await network(base+'/auth/v1/user',{headers:{apikey:key,Authorization:token},signal:AbortSignal.timeout(10000)});
      if(!auth.ok)fail('Your session expired. Sign in again.',401);const user=await auth.json();if(!uuid.test(user.id||''))fail('Please sign in again.',401);
      const owner=user.id,limit=await bucket();
      if(request.headers.get('content-type')?.startsWith('multipart/form-data')) {
        const body=await boundedBody(request,limit+524288),form=await new Request('https://upload.invalid',{method:'POST',headers:{'content-type':request.headers.get('content-type')},body}).formData();
        const file=form.get('file');if(form.getAll('file').length!==1||!(file instanceof File))fail('Choose one file.');
        let input;try{input=JSON.parse(String(form.get('metadata')));}catch{fail('Invalid upload details.');}
        if(!uuid.test(input.id||'')||!uuid.test(input.operation||'')||!projects.includes(input.project)||!['image','file'].includes(input.source_type)||(input.version!=null&&(!Number.isSafeInteger(input.version)||input.version<1)))fail('Invalid source details.');
        const bytes=new Uint8Array(await file.arrayBuffer()),metadata=validateFile(bytes,file.name,input.source_type,limit);
        const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
        const payload={id:input.id,operation:input.operation,project:input.project,version:input.version??null,source_type:input.source_type,...values(input,metadata.original_filename),...metadata,sha256};
        let job=await rpc(owner,'begin',payload);if(job.already_saved)return reply({saved:true});
        if(job.state==='committed'){try{await cleanup(owner,job);}catch{}return reply({saved:true});}
        if(job.state!=='staging')fail('This upload was cancelled. Reload before choosing the file again.',409);
        try {
          try {await api('/storage/v1/object/hq-source-files/'+job.candidate_path,{method:'POST',headers:{'Content-Type':metadata.mime_type,'x-upsert':'false','cache-control':'private, max-age=60'},body:bytes,timeout:60000});}
          catch(error){if(error.status!==409&&error.code!=='Duplicate'&&error.code!=='ResourceAlreadyExists')throw error;}
          job=await rpc(owner,'commit',{operation:job.id});
        } catch(error) {
          try {const settled=await rpc(owner,'discard',{operation:job.id});await cleanup(owner,settled);if(settled.state==='committed')return reply({saved:true});}catch{/* Journal retains the exact cleanup path for retry. */}
          throw error;
        }
        let notice='';try{await cleanup(owner,job);}catch{notice='Saved. The previous file needs cleanup; use Retry file cleanup.';}
        return reply({saved:true,notice});
      }
      const bytes=await boundedBody(request,4096,15000);let input;try{input=JSON.parse(new TextDecoder().decode(bytes));}catch{fail('Invalid request.');}
      if(input.action==='config')return reply({max_bytes:limit});
      if(!projects.includes(input.project))fail('Unknown project.');
      if(input.action==='cleanup') {
        const jobs=await rpc(owner,'list',{project:input.project});let pending=0;
        for(const job of jobs){try{const status=await cleanup(owner,job);if(status?.pending)pending++;}catch{pending++;}}
        return reply({notice:pending?'Some file cleanup is pending or waiting for an interrupted upload to settle. Retry in ten minutes when connected.':'File cleanup checked.'});
      }
      if(input.action==='delete') {
        if(!uuid.test(input.id||'')||!uuid.test(input.operation||'')||!Number.isSafeInteger(input.version))fail('Invalid deletion details.');
        const job=await rpc(owner,'delete',input);if(job.already_deleted)return reply({deleted:true});
        try{await cleanup(owner,job);}catch{fail('Deletion is pending. Reload, then use Retry file cleanup to finish safely.',503);}
        return reply({deleted:true});
      }
      fail('Unknown file action.');
    }catch(error){return reply({error:error.status===401?error.message:(error.message||'File operation failed. Reload before retrying.')},error.status>=400&&error.status<=599?error.status:400);}
  };
}
if(globalThis.Deno?.serve)Deno.serve(createHandler({SUPABASE_URL:Deno.env.get('SUPABASE_URL'),SUPABASE_SERVICE_ROLE_KEY:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),ALLOWED_ORIGINS:Deno.env.get('ALLOWED_ORIGINS'),MAX_FILE_BYTES:Deno.env.get('MAX_FILE_BYTES')}));
