import { libraryRoute, SOURCE_TYPES, safeWebsiteUrl, previewUrl, sourceValues, filterSources, sourceSummary, sectionName, storedView, rememberView } from './source-core.js?v=20261026-sources';
import { projectRoute, ordered } from './project-core.js?v=20261026-projects';
import { createSourceStore } from './source-store.js?v=20261026-sources';
import { newMoneyId as newId } from './money-core.js?v=20261026-money';

export function createSourceView({root,editor,projects,repository,isSignedIn,signIn}) {
  const $ = selector => root.querySelector(selector), field = name => editor.querySelector('[name="'+name+'"]');
  let storage;try {storage = window.localStorage;} catch {/* Browsing preferences are optional. */}
  let route = null, active = false, editing = null, mode = storedView(storage);
  let typeFilter = '', sectionFilter = '', restoreFocus = null;
  const store = createSourceStore(repository,{isSignedIn,changed:render}), {state} = store;
  const ready = () => isSignedIn() && state.data && !state.loading && !state.busy && !state.error;
  const el = (tag,className,text) => {const n = document.createElement(tag);if(className)n.className=className;if(text!=null)n.textContent=text;return n;};
  function media(source) {
    const wrap = el('div','source-media');wrap.setAttribute('aria-hidden','true');
    const icon = el('span','source-media-symbol');
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    for (const [key,value] of Object.entries({viewBox:'0 0 24 24',width:'28',height:'28',fill:'none',stroke:'currentColor','stroke-width':'1.4','stroke-linecap':'round','stroke-linejoin':'round',focusable:'false'})) svg.setAttribute(key,value);
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',source.source_type === 'link' ? 'M14 4h6v6m0-6L10 14M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5' : 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 5h6m-6 4h6m-6 4h4');
    svg.append(path);icon.append(svg);wrap.append(icon);
    const url = source.source_type === 'link' ? previewUrl(source.preview_image_url) : '';
    if (url) {
      const image = el('img');image.alt='';image.loading='lazy';image.decoding='async';image.referrerPolicy='no-referrer';
      image.addEventListener('error',()=>image.remove(),{once:true});image.src=url;wrap.append(image);
    }
    return wrap;
  }
  function render() {
    if (!route) return;
    const project = projects.find(p=>p.value === route.project), data = state.data;
    const projectName = project.value === 'Health & Fitness' ? project.value : project.name;
    $('#sourceProjectName').textContent = projectName;
    $('#sourceProjectBack').textContent = 'Back to '+projectName;$('#sourceProjectBack').href=projectRoute(route.project);
    $('#sourceStatus').textContent = !isSignedIn() ? 'Sign in to keep your links and notes together.' : state.loading ? 'Loading your sources…' : state.notice;
    $('#sourceError').textContent=state.error;$('#sourceSignIn').hidden=isSignedIn();$('#sourceReload').hidden=!isSignedIn();$('#sourceReload').disabled=state.loading||state.busy;
    root.setAttribute('aria-busy',String(state.loading||state.busy));
    $('#sourceCollection').hidden=!!route.source;$('#sourceDetail').hidden=!route.source;
    $('#sourceAdd').disabled=!ready();$('#sourceBackToLibrary').href=libraryRoute(route.project);
    for(const button of root.querySelectorAll('[data-source-view]'))button.setAttribute('aria-pressed',String(button.dataset.sourceView===mode));
    $('#sourceTypeFilter').value=typeFilter;$('#sourceTypeFilter').disabled=!data;
    const select=$('#sourceSectionFilter');select.replaceChildren(new Option('All subsections',''),new Option('No subsection','unassigned'));
    if(data)ordered(data.sections).forEach(s=>select.add(new Option(s.name,s.id)));
    if(sectionFilter && sectionFilter!=='unassigned' && !data?.sections.some(s=>s.id===sectionFilter))sectionFilter='';
    select.value=sectionFilter;select.disabled=!data;
    const rows=data ? filterSources(data.sources,typeFilter,sectionFilter) : [];
    $('#sourceCount').textContent=data ? `${rows.length} ${rows.length===1?'source':'sources'}${typeFilter||sectionFilter?' shown':''}` : '';
    const list=$('#sourceRows');list.className='source-rows is-'+mode;list.replaceChildren();
    $('#sourceEmpty').hidden=!data||!!rows.length;
    $('#sourceEmptyTitle').textContent=data?.sources.length?'No matching sources':'A home for your ideas';
    $('#sourceEmptyCopy').textContent=data?.sources.length?'Try another filter, or save a new source.':'Save a website to return to, or write down an idea. Everything here belongs to '+projectName+'.';
    $('#sourceClearFilters').hidden=!data?.sources.length||!(typeFilter||sectionFilter);
    $('#sourceEmptyAdd').hidden=!!data?.sources.length;$('#sourceEmptyAdd').disabled=!ready();
    for(const source of rows) {
      const item=el('li','source-card'),link=el('a','source-open');link.href=libraryRoute(route.project,source.id);
      link.append(media(source));const copy=el('div','source-card-copy');
      copy.append(el('span','source-type',SOURCE_TYPES[source.source_type]||'Source'),el('h3','',source.title),el('p','source-summary',sourceSummary(source)),el('small','source-association',sectionName(source,data.sections)));
      link.append(copy);item.append(link);list.append(item);
    }
    const source=data?.sources.find(s=>s.id===route.source);
    $('#sourceDetailContent').hidden=!source;$('#sourceMissing').hidden=!route.source||!data||!!source;
    if(source) {
      $('#sourceDetailTitle').textContent=source.title;$('#sourceDetailType').textContent=SOURCE_TYPES[source.source_type]||'Source';
      $('#sourceDetailSection').textContent=sectionName(source,data.sections);
      const date=new Date(source.updated_at);$('#sourceDetailDate').textContent=Number.isNaN(date.getTime())?'':'Updated '+date.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
      const url=safeWebsiteUrl(source.url);$('#sourceOriginal').hidden=source.source_type!=='link'||!url;
      $('#sourceOriginal').href=url||'#';$('#sourceOriginalUrl').textContent=url;
      const imageArea=$('#sourceDetailImage');imageArea.replaceChildren();imageArea.hidden=!previewUrl(source.preview_image_url);
      if(!imageArea.hidden)imageArea.append(media(source));
      $('#sourceDetailDescription').textContent=source.description||'';$('#sourceDetailDescription').hidden=!source.description;
      $('#sourceDetailNotesHeading').textContent=source.source_type==='note'?'Written note':'Personal notes';
      $('#sourceDetailNotes').textContent=source.note_content||'';$('#sourceDetailNotesArea').hidden=!source.note_content;
      $('#sourceEdit').disabled=!ready();$('#sourceDelete').disabled=!ready();
    }
    if(editor.open) {
      editor.querySelector('[role=alert]').textContent=state.error;
      for(const input of editor.querySelectorAll('input,textarea,select'))input.disabled=state.busy|| (input.name==='source_type'&&editing?.version!=null);
      editor.querySelector('[type=submit]').disabled=!ready();editor.querySelector('[data-cancel]').disabled=state.busy;
    }
  }
  function formType() {
    const link=field('source_type').value==='link';
    for(const block of editor.querySelectorAll('[data-source-link]'))block.hidden=!link;
    field('url').required=link;field('url').disabled=!link;
    field('title').required=!link;
    editor.querySelector('[for=sourceTitleInput]').textContent=link?'Title (optional)':'Title';
    field('content').required=!link;editor.querySelector('[data-source-note]').hidden=link;field('content').disabled=link;
    editor.querySelector('#sourceEditorHint').textContent=link?'Paste a URL and save. Automatic website previews aren’t available yet; you can add your own title and details.':'Keep an idea, plan or useful piece of writing for this project.';
    editor.querySelector('#sourceMoreDetails').open=!!editing?.version;
  }
  function showEditor(source=null) {
    if(!ready())return;
    restoreFocus=document.activeElement;
    editing={id:source?.id||newId(),version:source?.version??null};
    editor.querySelector('h2').textContent=source?'Edit source':'Add source';editor.querySelector('[role=alert]').textContent='';
    for(const input of editor.querySelectorAll('input,textarea,select,button'))input.disabled=false;
    field('source_type').value=source?.source_type||'link';field('source_type').disabled=!!source;
    for(const name of ['url','title','description'])field(name).value=source?.[name]||'';
    field('notes').value=source?.source_type==='link'?source.note_content||'':'';field('content').value=source?.source_type==='note'?source.note_content||'':'';
    const select=field('section_id');select.replaceChildren(new Option('No subsection',''));
    ordered(state.data.sections).forEach(s=>select.add(new Option(s.name,s.id)));select.value=source?.section_id||'';
    formType();editor.showModal();field(source?.source_type==='note'?'title':'url').focus();
  }
  editor.querySelector('form').addEventListener('submit',async event=>{
    event.preventDefault();if(!ready()||!editing)return;
    try {
      const entry=editing,values=sourceValues({source_type:field('source_type').value,url:field('url').value,title:field('title').value,
        description:field('description').value,note_content:field(field('source_type').value==='link'?'notes':'content').value,section_id:field('section_id').value},state.data.sections);
      if(await store.save(entry.id,entry.version,values) && editing===entry)editor.close();
    }catch(error){editor.querySelector('[role=alert]').textContent=error.message;}
  });
  field('source_type').addEventListener('change',formType);
  editor.querySelector('[data-cancel]').addEventListener('click',()=>editor.close());
  editor.addEventListener('cancel',event=>{if(state.busy)event.preventDefault();});
  editor.addEventListener('close',()=>{editing=null;if(restoreFocus?.isConnected)restoreFocus.focus({preventScroll:true});else if(active)$('#sourceAdd').focus({preventScroll:true});});
  $('#sourceAdd').addEventListener('click',()=>showEditor());$('#sourceEmptyAdd').addEventListener('click',()=>showEditor());
  $('#sourceEdit').addEventListener('click',()=>showEditor(state.data.sources.find(s=>s.id===route.source)));
  $('#sourceDelete').addEventListener('click',async()=>{
    if(!ready())return;const source=state.data.sources.find(s=>s.id===route.source),project=route.project;
    if(confirm(`Delete “${source.title}”? This removes only this saved source. Project milestones, tasks and other sources will stay unchanged.`)) {
      if(await store.remove(source.id,source.version) && active && route.project===project)location.hash=libraryRoute(project);
    }
  });
  $('#sourceTypeFilter').addEventListener('change',event=>{typeFilter=event.target.value;render();});
  $('#sourceSectionFilter').addEventListener('change',event=>{sectionFilter=event.target.value;render();});
  $('#sourceClearFilters').addEventListener('click',()=>{typeFilter='';sectionFilter='';render();});
  for(const button of root.querySelectorAll('[data-source-view]'))button.addEventListener('click',()=>{mode=button.dataset.sourceView;rememberView(storage,mode);render();});
  $('#sourceSignIn').addEventListener('click',signIn);$('#sourceReload').addEventListener('click',()=>store.load(true));
  return {
    open(next) {
      const entering=!active||route?.project!==next.project;
      if(entering||route?.source!==next.source){if(editor.open)editor.close();}
      if(entering){typeFilter='';sectionFilter='';}
      active=true;route=next;store.select(next.project);render();void store.load(entering);
    },
    close(){active=false;if(editor.open)editor.close();},
    reset(){if(editor.open)editor.close();store.reset();typeFilter='';sectionFilter='';}
  };
}
