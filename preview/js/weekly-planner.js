import { timing } from '../../js/coming-core.js?v=20261026-coming';
import { taskKey } from '../../js/recurrence.js?v=20261026-datefix';
import { attachTaskDrag } from '../../js/task-drag.js?v=20261026-longpress';
import { createMoveEditor } from '../../js/move-editor.js?v=20261026-datefix';
import { addDays, calendarDate, dateKey, monday, validDate } from '../../js/dates.js?v=20261026-datefix';

export function createWeeklyPlanner({ root, editor, projects, getTasks, isSignedIn, save, remove, complete, signIn, isReady = () => false, move = async () => {}, restore = async () => {}, getMeal = () => null, onWeekChange = () => {}, mealNotice = () => '', getEvents = () => [], editEvent = () => {}, getIdeas = () => [], scheduleIdea = () => {}, comingNotice = () => '', openPersonalTask = () => {}, taskMeta = () => null, setReminder = () => {}, wellbeingRepository = null }) {
  const $ = selector => root.querySelector(selector);
  const form = editor.querySelector('form');
  const field = name => form.elements.namedItem(name);
  const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday:'long' });
  const dateFormat = new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short' });
  let start = monday(), editingTask = null, returnFocus = null, submitting = false;
  const mover = createMoveEditor({ editor:document.getElementById('moveEditor'), getTasks, move });
  $('#includeSkipped').addEventListener('change', render);
  projects.forEach(project => field('project').add(new Option(project.name, project.value)));

  function openEditor(task = null, date = dateKey(new Date())) {
    if (!isSignedIn()) { signIn(); return; }
    if(task&&!task.routine_id&&task.project===null){openPersonalTask(task);return;}
    editingTask = task;
    editor.querySelector('[data-set-reminder]').checked=false;
    returnFocus = document.activeElement;
    editor.querySelector('h2').textContent = task ? 'Edit task' : 'A little plan';
    field('task').value = task?.task ?? '';
    // Preserve any legacy project values when editing existing tasks.
    if (task && ![...field('project').options].some(option => option.value === task.project)) {
      field('project').add(new Option(task.project, task.project));
    }
    field('project').value = task?.project ?? 'Other';
    field('date').value = task ? (task.scheduled_date || '') : date;
    editor.querySelector('[data-delete]').hidden = !task;
    editor.querySelector('[data-delete]').textContent = task?.routine_id ? 'Skip this occurrence' : 'Delete task';
    field('date').required = !!task?.routine_id;
    editor.querySelector('.editor-hint').textContent = task?.routine_id ? 'Changes apply to this occurrence only. Use Manage routines to change the repeat schedule.' : 'Clear the date to keep this task in its project list without scheduling it.';
    editor.querySelector('[data-move]').hidden = !task?.scheduled_date || !isReady();
    editor.querySelector('[role="alert"]').textContent = '';
    editor.showModal();
    field('task').focus();
  }
  function closeEditor() {
    editor.close();
    if (returnFocus?.isConnected) returnFocus.focus();
    else if (!root.hidden) $('#weekHeading').focus();
    else document.getElementById('taskHeading').focus();
  }
  async function submit(operation, remind = false) {
    if (submitting) return;
    submitting = true;
    editor.querySelectorAll('button,input,select').forEach(el => el.disabled = true);
    editor.querySelector('[role="alert"]').textContent = '';
    try { const saved=await operation(); closeEditor(); if(remind)await setReminder(saved||editingTask); }
    catch (error) { editor.querySelector('[role="alert"]').textContent = error.message || 'Please try again.'; }
    finally { submitting = false; editor.querySelectorAll('button,input,select').forEach(el => el.disabled = false); }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    const task = field('task').value.trim(), scheduled_date = field('date').value || null;
    if (!task) { field('task').setCustomValidity('Please enter a task.'); field('task').reportValidity(); return; }
    if (scheduled_date && !validDate(scheduled_date)) return;
    const values = { task, project:field('project').value, scheduled_date };
    submit(() => save(editingTask, values),editor.querySelector('[data-set-reminder]').checked);
  });
  field('task').addEventListener('input', () => field('task').setCustomValidity(''));
  editor.querySelector('[data-cancel]').addEventListener('click', closeEditor);
  editor.addEventListener('cancel', event => { event.preventDefault(); if (!submitting) closeEditor(); });
  editor.querySelector('[data-delete]').addEventListener('click', () => {
    if (confirm(editingTask?.routine_id ? 'Skip this occurrence only?' : 'Are you sure you want to delete this task?')) submit(() => remove(editingTask));
  });
  editor.querySelector('[data-move]').addEventListener('click', () => { closeEditor(); mover.open(editingTask); });
  $('#previousWeek').addEventListener('click', () => { start = addDays(start, -7); render(); });
  $('#nextWeek').addEventListener('click', () => { start = addDays(start, 7); render(); });
  $('#currentWeek').addEventListener('click', () => { start = monday(); render(); });
  $('#weekSignIn').addEventListener('click', signIn);
  $('#weekIdeaSchedule').addEventListener('click',()=>{
    const today=dateKey(new Date()),end=dateKey(addDays(start,6));
    scheduleIdea($('#weekIdeaChoice').value,today>=dateKey(start)&&today<=end?today:dateKey(start));
  });

  // Account-synced check-ins; never fall back to local-only saving.
  let checkins={},loadedWeek='',loadingWeek='',wellbeingError='';
  const readCheckins = () => checkins;
  async function loadWellbeing(week,force=false) {
    if(!wellbeingRepository || !isSignedIn()) {checkins={};loadedWeek='';return;}
    if(!force && (loadedWeek===week || loadingWeek===week))return;
    loadingWeek=week;
    try {
      const records=await wellbeingRepository.list(week,dateKey(addDays(calendarDate(week),6)));
      if(loadingWeek!==week)return;
      checkins=Object.fromEntries(records.map(row=>[row.checkin_date,{
        mood:row.mood==null?'':String(row.mood),energy:row.energy==null?'':String(row.energy),
        rested:row.rested==null?'':String(row.rested),
        hours:row.sleep_minutes==null?'':String(Math.floor(row.sleep_minutes/60)),
        minutes:row.sleep_minutes==null?'':String(row.sleep_minutes%60),
        notes:row.notes||''
      }]));
      loadedWeek=week;wellbeingError='';render();
    }catch(error){wellbeingError=error.message||'Could not load check-ins';}
    finally {if(loadingWeek===week)loadingWeek='';}
  }
  function openCheckin(key) {
    if(!isSignedIn()) {signIn();return;}
    const previous = readCheckins()[key] || {};
    const dialog = document.createElement('dialog'); dialog.className = 'wellbeing-dialog';
    const form = document.createElement('form'); form.method = 'dialog'; form.className = 'wellbeing-form';
    const title = document.createElement('h2'); title.textContent = 'Daily wellbeing check-in';
    const subtitle = document.createElement('p'); subtitle.textContent = key + ' · A gentle moment for yourself';
    form.append(title,subtitle);
    // Small custom botanical illustrations, rendered as SVG rather than emoji.
    const botanical = (kind, level) => {
      const stem = '<path d="M24 40 Q24 27 24 13" />';
      const leaf = (x,y,flip=1) => '<path d="M24 '+y+' Q'+(24+flip*12)+' '+(y-13)+' '+(24+flip*15)+' '+(y-3)+' Q'+(24+flip*8)+' '+(y+4)+' 24 '+y+'Z" />';
      const leaves = Array.from({length:Math.max(0,level-1)},(_,i)=>leaf(24,34-i*6,i%2?1:-1)).join('');
      const petals = Array.from({length:level===5?6:5},(_,i)=>'<ellipse cx="24" cy="10" rx="3.5" ry="7" transform="rotate('+(i*(360/(level===5?6:5)))+' 24 17)" />').join('');
      let drawing='';
      if(kind==='energy')drawing=stem+leaves+(level===1?'<path d="M20 37 Q24 32 28 37" />':'');
      if(kind==='mood')drawing=level===1?'<path d="M24 40 Q22 27 27 20 M27 20 Q11 14 14 29 Q24 30 27 20Z" />':
        level===2?stem+leaf(24,28,-1):level===3?stem+leaf(24,31,-1)+leaf(24,25,1):
        stem+leaf(24,30,-1)+(level===5?petals:'<path d="M24 17 Q13 11 17 21 Q24 24 24 17 Q31 11 33 21 Q24 24 24 17Z" />');
      if(kind==='rested') {
        const moon='<path d="M28 7 A15 15 0 1 0 39 32 A14 14 0 0 1 28 7Z" />';
        const star='<path d="M37 8v8m-4-4h8" />';
        const sun='<circle cx="24" cy="22" r="8" /><path d="M24 5v7m0 20v7M7 22h7m20 0h7M12 10l5 5m14 14 5 5m0-24-5 5M17 29l-5 5" />';
        drawing=level===5?sun:level===4?moon+star:level===3?'<path d="M10 31 Q5 22 17 20 Q19 10 29 16 Q40 14 40 27 Q39 34 31 34H17Q10 34 10 31Z" />':moon+(level===2?'<path d="M35 34l3-3m-3 0 3 3" />':'');
      }
      return '<svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">'+drawing+'</svg>';
    };
    const groups = [
      {name:'mood',label:'How are you feeling?',names:['Low','Flat','Okay','Good','Great']},
      {name:'energy',label:'How is your energy?',names:['Very low','Low','Okay','Good','High']},
      {name:'rested',label:'How rested do you feel?',names:['Exhausted','Tired','Okay','Rested','Refreshed']}
    ];
    for (const group of groups) {
      const fieldset=document.createElement('fieldset');const legend=document.createElement('legend');legend.textContent=group.label;fieldset.append(legend);
      const choices=document.createElement('div');choices.className='wellbeing-choices';
      group.names.forEach((name,i)=>{const label=document.createElement('label');label.className='wellbeing-choice';
        const radio=document.createElement('input');radio.type='radio';radio.name=group.name;radio.value=String(i+1);radio.checked=Number(previous[group.name])===i+1;
        const symbol=document.createElement('span');symbol.className='wellbeing-symbol';symbol.innerHTML=botanical(group.name,i+1);
        const text=document.createElement('small');text.textContent=name;label.append(radio,symbol,text);choices.append(label);
      });fieldset.append(choices);form.append(fieldset);
    }
    const sleep=document.createElement('fieldset');const sleepLegend=document.createElement('legend');sleepLegend.textContent='How long did you sleep?';sleep.append(sleepLegend);
    const sleepRow=document.createElement('div');sleepRow.className='wellbeing-sleep';
    for (const [name,max,step,label] of [['hours',24,1,'hours'],['minutes',59,5,'minutes']]) {
      const wrap=document.createElement('label');wrap.textContent=label;const input=document.createElement('input');input.type='number';input.name=name;input.min='0';input.max=String(max);input.step=String(step);input.placeholder=name==='hours'?'7':'30';input.value=previous[name]??'';wrap.prepend(input);sleepRow.append(wrap);
    }sleep.append(sleepRow);form.append(sleep);
    const notesLabel=document.createElement('label');notesLabel.className='wellbeing-notes-label';notesLabel.textContent='Notes (optional)';
    const notes=document.createElement('textarea');notes.name='notes';notes.rows=2;notes.placeholder='Anything you would like to remember…';notes.value=previous.notes||'';notesLabel.append(notes);form.append(notesLabel);
    const notice=document.createElement('p');notice.className='wellbeing-local-notice';notice.textContent='Your check-in will be saved to your private account.';form.append(notice);
    const actions=document.createElement('div');actions.className='wellbeing-actions';
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.addEventListener('click',()=>dialog.close());
    const saveButton=document.createElement('button');saveButton.type='submit';saveButton.textContent='Save check-in';actions.append(cancel,saveButton);form.append(actions);
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      const data=new FormData(form),entry={};for(const [name,value] of data.entries())entry[name]=value;
      if(!Object.keys(entry).some(k=>entry[k]!=='')){notice.textContent='Choose at least one answer before saving.';return;}
      const hours=entry.hours===''?null:Number(entry.hours),minutes=entry.minutes===''?null:Number(entry.minutes);
      const sleepMinutes=hours===null&&minutes===null?null:(hours||0)*60+(minutes||0);
      if(sleepMinutes!==null&&(sleepMinutes<0||sleepMinutes>1440)){notice.textContent='Please enter a sleep duration of up to 24 hours.';return;}
      saveButton.disabled=true;saveButton.textContent='Saving…';
      try {
        if(!wellbeingRepository)throw Error('Wellbeing storage is not available.');
        await wellbeingRepository.save(key,{mood:entry.mood?Number(entry.mood):null,energy:entry.energy?Number(entry.energy):null,
          rested:entry.rested?Number(entry.rested):null,sleep_minutes:sleepMinutes,notes:entry.notes||''});
        checkins[key]=entry;dialog.close();render();
      }catch(error){notice.textContent='Could not save: '+(error.message||'Please try again.');}
      finally{saveButton.disabled=false;saveButton.textContent='Save check-in';}
    });
    dialog.addEventListener('close',()=>dialog.remove());dialog.append(form);document.body.append(dialog);dialog.showModal();
  }
  // Preview-only weekly wellbeing dashboard; uses the same account-synced records as the hearts.
  function renderWellbeingDashboard(week, signedIn) {
    let panel = root.querySelector('#wellbeingOverview');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'wellbeingOverview';
      panel.setAttribute('aria-label', 'Weekly wellbeing overview');
      panel.style.cssText = 'margin:18px 0;padding:16px;border:1px solid #d8dfd0;border-radius:17px;background:#f7f4eb;color:#304638';
      $('#weekDays').before(panel);
    }
    panel.replaceChildren();
    const heading = document.createElement('h3');
    heading.textContent = 'Your wellbeing this week';
    heading.style.cssText = 'font:normal 22px Georgia,serif;margin:0 0 5px';
    panel.append(heading);
    const message = document.createElement('p');
    message.style.cssText = 'font-size:12px;color:#657465;margin:0 0 12px';
    if (!signedIn) message.textContent = 'Sign in to see your check-ins.';
    else if (loadedWeek !== week) message.textContent = wellbeingError || 'Loading your check-ins…';
    else message.textContent = Object.keys(checkins).length + ' of 7 days logged · Tap a day to view or edit';
    panel.append(message);
    if (!signedIn || loadedWeek !== week) return;
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px';
    const names = ['M','T','W','T','F','S','S'];
    for (let i=0;i<7;i++) {
      const key=dateKey(addDays(calendarDate(week),i)), entry=checkins[key];
      const button=document.createElement('button');
      button.type='button';
      button.style.cssText='min-width:0;padding:9px 2px;border:1px solid #cbd7c7;border-radius:10px;background:'+(entry?'#e0eadb':'#f1eee6')+';color:#304638;text-align:center';
      const day=document.createElement('strong');day.textContent=names[i];day.style.cssText='display:block;font-size:12px';
      const status=document.createElement('span');status.textContent=entry?'♥':'○';status.style.cssText='display:block;font-size:19px;margin:5px 0;color:#547459';
      const details=document.createElement('small');details.style.cssText='display:block;font-size:10px;line-height:1.5';
      details.textContent=entry?('Mood '+(entry.mood||'–')+'\nEnergy '+(entry.energy||'–')):'—';
      details.style.whiteSpace='pre-line';
      button.append(day,status,details);
      button.setAttribute('aria-label',key+(entry?' saved check-in':' no check-in'));
      button.addEventListener('click',()=>openCheckin(key));
      grid.append(button);
    }
    panel.append(grid);
    const sleep = Object.values(checkins).map(x=>Number(x.hours||0)*60+Number(x.minutes||0)).filter((v,i)=>v>0);
    if(sleep.length) {
      const summary=document.createElement('p');
      summary.style.cssText='font-size:12px;margin:12px 0 0;color:#526b55';
      summary.textContent='Average logged sleep: '+(sleep.reduce((a,b)=>a+b,0)/sleep.length/60).toFixed(1)+' hours';
      panel.append(summary);
    }
  }
  const expandedPastDays = new Set();
  const manuallyCollapsedDays = new Set();
  function render() {
    const end = addDays(start, 6), today = dateKey(new Date()), signedIn = isSignedIn();
    if(signedIn)void loadWellbeing(dateKey(start));else {checkins={};loadedWeek='';}
    $('#weekRange').textContent = `${dateFormat.format(start)} – ${dateFormat.format(end)} ${end.getFullYear()}`;
    if (start.getFullYear() !== end.getFullYear()) $('#weekRange').textContent = `${dateFormat.format(start)} ${start.getFullYear()} – ${dateFormat.format(end)} ${end.getFullYear()}`;
    $('#weekSignIn').hidden = signedIn;
    const tasks = signedIn ? getTasks(dateKey(start), dateKey(end)) : [];
    const visible = tasks.filter(task => !task.skipped && task.scheduled_date >= dateKey(start) && task.scheduled_date <= dateKey(end));
    $('#weekProgress').textContent = signedIn ? `${visible.filter(task => task.completed).length} of ${visible.length} complete` : 'Sign in to see and plan your week.';
    $('#extrasNotice').hidden = !signedIn || isReady();
    $('#skippedControl').hidden = !tasks.some(task => task.skipped);
    const notice = mealNotice(dateKey(start));
    $('#weekMealsNotice').textContent = notice; $('#weekMealsNotice').hidden = !notice;
    const coming=comingNotice();$('#weekComingNotice').textContent=coming;$('#weekComingNotice').hidden=!coming;
    const ideas=signedIn?getIdeas():[],choice=$('#weekIdeaChoice'),previous=choice.value;
    choice.replaceChildren();for(const idea of ideas)choice.add(new Option((idea.kind==='event'?'Event · ':'To-do · ')+idea.title,idea.id));
    if(ideas.some(i=>i.id===previous))choice.value=previous;
    $('#weekSomedayCount').textContent=String(ideas.length);$('#weekSomedayPicker').hidden=!ideas.length;
    $('#weekSomedayEmpty').hidden=!!ideas.length;$('#weekIdeaSchedule').disabled=!signedIn||!ideas.length||!!coming;
    renderWellbeingDashboard(dateKey(start),signedIn);
    $('#weekDays').replaceChildren();
    for (let offset = 0; offset < 7; offset++) {
      const date = addDays(start, offset), key = dateKey(date);
      const day = document.createElement('section'); day.className = 'week-day'; day.dataset.date = key;
      if (key === today) day.classList.add('is-today');
      const heading = document.createElement('h3'); heading.id = `day-${key}`;
      const time = document.createElement('time'); time.dateTime = key;
      const dayName = document.createElement('span'); dayName.textContent = dayFormat.format(date);
      const dayDate = document.createElement('small'); dayDate.textContent = dateFormat.format(date) + (key === today ? ' · Today' : '');
      time.append(dayName, dayDate); heading.append(time);
      const wellbeingButton=document.createElement('button');wellbeingButton.type='button';wellbeingButton.className='wellbeing-day-button';
      const logged=!!readCheckins()[key];
      const heart=document.createElementNS('http://www.w3.org/2000/svg','svg');
      heart.setAttribute('viewBox','0 0 24 24');heart.setAttribute('width','12');heart.setAttribute('height','12');
      heart.setAttribute('fill',logged?'currentColor':'none');heart.setAttribute('stroke','currentColor');heart.setAttribute('stroke-width','1.65');
      heart.setAttribute('stroke-linecap','round');heart.setAttribute('stroke-linejoin','round');heart.setAttribute('aria-hidden','true');
      const heartPath=document.createElementNS('http://www.w3.org/2000/svg','path');
      heartPath.setAttribute('d','M20.4 5.9c-2.1-2.3-5.4-1.9-8.4 1.1-3-3-6.3-3.4-8.4-1.1-2.4 2.7-1.3 6.3 1.1 8.8 2.1 2.3 4.6 4.3 7.3 6.1 2.7-1.8 5.2-3.8 7.3-6.1 2.4-2.5 3.5-6.1 1.1-8.8z');
      heart.append(heartPath);wellbeingButton.append(heart,document.createTextNode(logged?'Logged':'Check in'));
      wellbeingButton.setAttribute('aria-label',(logged?'Edit wellbeing check-in for ':'Open wellbeing check-in for ')+key);
      wellbeingButton.addEventListener('click',()=>openCheckin(key));heading.append(wellbeingButton);
      day.setAttribute('aria-labelledby', heading.id);
      const content = document.createElement('div'); content.className = 'day-content';
      const meal = signedIn ? getMeal(key) : null;
      if (meal?.lunch || meal?.dinner) {
        const summary = document.createElement('dl'); summary.className = 'day-meals'; summary.setAttribute('aria-label', 'Planned meals');
        for (const field of ['lunch','dinner']) {
          if (!meal[field]) continue;
          const line = document.createElement('div'), title = document.createElement('dt'), value = document.createElement('dd');
          const icon = document.createElement('span'); icon.className = 'meal-symbol'; icon.setAttribute('aria-hidden','true'); icon.textContent = field === 'lunch' ? '☼' : '☾';
          title.append(icon, document.createTextNode(field === 'lunch' ? 'Lunch' : 'Dinner')); value.textContent = meal[field];
          line.append(title,value); summary.append(line);
        }
        content.append(summary);
      }
      const events=signedIn?getEvents(key):[];
      if(events.length){
        const title=document.createElement('h4');title.className='day-events-heading';title.textContent='Events & Appointments';content.append(title);
        const list=document.createElement('ul');list.className='day-events';list.setAttribute('aria-label',dayFormat.format(date)+' events and appointments');
        for(const event of events){const row=document.createElement('li'),button=document.createElement('button');button.type='button';button.className='week-event';button.setAttribute('aria-label','Edit event '+event.title);
          const name=document.createElement('strong');name.textContent=event.title;const time=document.createElement('small');time.textContent=timing(event,key);
          button.append(name,time);button.addEventListener('click',()=>editEvent(event));row.append(button);list.append(row);
        }
        content.append(list);
      }
      const list = document.createElement('ul'); list.className = 'day-tasks'; list.setAttribute('aria-label', `${dayFormat.format(date)} tasks`);
      tasks.filter(task => task.scheduled_date === key && (!task.skipped || $('#includeSkipped').checked)).sort((a,b)=>Number(!!a.completed)-Number(!!b.completed)).forEach(task => {
        const row = document.createElement('li'); row.className = 'week-task' + (task.completed ? ' done' : ''); row.dataset.taskId = task.id; row.dataset.itemKey = taskKey(task);
        if (task.skipped) {
          row.classList.add('is-skipped');
          const copy = document.createElement('span'); copy.textContent = `Skipped · ${task.task}`;
          const undo = document.createElement('button'); undo.type = 'button'; undo.className = 'week-edit'; undo.textContent = 'Undo';
          undo.addEventListener('click', async () => { undo.disabled = true; try { await restore(task); } catch {} finally { undo.disabled = false; } });
          row.append(copy, undo); list.append(row); return;
        }
        const handle = document.createElement('button'); handle.type = 'button'; handle.className = 'drag-handle'; handle.textContent = '⠿';
        handle.setAttribute('aria-label', `Move or reorder ${task.task}`); handle.title = 'Hold the task to drag, or tap here for Move / reorder';
        if (isReady()) { row.append(handle); attachTaskDrag(handle, row, task, move, mover.open); }
        const checkLabel = document.createElement('div'); checkLabel.className = 'week-check';
        const check = document.createElement('input'); check.type = 'checkbox'; check.checked = !!task.completed;
        check.setAttribute('aria-label', `Mark ${task.task} ${task.completed ? 'incomplete' : 'complete'}`);
        const name = document.createElement('span'); name.textContent = task.task;
        checkLabel.append(check, name); name.tabIndex=0; name.setAttribute('role','button'); name.setAttribute('aria-label','Edit '+task.task); name.addEventListener('click',()=>openEditor(task)); name.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openEditor(task);}});
        const personal=task.project===null?taskMeta(task):null;if(personal?.start_time){const time=document.createElement('small');time.className='week-personal-time';time.textContent=personal.start_time.slice(0,5);checkLabel.append(time);}
        if (task.routine_id) { const repeat = document.createElement('small'); repeat.className = 'repeat-icon'; repeat.textContent = '↻'; repeat.setAttribute('aria-label', 'Recurring task'); repeat.title = 'Recurring task'; checkLabel.append(repeat); }
        const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'week-edit'; edit.textContent = 'Edit'; edit.setAttribute('aria-label', `Edit ${task.task}`);
        edit.addEventListener('click', () => openEditor(task));
        check.addEventListener('change', async () => {
          check.disabled = true; edit.disabled = true;
          try {
            await complete(task, check.checked);
            root.querySelector(`[data-task-id="${task.id}"] input`)?.focus({ preventScroll:true });
          }
          catch { check.checked = !!task.completed; }
          finally { check.disabled = false; edit.disabled = false; }
        });
        row.append(checkLabel); list.append(row);
      });
      if (!list.children.length) { const empty = document.createElement('p'); empty.className = 'day-empty'; empty.textContent = signedIn ? 'A little breathing room' : 'Your plans go here'; content.append(empty); }
      const add = document.createElement('button'); add.type = 'button'; add.className = 'day-add'; add.textContent = '+';
      add.setAttribute('aria-label', `Add task for ${dayFormat.format(date)} ${dateFormat.format(date)}`); add.disabled = !signedIn;
      add.addEventListener('click', () => openEditor(null, key));
      content.append(list); day.append(heading, content, add);
      // Past days in the current week collapse by default; manually opened days stay open.
      const currentWeek = true;
      if (signedIn) {
        const dayTasks = visible.filter(task => task.scheduled_date === key);
        const doneCount = dayTasks.filter(task => task.completed).length;
        const toggle = document.createElement('button');
        toggle.type = 'button'; toggle.className = 'week-day-toggle';
        const summary = document.createElement('span'); summary.className = 'week-day-summary';
        summary.textContent = dayTasks.length ? doneCount + '/' + dayTasks.length + ' tasks complete' : 'No tasks';
        const chevron = document.createElement('span'); chevron.className = 'week-day-chevron'; chevron.setAttribute('aria-hidden', 'true');
        const expanded = !manuallyCollapsedDays.has(key) && (key >= today || expandedPastDays.has(key));
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.setAttribute('aria-controls', 'day-content-' + key);
        toggle.setAttribute('aria-label', (expanded ? 'Collapse ' : 'Expand ') + dayFormat.format(date) + ', ' + dateFormat.format(date));
        toggle.append(summary, chevron);
        content.id = 'day-content-' + key;
        day.classList.add('is-past-day');
        // Apply the collapsed layout directly, independently of cached stylesheets.
        const applyCollapsed = (collapsed) => {
          day.classList.toggle('is-collapsed', collapsed);
          day.style.gridTemplateColumns = collapsed ? '77px minmax(0, 1fr)' : '';
          day.style.gridTemplateRows = collapsed ? 'auto' : '';
          day.style.minHeight = collapsed ? '54px' : '';
          day.style.alignItems = collapsed ? 'center' : '';
          content.hidden = collapsed;
          content.style.display = collapsed ? 'none' : '';
          add.hidden = collapsed;
          add.style.display = collapsed ? 'none' : '';
          heading.style.gridColumn = collapsed ? '1' : '';
          heading.style.gridRow = collapsed ? '1' : '';
          toggle.style.gridColumn = '2';
          toggle.style.gridRow = '1';
          toggle.style.minWidth = '0';
          toggle.style.width = '100%';
          toggle.style.minHeight = '44px';
          toggle.style.border = '0';
          toggle.style.borderRadius = '0';
          toggle.style.boxShadow = 'none';
          toggle.style.background = 'transparent';
          toggle.style.color = '#526650';
          toggle.style.fontSize = '12px';
          toggle.style.textAlign = 'right';
          toggle.style.padding = '0';
          toggle.style.justifyContent = 'flex-end';
          if (!collapsed) {
            content.style.gridColumn = '2';
            content.style.gridRow = '2';
            add.style.gridColumn = '3';
            add.style.gridRow = '1';
          } else {
            content.style.gridColumn = '';
            content.style.gridRow = '';
            add.style.gridColumn = '';
            add.style.gridRow = '';
          }
          toggle.setAttribute('aria-expanded', String(!collapsed));
          toggle.setAttribute('aria-label', (collapsed ? 'Expand ' : 'Collapse ') + dayFormat.format(date) + ', ' + dateFormat.format(date));
        };
        toggle.addEventListener('click', () => {
          const collapsed = !day.classList.contains('is-collapsed');
          applyCollapsed(collapsed);
          if (collapsed) { expandedPastDays.delete(key); manuallyCollapsedDays.add(key); } else { expandedPastDays.add(key); manuallyCollapsedDays.delete(key); }
        });
        applyCollapsed(!expanded);
        day.insertBefore(toggle, heading.nextSibling);
      }
      $('#weekDays').append(day);
    }
    onWeekChange(dateKey(start));
  }
  return { render, openEditor, getWeek:() => dateKey(start), setWeek:week => { if (validDate(week)) { start = monday(calendarDate(week)); render(); } }, reset() { start = monday(); if (editor.open) closeEditor(); mover.reset(); render(); } };
}
