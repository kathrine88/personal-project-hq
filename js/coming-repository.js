function failure(error) {
  if(['PGRST202','PGRST205','42P01','42883'].includes(error?.code))return new Error('Coming Up is not available yet. Apply the Stage 3A SQL migration, then reload. Existing planners still work.');
  if(['40001','23505'].includes(error?.code))return new Error('This plan was already saved, changed or deleted. Cancel and reload before editing again.');
  return new Error(error?.message||'Could not connect. Please reload and try again.');
}
export function createComingRepository(client) {
  async function result(query){const {data,error}=await query;if(error)throw failure(error);return data;}
  return {
    async load(){const data=await result(client.rpc('hq_coming_snapshot'));if(!Array.isArray(data))throw new Error('Could not read Coming Up. Reload before making changes.');return data;},
    async save(id,version,values){const data=await result(client.rpc('hq_coming_change',{p_id:id,p_version:version,p_action:'save',p_values:values}));if(!data?.entry||data.entry.id!==id)throw new Error('Could not confirm the saved plan. Reload before retrying.');return data;},
    async remove(id,version){const data=await result(client.rpc('hq_coming_change',{p_id:id,p_version:version,p_action:'delete',p_values:{}}));if(data?.entry_id!==id)throw new Error('Could not confirm deletion. Reload before retrying.');return data;}
  };
}
