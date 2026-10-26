export function createRoutineRepository(client) {
  const check = async query => {
    const { data, error } = await query;
    if (error) throw error;
    return data;
  };
  async function list(table) {
    const items = [];
    for (let offset = 0; ; offset += 500) {
      let query = client.from(table).select('*');
      if (table === 'hq_task_positions') query = query.order('day').order('item_key');
      else if (table === 'hq_routine_occurrences') query = query.order('routine_id').order('occurrence_date');
      else query = query.order('id');
      const page = await check(query.range(offset, offset + 499));
      items.push(...(page || []));
      if (!page || page.length < 500) return items;
    }
  }
  const single = async query => {
    const data = await check(query.select().single());
    if (!data) throw new Error('Nothing was saved. Refresh and try again.');
    return data;
  };
  return {
    async list() {
      const [routines, exceptions, positions] = await Promise.all([
        list('hq_routines'), list('hq_routine_occurrences'), list('hq_task_positions')
      ]);
      return { routines, exceptions, positions };
    },
    save: (id, values) => single(id ? client.from('hq_routines').update(values).eq('id', id) : client.from('hq_routines').insert(values)),
    // Deletion is reversible at the storage level and retains completed history.
    remove: id => single(client.from('hq_routines').update({ deleted:true }).eq('id', id)),
    occurrence(task, patch) {
      const previous = task.exception || {};
      const values = {
        routine_id:task.routine_id, occurrence_date:task.occurrence_date,
        scheduled_date:task.scheduled_date, task:previous.task ?? task.task,
        project:previous.project ?? task.project, completed:task.completed, skipped:task.skipped || false,
        ...patch
      };
      return single(client.from('hq_routine_occurrences').upsert(values, { onConflict:'routine_id,occurrence_date' }));
    },
    move: (key, day, order) => check(client.rpc('hq_move_task', { p_item_key:key, p_day:day, p_order:order }))
  };
}
