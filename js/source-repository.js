import { SOURCE_BUCKET } from './source-files.js?v=20261026-uploads';
import { PROJECT_KEYS } from './project-core.js?v=20261026-projects';
function failure(error) {
  if (['PGRST202','PGRST205','42P01','42883'].includes(error?.code)) return new Error('Source Library is not available yet. Please apply the Stage 2A SQL migration, then reload. Your existing projects and planners still work.');
  if (error?.code === '23503') return new Error('The subsection changed or was deleted. Reload, then choose a current subsection or leave it unassigned.');
  if (['PGRST116','23505'].includes(error?.code)) return new Error('This source was already saved, changed or deleted. Cancel and reload before editing again.');
  return new Error(error?.message || 'Could not connect. Please try again.');
}
const columns = ['source_type','url','title','description','note_content','section_id'];
export function createSourceRepository(client) {
  const check = project => {if (!PROJECT_KEYS.includes(project)) throw new Error('Unknown project.');};
  async function result(query) {const {data,error} = await query; if (error) throw failure(error); return data;}
  function scoped(project, id, version, query) {check(project); return query.eq('project',project).eq('id',id).eq('version',version);}
  async function fileAction(body) {
    try {
      const {data,error}=await client.functions.invoke('source-files',{body});
      if(error) {
        let detail;try{detail=await error.context?.json();}catch{}
        throw new Error(detail?.error||'Uploads are unavailable or the connection failed. Check Stage 2B setup, then reload before retrying.');
      }
      if(data?.error)throw new Error(data.error);return data;
    }catch(error){throw new Error(error.message||'File operation failed. Reload before retrying.');}
  }
  return {
    async upload(project,id,version,values,file,operation) {
      check(project);const body=new FormData();body.set('file',file);
      body.set('metadata',JSON.stringify({id,operation,project,version,...values}));
      return fileAction(body);
    },
    cleanup:project=>{check(project);return fileAction({action:'cleanup',project});},
    async signedFile(source,download=false) {
      if(source.file_status==='deleting')throw new Error('This file is pending deletion. Retry file cleanup.');
      if(!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|heic|heif|pdf|docx|xlsx|txt)$/.test(source.storage_path||''))throw new Error('This source has no valid private file.');
      const {data,error}=await client.storage.from(SOURCE_BUCKET).createSignedUrl(source.storage_path,300,download?{download:source.original_filename}:undefined);
      if(error||!data?.signedUrl)throw new Error('Could not open this private file. Refresh file access or sign in again.');
      return data.signedUrl;
    },
    async load(project) {
      check(project); const data = await result(client.rpc('hq_source_library', {p_project:project}));
      if (!data || !Array.isArray(data.sources) || !Array.isArray(data.sections) || data.sections.some(s => s.project !== project) || data.sources.some(s => s.project !== project || (s.section_id && !data.sections.some(section => section.id === s.section_id)))) throw new Error('Could not read the complete library. Please reload.');
      return data;
    },
    async save(project, id, version, input) {
      check(project);
      const values = Object.fromEntries(columns.map(key => [key,input[key]]));
      if (version != null) {
        // The database trigger, not the caller, increments the version/timestamp.
        const row = await result(scoped(project,id,version,client.from('hq_project_sources').update(values)).select().single());
        if (!row) throw failure({code:'PGRST116'}); return row;
      }
      // A stable ID is allocated when the form opens, so an interrupted add cannot
      // silently insert a second copy when retried.
      const row = await result(client.from('hq_project_sources').upsert({id,project,...values},{onConflict:'id',ignoreDuplicates:true}).select().maybeSingle());
      if (row) return row;
      const existing = await result(client.from('hq_project_sources').select().eq('project',project).eq('id',id).single());
      if (!existing || columns.some(key => existing[key] !== values[key])) throw failure({code:'PGRST116'});
      return existing;
    },
    async remove(project, id, version, uploaded=false, operation='') {
      if(uploaded){check(project);return fileAction({action:'delete',project,id,version,operation});}
      const row = await result(scoped(project,id,version,client.from('hq_project_sources').delete()).select('id').single());
      if (!row) throw failure({code:'PGRST116'}); return row;
    }
  };
}
