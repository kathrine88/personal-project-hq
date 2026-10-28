import { addDays, calendarDate, dateKey } from './dates.js?v=20261026-datefix';
import { mealWeek } from './meal-repository.js?v=20261026-meals';

const emptyState = () => ({ meals:[], shopping:[], draft:null, loaded:false, loading:false, saving:false, shoppingBusy:false, pendingCheck:null, error:'', unavailable:false, status:'', dirty:false });
const errorMessage = error => ['PGRST205','42P01'].includes(error?.code)
  ? 'Meal planning is not available yet. Your task planner still works.'
  : `Could not save or load this week. ${error?.message || 'Please try again.'}`;
export function createMealStore(repository, { isSignedIn, changed = () => {}, mealsChanged = () => {} }) {
  const weeks = new Map(); let epoch = 0;
  function state(week) {
    const key = mealWeek(week);
    if (!weeks.has(key)) weeks.set(key, emptyState());
    return weeks.get(key);
  }
  function rows(week) {
    const current = state(week);
    return Array.from({ length:7 }, (_, offset) => {
      const key = dateKey(addDays(calendarDate(mealWeek(week)), offset));
      return { meal_date:key, lunch:current.draft?.[key]?.lunch || '', dinner:current.draft?.[key]?.dinner || '' };
    });
  }
  const toDraft = meals => Object.fromEntries(meals.map(row => [row.meal_date, { lunch:row.lunch || '', dinner:row.dinner || '' }]));
  async function load(week, force = false) {
    const key = mealWeek(week), current = state(key);
    if (!isSignedIn() || current.loading || current.saving || current.shoppingBusy || (!force && (current.loaded || current.error))) return;
    const version = epoch;
    current.loading = true; current.error = ''; changed(key); mealsChanged(key);
    try {
      const data = await repository.load(key);
      if (epoch !== version || !isSignedIn()) return;
      current.meals = data.meals; current.shopping = data.shopping;
      if (!current.draft || !current.dirty) current.draft = toDraft(data.meals);
      current.loaded = true; current.unavailable = false;
    } catch (error) {
      if (epoch !== version || !isSignedIn()) return;
      current.error = errorMessage(error); current.unavailable = ['PGRST205','42P01'].includes(error?.code);
    } finally {
      if (epoch === version && isSignedIn()) { current.loading = false; changed(key); mealsChanged(key); }
    }
  }
  async function write(week, shopping, operation) {
    const key = mealWeek(week), current = state(key), version = epoch;
    if (!isSignedIn() || !current.loaded || current.loading || current.saving || current.shoppingBusy) return false;
    if (shopping) current.shoppingBusy = true; else current.saving = true;
    current.error = ''; current.status = shopping ? 'Saving shopping list…' : 'Saving meals…'; changed(key);
    try {
      const apply = await operation(current);
      if (epoch !== version || !isSignedIn()) return false;
      apply(); current.status = shopping ? 'Shopping list saved.' : 'Meals saved.';
      if (!shopping) mealsChanged(key);
      return true;
    } catch (error) {
      if (epoch === version && isSignedIn()) { current.error = errorMessage(error); current.status = ''; }
      return false;
    } finally {
      if (epoch === version && isSignedIn()) { current.saving = false; current.shoppingBusy = false; current.pendingCheck = null; changed(key); }
    }
  }
  return {
    state, rows, load,
    draft(week, date, field, value) {
      if (!['lunch','dinner'].includes(field) || !rows(week).some(row => row.meal_date === date)) return;
      const current = state(week);
      if (!current.loaded || current.saving || current.loading) return;
      current.draft ||= toDraft(current.meals);
      current.draft[date] ||= { lunch:'', dinner:'' };
      current.draft[date][field] = value; current.dirty = true; current.status = 'Unsaved meal changes.';
    },
    saveMeals(week) {
      const values = rows(week).map(row => ({ ...row, lunch:row.lunch.trim(), dinner:row.dinner.trim() }));
      return write(week, false, async current => {
        const saved = await repository.saveMeals(week, values);
        return () => { current.meals = saved; current.draft = toDraft(saved); current.dirty = false; };
      });
    },
    addItem(week, item) {
      const text = item.trim(); if (!text) return Promise.resolve(false);
      return write(week, true, async current => {
        const saved = await repository.addItem(week, text);
        return () => { current.shopping.push(saved); };
      });
    },
    checkItem(week, id, checked) {
      const current = state(week);
      if (!isSignedIn() || !current.loaded || current.loading || current.saving || current.shoppingBusy) return Promise.resolve(false);
      current.pendingCheck = { id, checked };
      return write(week, true, async current => {
        const saved = await repository.checkItem(id, checked);
        return () => { current.shopping = current.shopping.map(item => item.id === id ? saved : item); };
      });
    },
    deleteItem(week, id) {
      return write(week, true, async current => {
        await repository.deleteItem(id);
        return () => { current.shopping = current.shopping.filter(item => item.id !== id); };
      });
    },
    meal(date) {
      if (!isSignedIn()) return null;
      return state(date).meals.find(meal => meal.meal_date === date) || null;
    },
    reset() { ++epoch; weeks.clear(); }
  };
}
