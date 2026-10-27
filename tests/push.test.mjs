import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {createPushHandler,validSubscription,APP_ORIGIN} from '../supabase/functions/reminder-push/core.js';
import {pushSupport} from '../js/push-settings.js';
import {zonedInstant} from '../js/reminder-core.js';
const id='00000000-0000-4000-8000-000000000001';const token='00000000-0000-4000-8000-000000000002';
const subscription={endpoint:'https://web.push.apple.com/example',keys:{p256dh:'B'.repeat(87),auth:'A'.repeat(22)}};
function fixture({enabled='true',status=201,throws=false}={}){
 const calls=[];let begun=false;const envs={VAPID_PUBLIC_KEY:'B'.repeat(87),VAPID_PRIVATE_KEY:'secret',VAPID_SUBJECT:'mailto:owner@example.com',PUSH_DELIVERY_ENABLED:enabled,PUSH_DISPATCH_SECRET:'x'.repeat(43)};
 const admin={rpc:async(name,args)=>{calls.push([name,args]);if(name==='hq_push_claim')return {data:[{id,token}]};if(name==='hq_push_begin'){if(begun)return {data:null};begun=true;return {data:{subscription,vapid_key:envs.VAPID_PUBLIC_KEY,occurrence_id:id}};}return {data:null};}};
 const user={auth:{getUser:async jwt=>jwt==='user'?{data:{user:{id}}}:{error:Error('invalid')}},rpc:async(name,args)=>{calls.push([name,args]);return {data:{id,token}};}};
 const handler=createPushHandler({env:k=>envs[k],adminClient:()=>admin,userClient:()=>user,
  preparePush:(sub,payload,options)=>{calls.push(['encrypt',JSON.parse(payload),options]);return {headers:{encrypted:'true'},body:new Uint8Array([1,2,3])};},
  fetcher:async(url,options)=>{calls.push(['fetch',url,options]);if(throws)throw Error('timeout');return new Response(null,{status});}});
 const request=(body,headers={})=>handler(new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)}));
 return {request,calls,envs};
}
test('dispatch requires a distinct server secret AND an explicit opt-in; public/user tokens cannot trigger it',async()=>{
 const f=fixture();for(const headers of [{},{Authorization:'Bearer user'},{Authorization:'Bearer wrong'}])assert.equal((await f.request({action:'dispatch'},headers)).status,401);
 assert.equal(f.calls.length,0);const off=fixture({enabled:'false'});assert.equal((await off.request({action:'dispatch'},{Authorization:'Bearer '+'x'.repeat(43)})).status,409);assert.equal(off.calls.length,0);
});
test('config and actual test path validate a user token; no private key is returned',async()=>{
 const f=fixture({enabled:'false'});assert.equal((await f.request({action:'config'})).status,401);assert.equal((await f.request({action:'config'},{Authorization:'Bearer anon'})).status,401);
 const config=await(await f.request({action:'config'},{Authorization:'Bearer user'})).json();assert.deepEqual(Object.keys(config).sort(),['deliveryEnabled','publicKey']);
 const result=await f.request({action:'test',deviceId:id},{Authorization:'Bearer user'});assert.equal(result.status,200);assert.ok(f.calls.find(c=>c[0]==='hq_push_test_claim'));assert.ok(f.calls.find(c=>c[0]==='fetch'));
});
test('send starts with a durable one-use authorization; payload contains no reminder titles, notes, URLs or auth tokens',async()=>{
 const f=fixture();const headers={Authorization:'Bearer '+'x'.repeat(43)};assert.equal((await f.request({action:'dispatch'},headers)).status,200);
 assert.ok(f.calls.findIndex(c=>c[0]==='hq_push_begin')<f.calls.findIndex(c=>c[0]==='fetch'));
 assert.deepEqual(f.calls.find(c=>c[0]==='encrypt')[1],{kind:'reminder',occurrenceId:id,tag:id});
 const options=f.calls.find(c=>c[0]==='fetch')[2];assert.equal(options.redirect,'error');assert.ok(options.signal);assert.equal(f.calls.find(c=>c[0]==='encrypt')[2].TTL,60);
 await f.request({action:'dispatch'},headers);assert.equal(f.calls.filter(c=>c[0]==='fetch').length,1);
});
test('expired endpoints, rate limits, provider failures and network ambiguity record only safe status codes',async()=>{
 for(const status of [410,404,429,500,401]){const f=fixture({status});await f.request({action:'dispatch'},{Authorization:'Bearer '+'x'.repeat(43)});assert.equal(f.calls.find(c=>c[0]==='hq_push_finish')[1].p_status,status);}
 const f=fixture({throws:true});await f.request({action:'dispatch'},{Authorization:'Bearer '+'x'.repeat(43)});assert.equal(f.calls.find(c=>c[0]==='hq_push_finish')[1].p_status,0);
});
test('subscription validation blocks SSRF hosts, credentials, ports, fragments and malformed keys',()=>{
 assert.equal(validSubscription(subscription),true);
 for(const endpoint of ['http://web.push.apple.com/x','https://web.push.apple.com.evil.test/x','https://127.0.0.1/x','https://user@web.push.apple.com/x','https://web.push.apple.com:444/x','https://web.push.apple.com/x#fragment'])assert.equal(validSubscription({...subscription,endpoint}),false);
 assert.equal(validSubscription({...subscription,keys:{p256dh:'short',auth:'bad'}}),false);
});
test('CORS and bounded body reject foreign origins and oversized input before any database access',async()=>{
 const f=fixture();assert.equal((await f.request({action:'config'},{Origin:'https://evil.test'})).status,403);assert.equal((await f.request({action:'config',padding:'x'.repeat(5000)})).status,400);assert.equal(f.calls.length,0);
 const response=await f.request({action:'config'},{Origin:APP_ORIGIN,Authorization:'Bearer user'});assert.equal(response.headers.get('Cache-Control'),'no-store');
});
test('service worker always shows generic notifications and taps only focus/open this app scope',async()=>{
 const handlers={},shown=[],messages=[],opened=[];let focused=0;
 const self={addEventListener:(event,handler)=>handlers[event]=handler,skipWaiting:async()=>{},registration:{scope:'https://example.test/personal-project-hq/',showNotification:async(...args)=>shown.push(args)},clients:{claim:async()=>{},matchAll:async()=>[{url:'https://example.test/personal-project-hq/tools/push-setup.html',focus:async()=>assert.fail('setup page is not the app')},{url:'https://example.test/another-app/',focus:async()=>assert.fail('wrong app')},{url:'https://example.test/personal-project-hq/',focus:async()=>focused++,postMessage:m=>messages.push(m)}],openWindow:async url=>opened.push(url)}};
 vm.runInNewContext(fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8'),{self,URL});
 let pending;handlers.push({data:{json:()=>({kind:'reminder',occurrenceId:id,title:'PRIVATE',url:'https://evil.test'})},waitUntil:p=>pending=p});await pending;
 assert.equal(shown.length,1);assert.ok(!JSON.stringify(shown).includes('PRIVATE'));assert.ok(!JSON.stringify(shown).includes('evil.test'));assert.equal(handlers.fetch,undefined);
 handlers.notificationclick({notification:{data:{occurrenceId:id},close(){}},waitUntil:p=>pending=p});await pending;assert.equal(focused,1);assert.equal(messages[0].type,'HQ_OPEN_REMINDERS');assert.equal(opened.length,0);
 self.clients.matchAll=async()=>[];handlers.notificationclick({notification:{data:{occurrenceId:id},close(){}},waitUntil:p=>pending=p});await pending;assert.equal(new URL(opened[0]).pathname,'/personal-project-hq/');assert.equal(new URL(opened[0]).hash,'#reminders');
 handlers.push({data:{json:()=>{throw Error('malformed')}},waitUntil:p=>pending=p});await pending;assert.equal(shown.length,2);
});
test('Europe/London due instants retain winter/summer wall clocks and DST gap/fold semantics',()=>{
 assert.equal(new Date(zonedInstant('2026-01-20','09:00','Europe/London')).toISOString(),'2026-01-20T09:00:00.000Z');
 assert.equal(new Date(zonedInstant('2026-07-20','09:00','Europe/London')).toISOString(),'2026-07-20T08:00:00.000Z');
 assert.equal(new Date(zonedInstant('2026-03-29','01:30','Europe/London')).toISOString(),'2026-03-29T01:30:00.000Z');
 assert.equal(new Date(zonedInstant('2026-10-25','01:30','Europe/London')).toISOString(),'2026-10-25T01:30:00.000Z');
});

test('iPhone Safari asks for Home Screen installation; installed apps and desktop feature support are detected without prompting',()=>{
 const fake={isSecureContext:true,Notification:{},PushManager:{},navigator:{serviceWorker:{},userAgent:'iPhone',platform:'iPhone'},matchMedia:()=>({matches:false})};
 assert.match(pushSupport(fake),/Add to Home Screen/);fake.navigator.standalone=true;assert.equal(pushSupport(fake),'');fake.isSecureContext=false;assert.match(pushSupport(fake),/unsupported/);
});
