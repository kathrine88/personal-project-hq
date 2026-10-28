import test from 'node:test';
import assert from 'node:assert/strict';
import { createMealStore } from '../js/meal-store.js';
import { mealWeek, createMealRepository } from '../js/meal-repository.js';

const WEEK='2026-10-26', NEXT='2026-11-02';
function setup(overrides={}) {
  const meals=new Map(), shopping=new Map();let signedIn=true,next=1;
  const repo={
    load:async week=>({meals:structuredClone(meals.get(week)||[]),shopping:structuredClone(shopping.get(week)||[])}),
    saveMeals:async(week,rows)=>{meals.set(week,structuredClone(rows));return structuredClone(rows);},
    addItem:async(week,item)=>{const row={id:String(next++),week_start:week,item,checked:false};shopping.set(week,[...(shopping.get(week)||[]),row]);return structuredClone(row);},
    checkItem:async(id,checked)=>{for(const rows of shopping.values()){const row=rows.find(r=>r.id===id);if(row){row.checked=checked;return structuredClone(row);}}},
    deleteItem:async id=>{for(const [week,rows] of shopping)shopping.set(week,rows.filter(r=>r.id!==id));},...overrides
  };
  const store=createMealStore(repo,{isSignedIn:()=>signedIn});
  return {store,repo,meals,shopping,signOut:()=>{signedIn=false;store.reset();},signIn:()=>{signedIn=true;}};
}

test('week keys are Monday-first across month/year boundaries; invalid dates fail safely',()=>{
  assert.equal(mealWeek('2026-11-01'),WEEK);assert.equal(mealWeek('2027-01-01'),'2026-12-28');
  assert.throws(()=>mealWeek(undefined),/valid week/);
});

test('saved meals, unsaved drafts and manual shopping are independent for each week',async()=>{
  const {store,repo,signOut,signIn}=setup();await store.load(WEEK);await store.load(NEXT);
  store.draft(WEEK,WEEK,'lunch','  Soup  ');store.draft(WEEK,'2026-11-01','dinner','Roast');
  assert.equal(store.meal(WEEK),null);assert.equal(store.state(WEEK).dirty,true);
  assert.equal(await store.saveMeals(WEEK),true);assert.equal(store.meal(WEEK).lunch,'Soup');assert.equal(store.meal('2026-11-01').dinner,'Roast');
  assert.equal(store.meal(NEXT),null);assert.equal(store.state(WEEK).shopping.length,0,'meals must not generate shopping');
  await store.addItem(WEEK,'Bread');await store.addItem(NEXT,'Apples');
  const id=store.state(WEEK).shopping[0].id;await store.checkItem(WEEK,id,true);assert.equal(store.state(WEEK).shopping[0].checked,true);
  assert.equal(store.state(NEXT).shopping[0].checked,false);
  const reloaded=createMealStore(repo,{isSignedIn:()=>true});await reloaded.load(WEEK);assert.equal(reloaded.meal(WEEK).lunch,'Soup');assert.equal(reloaded.state(WEEK).shopping[0].checked,true);
  await store.checkItem(WEEK,id,false);await store.deleteItem(WEEK,id);assert.equal(store.state(WEEK).shopping.length,0);
  store.draft(WEEK,WEEK,'lunch','');await store.saveMeals(WEEK);assert.equal(store.meal(WEEK).lunch,'');
  signOut();assert.equal(store.meal(WEEK),null);signIn();await store.load(WEEK);assert.equal(store.meal('2026-11-01').dinner,'Roast');
});

test('failed saves preserve draft values and confirmed data, then support retry',async()=>{
  let fail=true;const {store}=setup({saveMeals:async(_,rows)=>{if(fail)throw Error('Offline');return rows;}});
  await store.load(WEEK);store.draft(WEEK,WEEK,'dinner','Pasta');
  assert.equal(await store.saveMeals(WEEK),false);assert.equal(store.rows(WEEK)[0].dinner,'Pasta');assert.equal(store.meal(WEEK),null);assert.match(store.state(WEEK).error,/Offline/);
  fail=false;assert.equal(await store.saveMeals(WEEK),true);assert.equal(store.meal(WEEK).dinner,'Pasta');
});

