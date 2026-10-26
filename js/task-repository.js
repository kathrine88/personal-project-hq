// One data boundary shared by projects and planner; future views can reuse it.
export function createTaskRepository(client) {
  const columns = 'id, project, task, completed, scheduled_date';
  async function result(query, single = false) {
    const { data, error } = await query;
    if (error) throw error;
    if (single && !data) throw new Error('This task could not be saved. Refresh and try again.');
    return data;
  }
  return {
    async list() {
      const tasks = [];
      for (let start = 0; ; start += 500) {
        const page = await result(client.from('test_tasks').select(columns).order('id').range(start, start + 499));
        tasks.push(...(page || []));
        if (!page || page.length < 500) return tasks;
      }
    },
    // owner_id defaults to auth.uid(); RLS enforces ownership on every operation.
    add: values => result(client.from('test_tasks').insert(values).select(columns).single(), true),
    update: (id, values) => result(client.from('test_tasks').update(values).eq('id', id).select(columns).single(), true),
    remove: id => result(client.from('test_tasks').delete().eq('id', id).select('id').single(), true)
  };
}
