import { addDays, calendarDate, dateKey, monday } from './dates.js?v=20261026-datefix';
import { createMealStore } from './meal-store.js?v=20261026-meals';

export function createMealPlanner({ root, repository, isSignedIn, signIn, mealsChanged }) {
  const $ = selector => root.querySelector(selector);
  let start = dateKey(monday());
  const shoppingDrafts = new Map();
  const dateFormat = new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short' });
  const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday:'long' });
  const store = createMealStore(repository, { isSignedIn, changed:key => { if (key === start) render(); }, mealsChanged });
  function navigate(amount) { start = dateKey(addDays(calendarDate(start), amount)); render(); store.load(start); }
  $('#mealPrevious').addEventListener('click', () => navigate(-7));
  $('#mealNext').addEventListener('click', () => navigate(7));
  $('#mealCurrent').addEventListener('click', () => { start = dateKey(monday()); render(); store.load(start); });
  $('#mealSignIn').addEventListener('click', signIn);
  $('#mealRetry').addEventListener('click', () => store.load(start, true));
  $('#mealForm').addEventListener('submit', event => { event.preventDefault(); store.saveMeals(start); });
  $('#shoppingText').addEventListener('input', event => shoppingDrafts.set(start, event.target.value));
  $('#shoppingForm').addEventListener('submit', async event => {
    event.preventDefault(); const week = start, text = $('#shoppingText').value.trim();
    if (!text) { $('#shoppingText').setCustomValidity('Please enter an item.'); $('#shoppingText').reportValidity(); return; }
    if (await store.addItem(week, text)) {
      shoppingDrafts.delete(week);
      if (start === week && isSignedIn()) { $('#shoppingText').value = ''; $('#shoppingText').focus(); }
    }
  });
  $('#shoppingText').addEventListener('input', () => $('#shoppingText').setCustomValidity(''));
  function render() {
    const current = store.state(start), signedIn = isSignedIn();
    const first = calendarDate(start), last = addDays(first, 6);
    $('#mealRange').textContent = first.getFullYear() === last.getFullYear()
      ? `${dateFormat.format(first)} – ${dateFormat.format(last)} ${last.getFullYear()}`
      : `${dateFormat.format(first)} ${first.getFullYear()} – ${dateFormat.format(last)} ${last.getFullYear()}`;
    const disabled = !signedIn || !current.loaded || current.loading || current.saving || current.shoppingBusy;
    root.setAttribute('aria-busy', String(current.loading));
    $('#mealSignIn').hidden = signedIn;
    $('#mealStatus').textContent = !signedIn ? 'Sign in to plan your meals and shopping.' : current.loading ? 'Loading meals and shopping…' : current.status || (current.loaded ? 'Your week is ready.' : '');
    $('#mealError').textContent = signedIn ? current.error : '';
    $('#mealRetry').hidden = !signedIn || !current.error;
    $('#mealSave').disabled = disabled;
    $('#mealSave').textContent = current.saving ? 'Saving meals…' : 'Save meals';
    $('#mealDays').replaceChildren();
    store.rows(start).forEach(row => {
      const section = document.createElement('section'); section.className = 'meal-day'; section.dataset.mealDate = row.meal_date;
      const heading = document.createElement('h2'); heading.id = `meal-${row.meal_date}`;
      const date = calendarDate(row.meal_date);
      heading.textContent = `${dayFormat.format(date)} · ${dateFormat.format(date)}`;
      section.setAttribute('aria-labelledby', heading.id); section.append(heading);
      for (const field of ['lunch','dinner']) {
        const wrap = document.createElement('div'), label = document.createElement('label'), input = document.createElement('input');
        input.id = `${field}-${row.meal_date}`; input.name = input.id; input.type = 'text'; input.autocomplete = 'off'; input.maxLength = 1000;
        input.value = row[field]; input.disabled = disabled;
        label.htmlFor = input.id;
        const icon = document.createElement('span'); icon.className = 'meal-symbol'; icon.setAttribute('aria-hidden','true'); icon.textContent = field === 'lunch' ? '☼' : '☾';
        label.append(icon, document.createTextNode(field === 'lunch' ? 'Lunch' : 'Dinner'));
        input.addEventListener('input', () => {
          store.draft(start, row.meal_date, field, input.value);
          $('#mealStatus').textContent = 'Unsaved meal changes.';
        });
        wrap.append(label,input); section.append(wrap);
      }
      $('#mealDays').append(section);
    });
    $('#shoppingText').disabled = disabled;
    $('#shoppingAdd').disabled = disabled;
    $('#shoppingText').value = shoppingDrafts.get(start) || '';
    $('#shoppingItems').replaceChildren();
    const shopping = signedIn ? current.shopping : [];
    $('#shoppingProgress').hidden = !signedIn || !current.loaded;
    $('#shoppingProgress').textContent = `${shopping.filter(item => item.checked).length} of ${shopping.length} collected`;
    $('#shoppingEmpty').hidden = shopping.length > 0 || !signedIn || !current.loaded || current.loading;
    shopping.forEach(item => {
      const li = document.createElement('li'); li.className = 'shopping-item'; li.dataset.shoppingId = item.id;
      const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
      input.type = 'checkbox'; input.checked = current.pendingCheck?.id === item.id ? current.pendingCheck.checked : item.checked; input.disabled = disabled;
      input.setAttribute('aria-label', `Mark ${item.item} ${input.checked ? 'needed' : 'bought'}`); text.textContent = item.item;
      if (input.checked) li.classList.add('is-bought');
      label.append(input,text);
      input.addEventListener('change', () => store.checkItem(start, item.id, input.checked));
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'delete'; remove.textContent = 'Delete'; remove.disabled = disabled;
      remove.setAttribute('aria-label', `Delete shopping item ${item.item}`);
      remove.addEventListener('click', () => store.deleteItem(start, item.id));
      li.append(label,remove); $('#shoppingItems').append(li);
    });
  }
  return {
    render,
    open(week) { start = dateKey(monday(calendarDate(week))); render(); store.load(start); },
    getWeek:() => start,
    ensureWeek:week => store.load(week),
    meal:date => store.meal(date),
    notice(week) {
      if (!isSignedIn()) return '';
      const current = store.state(week);
      return current.loading ? 'Loading meals…' : current.error ? 'Meals could not load. Open Meal Planner to retry.' : '';
    },
    reset() { store.reset(); shoppingDrafts.clear(); start = dateKey(monday()); render(); }
  };
}
