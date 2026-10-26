import { optimisticProject } from './project-core.js?v=20261026-projects';
export function createProjectStore(repository, {isSignedIn, changed = () => {}}) {
  let epoch = 0;
  const state = {project:'', data:null, loading:false, busy:false, error:'', notice:''};
  const current = token => token === epoch && isSignedIn();
  function select(project) {
    if (state.project === project) return;
    epoch++; Object.assign(state, {project, data:null, loading:false, busy:false, error:'', notice:''});
  }
  async function load(force = false) {
    if (!isSignedIn() || state.loading || state.busy || (!force && (state.data || state.error))) return;
    const token = epoch; state.loading = true; state.error = ''; changed();
    try {const data = await repository.load(state.project); if (current(token)) state.data = data;}
    catch (error) {if (current(token)) {state.data = null; state.error = error.message;}}
    finally {if (current(token)) {state.loading = false; changed();}}
  }
  async function save(action, values) {
    if (!isSignedIn() || !state.data || state.error || state.busy || state.loading) return false;
    const token = epoch, previous = state.data, project = state.project;
    state.busy = true; state.notice = 'Saving…'; state.data = optimisticProject(previous, action, values); changed();
    try {
      const data = await repository.save(project, previous.revision, action, values);
      if (!current(token)) return false;
      state.data = data; state.notice = 'Saved.'; return true;
    } catch (error) {
      if (current(token)) {state.data = previous; state.error = error.message + ' Reload before trying again to check what was saved.'; state.notice = '';}
      return false; // An interrupted response may have committed; reload before any retry.
    } finally {if (current(token)) {state.busy = false; changed();}}
  }
  return {state, select, load, save, reset() {epoch++; Object.assign(state, {project:'', data:null, loading:false, busy:false, error:'', notice:''}); changed();}};
}
