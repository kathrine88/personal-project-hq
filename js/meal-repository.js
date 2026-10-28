import { addDays, calendarDate, dateKey, monday, validDate } from './dates.js?v=20261026-datefix';

export function mealWeek(value) {
  if (!validDate(value)) throw new Error('Choose a valid week.');
  return dateKey(monday(calendarDate(value)));
}
export function createMealRepository(client) {
  async function result(query) {
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }
  async function single(query) {
    const data = await result(query.select().single());
    if (!data) throw new Error('Nothing was saved. Please try again.');
    return data;
  }
  async function pages(query) {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const page = await result(query().range(offset, offset + 499));
      rows.push(...(page || []));
      if (!page || page.length < 500) return rows;
    }
  }
  return {
    async load(week) {
      const start = mealWeek(week), end = dateKey(addDays(calendarDate(start), 6));
      const [meals, shopping] = await Promise.all([
        pages(() => client.from('hq_meals').select('meal_date,lunch,dinner').gte('meal_date', start).lte('meal_date', end).order('meal_date')),
        pages(() => client.from('hq_shopping_items').select('id,week_start,item,checked,created_at').eq('week_start', start).order('created_at').order('id'))
      ]);
      return { meals, shopping };
    },
    async saveMeals(week, rows) {
      const start = mealWeek(week), end = dateKey(addDays(calendarDate(start), 6));
      if (rows.length !== 7 || new Set(rows.map(row => row.meal_date)).size !== 7 || rows.some(row => !validDate(row.meal_date) || row.meal_date < start || row.meal_date > end)) throw new Error('Choose a valid week.');
      const data = await result(client.from('hq_meals').upsert(rows, { onConflict:'owner_id,meal_date' }).select('meal_date,lunch,dinner'));
      if (!data || data.length !== 7) throw new Error('Your meals could not be confirmed. Please try saving again.');
      return data;
    },
    addItem: (week, item) => single(client.from('hq_shopping_items').insert({ week_start:mealWeek(week), item })),
    checkItem: (id, checked) => single(client.from('hq_shopping_items').update({ checked }).eq('id', id)),
    deleteItem: id => single(client.from('hq_shopping_items').delete().eq('id', id))
  };
}
