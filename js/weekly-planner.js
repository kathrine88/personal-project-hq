import { timing } from './coming-core.js?v=20261026-coming';
import { taskKey } from './recurrence.js?v=20261026-datefix';
import { attachTaskDrag } from './task-drag.js?v=20261026-longpress';
import { createMoveEditor } from './move-editor.js?v=20261026-datefix';
import { addDays, calendarDate, dateKey, monday, validDate } from './dates.js?v=20261026-datefix';

export function createWeeklyPlanner({ root, editor, projects, getTasks, isSignedIn, save, remove, complete, signIn, isReady = () => false, move = async () => {}, restore = async () => {}, getMeal = () => null, onWeekChange = () => {}, mealNotice = () => '', getEvents = () => [], editEvent = () => {}, getIdeas = () => [], scheduleIdea = () => {}, comingNotice = () => '', openPersonalTask = () => {}, taskMeta = () => null, setReminder = () => {} }) {
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

  const expandedPastDays = new Set();
  const manuallyCollapsedDays = new Set();
  function render() {
    const end = addDays(start, 6), today = dateKey(new Date()), signedIn = isSignedIn();
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
    $('#weekDays').replaceChildren();
    for (let offset = 0; offset < 7; offset++) {
      const date = addDays(start, offset), key = dateKey(date);
      const day = document.createElement('section'); day.className = 'week-day'; day.dataset.date = key;
      if (key === today) day.classList.add('is-today');
      const heading = document.createElement('h3'); heading.id = `day-${key}`;
      const time = document.createElement('time'); time.dateTime = key;
      const dayName = document.createElement('span'); dayName.textContent = dayFormat.format(date);
      const dayDate = document.createElement('small'); dayDate.textContent = dateFormat.format(date) + (key === today ? ' · Today' : '');
      time.append(dayName, dayDate); heading.append(time); day.setAttribute('aria-labelledby', heading.id);
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
