import { addDays, calendarDate, dateKey, monday } from './dates.js?v=20261026-datefix';

export const taskKey = task => task.routine_id ? `routine:${task.routine_id}:${task.occurrence_date}` : `task:${task.id}`;
const dayNumber = value => {
  const d = calendarDate(value);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
};

export function occursOn(routine, key) {
  if (!calendarDate(key) || !calendarDate(routine.start_date) || (routine.end_date && !calendarDate(routine.end_date))) return false;
  if (key < routine.start_date || (routine.end_date && key > routine.end_date)) return false;
  const date = calendarDate(key), start = calendarDate(routine.start_date);
  if (routine.frequency === 'daily') return true;
  if (routine.frequency === 'monthly') {
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    return date.getDate() === Math.min(start.getDate(), lastDay);
  }
  const weekday = date.getDay() || 7;
  if (!routine.weekdays.includes(weekday)) return false;
  return routine.frequency === 'weekly' ||
    (routine.frequency === 'fortnightly' && ((dayNumber(dateKey(monday(date))) - dayNumber(dateKey(monday(start)))) / 7) % 2 === 0);
}

// Generate only the requested date window. Browsing never writes occurrences.
export function weekTasks(ordinary, routines, exceptions, positions, start, end, today = dateKey(new Date())) {
  // Older cached planner callers may omit the range. Default only absent values;
  // malformed explicit dates are rejected instead of silently changing the week.
  const first = calendarDate(start ?? dateKey(monday()));
  const last = calendarDate(end ?? dateKey(addDays(first, 6)));
  if (!first || !last || last < first) return [];
  start = dateKey(first); end = dateKey(last);
  const result = ordinary.filter(task => task.scheduled_date >= start && task.scheduled_date <= end);
  const byRoutine = new Map(routines.map(routine => [routine.id, routine]));
  const exceptionKeys = new Set(exceptions.map(item => `${item.routine_id}:${item.occurrence_date}`));
  const virtual = (routine, key, exception = null) => ({
    id:`routine:${routine.id}:${key}`, routine_id:routine.id, occurrence_date:key,
    task:exception?.task ?? routine.task, project:exception?.project ?? routine.project,
    scheduled_date:exception?.scheduled_date ?? key, completed:exception?.completed ?? false,
    skipped:exception?.skipped ?? false, exception
  });
  for (const routine of routines) {
    if (routine.deleted) continue;
    const lastDate = calendarDate(end);
    for (let date = calendarDate(start); date <= lastDate; date = addDays(date, 1)) {
      const key = dateKey(date);
      if (routine.paused && key >= today) continue;
      if (occursOn(routine, key) && !exceptionKeys.has(`${routine.id}:${key}`)) result.push(virtual(routine, key));
    }
  }
  // Exceptions are keyed by the original occurrence date, even after moving.
  // Retain saved history/individual plans when a routine is edited or paused.
  for (const exception of exceptions) {
    const routine = byRoutine.get(exception.routine_id);
    if (!routine || exception.scheduled_date < start || exception.scheduled_date > end) continue;
    if (routine.deleted && !exception.completed) continue;
    result.push(virtual(routine, exception.occurrence_date, exception));
  }
  const ranks = new Map(positions.map(p => [`${p.day}:${p.item_key}`, p.position]));
  return result.sort((a, b) => {
    const day = a.scheduled_date.localeCompare(b.scheduled_date);
    if (day) return day;
    const aRank = ranks.get(`${a.scheduled_date}:${taskKey(a)}`) ?? Infinity;
    const bRank = ranks.get(`${b.scheduled_date}:${taskKey(b)}`) ?? Infinity;
    return aRank - bRank || taskKey(a).localeCompare(taskKey(b), 'en', { numeric:true });
  });
}
