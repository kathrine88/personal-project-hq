export const SOURCE_BUCKET='hq-source-files';
export const MAX_UPLOAD_BYTES=20*1024*1024;
export const isUpload=source=>['image','file'].includes(source?.source_type);
export const fileSize=bytes=>bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':Math.max(1,Math.ceil(bytes/1024))+' KB';
export const fileAccept=kind=>kind==='image'?'.jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif':'.pdf,.docx,.xlsx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain';
export function checkSelectedFile(file,kind) {
  if(!file||!file.size||file.size>MAX_UPLOAD_BYTES)throw new Error('Choose one non-empty file up to 20 MB.');
  const ext=file.name.split('.').pop()?.toLowerCase(),allowed=kind==='image'?['jpg','jpeg','png','webp','heic','heif']:['pdf','docx','xlsx','txt'];
  if(!allowed.includes(ext))throw new Error(kind==='image'?'Choose JPEG, PNG, WebP or HEIC/HEIF.':'Choose PDF, DOCX, XLSX or TXT.');
  return file;
}
// Signed URLs exist only in memory, never source rows or localStorage.
export function createFileAccess(repository,{now=()=>Date.now()}={}) {
  let generation=0;const cache=new Map();
  async function url(source,download=false,refresh=false) {
    const key=source.id+':'+source.version+':'+download;
    if(refresh)cache.delete(key);
    const found=cache.get(key);if(found&&found.expires>now())return found.promise;
    const epoch=generation;
    const promise=repository.signedFile(source,download).then(value=>{
      if(epoch!==generation)throw new Error('Your session changed. Sign in again.');
      return value;
    }).catch(error=>{cache.delete(key);throw error;});
    cache.set(key,{promise,expires:now()+240000});return promise;
  }
  return {url,clear(){generation++;cache.clear();}};
}
