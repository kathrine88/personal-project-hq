import test from 'node:test';
import assert from 'node:assert/strict';
import {createTaskRepository} from '../js/task-repository.js';

function clientMock(execute) {
  return {from(table) {
    assert.equal(table,'test_tasks');
    const request={op:'list'};
    const query={
      select(columns){request.columns=columns;return query;},
      order(column){request.order=column;return query;},
      range(start,end){request.range=[start,end];return query;},
      insert(values){request.op='add';request.values=values;return query;},
      update(values){request.op='update';request.values=values;return query;},
      delete(){request.op='remove';return query;},
      eq(key,value){request.filter=[key,value];return query;},
      single(){request.single=true;return query;},
      then(resolve,reject){return Promise.resolve().then(()=>execute(request)).then(resolve,reject);}
    };
    return query;
  }};
}

test('reads scheduled and undated tasks beyond the API row limit', async () => {
  const all=Array.from({length:1201},(_,id)=>({id,scheduled_date:id%2?'2026-10-26':null}));
  const ranges=[];
  const repository=createTaskRepository(clientMock(q=>{
    assert.equal(q.order,'id');assert.match(q.columns,/scheduled_date/);ranges.push(q.range);
    return {data:all.slice(q.range[0],q.range[1]+1),error:null};
  }));
  assert.deepEqual(await repository.list(),all);
  assert.deepEqual(ranges,[[0,499],[500,999],[1000,1499]]);
});

test('mutations target a single ID, request a returned row and never invent dates or owners', async () => {
  const calls=[];
  const repository=createTaskRepository(clientMock(q=>{calls.push(q);return {data:{id:42,...q.values},error:null};}));
  await repository.add({task:'Undated',project:'Other'});
  assert.deepEqual(calls[0].values,{task:'Undated',project:'Other'});
  await repository.update(42,{scheduled_date:'2026-11-02'});
  await repository.update(42,{scheduled_date:null});
  await repository.remove(42);
  for(const call of calls){assert.equal(call.single,true);if(call.op!=='add')assert.deepEqual(call.filter,['id',42]);}
  assert.deepEqual(calls[1].values,{scheduled_date:'2026-11-02'});
  assert.deepEqual(calls[2].values,{scheduled_date:null});
});

test('database errors and zero-row mutations cannot report success', async () => {
  const denied=createTaskRepository(clientMock(()=>({data:null,error:{message:'RLS denied'}})));
  await assert.rejects(denied.update(42,{completed:true}),{message:'RLS denied'});
  const missing=createTaskRepository(clientMock(()=>({data:null,error:null})));
  await assert.rejects(missing.remove(42),/could not be saved/);
});
