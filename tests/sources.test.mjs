import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryRoute,readLibraryRoute,websiteUrl,safeWebsiteUrl,previewUrl,sourceValues,filterSources,sourceSummary,storedView,rememberView} from '../js/source-core.js';
import {createSourceRepository} from '../js/source-repository.js';
import {createSourceStore} from '../js/source-store.js';
import {PROJECT_KEYS} from '../js/project-core.js';
const id='00000000-0000-4000-8000-000000000001',section={id:'00000000-0000-4000-8000-000000000002',project:'Garden',name:'A section',position:0};
const source={id,project:'Garden',source_type:'link',url:'https://example.org/',title:'A website',description:'',note_content:'',section_id:null,version:1,created_at:'2026-10-26T10:00:00Z',updated_at:'2026-10-26T10:00:00Z'};
const snapshot=()=>({sections:[{...section}],sources:[{...source}]});
test('library routes retain existing keys and reject malformed/unknown identifiers',()=>{
 for(const project of PROJECT_KEYS)assert.deepEqual(readLibraryRoute(libraryRoute(project,id)),{project,source:id});
 for(const value of ['#library/%E0%A4%A','#library/Fake','#library/Garden/not-id','#project/Garden','#library/Garden/'+id+'/extra'])assert.equal(readLibraryRoute(value),null);
 assert.deepEqual(readLibraryRoute(libraryRoute('Christmas Planning')),{project:'Christmas Planning',source:''});
});
test('website navigation accepts only explicit HTTP(S), rejects credentials, executable schemes and malformed input',()=>{
 assert.equal(websiteUrl(' https://EXAMPLE.org '),'https://example.org/');assert.equal(websiteUrl('http://example.org/a?b=c#part'),'http://example.org/a?b=c#part');
 for(const value of ['',undefined,'example.org','javascript:alert(1)','data:text/html,hi','file:///etc/passwd','https://user:pass@example.org/','https://example.org/space here','https://example.org\\@local/','https:example.org','https://example.org/'+ 'x'.repeat(2048)])assert.throws(()=>websiteUrl(value));
 assert.equal(safeWebsiteUrl('javascript:alert(1)'),'');
});
test('preview image guard and fallback tolerate invalid/missing/private URLs without initiating metadata requests',()=>{
 assert.equal(previewUrl('https://images.public-site.org/a.jpg'),'https://images.public-site.org/a.jpg');
 for(const value of [undefined,'','http://images.public-site.org/a.jpg','https://127.0.0.1/a','https://2130706433/a','https://[::1]/','https://localhost/a','https://router.local/a','https://host.internal/a','https://host.test/a','https://images.public-site.org:8443/a','javascript:x'])assert.equal(previewUrl(value),'');
});
test('URL-only save uses domain title; notes require title/content; all optional fields and assignments validate',()=>{
 const value=sourceValues({source_type:'link',url:'https://example.org/read'});assert.equal(value.title,'example.org');assert.equal(value.section_id,null);assert.equal(value.note_content,'');
 const note=sourceValues({source_type:'note',title:' A plan ',note_content:' line 1\nline 2 ',section_id:section.id},[section]);assert.equal(note.url,null);assert.equal(note.description,'');assert.equal(note.note_content,'line 1\nline 2');
 for(const input of [{source_type:'note',title:'',note_content:'Hi'},{source_type:'note',title:'Title',note_content:''},{source_type:'image'},{source_type:'link',url:'https://example.org',section_id:'other'},{source_type:'link',url:'https://example.org',description:'x'.repeat(2001)},{source_type:'note',title:'Title',note_content:'x'.repeat(50001)}])assert.throws(()=>sourceValues(input,[section]));
});
test('filters combine type and optional subsection and preserve newest-first source ordering',()=>{
 const rows=[{...source,id:'a'},{...source,id:'b',source_type:'note',section_id:section.id,created_at:'2026-10-27T10:00:00Z'},{...source,id:'c',section_id:section.id}];
 assert.deepEqual(filterSources(rows).map(r=>r.id),['b','a','c']);assert.deepEqual(filterSources(rows,'link',section.id).map(r=>r.id),['c']);assert.deepEqual(filterSources(rows,'','unassigned').map(r=>r.id),['a']);
 assert.equal(sourceSummary({...source,description:'  hello\n world  '}),'hello world');assert.equal(sourceSummary({...source,url:'bad'}),'');
});
test('view preference fails gracefully in private browsing or denied storage and contains no source data',()=>{
 const denied={getItem(){throw Error('denied');},setItem(){throw Error('denied');}};assert.equal(storedView(denied),'gallery');assert.doesNotThrow(()=>rememberView(denied,'list'));
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};rememberView(storage,'list');assert.equal(storedView(storage),'list');assert.deepEqual([...values.entries()],[['hq-source-view','list']]);
});
test('repository scopes mutations by project/id/version, whitelists editable fields and handles duplicate-safe adds',async()=>{
 const calls=[];let response={data:{...source},error:null};
 const client={rpc:async(name,args)=>{calls.push({name,args});return {data:snapshot()};},from:table=>{
  const q={table,filters:[]};calls.push(q);const api={update:values=>{q.update=values;return api;},upsert:(values,options)=>{q.upsert=values;q.options=options;return api;},delete:()=>{q.delete=true;return api;},eq:(k,v)=>{q.filters.push([k,v]);return api;},select:()=>api,single:()=>api,maybeSingle:()=>api,then:(ok,bad)=>Promise.resolve(response).then(ok,bad)};return api;
 }};
 const repo=createSourceRepository(client);await repo.load('Garden');assert.deepEqual(calls[0],{name:'hq_source_library',args:{p_project:'Garden'}});
 const values=sourceValues(source);await repo.save('Garden',id,1,{...values,owner_id:'evil',project:'Other',preview_image_url:'javascript:x'});assert.deepEqual(calls[1].filters,[['project','Garden'],['id',id],['version',1]]);assert.equal(Object.hasOwn(calls[1].update,'owner_id'),false);assert.equal(Object.hasOwn(calls[1].update,'preview_image_url'),false);
 await repo.remove('Garden',id,1);assert.deepEqual(calls[2].filters,[['project','Garden'],['id',id],['version',1]]);
 await repo.save('Garden',id,null,values);assert.equal(calls[3].options.ignoreDuplicates,true);assert.equal(calls[3].upsert.id,id);assert.equal(calls[3].upsert.project,'Garden');
 response={error:{code:'23503'}};await assert.rejects(repo.save('Garden',id,1,values),/subsection/);response={data:null};await assert.rejects(repo.remove('Garden',id,1),/changed or deleted/);await assert.rejects(repo.load('Unknown'),/Unknown/);
});
test('repository refuses incomplete/cross-project data and reports unavailable migrations',async()=>{
 let response={data:snapshot()};const repo=createSourceRepository({rpc:async()=>response});response={data:{sources:[{...source,project:'Other'}],sections:[]}};await assert.rejects(repo.load('Garden'),/complete library/);
 response={data:{sources:[{...source,section_id:'missing'}],sections:[]}};await assert.rejects(repo.load('Garden'),/complete library/);response={data:{sources:[]}};await assert.rejects(repo.load('Garden'),/complete library/);response={error:{code:'PGRST202'}};await assert.rejects(repo.load('Garden'),/Stage 2A/);
});
test('committed save followed by failed reload closes successfully, hides stale data and blocks duplicate writes',async()=>{
 let loads=0,writes=0;const store=createSourceStore({load:async()=>{if(++loads===2)throw Error('Interrupted');return snapshot();},save:async()=>writes++},{isSignedIn:()=>true});store.select('Garden');await store.load();assert.equal(await store.save(id,null,{}),true);assert.equal(store.state.data,null);assert.match(store.state.error,/Saved, but/);assert.equal(await store.save(id,null,{}),false);assert.equal(writes,1);await store.load(true);assert.equal(store.state.error,'');
});
test('uncertain writes require reload rather than a blind retry; sessions/projects discard delayed responses',async()=>{
 let writes=0;const store=createSourceStore({load:async()=>snapshot(),save:async()=>{writes++;throw Error('Response lost');}},{isSignedIn:()=>true});store.select('Garden');await store.load();assert.equal(await store.save(id,null,{}),false);assert.match(store.state.error,/Reload/);assert.equal(await store.save(id,null,{}),false);assert.equal(writes,1);
 let resolve;const late=createSourceStore({load:()=>new Promise(r=>resolve=r)},{isSignedIn:()=>true});late.select('Garden');const loading=late.load();late.select('Other');resolve(snapshot());await loading;assert.equal(late.state.data,null);
 let finish;const session=createSourceStore({load:async()=>snapshot(),save:()=>new Promise(r=>finish=r)},{isSignedIn:()=>true});session.select('Garden');await session.load();const saving=session.save(id,1,{});session.reset();finish(source);assert.equal(await saving,false);assert.equal(session.state.data,null);
});
