import { isUpload, checkSelectedFile, fileAccept, fileSize, createFileAccess } from './source-files.js?v=20261026-uploads';
import { libraryRoute, SOURCE_TYPES, safeWebsiteUrl, previewUrl, sourceValues, filterSources, sourceSummary, sectionName, storedView, rememberView } from './source-core.js?v=20261026-uploads';
import { projectRoute, ordered } from './project-core.js?v=20261026-projects';
import { createSourceStore } from './source-store.js?v=20261026-uploads';
import { newMoneyId as newId } from './money-core.js?v=20261026-money';

export function createSourceView({root,editor,projects,repository,isSignedIn,signIn}) {
  const $ = selector => root.querySelector(selector), field = name => editor.querySelector('[name="'+name+'"]');
  let storage;try {storage = window.localStorage;} catch {/* Browsing preferences are optional. */}
  let route = null, active = false, editing = null, mode = storedView(storage), selectedFile=null, previewObjectUrl='', fileLinkTimer=0;
  const access=createFileAccess(repository);
  let typeFilter = '', sectionFilter = '', restoreFocus = null;
  const store = createSourceStore(repository,{isSignedIn,changed:render}), {state} = store;
  const ready = () => isSignedIn() && state.data && !state.loading && !state.busy && !state.error;
  const el = (tag,className,text) => {const n = document.createElement(tag);if(className)n.className=className;if(text!=null)n.textContent=text;return n;};
  function privateImage(source,image,wrap) {
    let retries=0;
    async function update(refresh=false) {
      try {const url=await access.url(source,false,refresh);if(image.isConnected&&active){image.src=url;setTimeout(()=>{if(image.isConnected&&active)void update();},240000);}}
      catch {if(image.isConnected){image.remove();if(wrap.closest('#sourceDetailImage'))wrap.append(el('p','editor-hint','Preview unavailable. Open or download the original file.'));}}
    }
    image.addEventListener('error',()=>{if(retries++===0)void update(true);else{image.remove();if(wrap.closest('#sourceDetailImage'))wrap.append(el('p','editor-hint','This browser cannot display this image. Open or download the original.'));}});
    // Start after the caller has attached the DOM node.
    queueMicrotask(()=>void update());
  }
  function fileLinks(source) {
    clearTimeout(fileLinkTimer);
    const epoch=source.storage_path;
    async function fill(node,download) {
      node.removeAttribute('href');node.setAttribute('aria-disabled','true');
      try {const url=await access.url(source,download);if(active&&route?.source===source.id&&state.data?.sources.some(s=>s.id===source.id&&s.storage_path===epoch)){node.href=url;node.removeAttribute('aria-disabled');}}
      catch(error){if(active&&route?.source===source.id)$('#sourceFileAccessError').textContent=error.message;}
    }
    $('#sourceFileAccessError').textContent='';
    $('#sourceFileOpen').removeAttribute('href');$('#sourceFileDownload').removeAttribute('href');
    if(source.file_status==='deleting'){$('#sourceFileAccessError').textContent='Deletion pending. Use Retry file cleanup to finish removing this file.';return;}
    if(!$('#sourceFileOpen').hidden)void fill($('#sourceFileOpen'),false);
    void fill($('#sourceFileDownload'),true);
    fileLinkTimer=setTimeout(()=>{if(active&&route?.source===source.id)fileLinks(source);},240000);
  }
  function clearSelectedFile() {
    selectedFile=null;field('upload').value='';if(previewObjectUrl)URL.revokeObjectURL(previewObjectUrl);previewObjectUrl='';
    editor.querySelector('#sourceSelectedPreview').hidden=true;editor.querySelector('#sourceSelectedPreview').removeAttribute('src');
  }
  function media(source) {
    const wrap = el('div','source-media');wrap.setAttribute('aria-hidden','true');
    const icon = el('span','source-media-symbol');
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    for (const [key,value] of Object.entries({viewBox:'0 0 24 24',width:'28',height:'28',fill:'none',stroke:'currentColor','stroke-width':'1.4','stroke-linecap':'round','stroke-linejoin':'round',focusable:'false'})) svg.setAttribute(key,value);
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',source.source_type === 'link' ? 'M14 4h6v6m0-6L10 14M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5' : 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 5h6m-6 4h6m-6 4h4');
    svg.append(path);icon.append(svg);wrap.append(icon);
    const uploadedImage=source.source_type==='image'&&source.file_status!=='deleting';
    const url = source.source_type === 'link' ? previewUrl(source.preview_image_url) : '';
    if(source.source_type==='file')icon.append(el('small','source-file-extension',(source.original_filename||'FILE').split('.').pop().toUpperCase()));
    if(uploadedImage){const image=el('img');image.alt='';image.loading='lazy';image.decoding='async';image.referrerPolicy='no-referrer';wrap.append(image);privateImage(source,image,wrap);}
    if (url) {
      const image = el('img');image.alt='';image.loading='lazy';image.decoding='async';image.referrerPolicy='no-referrer';
      image.addEventListener('error',()=>image.remove(),{once:true});image.src=url;wrap.append(image);
    }
    return wrap;
  }
  function render() {
    if (!route) return;
    clearTimeout(fileLinkTimer);
    const project = projects.find(p=>p.value === route.project), data = state.data;
    const projectName = project.value === 'Health & Fitness' ? project.value : project.name;
    $('#sourceProjectName').textContent = projectName;
    $('#sourceProjectBack').textContent = 'Back to '+projectName;$('#sourceProjectBack').href=projectRoute(route.project);
    $('#sourceStatus').textContent = !isSignedIn() ? 'Sign in to keep your links and notes together.' : state.loading ? 'Loading your sources…' : state.notice;
    $('#sourceError').textContent=state.error;$('#sourceSignIn').hidden=isSignedIn();$('#sourceReload').hidden=!isSignedIn();$('#sourceReload').disabled=state.loading||state.busy;
    root.setAttribute('aria-busy',String(state.loading||state.busy));
    $('#sourceCleanup').hidden=!data?.file_cleanup_pending;$('#sourceCleanup').disabled=!ready();
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
    $('#sourceEmptyCopy').textContent=data?.sources.length?'Try another filter, or save a new source.':'Keep links, notes, photographs and files together. Everything here belongs to '+projectName+'.';
    $('#sourceClearFilters').hidden=!data?.sources.length||!(typeFilter||sectionFilter);
    $('#sourceEmptyAdd').hidden=!!data?.sources.length;$('#sourceEmptyAdd').disabled=!ready();
    for(const source of rows) {
      const item=el('li','source-card'),link=el('a','source-open');link.href=libraryRoute(route.project,source.id);
      link.append(media(source));const copy=el('div','source-card-copy');
      copy.append(el('span','source-type',SOURCE_TYPES[source.source_type]||'Source'),el('h3','',source.title),el('p','source-summary',sourceSummary(source)),el('small','source-association',source.file_status==='deleting'?'Deletion pending · retry file cleanup':sectionName(source,data.sections)));
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
      const imageArea=$('#sourceDetailImage');imageArea.replaceChildren();imageArea.hidden=!(source.source_type==='image'&&source.file_status!=='deleting')&&!previewUrl(source.preview_image_url);
      if(!imageArea.hidden)imageArea.append(media(source));
      $('#sourceDetailDescription').textContent=source.description||'';$('#sourceDetailDescription').hidden=!source.description;
      $('#sourceDetailNotesHeading').textContent=source.source_type==='note'?'Written note':'Personal notes';
      $('#sourceDetailNotes').textContent=source.note_content||'';$('#sourceDetailNotesArea').hidden=!source.note_content;
      $('#sourceEdit').disabled=!ready()||source.file_status==='deleting';$('#sourceDelete').disabled=!ready();
      $('#sourceDelete').textContent=source.file_status==='deleting'?'Retry deletion':'Delete source';
      $('#sourceFileDetails').hidden=!isUpload(source);
      $('#sourceFileOpen').hidden=!(source.source_type==='image'||source.mime_type==='application/pdf')||source.file_status==='deleting';
      $('#sourceFileDownload').hidden=source.file_status==='deleting';
      if(isUpload(source)){
        $('#sourceFileMetadata').textContent=(source.original_filename||'File')+' · '+fileSize(source.file_size||0)+' · '+(source.mime_type||'');
        $('#sourceFileOpen').textContent=source.mime_type==='application/pdf'?'Open PDF':'Open image';
        $('#sourceFileViewingHint').hidden=source.source_type==='image'&&!['image/heic','image/heif'].includes(source.mime_type);
        $('#sourceFileViewingHint').textContent=source.mime_type==='application/pdf'?'PDFs open in your browser’s native viewer where supported. You can also download the original.':source.source_type==='image'?'HEIC/HEIF previews depend on your browser. If unavailable, open or download the original.':'Documents download as attachments. Open them in a suitable app from Files.';
        fileLinks(source);
      }
    }
    if(!source){
      $('#sourceDetailImage').replaceChildren();$('#sourceFileOpen').removeAttribute('href');$('#sourceFileDownload').removeAttribute('href');
      for(const selector of ['#sourceDetailTitle','#sourceDetailNotes','#sourceDetailDescription','#sourceOriginalUrl','#sourceFileMetadata'])$(selector).textContent='';
    }
    if(editor.open) {
      editor.querySelector('[role=alert]').textContent=state.error;
      for(const input of editor.querySelectorAll('input,textarea,select'))input.disabled=state.busy|| (input.name==='source_type'&&editing?.version!=null);
      editor.querySelector('[type=submit]').disabled=!ready();editor.querySelector('[data-cancel]').disabled=state.busy;
      editor.querySelector('[type=submit]').textContent=state.busy&&selectedFile?'Uploading…':'Save source';
    }
  }
  function formType() {
    const kind=field('source_type').value,link=kind==='link',note=kind==='note',uploaded=['image','file'].includes(kind);
    for(const block of editor.querySelectorAll('[data-source-link]'))block.hidden=!link;
    for(const block of editor.querySelectorAll('[data-source-extra]'))block.hidden=note;
    field('url').required=link;field('url').disabled=!link;
    field('title').required=note;editor.querySelector('[for=sourceTitleInput]').textContent=note?'Title':'Title (optional)';
    field('content').required=note;editor.querySelector('[data-source-note]').hidden=!note;field('content').disabled=!note;
    editor.querySelector('#sourceFilePicker').hidden=!uploaded;field('upload').accept=fileAccept(kind);
    editor.querySelector('[for=sourceFileInput]').textContent=editing?.version?'Replace file (optional)':'Choose a file';
    editor.querySelector('#sourceEditorHint').textContent=link?'Paste a URL and save. Automatic website previews aren’t available yet; you can add your own title and details.':note?'Keep an idea, plan or useful piece of writing for this project.':'Choose one file from Photos or Files. Your existing file stays safe until a replacement is saved.';
    editor.querySelector('#sourceMoreDetails').open=!!editing?.version;
  }
  function showEditor(source=null) {
    if(!ready())return;
    restoreFocus=document.activeElement;
    clearSelectedFile();editing={id:source?.id||newId(),version:source?.version??null,operation:newId(),source};
    editor.querySelector('#sourceSelectedFile').textContent=source?.original_filename?'Current file: '+source.original_filename:'';
    editor.querySelector('h2').textContent=source?'Edit source':'Add source';editor.querySelector('[role=alert]').textContent='';
    for(const input of editor.querySelectorAll('input,textarea,select,button'))input.disabled=false;
    field('source_type').value=source?.source_type||'link';field('source_type').disabled=!!source;
    for(const name of ['url','title','description'])field(name).value=source?.[name]||'';
    field('notes').value=source&&source.source_type!=='note'?source.note_content||'':'';field('content').value=source?.source_type==='note'?source.note_content||'':'';
    const select=field('section_id');select.replaceChildren(new Option('No subsection',''));
    ordered(state.data.sections).forEach(s=>select.add(new Option(s.name,s.id)));select.value=source?.section_id||'';
    formType();editor.showModal();field(source?.source_type==='note'?'title':isUpload(source)?'upload':'url').focus();
  }
  editor.querySelector('form').addEventListener('submit',async event=>{
    event.preventDefault();if(!ready()||!editing)return;
    try {
      const entry=editing,values=sourceValues({source_type:field('source_type').value,url:field('url').value,title:field('title').value,
        description:field('description').value,note_content:field(field('source_type').value==='note'?'content':'notes').value,section_id:field('section_id').value,original_filename:selectedFile?.name||entry.source?.original_filename},state.data.sections);
      const uploaded=['image','file'].includes(values.source_type);
      if(uploaded&&!selectedFile&&entry.version==null)throw new Error('Choose a file before saving.');
      if(selectedFile)checkSelectedFile(selectedFile,values.source_type);
      const success=uploaded&&selectedFile?await store.upload(entry.id,entry.version,values,selectedFile,entry.operation):await store.save(entry.id,entry.version,values);
      if(success&&editing===entry)editor.close();
    }catch(error){editor.querySelector('[role=alert]').textContent=error.message;}
  });
  field('source_type').addEventListener('change',()=>{clearSelectedFile();editor.querySelector('#sourceSelectedFile').textContent='';formType();});
  field('upload').addEventListener('change',()=>{
    const file=field('upload').files[0];
    if(previewObjectUrl)URL.revokeObjectURL(previewObjectUrl);previewObjectUrl='';selectedFile=null;
    editor.querySelector('#sourceSelectedPreview').hidden=true;editor.querySelector('[role=alert]').textContent='';
    try{if(!file)return;checkSelectedFile(file,field('source_type').value);selectedFile=file;editing.operation=newId();
      editor.querySelector('#sourceSelectedFile').textContent=file.name+' · '+fileSize(file.size);
      if(field('source_type').value==='image'){
        previewObjectUrl=URL.createObjectURL(file);const preview=editor.querySelector('#sourceSelectedPreview');preview.src=previewObjectUrl;preview.hidden=false;preview.onerror=()=>{preview.hidden=true;};
      }
    }catch(error){field('upload').value='';editor.querySelector('#sourceSelectedFile').textContent='';editor.querySelector('[role=alert]').textContent=error.message;}
  });
  editor.querySelector('[data-cancel]').addEventListener('click',()=>editor.close());
  editor.addEventListener('cancel',event=>{if(state.busy)event.preventDefault();});
  editor.addEventListener('close',()=>{clearSelectedFile();editing=null;if(restoreFocus?.isConnected)restoreFocus.focus({preventScroll:true});else if(active)$('#sourceAdd').focus({preventScroll:true});});
  $('#sourceAdd').addEventListener('click',()=>showEditor());$('#sourceEmptyAdd').addEventListener('click',()=>showEditor());
  $('#sourceEdit').addEventListener('click',()=>showEditor(state.data.sources.find(s=>s.id===route.source)));
  $('#sourceDelete').addEventListener('click',async()=>{
    if(!ready())return;const source=state.data.sources.find(s=>s.id===route.source),project=route.project;
    if(confirm(`Delete “${source.title}”? ${isUpload(source)?'This removes the saved source and its private file.':'This removes only this saved source.'} Project milestones, tasks and other sources will stay unchanged.`)) {
      if(await store.remove(source.id,source.version,isUpload(source),newId()) && active && route.project===project)location.hash=libraryRoute(project);
    }
  });
  $('#sourceTypeFilter').addEventListener('change',event=>{typeFilter=event.target.value;render();});
  $('#sourceSectionFilter').addEventListener('change',event=>{sectionFilter=event.target.value;render();});
  $('#sourceClearFilters').addEventListener('click',()=>{typeFilter='';sectionFilter='';render();});
  for(const button of root.querySelectorAll('[data-source-view]'))button.addEventListener('click',()=>{mode=button.dataset.sourceView;rememberView(storage,mode);render();});
  $('#sourceCleanup').addEventListener('click',()=>store.cleanup());
  $('#sourceRefreshFile').addEventListener('click',()=>{access.clear();render();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&active){access.clear();render();}});
  $('#sourceSignIn').addEventListener('click',signIn);$('#sourceReload').addEventListener('click',()=>store.load(true));
  return {
    open(next) {
      const entering=!active||route?.project!==next.project;
      if(entering||route?.source!==next.source){if(editor.open)editor.close();}
      if(entering){typeFilter='';sectionFilter='';}
      active=true;route=next;store.select(next.project);render();void store.load(entering);
    },
    close(){active=false;clearTimeout(fileLinkTimer);if(editor.open)editor.close();},
    reset(){clearTimeout(fileLinkTimer);access.clear();clearSelectedFile();if(editor.open)editor.close();store.reset();typeFilter='';sectionFilter='';}
  };
}
