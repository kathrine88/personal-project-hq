export function createSourceStore(repository, {isSignedIn, changed = () => {}}) {
  let epoch = 0;
  const state = {project:'',data:null,loading:false,busy:false,error:'',notice:''};
  const current = token => token === epoch && isSignedIn();
  function select(project) {
    if (project === state.project) return;
    epoch++;Object.assign(state,{project,data:null,loading:false,busy:false,error:'',notice:''});
  }
  async function load(force = false) {
    if (!isSignedIn() || state.loading || state.busy || (!force && (state.data || state.error))) return;
    const token = epoch;state.loading = true;state.error = '';state.notice = '';changed();
    try {const data = await repository.load(state.project);if (current(token)) state.data = data;}
    catch (error) {if (current(token)) {state.data = null;state.error = error.message;}}
    finally {if (current(token)) {state.loading = false;changed();}}
  }
  async function write(operation) {
    if (!isSignedIn() || !state.data || state.error || state.loading || state.busy) return false;
    const token = epoch, project = state.project;state.busy = true;state.notice = 'Saving…';changed();
    try {
      await operation();if (!current(token)) return false;
      try {const data = await repository.load(project);if (!current(token)) return false;state.data = data;state.notice = 'Saved.';}
      catch (error) {if (!current(token)) return false;state.data = null;state.error = 'Saved, but the library could not be refreshed. Reload to see your saved changes. '+error.message;state.notice = '';}
      return true; // Close the form on committed changes, including refresh failure.
    } catch (error) {
      if (current(token)) {state.error = error.message+' Reload before trying again to check what was saved.';state.notice = '';}
      return false; // An interrupted mutation may have committed. Do not blind-retry.
    } finally {if (current(token)) {state.busy = false;changed();}}
  }
  return {state,select,load,
    save:(id,version,values) => write(() => repository.save(state.project,id,version,values)),
    remove:(id,version) => write(() => repository.remove(state.project,id,version)),
    reset() {epoch++;Object.assign(state,{project:'',data:null,loading:false,busy:false,error:'',notice:''});changed();}
  };
}
