// Project task details; additive storage, existing milestones stay intact.
export function createTaskDetailRepository(client) {
  async function run(query) {const {data,error}=await query;if(error)throw new Error(error.message||'Could not save task details.');return data;}
  return {
    async load(project) {
      const [details,subtasks,links,purchases,sources,plannerLinks]=await Promise.all([
        run(client.from('hq_task_details').select('*')),
        run(client.from('hq_task_subtasks').select('*').order('position')),
        run(client.from('hq_task_links').select('*')),
        run(client.from('hq_money_purchases').select('id,item,project,estimated_pence,status,actual_pence,version,notes,priority,source_url,purchase_date')),
        run(client.from('hq_project_sources').select('id,title,source_type,project,url,section_id,note_content,description,version,original_filename')),
        run(client.from('hq_project_planner_links').select('milestone_id,planner_task_id'))
      ]);
      return {details,subtasks,links,purchases:purchases.filter(x=>x.project===project),sources:sources.filter(x=>x.project===project),plannerLinks};
    },
    async addSource(kind,parentId,project,values){
      const row=await run(client.from('hq_project_sources').insert({project,...values}).select().single());
      await this.link(kind,parentId,'source',row.id);
      return row;
    },
    async updateSource(id,version,values){return run(client.from('hq_project_sources').update(values).eq('id',id).eq('version',version).select().single());},
    async addPurchase(kind,parentId,project,item,estimatedPence){
      const purchase=await run(client.from('hq_money_purchases').insert({project,item,estimated_pence:estimatedPence,status:'planned'}).select().single());
      await this.link(kind,parentId,'purchase',purchase.id);
      return purchase;
    },
    async updatePurchase(id,version,values){return run(client.from('hq_money_purchases').update({...values,version:version+1}).eq('id',id).eq('version',version).select().single());},
    async organizePlannerTask(taskId,sectionId){return run(client.rpc('hq_organize_existing_planner_task',{p_task_id:taskId,p_section_id:sectionId}));},
    async schedule(milestoneId,date) {return run(client.rpc('hq_schedule_project_task',{p_milestone_id:milestoneId,p_date:date}));},
    async refreshPlannerLinks(){return run(client.from('hq_project_planner_links').select('milestone_id,planner_task_id'));},
    async saveNotes(parentKind,parentId,notes) {
      const field=parentKind==='section'?'section_id':'milestone_id';
      const rows=await run(client.from('hq_task_details').select('id').eq(field,parentId).limit(1));
      if(rows.length)return run(client.from('hq_task_details').update({notes}).eq('id',rows[0].id).select().single());
      return run(client.from('hq_task_details').insert({[field]:parentId,notes}).select().single());
    },
    addSubtask: (milestone_id,title,position)=>run(client.from('hq_task_subtasks').insert({milestone_id,title,position}).select().single()),
    updateSubtask: (id,values)=>run(client.from('hq_task_subtasks').update(values).eq('id',id).select().single()),
    removeSubtask: id=>run(client.from('hq_task_subtasks').delete().eq('id',id)),
    link: (kind,id,resourceType,resourceId)=>run(client.from('hq_task_links').insert({[kind==='section'?'section_id':'milestone_id']:id,[resourceType==='purchase'?'purchase_id':'source_id']:resourceId}).select().single()),
    unlink: id=>run(client.from('hq_task_links').delete().eq('id',id))
  };
}
