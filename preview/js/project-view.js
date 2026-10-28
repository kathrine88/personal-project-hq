import { libraryRoute } from '../../js/source-core.js?v=20261026-uploads';
import { projectRoute, ordered, projectProgress, moveIds, cleanName } from '../../js/project-core.js?v=20261026-projects';
import { createProjectStore } from '../../js/project-store.js?v=20261026-projects';
import { newMoneyId as newId } from '../../js/money-core.js?v=20261026-money';

export function createProjectView({root, editor, projects, repository, isSignedIn, signIn, openTasks, getPlannerTasks = () => [], taskDetailsRepository = null, reloadPlannerTasks = async () => {}}) {
  const $ = selector => root.querySelector(selector);
  let route = null, editing = null, returnFocus = '';
  let hubProject = '', hubExpanded = false;
  let detailData=null,detailProject='',detailError='';
  async function loadDetailData(project) {if(!taskDetailsRepository)return;try{detailData=await taskDetailsRepository.load(project);detailProject=project;detailError='';renderTodoSummary();}catch(error){detailError=error.message;renderTodoSummary();}}
  async function changeDetail(operation) {try{await operation();await loadDetailData(route.project);}catch(error){detailError=error.message;renderTodoSummary();}}
  const store = createProjectStore(repository, {isSignedIn, changed:render});
  const {state} = store;
  const el = (tag, className, text) => {const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node;};
  function button(text, label, key, action, disabled = false) {
    const node = el('button', 'project-control', text); node.type = 'button'; node.setAttribute('aria-label', label); node.dataset.projectFocus = key;
    node.disabled = disabled || !ready(); node.addEventListener('click', action); return node;
  }
  const ready = () => isSignedIn() && state.data && !state.loading && !state.busy && !state.error;
  function meter(target, info) {
    target.replaceChildren();
    const caption = el('p', 'project-progress-label', info.label); target.append(caption);
    const bar = el('div', 'project-progress'); bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', 'Task progress'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(info.percent)); bar.setAttribute('aria-valuetext', info.label);
    const fill = el('span'); fill.style.width = info.percent + '%'; bar.append(fill); target.append(bar);
  }
  function render() {
    if (!route) return;
    const focused = document.activeElement?.dataset.projectFocus;
    const project = projects.find(p => p.value === route.project);
    const data = state.data;
    root.dataset.theme = project.theme;
    $('#projectPhoto').src = '../' + project.image;
    $('#projectLibrary').href = libraryRoute(route.project);
    $('#projectEyebrow').textContent = project.note;
    $('#projectHeading').textContent = project.value === 'Health & Fitness' ? project.value : project.name;
    $('#projectStatus').textContent = !isSignedIn() ? 'Sign in to save your project tasks.' : state.loading ? 'Loading your project…' : state.notice;
    $('#projectError').textContent = state.error;
    $('#projectSignIn').hidden = isSignedIn(); $('#projectReload').hidden = !isSignedIn(); $('#projectReload').disabled = state.loading || state.busy;
    root.setAttribute('aria-busy', String(state.loading || state.busy));
    $('#projectOverall').hidden = !data;
    if (data) meter($('#projectOverall'), projectProgress(data));
    const modernHub = project.value !== 'Health & Fitness';
    root.classList.toggle('project-hub-enabled', modernHub && !route.section);
    if (hubProject !== route.project) {hubProject = route.project; hubExpanded = false; activeTask=null; expandedSections=new Set();detailData=null;detailProject='';}
    root.classList.toggle('project-hub-expanded', hubExpanded);
    const hub = $('#projectHub');
    if (hub) {
      hub.hidden = !modernHub || !!route.section;
      hub.querySelector('[data-hub=todo]').setAttribute('aria-expanded', String(hubExpanded));
      hub.querySelector('[data-hub=todo]').setAttribute('aria-label', hubExpanded ? 'Hide project tasks by area' : 'Browse project tasks by area');
      hub.querySelector('[data-hub=buy]').setAttribute('aria-label', 'View planned purchases for ' + route.project);
      hub.querySelector('[data-hub=library]').href = libraryRoute(route.project);
    }
    renderTodoSummary();
    if(hubExpanded && taskDetailsRepository && detailProject!==route.project)loadDetailData(route.project);
    $('#projectOverview').hidden = !!route.section;
    $('#projectSectionPage').hidden = !route.section;
    $('#projectAddSection').disabled = !ready();
    $('#projectSectionCards').replaceChildren();
    $('#projectEmpty').hidden = !data || !!data.sections.length;
    if (data) ordered(data.sections).forEach((section, index, sections) => {
      const li = el('li', 'project-section-card'); li.dataset.sectionId = section.id;
      const link = el('a', 'project-section-link'); link.href = projectRoute(route.project, section.id);
      link.append(el('h3', '', section.name)); const summary = el('div'); meter(summary, projectProgress(data, section.id)); link.append(summary); li.append(link);
      const controls = el('div', 'project-card-controls');
      controls.append(button('Rename', 'Rename ' + section.name, 'edit-' + section.id, () => showEditor('section', section)),
        button('↑', 'Move ' + section.name + ' up', 'up-' + section.id, () => reorder('sections', sections, section.id, -1), index === 0),
        button('↓', 'Move ' + section.name + ' down', 'down-' + section.id, () => reorder('sections', sections, section.id, 1), index === sections.length - 1),
        button('Delete', 'Delete subsection ' + section.name, 'delete-' + section.id, () => removeSection(section)));
      li.append(controls); $('#projectSectionCards').append(li);
    });
    $('#projectBack').href = projectRoute(route.project);
    $('#projectMilestones').replaceChildren();
    const section = data?.sections.find(s => s.id === route.section);
    $('#projectSectionContent').hidden = !section;
    $('#projectSectionMissing').hidden = !route.section || !data || !!section;
    if (section) {
      $('#projectSectionHeading').textContent = section.name;
      meter($('#projectSectionProgress'), projectProgress(data, section.id));
      $('#projectAddMilestone').disabled = !ready(); $('#projectRenameSection').disabled = !ready(); $('#projectDeleteSection').disabled = !ready();
      const milestones = ordered(data.milestones.filter(m => m.section_id === section.id));
      $('#projectMilestoneEmpty').hidden = !!milestones.length;
      milestones.forEach((milestone, index) => {
        const li = el('li', 'project-milestone' + (milestone.completed ? ' is-complete' : '')); li.dataset.milestoneId = milestone.id;
        const label = el('label', 'project-milestone-label'), check = el('input'); check.type = 'checkbox'; check.checked = milestone.completed; check.disabled = !ready(); check.dataset.projectFocus = 'check-' + milestone.id;
        check.addEventListener('change', () => store.save('complete_milestone', {id:milestone.id, section_id:section.id, completed:check.checked}));
        label.append(check, el('span', '', milestone.name)); li.append(label);
        const controls = el('div', 'project-milestone-controls');
        controls.append(button('Edit', 'Rename task ' + milestone.name, 'edit-' + milestone.id, () => showEditor('milestone', milestone)),
          button('↑', 'Move task ' + milestone.name + ' up', 'up-' + milestone.id, () => reorder('milestones', milestones, milestone.id, -1), index === 0),
          button('↓', 'Move task ' + milestone.name + ' down', 'down-' + milestone.id, () => reorder('milestones', milestones, milestone.id, 1), index === milestones.length - 1),
          button('Delete', 'Delete task ' + milestone.name, 'delete-' + milestone.id, async () => {
            if (confirm(`Delete milestone “${milestone.name}”? This removes only this milestone. Other milestones, projects and planner tasks will stay unchanged.`)) await store.save('delete_milestone', {id:milestone.id, section_id:section.id});
          }));
        li.append(controls); $('#projectMilestones').append(li);
      });
    }
    const form = editor.querySelector('form');
    if (editor.open) {
      form.querySelector('button[type=submit]').disabled = !ready();
      form.querySelector('input').disabled = state.busy;
      form.querySelector('[data-cancel]').disabled = state.busy;
      editor.querySelector('[role=alert]').textContent = state.error;
    }
    if (focused) [...root.querySelectorAll('[data-project-focus]')].find(n => n.dataset.projectFocus === focused && !n.disabled)?.focus({preventScroll:true});
  }


  // Project To Do: existing milestones are presented as tasks without altering stored data.
  const todoSummary = document.createElement('section');
  todoSummary.id = 'projectTodoSummary';
  todoSummary.className = 'project-todo-summary';
  todoSummary.hidden = true;
  todoSummary.setAttribute('aria-label', 'Project to do');
  let expandedSections = new Set(), activeTask = null, drag = null, suppressTap = false;
  const todoButton = (text, className, action) => {
    const b = el('button', className, text); b.type = 'button'; b.addEventListener('click', action); return b;
  };
  function resourceArea(kind,id,type,options={}) {
    const data=detailData||{links:[],purchases:[],sources:[]};
    const collection=type==='purchase'?data.purchases:data.sources;
    const key=type==='purchase'?'purchase_id':'source_id';
    const parent=kind==='section'?'section_id':'milestone_id';
    const links=data.links.filter(l=>l[parent]===id&&l[key]);
    const block=el('div','project-todo-linked-resources');
    const label=el('h5','',type==='purchase'?'Related purchases':'Library references');block.append(label);
    if(!links.length)block.append(el('p','project-todo-resource-empty','Nothing linked yet.'));
    links.forEach(link=>{
      const item=collection.find(x=>x.id===link[key]);
      if(!item)return;
      const row=el('div','project-todo-linked-row');
      const title=el('span','',type==='purchase'?item.item:item.title);
      row.append(title);
      if(type==='source'&&item.source_type==='link'&&/^https:\/\//.test(item.url||'')){
        const open=el('a','project-todo-resource-link','Open');open.href=item.url;open.target='_blank';open.rel='noopener noreferrer';row.append(open);
      }
      if(!options.inherited)row.append(todoButton('Unlink','project-todo-unlink',()=>{
        if(confirm('Remove this link? The original '+(type==='purchase'?'purchase':'Library item')+' will not be deleted.'))
          changeDetail(()=>taskDetailsRepository.unlink(link.id));
      }));
      block.append(row);
    });
    if(!options.inherited&&taskDetailsRepository){
      const select=el('select','project-todo-link-select');
      const placeholder=el('option','',type==='purchase'?'Choose an existing purchase…':'Choose an existing Library item…');
      placeholder.value='';select.append(placeholder);
      collection.filter(x=>!links.some(l=>l[key]===x.id)).forEach(item=>{
        const option=el('option','',type==='purchase'?item.item:item.title);
        option.value=item.id;select.append(option);
      });
      select.disabled=collection.length===0;
      const add=todoButton('+ Link item','project-todo-open',()=>{
        if(select.value)changeDetail(()=>taskDetailsRepository.link(kind,id,type,select.value));
      });
      add.disabled=!collection.length;
      block.append(select,add);
      if(!collection.length)block.append(el('p','project-todo-resource-empty','Add an item to this project’s '+(type==='purchase'?'To Buy list':'Library')+' first.'));
    }
    return block;
  }
  function showTaskDetail(task, section) {
    activeTask = task.id;
    renderTodoSummary();
  }
  function renderTodoSummary() {
    if (!route) return;
    todoSummary.hidden = !hubExpanded || !!route.section || route.project === 'Health & Fitness';
    if (todoSummary.hidden) return;
    todoSummary.replaceChildren();
    if(detailError)todoSummary.append(el('p','project-todo-error',detailError));
    const data = state.data;
    const head = el('div','project-todo-heading');
    head.append(el('h2','','To Do'),todoButton('Back to Garden','project-todo-back',()=>{hubExpanded=false;activeTask=null;render();}));
    todoSummary.append(head);
    if (!data) {todoSummary.append(el('p','project-todo-intro','Loading your tasks…'));return;}
    if (activeTask) {
      const task = data.milestones.find(m=>m.id===activeTask);
      const section = task && data.sections.find(s=>s.id===task.section_id);
      if (!task || !section) {activeTask=null;renderTodoSummary();return;}
      todoSummary.append(todoButton('← All tasks','project-todo-back',()=>{activeTask=null;renderTodoSummary();}));
      todoSummary.append(el('p','project-todo-eyebrow',section.name));
      todoSummary.append(el('h2','project-todo-detail-title',task.name));
      const complete = el('label','project-todo-detail-check');
      const checkbox=el('input');checkbox.type='checkbox';checkbox.checked=!!(plannerTask?plannerTask.completed:task.completed);checkbox.disabled=!ready();
      checkbox.addEventListener('change',async()=>{if(await store.save('complete_milestone',{id:task.id,section_id:section.id,completed:checkbox.checked}))await reloadPlannerTasks();});
      complete.append(checkbox,el('span','',task.completed?'Task complete':'Mark task complete'));
      todoSummary.append(complete);
      const actions=el('div','project-todo-detail-actions');
      actions.append(todoButton('Edit task name','project-todo-open',()=>showEditor('milestone',task)));
      const link=detailData?.plannerLinks?.find(l=>l.milestone_id===task.id);
      const plannerTask=link&&getPlannerTasks().find(t=>t.id===link.planner_task_id);
      const scheduleBox=el('div','project-todo-schedule');
      const dateLabel=el('label','','Schedule in Weekly Planner');
      const dateInput=el('input','project-todo-date');dateInput.type='date';dateInput.value=plannerTask?.scheduled_date||'';
      dateLabel.append(dateInput);scheduleBox.append(dateLabel);
      if(link) scheduleBox.append(el('p','project-todo-resource-empty',plannerTask?.scheduled_date?'Scheduled for '+plannerTask.scheduled_date:'Linked to Weekly Planner (no date set)'));
      scheduleBox.append(todoButton(link?'Update date':'Add to Weekly Planner','project-todo-open',async()=>{
        if(!dateInput.value){detailError='Choose a date first.';renderTodoSummary();return;}
        await changeDetail(async()=>{await taskDetailsRepository.schedule(task.id,dateInput.value);await reloadPlannerTasks();});
      }));
      actions.append(scheduleBox);
      todoSummary.append(actions);
      const existing=detailData||{details:[],subtasks:[],links:[],purchases:[],sources:[]};
      const notesRecord=existing.details.find(d=>d.milestone_id===task.id);
      const noteEditor=el('textarea','project-todo-notes-input');noteEditor.value=notesRecord?.notes||'';noteEditor.rows=3;noteEditor.placeholder='Add notes and constraints…';
      const noteSave=todoButton('Save notes','project-todo-open',()=>changeDetail(()=>taskDetailsRepository.saveNotes('milestone',task.id,noteEditor.value)));
      const subtasks=existing.subtasks.filter(t=>t.milestone_id===task.id);
      const extras=el('div','project-todo-detail-extras');
      const makeBlock=(title,description)=>{
        const block=el('section','project-todo-detail-block');
        block.append(el('h3','',title),el('p','',description));extras.append(block);return block;
      };
      const subBlock=makeBlock('Subtasks',subtasks.filter(t=>t.completed).length+' of '+subtasks.length+' completed');
      subtasks.forEach(st=>{
        const row=el('label','project-todo-subtask-row');const check=el('input');check.type='checkbox';check.checked=st.completed;
        check.addEventListener('change',()=>changeDetail(()=>taskDetailsRepository.updateSubtask(st.id,{completed:check.checked})));
        row.append(check,el('span','',st.title),todoButton('×','project-todo-remove',e=>changeDetail(()=>taskDetailsRepository.removeSubtask(st.id))));subBlock.append(row);
      });
      const subInput=el('input','project-todo-subtask-input');subInput.placeholder='New subtask…';subInput.maxLength=300;
      subBlock.append(subInput,todoButton('+ Add subtask','project-todo-open',()=>{if(subInput.value.trim())changeDetail(()=>taskDetailsRepository.addSubtask(task.id,subInput.value.trim(),subtasks.length));}));
      extras.append(resourceArea('milestone',task.id,'purchase'));
      extras.append(resourceArea('milestone',task.id,'source'));
      const notesBlock=makeBlock('Notes & constraints','');notesBlock.append(noteEditor,noteSave);
      const shared=makeBlock('Subsection resources','Resources shared across every task in '+section.name+'.');
      shared.append(resourceArea('section',section.id,'purchase',{inherited:true}));
      shared.append(resourceArea('section',section.id,'source',{inherited:true}));
      todoSummary.append(extras);return;
    }
    todoSummary.append(el('p','project-todo-intro','Tap a subsection to expand it. Press and hold anywhere on its tile to change the order.'));
    const list=el('div','project-todo-sections');
    const sections=ordered(data.sections);
    sections.forEach(section=>{
      const tasks=ordered(data.milestones.filter(m=>m.section_id===section.id));
      const done=tasks.filter(t=>t.completed).length;
      const tile=el('section','project-todo-tile');tile.dataset.sectionId=section.id;
      const header=todoButton('','project-todo-tile-header',()=>{
        if(suppressTap){suppressTap=false;return;}
        if(expandedSections.has(section.id))expandedSections.delete(section.id);else expandedSections.add(section.id);
        renderTodoSummary();
      });
      const labels=el('span','project-todo-tile-labels');
      labels.append(el('strong','',section.name),el('small','',done+'/'+tasks.length+' tasks completed'));
      header.append(labels,el('span','project-todo-chevron',expandedSections.has(section.id)?'⌃':'⌄'));
      tile.append(header);
      if(expandedSections.has(section.id)){
        const content=el('div','project-todo-tile-content');
        tasks.forEach(task=>{
          const row=el('div','project-todo-task-row');
          const check=el('input');check.type='checkbox';check.checked=!!task.completed;check.disabled=!ready();check.setAttribute('aria-label','Complete '+task.name);
          check.addEventListener('change',async()=>{if(await store.save('complete_milestone',{id:task.id,section_id:section.id,completed:check.checked}))await reloadPlannerTasks();});
          const name=todoButton(task.name+(task.completed?' ✓':''),'project-todo-task-name',()=>showTaskDetail(task,section));
          row.append(check,name);content.append(row);
        });
        const resources=el('div','project-todo-subsection-resources');
        resources.append(el('h4','','Subsection resources'));
        resources.append(resourceArea('section',section.id,'purchase'));
        resources.append(resourceArea('section',section.id,'source'));
        if(detailData){
          const sectionNotes=detailData.details.find(d=>d.section_id===section.id);
          const input=el('textarea','project-todo-notes-input');input.value=sectionNotes?.notes||'';input.placeholder='General notes for '+section.name;input.rows=2;
          resources.append(input,todoButton('Save subsection notes','project-todo-open',()=>changeDetail(()=>taskDetailsRepository.saveNotes('section',section.id,input.value))));
        }
        content.append(resources);
        if(!tasks.length)content.append(el('p','project-todo-empty','No tasks yet.'));
        content.append(todoButton('+ Add task','project-todo-add',()=>{const old=route;route={...route,section:section.id};showEditor('milestone');route=old;}));
        tile.append(content);
      }
      // Native iOS touch events avoid Safari cancelling pointer drags when scrolling.
      let timer=null, origin=null, touchDragging=false;
      const cancel=()=>{if(timer){clearTimeout(timer);timer=null;}};
      const markTarget=(x,y)=>{
        const target=document.elementFromPoint(x,y)?.closest('.project-todo-tile');
        if(target&&list.contains(target)){
          drag.target=target.dataset.sectionId;
          list.querySelectorAll('.project-todo-tile').forEach(t=>t.classList.toggle('is-drop-target',t===target));
        }
      };
      const finish=async()=>{
        cancel();origin=null;
        if(!drag||drag.id!==section.id)return;
        const {id,target}=drag;drag=null;touchDragging=false;
        tile.classList.remove('is-dragging');
        list.querySelectorAll('.project-todo-tile').forEach(t=>t.classList.remove('is-drop-target'));
        setTimeout(()=>{suppressTap=false;},350);
        if(id!==target){
          const ids=sections.map(s=>s.id),from=ids.indexOf(id),to=ids.indexOf(target);
          if(from>=0&&to>=0){ids.splice(from,1);ids.splice(to,0,id);await store.save('order_sections',{ids});}
        }
      };
      tile.addEventListener('touchstart',e=>{
        if(!ready()||e.target.closest('input,textarea,button,a')&& !e.target.closest('.project-todo-tile-header')||e.target.closest('.project-todo-add')||e.touches.length!==1)return;
        const t=e.touches[0];origin={x:t.clientX,y:t.clientY};cancel();
        timer=setTimeout(()=>{
          timer=null;touchDragging=true;drag={id:section.id,target:section.id};
          suppressTap=true;tile.classList.add('is-dragging');
          if(navigator.vibrate)navigator.vibrate(12);
        },400);
      },{passive:true});
      tile.addEventListener('touchmove',e=>{
        if(!e.touches.length)return;
        const t=e.touches[0];
        if(timer&&origin&&Math.hypot(t.clientX-origin.x,t.clientY-origin.y)>9)cancel();
        if(touchDragging&&drag?.id===section.id){
          if(e.cancelable)e.preventDefault();
          markTarget(t.clientX,t.clientY);
        }
      },{passive:false});
      tile.addEventListener('touchend',()=>{if(touchDragging)finish();else cancel();});
      tile.addEventListener('touchcancel',()=>{cancel();if(touchDragging){drag=null;touchDragging=false;tile.classList.remove('is-dragging');}});
      tile.addEventListener('pointerdown',e=>{
        if(e.pointerType==='touch'||!ready()||e.target.closest('input'))return;
        origin={x:e.clientX,y:e.clientY};cancel();
        timer=setTimeout(()=>{timer=null;drag={id:section.id,target:section.id};suppressTap=true;tile.classList.add('is-dragging');},400);
      });
      tile.addEventListener('pointermove',e=>{
        if(e.pointerType==='touch')return;
        if(timer&&origin&&Math.hypot(e.clientX-origin.x,e.clientY-origin.y)>9)cancel();
        if(drag?.id===section.id)markTarget(e.clientX,e.clientY);
      });
      tile.addEventListener('pointerup',e=>{if(e.pointerType!=='touch')finish();});
      tile.addEventListener('pointercancel',e=>{if(e.pointerType!=='touch')cancel();});
      list.append(tile);
    });
    todoSummary.append(list);
    todoSummary.append(todoButton('+ Add subsection','project-todo-add-section',()=>showEditor('section')));
    const plannerTasks=getPlannerTasks().filter(t=>t.project===route.project);
    if(plannerTasks.length){
      const group=el('section','project-todo-existing-planner');
      group.append(el('h3','','Already in Weekly Planner'));
      plannerTasks.forEach(t=>group.append(el('p','', (t.completed?'✓ ':'○ ')+t.task+(t.scheduled_date?' · '+t.scheduled_date:''))));
      todoSummary.append(group);
    }
  }
  async function reorder(kind, rows, id, direction) {
    await store.save('order_' + kind, {ids:moveIds(rows, id, direction), ...(kind === 'milestones' ? {section_id:route.section} : {})});
  }
  async function removeSection(section) {
    const count = state.data.milestones.filter(m => m.section_id === section.id).length;
    if (!confirm(`Delete subsection “${section.name}” and its ${count} milestone${count === 1 ? '' : 's'}? This cannot be undone. Other subsections, projects and planner tasks will stay unchanged. Any library sources assigned here will be kept in the project library without a subsection.`)) return;
    const project = route.project, inside = route.section === section.id;
    if (await store.save('delete_section', {id:section.id}) && inside && route?.project === project) location.hash = projectRoute(project);
  }
  function showEditor(kind, item = null) {
    if (!ready()) return;
    returnFocus = document.activeElement?.dataset.projectFocus || (kind === 'section' ? 'add-section' : 'add-milestone');
    editing = {kind, id:item?.id || newId(), section_id:kind === 'milestone' ? (item?.section_id || route.section) : undefined};
    editor.querySelector('h2').textContent = (item ? 'Rename ' : 'Add ') + (kind === 'section' ? 'subsection' : 'task');
    editor.querySelector('[role=alert]').textContent = '';
    const input = editor.querySelector('input'); input.value = item?.name || ''; input.disabled = false;
    editor.querySelector('button[type=submit]').disabled = false; editor.querySelector('[data-cancel]').disabled = false;
    editor.showModal(); input.focus();
  }
  editor.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault(); if (!editing || !ready()) return;
    try {
      const name = cleanName(editor.querySelector('input').value), entry = editing;
      const success = await store.save('save_' + entry.kind, {id:entry.id, name, ...(entry.section_id ? {section_id:entry.section_id} : {})});
      if (success && editing === entry) editor.close();
    } catch (error) {editor.querySelector('[role=alert]').textContent = error.message;}
  });
  editor.querySelector('[data-cancel]').addEventListener('click', () => editor.close());
  editor.addEventListener('cancel', event => {if (state.busy) event.preventDefault();});
  editor.addEventListener('close', () => {editing = null; [...root.querySelectorAll('[data-project-focus]')].find(n => n.dataset.projectFocus === returnFocus)?.focus({preventScroll:true});});
  $('#projectSignIn').addEventListener('click', signIn);
  $('#projectReload').addEventListener('click', () => store.load(true));
  $('#projectAddSection').addEventListener('click', () => showEditor('section'));
  $('#projectAddMilestone').addEventListener('click', () => showEditor('milestone'));
  $('#projectRenameSection').addEventListener('click', () => showEditor('section', state.data.sections.find(s => s.id === route.section)));
  $('#projectDeleteSection').addEventListener('click', () => removeSection(state.data.sections.find(s => s.id === route.section)));
  const hub = document.createElement('nav');
  hub.id = 'projectHub'; hub.className = 'project-hub'; hub.setAttribute('aria-label', 'Project spaces');
  hub.innerHTML = '<button type="button" class="project-hub-card" data-hub="todo" aria-expanded="false"><span class="project-hub-art" aria-hidden="true"></span><span class="project-hub-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="m8 9 1.5 1.5L12 8"/><path d="M14 10h3M8 15h9"/></svg></span><span class="project-hub-body"><strong>To Do</strong><small>Tasks and plans<br>for this project</small><span class="project-hub-arrow" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></span></span></button><button type="button" class="project-hub-card" data-hub="buy"><span class="project-hub-art" aria-hidden="true"></span><span class="project-hub-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10 2 10h14l2-10H3Z"/><path d="m8 10 4-7 4 7M3 14h18M9 14v4M15 14v4"/></svg></span><span class="project-hub-body"><strong>To Buy</strong><small>Planned purchases<br>for this project</small><span class="project-hub-arrow" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></span></span></button><a class="project-hub-card" data-hub="library"><span class="project-hub-art" aria-hidden="true"></span><span class="project-hub-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h5v16H4zM10 6h5v14h-5zM16 3l4 1  -2 16 -4-1z"/></svg></span><span class="project-hub-body"><strong>Library</strong><small>Ideas and<br>references</small><span class="project-hub-arrow" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></span></span></a>';
  root.insertBefore(hub, $('#projectOverview'));
  hub.after(todoSummary);
  hub.querySelector('[data-hub=todo]').addEventListener('click', () => {hubExpanded = !hubExpanded; activeTask=null; render();});
  hub.querySelector('[data-hub=buy]').addEventListener('click', () => {
    const filter = document.getElementById('moneyProjectFilter');
    if (filter) filter.value = route.project;
    location.hash = '#money-purchases';
  });
  $('#projectTasks').addEventListener('click', () => openTasks(route.project));
  return {
    open(next) {
      if (route?.project !== next.project || route?.section !== next.section) {if (editor.open) editor.close();}
      route = next; store.select(next.project); render(); void store.load();
    },
    async refreshFromPlanner(){if(!route||!isSignedIn())return;await store.load(true);if(hubExpanded)renderTodoSummary();},
    close() {if (editor.open) editor.close();},
    reset() {if (editor.open) editor.close(); store.reset();}
  };
}
