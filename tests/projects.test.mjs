import test from 'node:test';
import assert from 'node:assert/strict';
import {progress, projectProgress, projectRoute, readProjectRoute, ordered, moveIds, cleanName, optimisticProject, PROJECT_KEYS} from '../js/project-core.js';
import {createProjectStore} from '../js/project-store.js';
import {createProjectRepository} from '../js/project-repository.js';
const section={id:'00000000-0000-4000-8000-000000000001',project:'Garden',name:'A section',position:0};
const milestone={id:'00000000-0000-4000-8000-000000000002',project:'Garden',section_id:section.id,name:'A milestone',position:0,completed:false};
const snapshot=()=>({revision:'first',sections:[{...section}],milestones:[{...milestone}]});
test('progress is weighted by milestones, handles empty and excludes orphan/unrelated subsection rows',()=>{
 assert.deepEqual(progress([]),{total:0,completed:0,percent:0,label:'Not started'});
 const d=snapshot();d.sections.push({...section,id:'s2'});d.milestones.push({...milestone,id:'m2',completed:true},{...milestone,id:'m3',section_id:'s2',completed:true},{...milestone,id:'orphan',section_id:'missing',completed:false});
 assert.deepEqual(projectProgress(d),{total:3,completed:2,percent:67,label:'2 of 3 complete'});
 assert.equal(projectProgress(d,section.id).percent,50);assert.equal(projectProgress(d,'s2').percent,100);
 assert.equal(projectProgress(d,'empty').label,'Not started');
});
test('routes preserve all existing project keys, encode safely and reject malformed routes',()=>{
 for(const p of PROJECT_KEYS){const hash=projectRoute(p,section.id);assert.deepEqual(readProjectRoute(hash),{project:p,section:section.id});}
 for(const hash of ['#project/%E0%A4%A','#project/Fake','#project/Garden/../../oops','#project/Garden/bad','#week'])assert.equal(readProjectRoute(hash),null);
 assert.equal(readProjectRoute(projectRoute('Christmas Planning')).project,'Christmas Planning');
});
test('ordering is immutable, deterministic and safely bounded',()=>{
 const rows=[{id:'b',position:1},{id:'a',position:0},{id:'c',position:1}];
 assert.deepEqual(ordered(rows).map(r=>r.id),['a','b','c']);assert.deepEqual(moveIds(rows,'b',-1),['b','a','c']);assert.deepEqual(moveIds(rows,'b',1),['a','c','b']);
 assert.deepEqual(moveIds(rows,'a',-1),['a','b','c']);assert.deepEqual(moveIds(rows,'none',1),['a','b','c']);assert.equal(rows[0].id,'b');
});
test('names are validated and optimistic deletion/checkbox progress are isolated and reversible',()=>{
 for(const value of ['',undefined,'  ','x'.repeat(201)])assert.throws(()=>cleanName(value));assert.equal(cleanName(' Tree planting '),'Tree planting');
 const d=snapshot();d.sections.push({...section,id:'s2'});d.milestones.push({...milestone,id:'m2',section_id:'s2',completed:true});
 const completed=optimisticProject(d,'complete_milestone',{id:milestone.id,completed:true});assert.equal(projectProgress(completed).percent,100);assert.equal(d.milestones[0].completed,false);
 const deleted=optimisticProject(d,'delete_section',{id:section.id});assert.deepEqual(deleted.sections.map(s=>s.id),['s2']);assert.deepEqual(deleted.milestones.map(m=>m.id),['m2']);assert.equal(d.milestones.length,2);
 assert.equal(projectProgress(optimisticProject(d,'delete_milestone',{id:'m2'})).percent,0);
});
test('store updates progress immediately then accepts authoritative saved snapshot',async()=>{
 let finish;const saved=new Promise(r=>finish=r);const store=createProjectStore({load:async()=>snapshot(),save:()=>saved},{isSignedIn:()=>true});
 store.select('Garden');await store.load();const op=store.save('complete_milestone',{id:milestone.id,completed:true});assert.equal(store.state.busy,true);assert.equal(projectProgress(store.state.data).percent,100);
 assert.equal(await store.save('delete_section',{id:section.id}),false);const next=snapshot();next.milestones[0].completed=true;next.revision='saved';finish(next);assert.equal(await op,true);assert.equal(store.state.data.revision,'saved');
});
test('interrupted/stale mutation rolls back and requires reload before retry, protecting against unknown commit',async()=>{
 let writes=0;const store=createProjectStore({load:async()=>snapshot(),save:async()=>{writes++;throw Error('Connection lost');}},{isSignedIn:()=>true});
 store.select('Garden');await store.load();assert.equal(await store.save('delete_section',{id:section.id}),false);assert.equal(store.state.data.sections.length,1);assert.match(store.state.error,/Reload/);
 assert.equal(await store.save('delete_section',{id:section.id}),false);assert.equal(writes,1);await store.load(true);assert.equal(store.state.error,'');
});
test('late loads/saves cannot leak across projects or sign-out; unavailable schema is retryable',async()=>{
 let finish;const store=createProjectStore({load:()=>new Promise(r=>finish=r)},{isSignedIn:()=>true});store.select('Garden');const op=store.load();store.select('Other');finish(snapshot());await op;assert.equal(store.state.data,null);assert.equal(store.state.project,'Other');
 let done;const s=createProjectStore({load:async()=>snapshot(),save:()=>new Promise(r=>done=r)},{isSignedIn:()=>true});s.select('Garden');await s.load();const writing=s.save('delete_section',{id:section.id});s.reset();done(snapshot());assert.equal(await writing,false);assert.equal(s.state.data,null);
 const fail=createProjectStore({load:async()=>{throw Error('Migration required');}},{isSignedIn:()=>true});fail.select('Garden');await fail.load();assert.match(fail.state.error,/Migration/);assert.equal(fail.state.loading,false);
});
test('repository scopes every RPC and rejects partial/cross-project snapshots and missing migrations',async()=>{
 const calls=[];let response={data:snapshot(),error:null};const repo=createProjectRepository({rpc:async(name,args)=>{calls.push({name,args});return response;}});
 await repo.load('Garden');await repo.save('Garden','r','delete_section',{id:section.id});assert.deepEqual(calls[1],{name:'hq_project_change',args:{p_project:'Garden',p_revision:'r',p_action:'delete_section',p_values:{id:section.id}}});
 await assert.rejects(repo.load('Unknown'),/Unknown/);response={data:{sections:[],milestones:[]}};await assert.rejects(repo.load('Garden'),/complete project/);
 response={data:{...snapshot(),sections:[{...section,project:'Other'}]}};await assert.rejects(repo.load('Garden'),/complete project/);
 response={error:{code:'PGRST202'}};await assert.rejects(repo.load('Garden'),/migration/);response={error:{code:'40001'}};await assert.rejects(repo.load('Garden'),/another session/);
});
