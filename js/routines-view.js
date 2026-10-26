import { calendarDate, dateKey, validDate } from './dates.js';
const dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
export function createRoutinesView({ root, editor, projects, getRoutines, isSignedIn, isReady, save, remove, signIn }) {
  const formatDate = value => new Intl.DateTimeFormat('en-GB', {day:'numeric',month:'short',year:'numeric'}).format(calendarDate(value));
  const form = editor.querySelector('form'), field = name => form.elements.namedItem(name);
  let id = null, busy = false;
  const error = editor.querySelector('[role=alert]');
  projects.forEach(p => field('project').add(new Option(p.name, p.value)));
  dayNames.forEach((day, i) => {
    const label = document.createElement('label'), input = document.createElement('input');
    input.type = 'checkbox'; input.name = 'weekday'; input.value = i + 1;
    label.append(input, document.createTextNode(day)); editor.querySelector('[data-weekdays]').append(label);
  });
  function frequencyFields() {
    editor.querySelector('fieldset').hidden = !['weekly','fortnightly'].includes(field('frequency').value);
    editor.querySelector('[data-monthly]').hidden = field('frequency').value !== 'monthly';
  }
  field('frequency').addEventListener('change', frequencyFields);
  function open(routine = null) {
    if (!isSignedIn()) { signIn(); return; }
    if (!isReady()) return;
    id = routine?.id ?? null;
    editor.querySelector('h2').textContent = routine ? 'Edit routine' : 'A little routine';
    field('task').value = routine?.task || '';
    if (routine && ![...field('project').options].some(o => o.value === routine.project)) field('project').add(new Option(routine.project,routine.project));
    field('project').value = routine?.project || 'Other';
    field('frequency').value = routine?.frequency || 'daily';
    field('start').value = routine?.start_date || dateKey(new Date());
    field('end').value = routine?.end_date || '';
    editor.querySelectorAll('[name=weekday]').forEach(input => input.checked = (routine?.weekdays || [new Date().getDay() || 7]).includes(Number(input.value)));
    editor.querySelector('[data-delete-routine]').hidden = !routine;
    error.textContent = ''; frequencyFields(); editor.showModal(); field('task').focus();
  }
  function close() { editor.close(); root.querySelector('h1').focus(); }
  async function submit(operation) {
    if (busy) return;
    busy = true; editor.querySelectorAll('input,select,button').forEach(el => el.disabled = true); error.textContent = '';
    try { await operation(); close(); }
    catch (e) { error.textContent = e.message || 'Please try again.'; }
    finally { busy = false; editor.querySelectorAll('input,select,button').forEach(el => el.disabled = false); }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    const values = { task:field('task').value.trim(), project:field('project').value, frequency:field('frequency').value,
      start_date:field('start').value, end_date:field('end').value || null,
      weekdays:[...editor.querySelectorAll('[name=weekday]:checked')].map(input => Number(input.value)) };
    if (!values.task) { error.textContent = 'Please enter a task.'; return; }
    if (!validDate(values.start_date) || (values.end_date && (!validDate(values.end_date) || values.end_date < values.start_date))) { error.textContent = 'Choose an end date on or after the start date.'; return; }
    if (['weekly','fortnightly'].includes(values.frequency) && !values.weekdays.length) { error.textContent = 'Choose at least one weekday.'; return; }
    submit(() => save(id, values));
  });
  editor.querySelector('[data-cancel]').addEventListener('click', close);
  editor.addEventListener('cancel', event => { event.preventDefault(); if (!busy) close(); });
  editor.querySelector('[data-delete-routine]').addEventListener('click', () => {
    if (confirm('Delete this routine and its unfinished occurrences? Completed occurrences will be kept.')) submit(() => remove(id));
  });
  root.querySelector('[data-add-routine]').addEventListener('click', () => open());
  root.querySelector('[data-sign-in]').addEventListener('click', signIn);
  function render() {
    const signedIn = isSignedIn(), ready = isReady();
    root.querySelector('[data-add-routine]').disabled = !signedIn || !ready;
    root.querySelector('[data-sign-in]').hidden = signedIn;
    root.querySelector('[data-unavailable]').hidden = !signedIn || ready;
    const list = root.querySelector('ul'); list.replaceChildren();
    const routines = signedIn ? getRoutines().filter(r => !r.deleted) : [];
    root.querySelector('[data-empty]').hidden = routines.length > 0 || !signedIn || !ready;
    routines.forEach(routine => {
      const li = document.createElement('li'); li.className = 'routine-row';
      const copy = document.createElement('div'), title = document.createElement('strong'), detail = document.createElement('p');
      title.textContent = routine.task;
      detail.textContent = `${routine.paused ? 'Paused · ' : ''}${routine.frequency[0].toUpperCase() + routine.frequency.slice(1)}${['weekly','fortnightly'].includes(routine.frequency) ? ' · ' + routine.weekdays.map(d => dayNames[d-1]).join(', ') : ''} · From ${formatDate(routine.start_date)}${routine.end_date ? ' to ' + formatDate(routine.end_date) : ''}`;
      copy.append(title, detail);
      const actions = document.createElement('div'); actions.className = 'routine-actions';
      const edit = document.createElement('button'); edit.className = 'week-edit'; edit.textContent = 'Edit'; edit.setAttribute('aria-label', `Edit routine ${routine.task}`); edit.addEventListener('click', () => open(routine));
      const pause = document.createElement('button'); pause.className = 'week-edit'; pause.textContent = routine.paused ? 'Resume' : 'Pause'; pause.setAttribute('aria-label', `${pause.textContent} routine ${routine.task}`);
      pause.addEventListener('click', async () => { pause.disabled = true; try { await save(routine.id, { paused:!routine.paused }); } catch {} finally { pause.disabled = false; } });
      actions.append(edit,pause); li.append(copy,actions); list.append(li);
    });
  }
  return { render, reset() { if (editor.open) close(); render(); } };
}
