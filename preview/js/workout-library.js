export function createWorkoutLibrary({host,repository,isSignedIn,onChange}){
 const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=txt;return n;};
 const back=el('button','wellness-back','← Health & Wellbeing');back.type='button';
 const title=el('h2','','My workouts'),intro=el('p','','Your favourite routines, all in one place.');
 const form=el('form','workout-form'),name=el('input'),category=el('select'),duration=el('input'),exercises=el('textarea'),submit=el('button','','Save routine'),cancel=el('button','','Cancel edit');
 name.required=true;name.maxLength=100;name.placeholder='Routine name';name.setAttribute('aria-label','Routine name');
 for(const option of ['Strength','Cardio','Mobility','Stretching','Walking','Other']){const n=el('option','',option);n.value=option;category.append(n);}
 category.setAttribute('aria-label','Workout type');duration.type='number';duration.min=1;duration.max=1440;duration.placeholder='Minutes (optional)';duration.setAttribute('aria-label','Estimated duration in minutes');
 exercises.placeholder='Exercises, one per line (e.g. Squats — 3 × 10)';exercises.rows=5;exercises.setAttribute('aria-label','Exercises, one per line');
 submit.type='submit';cancel.type='button';cancel.hidden=true;form.append(name,category,duration,exercises,submit,cancel);
 const add=el('button','workout-add','+ Add routine');add.type='button';const formBack=el('button','workout-form-back','← Back to routines');formBack.type='button';const detail=el('section','workout-detail');detail.hidden=true;form.hidden=true;
 const status=el('p','weight-status');status.setAttribute('role','status');
 const list=el('div','workout-routine-list'),history=el('section','weight-history');
 host.append(back,title,intro,add,formBack,form,status,list,detail,history);formBack.hidden=true;
 let editing=null,visible=false,version=0,selected=null;
 function setView(view){const editingView=view==='form',detailView=view==='detail';form.hidden=!editingView;formBack.hidden=!editingView;add.hidden=editingView||detailView;list.hidden=editingView||detailView;history.hidden=editingView||detailView;detail.hidden=!detailView;if(!editingView){editing=null;form.reset();submit.textContent='Save routine';cancel.hidden=true;}if(!detailView)selected=null;}
 add.addEventListener('click',()=>{setView('form');name.focus();});formBack.addEventListener('click',()=>setView('list'));
 function openRoutine(routine){selected=routine.id;detail.replaceChildren();const returnButton=el('button','workout-detail-back','← All routines');returnButton.type='button';returnButton.addEventListener('click',()=>setView('list'));detail.append(returnButton,el('small','',routine.category+(routine.duration_minutes?' · '+routine.duration_minutes+' min':'')),el('h3','',routine.name));const lines=Array.isArray(routine.exercises)?routine.exercises:[];if(lines.length){const ul=el('ul');for(const line of lines)ul.append(el('li','',String(line)));detail.append(ul);}else detail.append(el('p','','No exercises added yet.'));const actions=el('div','workout-actions'),done=el('button','workout-complete','✓ Complete'),edit=el('button','','Edit'),del=el('button','','Delete');done.type=edit.type=del.type='button';done.addEventListener('click',async()=>{done.disabled=true;try{await repository.complete(routine);setView('list');await refresh();onChange?.();}catch(e){status.textContent=e.message;done.disabled=false;}});edit.addEventListener('click',()=>{setView('form');editing=routine.id;name.value=routine.name;category.value=routine.category;duration.value=routine.duration_minutes??'';exercises.value=lines.join('\n');submit.textContent='Update routine';cancel.hidden=false;name.focus();});del.addEventListener('click',async()=>{if(!confirm('Delete '+routine.name+'? Previous completions will remain in your history.'))return;try{await repository.removeRoutine(routine.id);setView('list');await refresh();}catch(e){status.textContent=e.message;}});actions.append(done,edit,del);detail.append(actions);setView('detail');}

 cancel.addEventListener('click',()=>setView('list'));
 const format=d=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric'}).format(new Date(d+'T12:00:00'));
 async function refresh(){
  if(!visible)return;const current=++version;
  if(!isSignedIn()){status.textContent='Sign in to save your workouts.';return;}
  status.textContent='Loading routines…';
  try{
   const [routines,completed]=await Promise.all([repository.routines(),repository.completions()]);
   if(current!==version)return;
   status.textContent=routines.length+' saved routine'+(routines.length===1?'':'s');
   list.replaceChildren();history.replaceChildren(el('h3','','Completed workouts'));
   if(!routines.length)list.append(el('p','','No routines yet. Create your first one above.'));
   for(const routine of routines){
    const card=el('button','workout-routine-card workout-routine-summary');card.type='button';card.append(el('small','',routine.category+(routine.duration_minutes?' · '+routine.duration_minutes+' min':'')),el('h3','',routine.name),el('span','workout-routine-open','View routine ›'));card.addEventListener('click',()=>openRoutine(routine));list.append(card);
   }
   if(!completed.length)history.append(el('p','','No completed workouts yet.'));
   for(const entry of completed){const item=el('div','weight-history-item');item.append(el('span','',format(entry.completed_on)),el('strong','',entry.routine_name));const del=el('button','','Remove');del.type='button';del.addEventListener('click',async()=>{if(!confirm('Remove this completed workout?'))return;try{await repository.removeCompletion(entry.id);await refresh();onChange?.();}catch(e){status.textContent=e.message;}});item.append(del);history.append(item);}
  }catch(e){if(current===version)status.textContent='Could not load workouts: '+e.message;}
 }
 form.addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;try{const data={name:name.value.trim(),category:category.value,duration_minutes:duration.value?Number(duration.value):null,exercises:exercises.value.split('\n').map(x=>x.trim()).filter(Boolean)};if(!data.name)return;await repository.saveRoutine(data,editing);editing=null;form.reset();submit.textContent='Save routine';cancel.hidden=true;setView('list');await refresh();}catch(error){status.textContent=error.message;}finally{submit.disabled=false;}});
 function show(value){visible=value;host.hidden=!value;if(value){setView('list');void refresh();}}
 return {show,back,refresh};
}
