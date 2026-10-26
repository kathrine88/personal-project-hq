import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePounds,gbp,moneyTotals,poundsInput,safeSource,newMoneyId } from '../js/money-core.js';
import { createMoneyStore } from '../js/money-store.js';
import { createMoneyRepository } from '../js/money-repository.js';
const empty=()=>({daily:[],movements:[],purchases:[]});

test('pounds parse to exact integer pence; GBP totals never use binary decimal arithmetic',()=>{
  assert.equal(parsePounds('0.10'),10);assert.equal(parsePounds('.20'),20);assert.equal(parsePounds('-12.34',true),-1234);assert.equal(parsePounds('+0.00',true),0);
  const data=empty();data.daily=Array.from({length:10000},()=>({amount_pence:parsePounds('0.10')}));
  assert.equal(moneyTotals(data).available,100000n);assert.equal(gbp(moneyTotals(data).available),'£1,000.00');assert.equal(gbp(-1n),'-£0.01');
  assert.equal(gbp(900719925474099199999n),'£9,007,199,254,740,991,999.99');assert.equal(poundsInput(1),'0.01');
  for(const value of ['1.005','1e3','NaN','1,000','Infinity','','99999999999999',undefined])assert.throws(()=>parsePounds(value,true));
  assert.throws(()=>parsePounds('-1'));assert.throws(()=>moneyTotals({daily:[{amount_pence:NaN}],movements:[],purchases:[]}));
});

test('one shared zero-opening pot excludes plans and recalculates edited/reversed/deleted purchases',()=>{
  const data=empty();assert.equal(moneyTotals(data).available,0n);
  data.daily=[{amount_pence:10000},{amount_pence:-2000}];data.movements=[{kind:'deposit',amount_pence:5000},{kind:'withdrawal',amount_pence:500}];
  const purchase={id:'p',status:'planned',estimated_pence:4000,actual_pence:null,project:'Garden'};data.purchases=[purchase];
  assert.equal(moneyTotals(data).available,12500n);assert.equal(moneyTotals(data).planned,4000n);
  purchase.status='purchased';purchase.actual_pence=3500;
  for(let i=0;i<100;i++)assert.equal(moneyTotals(data).available,9000n,'re-rendering cannot deduct again');
  purchase.estimated_pence=9999;assert.equal(moneyTotals(data).spent,3500n);
  purchase.actual_pence=3600;assert.equal(moneyTotals(data).available,8900n);
  purchase.status='planned';purchase.actual_pence=null;assert.equal(moneyTotals(data).available,12500n);
  data.purchases=[];assert.equal(moneyTotals(data).available,12500n);
  data.daily=[];data.movements=[];data.purchases=[{status:'purchased',estimated_pence:100,actual_pence:500}];assert.equal(moneyTotals(data).available,-500n);
});

test('free purchases use actual zero and safe source links cannot execute scripts',()=>{
  assert.equal(moneyTotals({daily:[],movements:[],purchases:[{status:'purchased',actual_pence:0,estimated_pence:2000}]}).spent,0n);
  assert.equal(safeSource(''),null);assert.equal(safeSource('https://example.com/item'),'https://example.com/item');
  for(const url of ['javascript:alert(1)','data:text/html,test','/relative','ftp://example.com'])assert.throws(()=>safeSource(url));
});

test('a committed write followed by failed refresh cannot be retried as a second mutation',async()=>{
  let writes=0,loads=0;
  const store=createMoneyStore({load:async()=>{if(loads++===0)return empty();throw Error('Offline');},save:async()=>{writes++;}},{isSignedIn:()=>true});
  await store.load();assert.equal(await store.save('daily','stable-id',null,{}),true);assert.equal(store.state.data,null);assert.match(store.state.error,/Saved, but/);
  assert.equal(await store.save('daily','stable-id',null,{}),false);assert.equal(writes,1);
});

test('sign-out discards delayed financial loads and mutation responses',async()=>{
  let signedIn=true,resolve;
  const store=createMoneyStore({load:()=>new Promise(r=>resolve=r)},{isSignedIn:()=>signedIn});
  const pending=store.load();signedIn=false;store.reset();resolve({...empty(),daily:[{amount_pence:12345}]});await pending;signedIn=true;assert.equal(store.state.data,null);
});

test('repository uses stable IDs, duplicate-safe inserts and version guards without a balance ledger',async()=>{
  const calls=[];let duplicate=false;
  const client={rpc:async name=>{assert.equal(name,'hq_money_snapshot');return {data:empty(),error:null};},from(table){const q={table,filters:[]};const api={
    select:()=>api,single:()=>api,maybeSingle:()=>api,eq:(k,v)=>{q.filters.push([k,v]);return api;},
    upsert:(values,options)=>{q.op='upsert';q.values=values;q.options=options;return api;},update:values=>{q.op='update';q.values=values;return api;},delete:()=>{q.op='delete';return api;},
    then:(ok,bad)=>Promise.resolve().then(()=>{calls.push(q);return {data:q.op==='upsert'&&duplicate?null:{id:'stable',amount_pence:100,entry_date:'2026-10-26',...q.values},error:null};}).then(ok,bad)};return api;}};
  const repo=createMoneyRepository(client);await repo.load();await repo.save('daily','stable',null,{amount_pence:100,entry_date:'2026-10-26'});
  assert.deepEqual(calls[0].options,{onConflict:'id',ignoreDuplicates:true});assert.equal(calls[0].values.id,'stable');assert.ok(!('owner_id' in calls[0].values));
  duplicate=true;await repo.save('daily','stable',null,{amount_pence:100,entry_date:'2026-10-26'});assert.equal(calls.length,3);
  await repo.save('purchases','stable',4,{actual_pence:200});assert.deepEqual(calls[3].filters,[['id','stable'],['version',4]]);assert.equal(calls[3].values.version,5);
  await repo.remove('purchases','stable',5);assert.deepEqual(calls[4].filters,[['id','stable'],['version',5]]);
});

test('stable financial record IDs support browsers without randomUUID',()=>{
 const id=newMoneyId({getRandomValues:bytes=>{bytes.fill(1);return bytes;}});
 assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