test('late loads and writes cannot repopulate a signed-out or replacement session',async()=>{
  let resolveLoad;const {store,signOut,signIn}=setup({load:()=>new Promise(resolve=>resolveLoad=resolve)});
  const pending=store.load(WEEK);signOut();resolveLoad({meals:[{meal_date:WEEK,lunch:'Private'}],shopping:[]});await pending;
  signIn();assert.equal(store.meal(WEEK),null);
  let resolveSave;
  const other=setup({saveMeals:()=>new Promise(resolve=>resolveSave=resolve)});await other.store.load(WEEK);other.store.draft(WEEK,WEEK,'lunch','Private');
  const save=other.store.saveMeals(WEEK);other.signOut();resolveSave([{meal_date:WEEK,lunch:'Private'}]);await save;other.signIn();assert.equal(other.store.meal(WEEK),null);
});

test('in-flight weeks remain isolated and navigation retains unsaved drafts',async()=>{
  const resolvers=new Map();const {store}=setup({load:week=>new Promise(resolve=>resolvers.set(week,resolve))});
  const first=store.load(WEEK),second=store.load(NEXT);
  resolvers.get(NEXT)({meals:[{meal_date:NEXT,lunch:'Next'}],shopping:[]});await second;
  store.draft(NEXT,NEXT,'dinner','Unsaved');
  resolvers.get(WEEK)({meals:[{meal_date:WEEK,lunch:'First'}],shopping:[]});await first;
  assert.equal(store.meal(WEEK).lunch,'First');assert.equal(store.meal(NEXT).lunch,'Next');assert.equal(store.rows(NEXT)[0].dinner,'Unsaved');
});

test('missing migration is reported without an unbounded retry loop',async()=>{
  let calls=0;const {store}=setup({load:async()=>{calls++;throw {code:'PGRST205'};}});
  await store.load(WEEK);await store.load(WEEK);assert.equal(calls,1);assert.equal(store.state(WEEK).unavailable,true);assert.equal(store.state(WEEK).loaded,false);
  await store.load(WEEK,true);assert.equal(calls,2);
});

test('repository filters by date/week and never addresses task tables or accepts an owner ID',async()=>{
  const requests=[];
  const client={from(table){const q={table,filters:[],op:'list'};const api={select:()=>api,order:()=>api,range:()=>api,
    gte:(k,v)=>{q.filters.push(['gte',k,v]);return api;},lte:(k,v)=>{q.filters.push(['lte',k,v]);return api;},eq:(k,v)=>{q.filters.push(['eq',k,v]);return api;},
    upsert:(values,options)=>{q.op='upsert';q.values=values;q.options=options;return api;},insert:values=>{q.op='insert';q.values=values;return api;},update:values=>{q.op='update';q.values=values;return api;},delete:()=>api,single:()=>api,
    then:(resolve,reject)=>Promise.resolve().then(()=>{requests.push(q);return {data:q.op==='list'?[]:q.values,error:null};}).then(resolve,reject)};return api;}};
  const repo=createMealRepository(client);await repo.load(WEEK);
  assert.deepEqual(requests[0].filters,[['gte','meal_date',WEEK],['lte','meal_date','2026-11-01']]);assert.deepEqual(requests[1].filters,[['eq','week_start',WEEK]]);
  const state=setup();await state.store.load(WEEK);await repo.saveMeals(WEEK,state.store.rows(WEEK));
  assert.deepEqual(requests[2].options,{onConflict:'owner_id,meal_date'});assert.equal(requests[2].values.length,7);assert.ok(requests[2].values.every(row=>!('owner_id' in row)));
  await repo.addItem(WEEK,'Bread');assert.equal(requests[3].table,'hq_shopping_items');assert.deepEqual(requests[3].values,{week_start:WEEK,item:'Bread'});
  assert.ok(requests.every(q=>['hq_meals','hq_shopping_items'].includes(q.table)));
});
