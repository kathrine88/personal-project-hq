import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {createPushHandler,validSubscription,APP_ORIGIN} from '../supabase/functions/reminder-push/core.js';
import {pushSupport,pushFailureMessage,automaticDeliveryMessage} from '../js/push-settings.js';
import {zonedInstant} from '../js/reminder-core.js';
const id='00000000-0000-4000-8000-000000000001';const token='00000000-0000-4000-8000-000000000002';
const subscription={endpoint:'https://web.push.apple.com/example',keys:{p256dh:'B'.repeat(87),auth:'A'.repeat(22)}};
function fixture({enabled='true',status=201,throws=false,rpcErrors={},schedulerState='not_configured',tickBusy=false}={}){
 const calls=[];let begun=false;const envs={VAPID_PUBLIC_KEY:'B'.repeat(87),VAPID_PRIVATE_KEY:'secret',VAPID_SUBJECT:'mailto:owner@example.com',PUSH_DELIVERY_ENABLED:enabled,PUSH_DISPATCH_SECRET:'x'.repeat(43)};
 const admin={rpc:async(name,args)=>{calls.push([name,args]);if(rpcErrors[name])return {error:rpcErrors[name]};if(name==='hq_push_scheduler_start')return {data:tickBusy?null:token};if(name==='hq_push_scheduler_finish')return {data:true};if(name==='hq_push_claim')return {data:[{id,token}]};if(name==='hq_push_begin'){if(begun)return {data:null};begun=true;return {data:{subscription,vapid_key:envs.VAPID_PUBLIC_KEY,occurrence_id:id}};}return {data:null};}};
 const user={auth:{getUser:async jwt=>jwt==='user'?{data:{user:{id}}}:{error:Error('invalid')}},rpc:async(name,args)=>{calls.push([name,args]);if(rpcErrors[name])return {error:rpcErrors[name]};if(name==='hq_push_scheduler_status')return {data:{state:schedulerState}};return {data:{id,token}};}};
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
 const config=await(await f.request({action:'config'},{Authorization:'Bearer user'})).json();assert.deepEqual(Object.keys(config).sort(),['deliveryEnabled','publicKey','scheduler']);
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

test('claim SQL errors are 503 test_claim diagnostics, not a fake device/cooldown 409; provider is never contacted',async()=>{
 const f=fixture({rpcErrors:{hq_push_test_claim:{code:'42702',message:'SECRET endpoint=private.example auth=private',details:'private details'}}});
 const response=await f.request({action:'test',deviceId:id},{Authorization:'Bearer user'});const data=await response.json();
 assert.equal(response.status,503);assert.equal(data.code,'PUSH_DATABASE_ERROR');assert.equal(data.stage,'test_claim');assert.equal(data.dbCode,'42702');
 assert.match(data.requestId,/^[0-9a-f-]{36}$/i);assert.equal(f.calls.filter(c=>c[0]==='fetch').length,0);assert.equal(f.calls.filter(c=>c[0]==='hq_push_begin').length,0);
 assert.equal(f.calls.find(c=>c[0]==='hq_push_test_claim')[1].p_id,id);assert.ok(!JSON.stringify(data).includes('SECRET'));assert.ok(!JSON.stringify(data).includes('private'));
});
test('expected device and cooldown errors have distinct safe codes and do not reach the provider',async()=>{
 for(const [sqlCode,status,code] of [['PT409',409,'PUSH_DEVICE_NOT_ENABLED'],['PT429',429,'PUSH_TEST_RATE_LIMITED']]){
  const f=fixture({rpcErrors:{hq_push_test_claim:{code:sqlCode,message:'Do not expose this SQL message'}}});const response=await f.request({action:'test',deviceId:id},{Authorization:'Bearer user'});assert.equal(response.status,status);assert.equal((await response.json()).code,code);assert.equal(f.calls.filter(c=>c[0]==='fetch').length,0);
 }
});
test('begin, finish and provider failures can be distinguished without leaking raw errors',async()=>{
 for(const [rpcName,stage] of [['hq_push_begin','begin'],['hq_push_finish','finish']]){
  const f=fixture({rpcErrors:{[rpcName]:{code:'42501',message:'subscription SECRET',details:'SECRET'}}});const response=await f.request({action:'test',deviceId:id},{Authorization:'Bearer user'});const data=await response.json();assert.equal(response.status,503);assert.equal(data.stage,stage);assert.equal(data.dbCode,'42501');assert.ok(!JSON.stringify(data).includes('SECRET'));assert.equal(f.calls.filter(c=>c[0]==='fetch').length,stage==='finish'?1:0);
 }
 const provider=fixture({status:403});const response=await provider.request({action:'test',deviceId:id},{Authorization:'Bearer user'});const data=await response.json();assert.equal(response.status,502);assert.equal(data.code,'PUSH_PROVIDER_REJECTED');assert.equal(data.providerStatus,403);
});
test('browser unwraps FunctionsHttpError context and displays only allowlisted diagnostics',async()=>{
 const diagnostic={code:'PUSH_DATABASE_ERROR',stage:'test_claim',dbCode:'42702',requestId:id,message:'SECRET subscription',details:'SECRET'};
 const message=await pushFailureMessage({context:new Response(JSON.stringify(diagnostic))});assert.match(message,/PUSH_DATABASE_ERROR/);assert.match(message,/42702/);assert.match(message,/test_claim/);assert.ok(!message.includes('SECRET'));
 for(const value of [{code:'UNKNOWN',message:'SECRET'}, {...diagnostic,stage:'SECRET',dbCode:'SECRET!',requestId:'SECRET'}]){
  assert.ok(!(await pushFailureMessage({context:new Response(JSON.stringify(value))})).includes('SECRET'));
 }
 assert.ok(!(await pushFailureMessage(Error('SECRET'))).includes('SECRET'));
});

test('scheduled checks authenticate even with delivery off, then probe without claims or provider sends',async()=>{
 const f=fixture({enabled:'false'});
 assert.equal((await f.request({action:'scheduled'})).status,401);assert.equal(f.calls.length,0);
 const response=await f.request({action:'scheduled'},{Authorization:'Bearer '+'x'.repeat(43)});
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{mode:'probe',checked:true});
 assert.equal(f.calls.find(c=>c[0]==='hq_push_scheduler_start')[1].p_delivery,false);
 assert.equal(f.calls.find(c=>c[0]==='hq_push_scheduler_finish')[1].p_ok,true);
 assert.equal(f.calls.filter(c=>['fetch','hq_push_claim','hq_push_begin'].includes(c[0])).length,0);
});
test('live scheduler uses existing delivery path once, reports results and rejects overlapping ticks',async()=>{
 const f=fixture();const response=await f.request({action:'scheduled'},{Authorization:'Bearer '+'x'.repeat(43)});
 assert.equal(response.status,200);assert.equal((await response.json()).accepted,1);
 assert.equal(f.calls.filter(c=>c[0]==='fetch').length,1);
 assert.equal(f.calls.find(c=>c[0]==='hq_push_scheduler_finish')[1].p_ok,true);
 const busy=fixture({tickBusy:true});assert.equal((await(await busy.request({action:'scheduled'},{Authorization:'Bearer '+'x'.repeat(43)})).json()).result,'busy');assert.equal(busy.calls.length,1);
});
test('scheduler failures record an unhealthy heartbeat without replaying ambiguous sends',async()=>{
 for(const status of [429,500]){
  const f=fixture({status});await f.request({action:'scheduled'},{Authorization:'Bearer '+'x'.repeat(43)});
  assert.equal(f.calls.find(c=>c[0]==='hq_push_scheduler_finish')[1].p_ok,false);assert.equal(f.calls.filter(c=>c[0]==='fetch').length,1);
 }
 const broken=fixture({rpcErrors:{hq_push_begin:{code:'42501'}}});const result=await broken.request({action:'scheduled'},{Authorization:'Bearer '+'x'.repeat(43)});assert.equal(result.status,503);assert.equal(broken.calls.find(c=>c[0]==='hq_push_scheduler_finish')[1].p_ok,false);
});
test('manual tests never depend on scheduler health or the automatic flag',async()=>{
 const f=fixture({enabled:'false',rpcErrors:{hq_push_scheduler_status:{code:'PGRST202'}}});
 const config=await(await f.request({action:'config'},{Authorization:'Bearer user'})).json();assert.equal(config.scheduler.state,'unavailable');assert.ok(config.publicKey);
 assert.equal((await f.request({action:'test',deviceId:id},{Authorization:'Bearer user'})).status,200);
 assert.equal(f.calls.filter(c=>c[0]==='hq_push_scheduler_start').length,0);
});
test('frontend requires backend scheduler evidence before reporting automatic delivery active',()=>{
 assert.match(automaticDeliveryMessage({deliveryEnabled:true,scheduler:{state:'active'}}),/active \(recent scheduler check confirmed\)/);
 for(const state of ['paused','not_configured','starting','stale','error','probe','unavailable',undefined])assert.ok(!automaticDeliveryMessage({deliveryEnabled:true,scheduler:{state}}).includes('is active'));
 assert.match(automaticDeliveryMessage({deliveryEnabled:false,scheduler:{state:'active'}}),/not active yet/);
 assert.match(automaticDeliveryMessage({deliveryEnabled:false,scheduler:{state:'probe'}}),/off.*checks are working/);
});
