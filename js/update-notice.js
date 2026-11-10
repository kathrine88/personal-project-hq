// Optional, non-blocking update notice. No automatic reloads or offline data caching.
// A public GitHub commit check avoids needing to manually update a version file.
(()=>{
  const storageKey='hq-last-seen-release-sha';
  const endpoint='https://api.github.com/repos/kathrine88/personal-project-hq/commits/main';
  let checking=false, lastCheck=0, offered=false;
  const read=()=>{try{return localStorage.getItem(storageKey)}catch{return null}};
  const write=value=>{try{localStorage.setItem(storageKey,value)}catch{}};
  function showUpdate(sha){
    if(offered||document.getElementById('hq-update-banner'))return;
    offered=true;
    const banner=document.createElement('aside');
    banner.id='hq-update-banner';
    banner.setAttribute('role','status');
    banner.style.cssText='position:fixed;bottom:calc(12px + env(safe-area-inset-bottom, 0px));left:12px;right:12px;max-width:440px;margin:auto;z-index:2147483640;display:flex;align-items:center;gap:9px;padding:11px 12px;border:1px solid #c9bca9;border-radius:13px;background:#f8f1e6;color:#294536;box-shadow:0 6px 24px #2c291e2e;font:12px Arial,sans-serif';
    const copy=document.createElement('span');copy.textContent='A new Project HQ update is ready.';copy.style.flex='1';
    const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Refresh';refresh.style.cssText='background:#294536;color:#fff9ee;border:0;border-radius:8px;padding:10px 12px;font:600 12px Arial,sans-serif';
    refresh.addEventListener('click',()=>{
      // Confirm before discarding unsaved edits; keep the notice if cancelled.
      if(!window.confirm('Refresh Project HQ now? Save or finish any open edits first.'))return;
      write(sha);
      window.location.reload();
    });
    const dismiss=document.createElement('button');dismiss.type='button';dismiss.textContent='Later';dismiss.style.cssText='background:transparent;color:#765b51;border:0;padding:10px 3px;font:12px Arial,sans-serif';
    dismiss.addEventListener('click',()=>{banner.remove();offered=false;lastCheck=Date.now()});
    banner.append(copy,refresh,dismiss);document.body.append(banner);
  }
  async function check(){
    if(checking||!navigator.onLine||document.visibilityState==='hidden'||Date.now()-lastCheck<120000)return;
    checking=true;lastCheck=Date.now();
    try{
      const response=await fetch(endpoint,{cache:'no-store',headers:{Accept:'application/vnd.github+json'}});
      if(!response.ok)return;
      const payload=await response.json(),sha=payload.sha;
      if(typeof sha!=='string'||!/^[a-f0-9]{40}$/.test(sha))return;
      const previous=read();
      if(previous&&previous!==sha)showUpdate(sha);
      else if(!previous)write(sha);
    }catch{/* Offline, API unavailable or rate limited: never interrupt the app. */}
    finally{checking=false}
  }
  window.addEventListener('load',check,{once:true});
  window.addEventListener('pageshow',check);
  window.addEventListener('focus',check);
  window.addEventListener('online',check);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')check()});
})();
