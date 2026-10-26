import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoutineRepository } from '../js/routine-repository.js';

function fakeClient(execute) {
  return {
    rpc(name,args) { return execute({op:'rpc',name,args}); },
    from(table) {
      const q={table,op:'list'};
      const api={select:()=>api,order:()=>api,range:(a,b)=>{q.range=[a,b];return api;},single:()=>api,
        insert:values=>{q.op='insert';q.values=values;return api;},
        update:values=>{q.op='update';q.values=values;return api;},
        upsert:(values,options)=>{q.op='upsert';q.values=values;q.options=options;return api;},
        eq:(column,value)=>{q.filter=[column,value];return api;},
        then:(resolve,reject)=>Promise.resolve().then(()=>execute(q)).then(resolve,reject)};
      return api;
    }
  };
}

test('occurrence upserts retain individual text, completion and original date on a move', async () => {
  const calls=[];
  const repo=createRoutineRepository(fakeClient(q=>{calls.push(q);return {data:q.values,error:null};}));
  const task={routine_id:'r1',occurrence_date:'2026-10-26',scheduled_date:'2026-10-26',task:'Read',project:'Other',completed:true};
  const saved=await repo.occurrence(task,{scheduled_date:'2026-11-02'});
  assert.equal(saved.occurrence_date,'2026-10-26');assert.equal(saved.scheduled_date,'2026-11-02');assert.equal(saved.completed,true);
  assert.equal(saved.task,'Read');assert.equal(saved.project,'Other');assert.equal('owner_id' in saved,false);
  assert.deepEqual(calls[0].options,{onConflict:'routine_id,occurrence_date'});
  await repo.occurrence({...task,exception:{task:'Saved text',project:'Garden'}},{completed:false});
  assert.equal(calls[1].values.task,'Saved text');assert.equal(calls[1].values.project,'Garden');assert.equal(calls[1].values.completed,false);
});

test('loading routines is read-only and paginated; deleting preserves stored history', async () => {
  const calls=[];
  const repo=createRoutineRepository(fakeClient(q=>{calls.push(q);return {data:q.op==='list'?[]:{id:'r1',...q.values},error:null};}));
  await repo.list();assert.equal(calls.length,3);assert.ok(calls.every(q=>q.op==='list'));
  await repo.remove('r1');assert.equal(calls[3].op,'update');assert.deepEqual(calls[3].values,{deleted:true});
});

test('a move sends one RPC containing the complete destination order; errors propagate', async () => {
  const calls=[];
  const repo=createRoutineRepository(fakeClient(q=>{calls.push(q);return {data:{task:{id:1}},error:null};}));
  await repo.move('task:1','2026-10-28',['task:2','task:1']);
  assert.deepEqual(calls,[{op:'rpc',name:'hq_move_task',args:{p_item_key:'task:1',p_day:'2026-10-28',p_order:['task:2','task:1']}}]);
  const failed=createRoutineRepository(fakeClient(()=>({data:null,error:{message:'Permission denied'}})));
  await assert.rejects(failed.move('task:1','2026-10-28',['task:1']),{message:'Permission denied'});
});
