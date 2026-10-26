import {deviceZone,repeatLabels,reminderValues,reminderGroups,formatReminderTime,findReminder,relativeReminder,relativeDue,zonedInstant} from './reminder-core.js?v=20261026-reminders';
import {dateKey} from './dates.js?v=20261026-datefix';
import {newMoneyId as newId} from './money-core.js?v=20261026-money';
export function createReminderView({root,editor,repository,isSignedIn,signIn,openSource,getSourceInfo=()=>null}){
 const $=s=>root.querySelector(s),field=n=>editor.querySelector('[name="'+n+'"]'),alert=editor.querySelector('[role=alert]');
 let data=null,loading=false,busy=false,error='',notice='',epoch=0,request=0,editing=null,source=null,focus=null,history=false;
 const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!=null)n.textContent=text;return n;};
 const ready=()=>isSignedIn()&&data&&!loading&&!busy&&!error;
 function button(text,action){const b=el('button','coming-control',text);b.type='button';b.disabled=!ready();b.addEventListener('click',action);return b;}
 function rows(items,target,past=false){target.replaceChildren();for(const o of items){
  const li=el('li','coming-card reminder-card');li.dataset.occurrenceId=o.id;
  li.append(el('p','coming-date',formatReminderTime(o.due_at)),el('h3','',o.title));
  li.append(el('p','coming-kind',(o.source_kind==='standalone'?'Standalone':o.source_kind==='event'?'Event':'To-do')+(o.repeat_rule&&o.repeat_rule!=='never'?' · '+repeatLabels[o.repeat_rule]:'')));
  if(o.timezone!==deviceZone())li.append(el('p','editor-hint','Scheduled in '+o.timezone+'; shown in your current time zone.'));
  if(past){li.append(el('p','editor-hint',o.status==='dismissed'?'Dismissed '+formatReminderTime(o.dismissed_at):(o.resolution||'Cancelled')+' · '+formatReminderTime(o.cancelled_at)));}
  else{
   if(o.reminder.notes)li.append(el('p','coming-notes',o.reminder.notes));
   const actions=el('div','coming-actions');
   if(Date.parse(o.due_at)<=Date.now())actions.append(button('Dismiss',()=>write(()=>repository.change(o.reminder.id,o.reminder.version,'dismiss',{occurrence_id:o.id}))));
   actions.append(button('Edit',()=>open(o.reminder)),button('Delete',()=>remove(o.reminder)));
   if(o.reminder.link_kind!=='standalone')actions.append(button('Open '+(o.source_kind==='event'?'event':'to-do'),()=>openSource(o.reminder)));
   li.append(actions);
  }target.append(li);
 }}
 function render(){
  $('#reminderStatus').textContent=!isSignedIn()?'Sign in to keep your reminders.':loading?'Loading reminders…':busy?'Saving…':notice;
  $('#reminderError').textContent=error;$('#reminderSignIn').hidden=isSignedIn();$('#reminderReload').hidden=!isSignedIn();$('#reminderReload').disabled=busy||loading;$('#reminderAdd').disabled=!ready();
  $('#reminderActive').hidden=history;$('#reminderHistory').hidden=!history;
  root.querySelectorAll('[data-reminder-tab]').forEach(a=>a.setAttribute('aria-current',(a.dataset.reminderTab==='history')===history?'page':'false'));
  if(!busy){const g=reminderGroups(data);rows(g.attention,$('#reminderAttentionRows'));rows(g.upcoming,$('#reminderUpcomingRows'));rows(g.history,$('#reminderHistoryRows'),true);for(const [key,items] of [['Attention',g.attention],['Upcoming',g.upcoming],['History',g.history]])$('#reminder'+key+'Empty').hidden=!data||!!items.length;$('#reminderAttentionCount').textContent=g.attention.length;}
  root.querySelectorAll('.coming-control').forEach(b=>b.disabled=!ready());
  if(editor.open){alert.textContent=error;editor.querySelectorAll('button,input,select,textarea').forEach(c=>c.disabled=busy||loading);editor.querySelector('[type=submit]').disabled=!ready();}
 }
 async function load(){if(!isSignedIn())return;const token=epoch,n=++request;loading=true;error='';render();try{const result=await repository.load();if(token===epoch&&n===request){data=result;notice='';}}catch(e){if(token===epoch&&n===request)error=e.message;}finally{if(token===epoch&&n===request){loading=false;render();}}}
 async function write(operation){if(!ready())return false;const token=epoch;request++;busy=true;notice='';render();try{const result=await operation();if(token!==epoch||!isSignedIn())return false;data=result;notice='Saved.';return true;}catch(e){if(token===epoch)error=e.message+' Close and reload before retrying to check what was saved.';return false;}finally{if(token===epoch){busy=false;render();}}}
 function shape(){
  const linked=source?.link_kind!=='standalone';editor.querySelector('[data-reminder-repeat]').hidden=linked;editor.querySelector('[data-reminder-notes]').hidden=linked;editor.querySelector('[data-reminder-timing]').hidden=!linked;field('title').readOnly=linked;
  const mode=field('timing').value;field('date').readOnly=linked&&mode!=='custom';field('time').readOnly=linked&&['at','hour'].includes(mode);
  editor.querySelector('[data-reminder-timing-hint]').textContent=mode==='custom'?'An exact date and time, independent of later changes to the item.':mode==='at'||mode==='hour'?'Uses the item’s scheduled time; updates when its date or time changes.':'Choose the actual reminder time. The date follows the item, including later rescheduling.';
  const info=getSourceInfo(source);
  for(const option of field('timing').options)option.disabled=option.value!=='custom'&&(!info?.start_date||(['at','hour'].includes(option.value)&&!info?.start_time));
  if(linked&&mode!=='custom'){const due=relativeReminder(info,mode,field('time').value,editing?.timezone||deviceZone());if(due){field('date').value=due.date;field('time').value=due.time;}}
  preview();
 }
 function preview(){editor.querySelector('[data-reminder-zone]').textContent='Time zone: '+(editing?.timezone||deviceZone())+'. Daylight-saving changes follow this zone. No phone notifications are sent in this stage.';const zone=editing?.timezone||deviceZone(),mode=source?.link_kind==='standalone'?'custom':field('timing').value;const ms=mode==='custom'?zonedInstant(field('date').value,field('time').value,zone):relativeDue(getSourceInfo(source),mode,field('time').value,zone);if(Number.isFinite(ms))editor.querySelector('[data-reminder-zone]').textContent+=' Due: '+formatReminderTime(new Date(ms).toISOString())+'.';}
 async function open(existing=null,link={link_kind:'standalone'},label=''){
  if(!isSignedIn()){signIn();return;}if(busy||editor.open)return;
  focus=document.activeElement;source=existing?{link_kind:existing.link_kind,task_id:existing.task_id,plan_id:existing.plan_id,routine_id:existing.routine_id,occurrence_date:existing.occurrence_date}:link;
  // Always reload before editing so source-trigger revisions cannot be overwritten.
  const expectedId=existing?.id;await load();if(!ready()){if(isSignedIn())location.hash='#reminders';return;}
  existing=existing?data.reminders.find(r=>r.id===existing.id&&!r.deleted_at):findReminder(data,source);
  if(expectedId&&!existing){error='This reminder was removed. Reload to see the latest reminders.';location.hash='#reminders';render();return;}
  if(existing)source={link_kind:existing.link_kind,task_id:existing.task_id,plan_id:existing.plan_id,routine_id:existing.routine_id,occurrence_date:existing.occurrence_date};
  editing=existing||{id:newId(),version:null,timezone:deviceZone()};
  const pending=data.occurrences.find(o=>o.reminder_id===editing.id&&o.status==='pending');
  field('title').value=existing?.title||label;field('notes').value=existing?.notes||'';field('date').value=pending?.due_date||existing?.anchor_date||dateKey(new Date());field('time').value=(pending?.due_time||existing?.anchor_time||'09:00').slice(0,5);field('repeat_rule').value=existing?.repeat_rule||'never';field('timing').value=existing?.timing||'custom';
  editor.querySelector('h2').textContent=existing?'Edit reminder':'Also set a reminder';editor.querySelector('[data-reminder-delete]').hidden=!existing;alert.textContent='';editor.querySelectorAll('button,input,select,textarea').forEach(c=>c.disabled=false);shape();editor.showModal();field(source.link_kind==='standalone'?'title':'date').focus();
 }
 editor.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();if(!ready()||!editing)return;try{const item=editing,values=reminderValues({title:field('title').value,notes:field('notes').value,date:field('date').value,time:field('time').value,timing:source.link_kind==='standalone'?'custom':field('timing').value,repeat_rule:source.link_kind==='standalone'?field('repeat_rule').value:'never',timezone:item.timezone},source);if(await write(()=>repository.change(item.id,item.version,'save',values))&&editing===item)editor.close();}catch(e){alert.textContent=e.message;}});
 async function remove(r){if(!confirm('Delete this reminder? Its pending occurrence will be cancelled. Dismissed history and the original task or event will be kept.'))return;if(await write(()=>repository.change(r.id,r.version,'delete'))&&editor.open)editor.close();}
 field('timing').addEventListener('change',shape);field('time').addEventListener('change',()=>{if(['day','week'].includes(field('timing').value))shape();else preview();});field('date').addEventListener('change',preview);editor.querySelector('[data-reminder-delete]').addEventListener('click',()=>remove(editing));editor.querySelector('[data-cancel]').addEventListener('click',()=>editor.close());editor.addEventListener('cancel',e=>{if(busy)e.preventDefault();});editor.addEventListener('close',()=>{editing=null;source=null;if(focus?.isConnected)focus.focus({preventScroll:true});else document.getElementById(root.hidden?(location.hash.startsWith('#coming')?'comingHeading':'weekHeading'):'remindersHeading')?.focus({preventScroll:true});});
 $('#reminderAdd').addEventListener('click',()=>open());$('#reminderReload').addEventListener('click',load);$('#reminderSignIn').addEventListener('click',signIn);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!root.hidden&&!editor.open)void load();});setInterval(()=>{if(!root.hidden&&!editor.open&&!loading&&!busy)render();},30000);
 return {open(hash){history=hash==='#reminders-history';render();void load();},render,openLinked:(link,title)=>open(null,link,title),refreshIfLoaded(){if(data&&!busy&&!editor.open)void load();},reset(){epoch++;request++;data=null;loading=false;busy=false;error='';notice='';if(editor.open)editor.close();render();}};
}
