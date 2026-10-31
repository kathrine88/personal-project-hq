import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
const db=createClient('https://rilqlmsojlplbaoxkztc.supabase.co','sb_publishable_3jueoHvfgcnIlCkVpRKwWQ_6iWLG627');
const dates=['2026-11-02','2026-11-16','2026-11-23','2026-11-30','2026-12-07','2026-12-14'];
const targets=[[10,9],[11,10],[13,11],[15,12],[17,13],[20,15]];
const plus=(iso,n)=>{const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
let owner=null,rows=[],current=0;
const $=id=>document.getElementById(id);
async function init(){
 const {data:{session}}=await db.auth.getSession();if(!session){$('message').textContent='Please sign in through Personal Project HQ first.';return;}
 owner=session.user.id;await load();
 if(!rows.length){const inserts=[];dates.forEach((start,w)=>{[[0,'strength_a','Gentle strength A',targets[w][1]],[1,'walk','Easy walk',targets[w][0]],[3,'strength_b','Gentle strength B',targets[w][1]],[4,'walk','Easy walk',targets[w][0]],[6,'walk','Easy walk',targets[w][0]]].forEach(([day,kind,title,mins],position)=>inserts.push({owner_id:owner,programme_week:w+1,kind,title,target_minutes:mins,scheduled_date:plus(start,day),position}));});const {error}=await db.from('hq_fitness_sessions').upsert(inserts,{onConflict:'owner_id,programme_week,kind,scheduled_date',ignoreDuplicates:true});if(error){$('message').textContent=error.message;return;}await load();}
 render();
}
async function load(){const {data,error}=await db.from('hq_fitness_sessions').select('*').eq('owner_id',owner).order('scheduled_date');if(error)throw error;rows=data||[];}
function render(){const group=rows.filter(r=>r.programme_week===current+1);const completed=group.filter(r=>r.status==='completed').length;const decided=group.filter(r=>r.status!=='planned').length;const allDone=rows.filter(r=>r.status==='completed').length;
 $('progress').textContent=allDone+' of 30 sessions completed · '+rows.filter(r=>r.status==='not_completed').length+' not completed';$('week').textContent='Week '+(current+1)+' of 6';$('weekdates').textContent=dates[current]+' – '+plus(dates[current],6);$('weekstats').textContent=completed+' completed · '+(5-decided)+' planned';$('prev').disabled=current===0;$('next').disabled=current===5;
 const list=$('sessions');list.replaceChildren();
 for(const row of group){const card=document.createElement('article');card.className='session '+row.status;const title=document.createElement('h3');title.textContent=row.title+' · '+row.target_minutes+' min';const date=document.createElement('input');date.type='date';date.value=row.scheduled_date;date.setAttribute('aria-label','Move '+row.title+' to another date');date.onchange=async()=>{await update(row,{scheduled_date:date.value});};const status=document.createElement('select');status.setAttribute('aria-label','Status for '+row.title);[['planned','Planned'],['completed','Completed'],['not_completed','Not completed']].forEach(([value,label])=>status.add(new Option(label,value)));status.value=row.status;status.onchange=()=>edit(row,status.value);const note=document.createElement('p');note.textContent=row.notes||'Tap a status to record how it went.';card.append(title,date,status,note);list.append(card)}
}
async function update(row,patch){const {error}=await db.from('hq_fitness_sessions').update(patch).eq('id',row.id).eq('owner_id',owner);if(error){alert(error.message);return;}await load();render();}
function edit(row,status){const dialog=$('noteDialog'),form=$('noteForm');$('noteTitle').textContent=status==='completed'?'How did your session go?':'What got in the way?';$('note').value=row.notes||'';$('difficulty').value=row.difficulty||'';$('actual').value=row.actual_minutes??'';dialog.showModal();form.onsubmit=async e=>{e.preventDefault();dialog.close();await update(row,{status,notes:$('note').value.trim(),difficulty:$('difficulty').value||null,actual_minutes:$('actual').value===''?null:Number($('actual').value),recorded_at:new Date().toISOString()})};$('cancel').onclick=()=>{dialog.close();render()};}
$('prev').onclick=()=>{current--;render()};$('next').onclick=()=>{current++;render()};init().catch(e=>$('message').textContent=e.message);
