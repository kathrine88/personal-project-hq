import { validDate } from './dates.js';
import { taskKey } from './recurrence.js';
export function createMoveEditor({ editor, getTasks, move }) {
  const form = editor.querySelector('form'), day = form.elements.namedItem('day'), before = form.elements.namedItem('before');
  let current = null, busy = false, source = null;
  const error = editor.querySelector('[role=alert]');
  function options() {
    before.replaceChildren(new Option('At the end', ''));
    if (!validDate(day.value)) return;
    getTasks(day.value, day.value).filter(task => !task.skipped && taskKey(task) !== taskKey(current)).forEach(task => before.add(new Option(`Before ${task.task}`, taskKey(task))));
  }
  function close() { editor.close(); if (source?.isConnected) source.focus(); else document.getElementById('weekHeading').focus(); }
  day.addEventListener('change', options);
  editor.querySelector('[data-cancel]').addEventListener('click', close);
  editor.addEventListener('cancel', event => { event.preventDefault(); if (!busy) close(); });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !validDate(day.value)) return;
    const date = day.value, key = before.value || null;
    busy = true; error.textContent = ''; editor.querySelectorAll('input,select,button').forEach(el => el.disabled = true);
    try { await move(current, date, key); close(); }
    catch (e) { error.textContent = e.message || 'Please try again.'; }
    finally { busy = false; editor.querySelectorAll('input,select,button').forEach(el => el.disabled = false); }
  });
  return {
    open(task) {
      current = task; source = document.activeElement; day.value = task.scheduled_date; options(); error.textContent = '';
      editor.querySelector('[data-task-name]').textContent = task.task; editor.showModal(); day.focus();
    },
    reset() { if (editor.open) close(); }
  };
}
