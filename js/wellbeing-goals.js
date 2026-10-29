export function createWellbeingGoals({host,repository,isSignedIn}){
 const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=txt;return n;};
 const back=el('button','wellness-back','← Health & Wellbeing');back.type='button';
 const title=el('h2','','Goals & milestones'),intro=el('p','','Small steps towards what matters to you.');
 const add=el('button','workout-add','+ Add goal');add.type='button';
 const form=el('form','workout-form'),name=el('input'),category=el('select'),date=el('input'),milestones=el('textarea'),save=el('button','','Save goal'),cancel=el('button','','Cancel');
 name.required=true;name.maxLength=120;name.placeholder='Goal title';name.setAttribute('aria-label','Goal title');
 for(const value of ['Fitness','Sleep','Mental wellbeing','Healthy habits','Nutrition','Other']){const o=el('option','',value);o.value=value;category.append(o);}category.setAttribute('aria-label','Goal category');
 date.type='date';date.setAttribute('aria-label','Optional target date');milestones.rows=5;milestones.placeholder='Milestones, one per line (optional)';milestones.setAttribute('aria-label','Milestones, one per line');
 save.type='submit';cancel.type='button';form.append(name,category,date,milestones,save,cancel);
 const status=el('p','weight-status');status.setAttribute('role','status');
 const list=el('div','workout-routine-list'),detail=el('section','workout-detail'),finished=el('section','weight-history');
 host.append(back,title,intro,add,form,status,list,detail,finished);
 let visible=false,version=0,editing=null,selected=null;
 function view(mode){form.hidden=mode!=='form';list.hidden=mode!=='list';finished.hidden=mode!=='list';detail.hidden=mode!=='detail';add.hidden=mode!=='list';if(mode!=='form'){editing=null;form.reset();save.textContent='Save goal';}if(mode!=='detail')selected=null;}
 view('list');
 add.addEventListener('click',()=>{view('form');name.focus();});cancel.addEventListener('click',()=>view('list'));
 const dateLabel=s=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric'}).format(new Date(s+'T12:00:00'));
 const percent=g=>{const m=Array.isArray(g.milestones)?g.milestones:[];return m.length?Math.round(m.filter(x=>x.done).length/m.length*100):0;};
 const isComplete=g=>Array.isArray(g.milestones)&&g.milestones.length>0&&g.milestones.every(x=>x.done);
 function progress(g){const wrap=el('div','weight-goal-track'),fill=el('div','weight-goal-fill');fill.style.width=percent(g)+'%';wrap.append(fill);return wrap;}
 async function open(g){
  selected=g.id;detail.replaceChildren();
  const backButton=el('button','workout-detail-back','← All goals');backButton.type='button';backButton.addEventListener('click',()=>view('list'));
  detail.append(backButton,el('small','',g.category+(g.target_date?' · Target '+dateLabel(g.target_date):'')),el('h3','',g.title));
  const ms=Array.isArray(g.milestones)?g.milestones:[];
  detail.append(el('p','',ms.length?ms.filter(x=>x.done).length+' of '+ms.length+' milestones completed':'No milestones yet'),progress(g));
  const checks=el('div','goal-milestone-list');
  for(let i=0;i<ms.length;i++){const row=el('label','goal-milestone');const input=el('input');input.type='checkbox';input.checked=!!ms[i].done;row.append(input,el('span','',ms[i].text));input.addEventListener('change',async()=>{const updated=ms.map((x,j)=>j===i?{...x,done:input.checked}:x);input.disabled=true;try{await repository.save({milestones:updated},g.id);await refresh(g.id);}catch(e){status.textContent=e.message;input.disabled=false;}});checks.append(row);}
  detail.append(checks);
  if(isComplete(g))detail.append(el('p','goal-congratulations','All milestones completed!'));
  const actions=el('div','workout-actions'),edit=el('button','','Edit goal'),del=el('button','','Delete goal');edit.type=del.type='button';
  edit.addEventListener('click',()=>{view('form');editing=g;name.value=g.title;category.value=g.category;date.value=g.target_date||'';milestones.value=ms.map(x=>x.text).join('\n');save.textContent='Update goal';name.focus();});
  del.addEventListener('click',async()=>{if(!confirm('Delete '+g.title+' and its milestones?'))return;try{await repository.remove(g.id);view('list');await refresh();}catch(e){status.textContent=e.message;}});
  actions.append(edit,del);detail.append(actions);view('detail');
 }
 async function refresh(reopenId){
  if(!visible)return;const current=++version;if(!isSignedIn()){status.textContent='Sign in to save goals.';return;}
  status.textContent='Loading goals…';
  try{const goals=await repository.list();if(current!==version)return;
   status.textContent=goals.length+' saved goal'+(goals.length===1?'':'s');
   list.replaceChildren();finished.replaceChildren(el('h3','','Completed goals'));
   const active=goals.filter(g=>!isComplete(g)),done=goals.filter(isComplete);
   if(!active.length)list.append(el('p','',goals.length?'All your goals are completed!':'No goals yet. Add your first goal above.'));
   for(const g of active){const card=el('button','workout-routine-card workout-routine-summary');card.type='button';card.append(el('small','',g.category),el('h3','',g.title),progress(g),el('span','workout-routine-open',percent(g)+'% · View goal ›'));card.addEventListener('click',()=>open(g));list.append(card);}
   if(!done.length)finished.append(el('p','','Completed goals will appear here.'));
   for(const g of done){const card=el('button','goal-finished-card');card.type='button';card.textContent='✓ '+g.title;card.addEventListener('click',()=>open(g));finished.append(card);}
   if(reopenId){const updated=goals.find(g=>g.id===reopenId);if(updated)await open(updated);else view('list');}
  }catch(e){if(current===version)status.textContent='Could not load goals: '+e.message;}
 }
 form.addEventListener('submit',async e=>{e.preventDefault();save.disabled=true;try{
  const old=editing,oldMs=Array.isArray(old?.milestones)?old.milestones:[];
  const ms=milestones.value.split('\n').map(x=>x.trim()).filter(Boolean).map(text=>({text,done:!!oldMs.find(x=>x.text===text&&x.done)}));
  await repository.save({title:name.value.trim(),category:category.value,target_date:date.value||null,milestones:ms},old?.id);
  view('list');await refresh();
 }catch(e){status.textContent=e.message;}finally{save.disabled=false;}});
 function show(value){visible=value;host.hidden=!value;if(value){view('list');void refresh();}}
 return {show,back,refresh};
}
