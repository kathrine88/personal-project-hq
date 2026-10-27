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
    const {data,error}=await client.rpc(name,args);if(error)throw Error('database');return data;
  }
  async function send(admin,claim) {
    const record=await rpc(admin,'hq_push_begin',{p_id:claim.id,p_token:claim.token});
    if(!record)return 'skipped';
    let status=0;
    try {
      if(!validSubscription(record.subscription) || record.vapid_key!==env('VAPID_PUBLIC_KEY')) {
        status=400; // Misconfiguration/retired key: no network request to arbitrary hosts.
      } else {
        const payload={kind:record.occurrence_id?'reminder':'test',occurrenceId:record.occurrence_id,
          tag:record.occurrence_id||claim.id};
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
    return status>=200&&status<300?'accepted':status===404||status===410?'expired':'not_accepted';
  }
  return async req => {
    const origin=req.headers.get('origin');
    if(origin && origin!==APP_ORIGIN)return response(403,{error:'Origin not allowed.'});
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(req.method!=='POST')return response(405,{error:'Use POST.'});
    let body;try{body=await readBody(req);}catch{return response(400,{error:'Invalid request.'});}
    try {
      if(body.action==='dispatch') {
        if(!await secretMatches(req.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1],env('PUSH_DISPATCH_SECRET')))
          return response(401,{error:'Server authorization required.'});
        if(env('PUSH_DELIVERY_ENABLED')!=='true')return response(409,{error:'Scheduled delivery is disabled.'});
      } else {
        if(!['config','test'].includes(body.action))return response(400,{error:'Unknown action.'});
        const token=req.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
        if(!token)return response(401,{error:'Sign in first.'});
        const user=userClient(token);
        const {data,error}=await user.auth.getUser(token);
        if(error||!data?.user||data.user.is_anonymous)return response(401,{error:'Sign in first.'});
        validateVapid();
        if(body.action==='config')return response(200,{publicKey:env('VAPID_PUBLIC_KEY')||'',
          deliveryEnabled:env('PUSH_DELIVERY_ENABLED')==='true'});
        if(!/^[0-9a-f-]{36}$/i.test(body.deviceId||''))return response(400,{error:'Invalid device.'});
        let claim;
        try { claim=await rpc(user,'hq_push_test_claim',{p_id:body.deviceId}); }
        catch {return response(409,{error:'Enable this device, or wait a minute before another test.'});}
        const result=await send(adminClient(),claim);
        return response(result==='accepted'?200:409,{result,message:result==='accepted'?
          'Push service accepted the test. Check your iPhone notifications.':
          result==='expired'?'This subscription expired. Enable notifications again.':'Test was not accepted. Check server configuration and try again later.'});
      }
      if(!env('VAPID_PUBLIC_KEY')||!env('VAPID_PRIVATE_KEY')||!env('VAPID_SUBJECT'))
        return response(503,{error:'Push configuration is incomplete.'});
      validateVapid();
      const admin=adminClient();const claims=await rpc(admin,'hq_push_claim');
      // At most 20 sends, five at a time, with a 10s network timeout each.
      const totals={accepted:0,expired:0,not_accepted:0,skipped:0};
      for(let i=0;i<claims.length;i+=5){
        const results=await Promise.all(claims.slice(i,i+5).map(c=>send(admin,c)));
        for(const result of results)totals[result]++;
      }
      return response(200,totals);
    } catch {
      // No tokens, subscription endpoints, keys or reminder contents in logs/errors.
      return response(503,{error:'Push service unavailable. Check configuration and delivery status in the Dashboard.'});
    }
  };
}
