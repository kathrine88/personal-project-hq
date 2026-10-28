export const PROJECT_KEYS = ['Garden','Book Nook','Christmas Planning','Health & Fitness','Home Projects','Other'];
export function projectRoute(project, section = '') {
  return '#project/' + encodeURIComponent(project) + (section ? '/' + encodeURIComponent(section) : '');
}
export function readProjectRoute(hash) {
  const parts = hash.slice(1).split('/');
  if (parts[0] !== 'project' || parts.length < 2 || parts.length > 3) return null;
  try {
    const project = decodeURIComponent(parts[1]), section = parts[2] ? decodeURIComponent(parts[2]) : '';
    if (!PROJECT_KEYS.includes(project) || (section && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(section))) return null;
    return {project, section};
  } catch { return null; }
}
export function ordered(rows) {
  return [...rows].sort((a,b) => a.position - b.position || a.id.localeCompare(b.id));
}
export function progress(milestones) {
  const total = milestones.length, completed = milestones.filter(m => m.completed).length;
  return {total, completed, percent:total ? Math.round(completed / total * 100) : 0,
    label:total ? `${completed} of ${total} complete` : 'Not started'};
}
export function projectProgress(data, section = '') {
  const ids = new Set(data.sections.map(s => s.id));
  return progress(data.milestones.filter(m => ids.has(m.section_id) && (!section || m.section_id === section)));
}
export function moveIds(rows, id, direction) {
  const ids = ordered(rows).map(row => row.id), index = ids.indexOf(id), target = index + direction;
  if (![-1,1].includes(direction) || index < 0 || target < 0 || target >= ids.length) return ids;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  return ids;
}
export function cleanName(value) {
  const name = String(value ?? '').trim();
  if (!name || name.length > 200) throw new Error('Enter a name between 1 and 200 characters.');
  return name;
}
export function optimisticProject(data, action, values) {
  const next = { ...data, sections:data.sections.map(s => ({...s})), milestones:data.milestones.map(m => ({...m})) };
  const list = action.endsWith('_section') ? next.sections : next.milestones;
  if (action.startsWith('save_')) {
    const row = list.find(r => r.id === values.id);
    if (row) Object.assign(row, {name:values.name});
    else list.push({...values, position:Math.max(-1, ...list.map(r => r.position)) + 1, completed:false});
  } else if (action === 'complete_milestone') {
    const row = next.milestones.find(r => r.id === values.id); if (row) row.completed = values.completed;
  } else if (action === 'delete_section') {
    next.sections = next.sections.filter(r => r.id !== values.id);
    next.milestones = next.milestones.filter(r => r.section_id !== values.id);
  } else if (action === 'delete_milestone') next.milestones = next.milestones.filter(r => r.id !== values.id);
  else if (action.startsWith('order_')) {
    const rows = action === 'order_sections' ? next.sections : next.milestones;
    values.ids.forEach((id, position) => {const row = rows.find(r => r.id === id); if (row) row.position = position;});
  }
  return next;
}
