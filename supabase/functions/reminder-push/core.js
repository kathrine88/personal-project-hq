// Runtime-independent handler; injected boundaries make auth/delivery testable.
export const APP_ORIGIN = 'https://kathrine88.github.io';
export function validSubscription(value) {
  try {
    const url = new URL(value?.endpoint);
    const host = url.hostname;
    const allowed = host === 'push.apple.com' || host.endsWith('.push.apple.com') ||
      host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com';
    return allowed && url.protocol === 'https:' && !url.port && !url.username && !url.password && !url.hash &&
      value.endpoint.length <= 2048 && /^[A-Za-z0-9_-]{87}=?$/.test(value.keys?.p256dh || '') &&
      /^[A-Za-z0-9_-]{22}(==)?$/.test(value.keys?.auth || '');
  } catch { return false; }
}
async function secretMatches(given, expected) {
  if (!expected || expected.length < 32 || !given) return false;
  const hash = value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [a,b] = await Promise.all([hash(given),hash(expected)]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let difference = 0; for (let i=0;i<x.length;i++) difference |= x[i]^y[i];
  return difference === 0;
}
async function readBody(req) {
  const reader = req.body?.getReader(); if (!reader) throw Error('body');
  const chunks=[];let length=0;
  try { for (;;) { const {value,done}=await reader.read();if(done)break;length+=value.byteLength;
    if(length>4096)throw Error('body');chunks.push(value); }
  } finally { await reader.cancel().catch(()=>{}); }
  const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function createPushHandler({env,userClient,adminClient,preparePush,validateVapid=()=>{},fetcher=fetch}) {
  const headers = {'Content-Type':'application/json','Cache-Control':'no-store',
    'Access-Control-Allow-Origin':APP_ORIGIN,'Vary':'Origin',
    'Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type',
    'Access-Control-Allow-Methods':'POST, OPTIONS'};
  const response = (status,body) => new Response(JSON.stringify(body),{status,headers});
  async function rpc(client,name,args={}) {
    const {data,error}=await client.rpc(name,args);
    if(error){
      // Keep only a bounded SQLSTATE/PostgREST code, never SQL/messages/details.
      const failure=Error('Push database step failed.');
      failure.stage=({hq_push_test_claim:'test_claim',hq_push_begin:'begin',hq_push_finish:'finish',hq_push_claim:'dispatch_claim',hq_push_scheduler_start:'scheduler_start',hq_push_scheduler_finish:'scheduler_finish',hq_push_scheduler_status:'scheduler_status'})[name]||'database';
      failure.dbCode=/^[A-Z0-9]{5,9}$/.test(error.code||'')?error.code:'UNKNOWN';
      throw failure;
    }
    return data;
  }
  async function send(admin,claim) {
    const record=await rpc(admin,'hq_push_begin',{p_id:claim.id,p_token:claim.token});
    if(!record)return {result:'skipped',providerStatus:null};
    let status=0;
    try {
      if(!validSubscription(record.subscription) || record.vapid_key!==env('VAPID_PUBLIC_KEY')) {
        status=400; // Misconfiguration/retired key: no network request to arbitrary hosts.
      } else {
        const payload={kind:record.coming_alert_id?'coming':record.occurrence_id?'reminder':'test',occurrenceId:record.occurrence_id,comingAlertId:record.coming_alert_id,
          tag:record.coming_alert_id||record.occurrence_id||claim.id};
        const details=preparePush(record.subscription,JSON.stringify(payload),{
          TTL:60,urgency:'normal',contentEncoding:'aes128gcm',
          topic:payload.tag.replaceAll('-',''),
          vapidDetails:{subject:env('VAPID_SUBJECT'),publicKey:env('VAPID_PUBLIC_KEY'),privateKey:env('VAPID_PRIVATE_KEY')}
        });
        // No redirects: a push endpoint must never redirect credentials to another host.
        const result=await fetcher(record.subscription.endpoint,{method:'POST',headers:details.headers,
          body:details.body,redirect:'error',signal:AbortSignal.timeout(10000)});
        status=result.status;
        await result.body?.cancel(); // Provider bodies may contain endpoint information: never log them.
      }
    } catch { status=0; }
    // If recording the result fails, 'sending' becomes terminal unknown. Never resend blindly.
    await rpc(admin,'hq_push_finish',{p_id:claim.id,p_token:claim.token,p_status:status});
    return {result:status>=200&&status<300?'accepted':status===404||status===410?'expired':'not_accepted',providerStatus:status};
  }
  async function deliver(admin){
    const claims=await rpc(admin,'hq_push_claim');
    const totals={accepted:0,expired:0,not_accepted:0,skipped:0};let failure=null;
    for(let i=0;i<claims.length;i+=5){
      const results=await Promise.allSettled(claims.slice(i,i+5).map(c=>send(admin,c)));
      for(const result of results){
        if(result.status==='fulfilled')totals[result.value.result]++;
        else failure=failure||result.reason;
      }
    }
    if(failure)throw failure;
    return totals;
  }
  return async req => {
    const requestId=crypto.randomUUID();
    const diagnostic=(status,code,stage,message,extra={})=>response(status,{code,stage,message,requestId,...extra});
    const origin=req.headers.get('origin');
    if(origin && origin!==APP_ORIGIN)return response(403,{error:'Origin not allowed.'});
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(req.method!=='POST')return response(405,{error:'Use POST.'});
    let body;try{body=await readBody(req);}catch{return response(400,{error:'Invalid request.'});}
    try {
      if(['dispatch','scheduled'].includes(body.action)) {
        if(!await secretMatches(req.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1],env('PUSH_DISPATCH_SECRET')))
          return response(401,{error:'Server authorization required.'});
        if(body.action==='dispatch'&&env('PUSH_DELIVERY_ENABLED')!=='true')return response(409,{error:'Scheduled delivery is disabled.'});
      } else {
        if(!['config','test'].includes(body.action))return response(400,{error:'Unknown action.'});
        const token=req.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
        if(!token)return response(401,{error:'Sign in first.'});
        const user=userClient(token);
        const {data,error}=await user.auth.getUser(token);
        if(error||!data?.user||data.user.is_anonymous)return response(401,{error:'Sign in first.'});
        validateVapid();
        if(body.action==='config'){
          let scheduler={state:'unavailable'};
          try{
            const health=await rpc(user,'hq_push_scheduler_status');
            if(['not_configured','paused','starting','stale','error','probe','active'].includes(health?.state))scheduler={state:health.state};
          }catch{ /* Missing Stage 3C-C SQL must not break the working manual test. */ }
          return response(200,{publicKey:env('VAPID_PUBLIC_KEY')||'',deliveryEnabled:env('PUSH_DELIVERY_ENABLED')==='true',scheduler});
        }
        if(!/^[0-9a-f-]{36}$/i.test(body.deviceId||''))return response(400,{error:'Invalid device.'});
        let claim;
        try { claim=await rpc(user,'hq_push_test_claim',{p_id:body.deviceId}); }
        catch(error){
          if(error.dbCode==='PT409')return diagnostic(409,'PUSH_DEVICE_NOT_ENABLED','test_claim','Enable notifications for this device, then retry.');
          if(error.dbCode==='PT429')return diagnostic(429,'PUSH_TEST_RATE_LIMITED','test_claim','Wait a minute before sending another test.');
          throw error;
        }
        const delivery=await send(adminClient(),claim);
        const extra={result:delivery.result,providerStatus:delivery.providerStatus};
        if(delivery.result==='accepted')return diagnostic(200,'PUSH_TEST_ACCEPTED','provider','Push service accepted the test. Check your iPhone notifications.',extra);
        if(delivery.result==='expired')return diagnostic(409,'PUSH_SUBSCRIPTION_EXPIRED','provider','This subscription expired. Enable notifications again.',extra);
        if(delivery.result==='skipped')return diagnostic(409,'PUSH_TEST_SKIPPED','begin','This test claim expired or the device was disabled. Refresh settings before retrying.',extra);
        if(delivery.providerStatus===0)return diagnostic(503,'PUSH_DELIVERY_UNKNOWN','provider','Delivery could not be confirmed. Check your iPhone before testing again.',extra);
        return diagnostic(502,'PUSH_PROVIDER_REJECTED','provider','Push service rejected the test. Check the provider status in this diagnostic.',extra);
      }
      if(!env('VAPID_PUBLIC_KEY')||!env('VAPID_PRIVATE_KEY')||!env('VAPID_SUBJECT'))
        return response(503,{error:'Push configuration is incomplete.'});
      validateVapid();
      const admin=adminClient();
      if(body.action==='scheduled'){
        const enabled=env('PUSH_DELIVERY_ENABLED')==='true';
        const tick=await rpc(admin,'hq_push_scheduler_start',{p_delivery:enabled});
        if(!tick)return response(200,{mode:enabled?'delivery':'probe',result:'busy'});
        try{
          // Flag OFF: validate auth/config/database reachability without selecting,
          // claiming or sending any reminder. Manual tests remain independent.
          const totals=enabled?await deliver(admin):null;
          const recorded=await rpc(admin,'hq_push_scheduler_finish',{p_token:tick,p_ok:!totals||totals.not_accepted===0});
          if(!recorded)return response(503,{error:'Scheduler run could not be confirmed.'});
          return response(200,{mode:enabled?'delivery':'probe',...(totals||{checked:true})});
        }catch(error){
          try{await rpc(admin,'hq_push_scheduler_finish',{p_token:tick,p_ok:false});}catch{ /* Original safe diagnostic wins. */ }
          throw error;
        }
      }
      return response(200,await deliver(admin));
    } catch(error) {
      // These fields are constructed here, not copied from raw exceptions.
      const stage=['test_claim','begin','finish','dispatch_claim','database','scheduler_start','scheduler_finish'].includes(error?.stage)?error.stage:'configuration';
      const dbCode=/^[A-Z0-9]{5,9}$/.test(error?.dbCode||'')?error.dbCode:null;
      const code=dbCode?'PUSH_DATABASE_ERROR':'PUSH_SERVICE_UNAVAILABLE';
      const details=dbCode?{dbCode}:{};
      console.error('reminder-push failure',JSON.stringify({requestId,code,stage,...details}));
      return diagnostic(503,code,stage,'Notification setup or delivery failed. Use the diagnostic code to identify the failing step.',details);
    }
  };
}
