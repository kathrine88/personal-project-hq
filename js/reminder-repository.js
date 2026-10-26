function failure(error){
 if(['PGRST202','PGRST205','42883','42P01'].includes(error?.code))return Error('Reminders are not available yet. Apply the Stage 3B SQL migration, then reload. Your other planners still work.');
 if(['40001','23505'].includes(error?.code))return Error('This reminder changed or was already saved. Close and reload before trying again.');
 return Error(error?.message||'Could not connect. Close and reload to check what was saved.');
}
export function createReminderRepository(client){
 async function call(name,args){const {data,error}=await client.rpc(name,args);if(error)throw failure(error);if(!Array.isArray(data?.reminders)||!Array.isArray(data?.occurrences))throw Error('Could not confirm reminder data. Close and reload before retrying.');return data;}
 return {load:()=>call('hq_reminder_snapshot'),change:(id,version,action,values={})=>call('hq_reminder_change',{p_id:id,p_version:version,p_action:action,p_values:values})};
}
