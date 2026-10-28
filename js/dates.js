// DATE values are local calendar dates, never UTC timestamps.
export function dateKey(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return '';
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(2000, month - 1, day, 12);
  date.setFullYear(year);
  return dateKey(date) === value ? date : null;
}
export function addDays(date, amount) {
  if (!dateKey(date) || !Number.isFinite(amount)) return null;
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}
export function monday(date = new Date()) {
  if (!dateKey(date)) return null;
  return calendarDate(dateKey(addDays(date, -((date.getDay() + 6) % 7))));
}
export function validDate(value) {
  return calendarDate(value) !== null;
}
