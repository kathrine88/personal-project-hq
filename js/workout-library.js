
// Starter programme routines; saved into the existing My workouts library.
const starterRoutines=[
 {name:'Six-week plan · Workout A',category:'Strength',duration_minutes:10,exercises:[
 'Chair sit-to-stand | 4–6 reps | Sit on a sturdy chair, feet hip-width apart. Lean forward only as comfortable, stand using the chair arms if needed, then lower slowly. Keep the movement small if your back is sensitive.',
 'Wall push-up | 4–6 reps | Hands on a wall at shoulder height. Step back a little, bend elbows to move toward the wall, then press away. Keep your body comfortable and avoid arching your lower back.',
 'Supported heel raise | 6–8 reps | Hold a worktop or sturdy chair. Lift heels slowly, pause, then lower with control. Keep your torso upright.',
 'Seated march | 20–30 sec | Sit tall with feet flat. Lift one foot a little, lower it, then alternate. Keep movements small and pain-free.'
 ]},
 {name:'Six-week plan · Workout B',category:'Mobility',duration_minutes:10,exercises:[
 'Supported side step | 4–6 each way | Stand near a worktop. Step gently sideways and bring your other foot across without twisting your trunk. Use support as needed.',
 'Standing side leg raise | 4–6 each side | Hold a sturdy support, stand tall, move one leg a little to the side without leaning, then return slowly. Skip if it strains the lower back.',
 'Shoulder-blade squeeze | 6–8 reps | Sit or stand comfortably. Gently draw shoulder blades toward one another, hold briefly, then relax. Avoid arching your back.',
 'Seated knee extension | 4–6 each leg | Sit in a sturdy chair. Slowly straighten one knee only as far as comfortable, lower and switch sides. Keep your back supported.'
 ]}
];
const movementGuide={
 'Chair sit-to-stand':['Sit with feet planted and use your hands for support if needed.','Do not force a deep bend; stop if it increases back pain.'],
 'Wall push-up':['Keep hands on a stable wall and bend your elbows slowly.','Move closer to the wall to make it easier.'],
 'Supported heel raise':['Hold a stable worktop and rise onto your toes.','Small, controlled lifts are enough.'],
 'Seated march':['Lift alternating feet gently while seated.','Keep your lower back comfortable against the chair.'],
 'Supported side step':['Take small sideways steps near a support.','Avoid twisting or reaching far.'],
 'Standing side leg raise':['Move one leg sideways a short distance while holding support.','Keep your torso upright; skip if painful.'],
 'Shoulder-blade squeeze':['Draw shoulders gently back and release.','Do not arch your lower back.'],
 'Seated knee extension':['Straighten one knee slowly while seated.','Use a back-supported chair and a comfortable range.']
};
function movementIllustration(label){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.setAttribute('viewBox','0 0 100 100');svg.setAttribute('width','76');svg.setAttribute('height','76');svg.setAttribute('role','img');svg.setAttribute('aria-label','Simplified illustration of '+label);
 const add=(tag,attrs)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);svg.append(n)};
 add('circle',{cx:49,cy:17,r:9,fill:'#d7b99a'});
 const supported=/Chair|Seated/.test(label),wall=/Wall/.test(label),side=/side|Side/.test(label);
 if(supported){add('path',{d:'M25 57 H61 V83 M25 57 V83',fill:'none',stroke:'#9a765c','stroke-width':4,'stroke-linecap':'round'});}
 if(wall)add('path',{d:'M80 8 V89',stroke:'#9a765c','stroke-width':5});
 add('path',{d:supported?'M49 29 L49 54 L66 57 M49 37 L34 47':wall?'M49 29 L54 56 M49 36 L77 39': 'M49 29 L49 59 M49 37 L30 49 M49 37 L68 49',fill:'none',stroke:'#456d55','stroke-width':6,'stroke-linecap':'round','stroke-linejoin':'round'});
 add('path',{d:supported?'M66 57 L70 78 M49 54 L37 76':side?'M49 59 L28 79 M49 59 L66 83':'M49 59 L39 83 M49 59 L62 83',fill:'none',stroke:'#456d55','stroke-width':6,'stroke-linecap':'round'});
 return svg;
}
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
 function openRoutine(routine){selected=routine.id;detail.replaceChildren();const returnButton=el('button','workout-detail-back','← All routines');returnButton.type='button';returnButton.addEventListener('click',()=>setView('list'));detail.append(returnButton,el('small','',routine.category+(routine.duration_minutes?' · '+routine.duration_minutes+' min':'')),el('h3','',routine.name));const lines=Array.isArray(routine.exercises)?routine.exercises:[];if(lines.length){const ul=el('div','workout-exercise-guides');for(const line of lines){const [label,reps,instructions]=String(line).split(' | ');const guide=movementGuide[label];if(guide){const card=el('article','workout-exercise-guide');card.style.cssText='display:flex;gap:12px;align-items:flex-start;padding:14px 0;border-bottom:1px solid #d9d1c4';const picture=el('div');picture.style.cssText='background:#e1e9dd;border-radius:12px;flex:0 0 84px;padding:4px';picture.append(movementIllustration(label));const copy=el('div');copy.append(el('h4','',label),el('strong','',reps||''),el('p','',instructions||guide[0]));const tip=el('small','',guide[1]);tip.style.color='#6b765e';copy.append(tip);card.append(picture,copy);ul.append(card);}else ul.append(el('p','',String(line)));}detail.append(ul);}else detail.append(el('p','','No exercises added yet.'));const actions=el('div','workout-actions'),done=el('button','workout-complete','✓ Complete'),edit=el('button','','Edit'),del=el('button','','Delete');done.type=edit.type=del.type='button';done.addEventListener('click',async()=>{done.disabled=true;try{await repository.complete(routine);setView('list');await refresh();onChange?.();}catch(e){status.textContent=e.message;done.disabled=false;}});edit.addEventListener('click',()=>{setView('form');editing=routine.id;name.value=routine.name;category.value=routine.category;duration.value=routine.duration_minutes??'';exercises.value=lines.join('\n');submit.textContent='Update routine';cancel.hidden=false;name.focus();});del.addEventListener('click',async()=>{if(!confirm('Delete '+routine.name+'? Previous completions will remain in your history.'))return;try{await repository.removeRoutine(routine.id);setView('list');await refresh();}catch(e){status.textContent=e.message;}});actions.append(done,edit,del);detail.append(actions);setView('detail');}

 cancel.addEventListener('click',()=>setView('list'));
 const format=d=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric'}).format(new Date(d+'T12:00:00'));
 async function refresh(){
  if(!visible)return;const current=++version;
  if(!isSignedIn()){status.textContent='Sign in to save your workouts.';return;}
  status.textContent='Loading routines…';
  try{
   let [routines,completed]=await Promise.all([repository.routines(),repository.completions()]);
   // Only add the two programme routines if they are not already saved.
   for(const starter of starterRoutines){if(!routines.some(r=>r.name===starter.name)){await repository.saveRoutine(starter);routines=await repository.routines();}}
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
