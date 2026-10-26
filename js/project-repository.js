import { PROJECT_KEYS } from './project-core.js?v=20261026-projects';
export function projectError(error) {
  if (['PGRST202','PGRST205','42P01','42883'].includes(error?.code)) return new Error('Project dashboards are not available yet. Please apply the Project Pages migration, then reload. Your existing planners and tasks still work.');
  if (error?.code === '40001') return new Error('This project changed in another session. Reload the project before making more changes.');
  return new Error(error?.message || 'Could not save your project. Please reload and try again.');
}
export function createProjectRepository(client) {
  async function request(name, args) {
    if (!PROJECT_KEYS.includes(args.p_project)) throw new Error('Unknown project.');
    const {data, error} = await client.rpc(name, args);
    if (error) throw projectError(error);
    if (!data || !Array.isArray(data.sections) || !Array.isArray(data.milestones) || typeof data.revision !== 'string') throw new Error('Could not read the complete project. Please reload.');
    // A bad response must never mix another project's milestones into this dashboard.
    if (data.sections.some(s => s.project !== args.p_project) || data.milestones.some(m => m.project !== args.p_project || !data.sections.some(s => s.id === m.section_id))) throw new Error('Could not read the complete project. Please reload.');
    return data;
  }
  return {
    load:project => request('hq_project_snapshot', {p_project:project}),
    save:(project, revision, action, values) => request('hq_project_change', {p_project:project, p_revision:revision, p_action:action, p_values:values})
  };
}
