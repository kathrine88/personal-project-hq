export function createMoneyStore(repository,{isSignedIn,changed=()=>{}}) {
  let epoch=0;
  const state={data:null,loading:false,busy:false,error:'',notice:''};
  async function load(force=false) {
    if(!isSignedIn()||state.loading||state.busy||(!force&&(state.data||state.error)))return;
    const version=epoch;state.loading=true;state.error='';changed();
    try {const data=await repository.load();if(version===epoch&&isSignedIn())state.data=data;}
    catch(error){if(version===epoch&&isSignedIn()){state.data=null;state.error=error.message;}}
    finally{if(version===epoch&&isSignedIn()){state.loading=false;changed();}}
  }
  async function write(operation) {
    if(!isSignedIn()||!state.data||state.loading||state.busy)return false;
    const version=epoch;state.busy=true;state.error='';state.notice='Saving…';changed();
    try {
      await operation();
      if(version!==epoch||!isSignedIn())return false;
      // Read all financial tables in ONE database snapshot, not mixed cached totals.
      try {const data=await repository.load();if(version!==epoch||!isSignedIn())return false;state.data=data;state.notice='Saved.';}
      catch(error){if(version!==epoch||!isSignedIn())return false;state.data=null;state.error='Saved, but the balance could not be refreshed. Reload before making further changes. '+error.message;state.notice='';}
      return true; // Mutation succeeded; do not repeat it just because refresh failed.
    } catch(error){if(version===epoch&&isSignedIn()){state.error=error.message;state.notice='';}return false;}
    finally{if(version===epoch&&isSignedIn()){state.busy=false;changed();}}
  }
  return {state,load,save:(kind,id,version,values)=>write(()=>repository.save(kind,id,version,values)),remove:(kind,id,version)=>write(()=>repository.remove(kind,id,version)),reset(){epoch++;Object.assign(state,{data:null,loading:false,busy:false,error:'',notice:''});changed();}};
}
