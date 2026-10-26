import { addDays, dateKey, monday, validDate } from './dates.js';

export function createWeeklyPlanner({ root, editor, projects, getTasks, isSignedIn, save, remove, complete, signIn }) {
  const $ = selector => root.querySelector(selector);
  const form = editor.querySelector('form');
  const field = name => form.elements.namedItem(name);
  const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday:'long' });
  const dateFormat = new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short' });
  let start = monday(), editingId = null, returnFocus = null, submitting = false;
  projects.forEach(project => field('project').add(new Option(project.name, project.value)));

  function openEditor(task = null, date = dateKey(new Date())) {
    if (!isSignedIn()) { signIn(); return; }
    editingId = task?.id ?? null;
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
  async function submit(operation) {
    if (submitting) return;
    submitting = true;
    editor.querySelectorAll('button,input,select').forEach(el => el.disabled = true);
    editor.querySelector('[role="alert"]').textContent = '';
    try { await operation(); closeEditor(); }
    catch (error) { editor.querySelector('[role="alert"]').textContent = error.message || 'Please try again.'; }
    finally { submitting = false; editor.querySelectorAll('button,input,select').forEach(el => el.disabled = false); }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    const task = field('task').value.trim(), scheduled_date = field('date').value || null;
    if (!task) { field('task').setCustomValidity('Please enter a task.'); field('task').reportValidity(); return; }
    if (scheduled_date && !validDate(scheduled_date)) return;
    const values = { task, project:field('project').value, scheduled_date };
    submit(() => save(editingId, values));
  });
  field('task').addEventListener('input', () => field('task').setCustomValidity(''));
  editor.querySelector('[data-cancel]').addEventListener('click', closeEditor);
  editor.addEventListener('cancel', event => { event.preventDefault(); if (!submitting) closeEditor(); });
  editor.querySelector('[data-delete]').addEventListener('click', () => {
    if (confirm('Are you sure you want to delete this task?')) submit(() => remove(editingId));
  });
  $('#previousWeek').addEventListener('click', () => { start = addDays(start, -7); render(); });
  $('#nextWeek').addEventListener('click', () => { start = addDays(start, 7); render(); });
  $('#currentWeek').addEventListener('click', () => { start = monday(); render(); });
  $('#weekSignIn').addEventListener('click', signIn);

  function render() {
    const end = addDays(start, 6), today = dateKey(new Date()), signedIn = isSignedIn();
    $('#weekRange').textContent = `${dateFormat.format(start)} – ${dateFormat.format(end)} ${end.getFullYear()}`;
    if (start.getFullYear() !== end.getFullYear()) $('#weekRange').textContent = `${dateFormat.format(start)} ${start.getFullYear()} – ${dateFormat.format(end)} ${end.getFullYear()}`;
    $('#weekSignIn').hidden = signedIn;
    const tasks = signedIn ? getTasks() : [];
    const visible = tasks.filter(task => task.scheduled_date >= dateKey(start) && task.scheduled_date <= dateKey(end));
    $('#weekProgress').textContent = signedIn ? `${visible.filter(task => task.completed).length} of ${visible.length} complete` : 'Sign in to see and plan your week.';
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
      const list = document.createElement('ul'); list.className = 'day-tasks'; list.setAttribute('aria-label', `${dayFormat.format(date)} tasks`);
      tasks.filter(task => task.scheduled_date === key).forEach(task => {
        const row = document.createElement('li'); row.className = 'week-task' + (task.completed ? ' done' : ''); row.dataset.taskId = task.id;
        const checkLabel = document.createElement('label'); checkLabel.className = 'week-check';
        const check = document.createElement('input'); check.type = 'checkbox'; check.checked = !!task.completed;
        check.setAttribute('aria-label', `Mark ${task.task} ${task.completed ? 'incomplete' : 'complete'}`);
        const name = document.createElement('span'); name.textContent = task.task;
        checkLabel.append(check, name);
        const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'week-edit'; edit.textContent = 'Edit'; edit.setAttribute('aria-label', `Edit ${task.task}`);
        edit.addEventListener('click', () => openEditor(task));
        check.addEventListener('change', async () => {
          check.disabled = true; edit.disabled = true;
          try {
            await complete(task.id, check.checked);
            root.querySelector(`[data-task-id="${task.id}"] input`)?.focus({ preventScroll:true });
          }
          catch { check.checked = !!task.completed; }
          finally { check.disabled = false; edit.disabled = false; }
        });
        row.append(checkLabel, edit); list.append(row);
      });
      if (!list.children.length) { const empty = document.createElement('p'); empty.className = 'day-empty'; empty.textContent = signedIn ? 'A little breathing room' : 'Your plans go here'; content.append(empty); }
      const add = document.createElement('button'); add.type = 'button'; add.className = 'day-add'; add.textContent = '+';
      add.setAttribute('aria-label', `Add task for ${dayFormat.format(date)} ${dateFormat.format(date)}`); add.disabled = !signedIn;
      add.addEventListener('click', () => openEditor(null, key));
      content.append(list); day.append(heading, content, add); $('#weekDays').append(day);
    }
  }
  return { render, openEditor, reset() { start = monday(); if (editor.open) closeEditor(); render(); } };
}
