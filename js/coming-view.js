import { comingValues,hydrateComing,comingGroups,monthGroups,eventsOn,timing,itemDate } from './coming-core.js?v=20261026-coming';
import { calendarDate,dateKey } from './dates.js?v=20261026-datefix';
import { newMoneyId as newId } from './money-core.js?v=20261026-money';
export function createComingView({root,editor,repository,getTasks,isSignedIn,signIn,reload,completeTask,applyResult,beforeWrite=()=>{},changed=()=>{}}) {
  const $=s=>root.querySelector(s),field=name=>editor.querySelector('[name="'+name+'"]');
  const state={entries:null,loading:false,busy:false,error:'',notice:''};
  let history=false,editing=null,returnFocus=null,epoch=0,request=0,midnight=0;
  const ready=()=>isSignedIn()&&state.entries&&!state.loading&&!state.busy&&!state.error;
  const items=()=>state.entries?hydrateComing(state.entries,getTasks()):[];
  const el=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!=null)n.textContent=text;return n;};
  function button(text,label,action){const b=el('button','coming-control',text);b.type='button';b.setAttribute('aria-label',label);b.disabled=!ready();b.addEventListener('click',action);return b;}
  function list(rows,target,mode='') {
    target.replaceChildren();
    for(const item of rows) {
      const li=el('li','coming-card'+(item.completed?' is-complete':''));li.dataset.planId=item.id;
      const top=el('div','coming-card-top');top.append(el('p','coming-date',itemDate(item)));
      if(item.kind==='todo') {
        const check=el('input');check.type='checkbox';check.checked=item.completed;check.disabled=!ready();check.setAttribute('aria-label',`Mark ${item.title} ${item.completed?'incomplete':'complete'}`);
        check.addEventListener('change',()=>{const completed=check.checked;void write(()=>completeTask(item.task,completed)).then(()=>{if(!root.hidden)root.querySelector('[data-plan-id="'+item.id+'"] input')?.focus({preventScroll:true});});});const label=el('label','coming-check');label.append(check);top.append(label);
      }
      li.append(top,el('h3','',item.title),el('p','coming-kind',(item.kind==='event'?'Event':'To-do')+' · '+timing(item)));
      if(item.notes)li.append(el('p','coming-notes',item.notes));
      const actions=el('div','coming-actions');actions.append(button('Edit','Edit plan '+item.title,()=>openEditor(item)));
      if(!item.start_date||mode==='overdue')actions.append(button(item.start_date?'Reschedule':'Schedule','Schedule '+item.title,()=>openEditor(item,dateKey(new Date()))));
      actions.append(button('Delete','Delete plan '+item.title,()=>remove(item)));li.append(actions);target.append(li);
    }
  }
  function render() {
    const signed=isSignedIn(),data=comingGroups(items());
    $('#comingStatus').textContent=!signed?'Sign in to keep your future plans together.':state.loading?'Loading your plans…':state.notice;
    $('#comingError').textContent=state.error;$('#comingSignIn').hidden=signed;$('#comingSignIn').disabled=state.busy;$('#comingReload').hidden=!signed;$('#comingReload').disabled=state.loading||state.busy;
    $('#comingAdd').disabled=!ready();$('#comingAddIdea').disabled=!ready();root.setAttribute('aria-busy',String(state.loading||state.busy));
    $('#comingJump').hidden=history;
    $('#comingUpcoming').hidden=history;$('#comingHistory').hidden=!history;
    for(const tab of root.querySelectorAll('[data-coming-tab]'))tab.setAttribute('aria-current',tab.dataset.comingTab===(history?'history':'upcoming')?'page':'false');
    if(state.busy){
      // Keep the activated checkbox/row mounted while its request is pending.
      // Replacing it synchronously loses native touch/keyboard activation state.
      for(const control of root.querySelectorAll('button,input'))control.disabled=true;
      if(editor.open){for(const control of editor.querySelectorAll('button,input,select,textarea'))control.disabled=true;}
      return;
    }
    $('#comingJump').disabled=false;
    $('#comingSomedayCount').textContent=String(data.someday.length);$('#comingOverdueCount').textContent=String(data.overdue.length);
    $('#comingOverdue').hidden=!data.overdue.length;$('#comingSomedayEmpty').hidden=!state.entries||!!data.someday.length;
    list(data.someday,$('#comingSomedayRows'));list(data.overdue,$('#comingOverdueRows'),'overdue');
    for(const [target,rows,past] of [[$('#comingMonths'),data.upcoming,false],[$('#comingHistoryMonths'),data.history,true]]) {
      target.replaceChildren();
      for(const group of monthGroups(rows,dateKey(new Date()),past)) {
        const section=el('section','coming-month');section.append(el('h2','',group.label));const ul=el('ul','coming-list');list(group.items,ul);section.append(ul);target.append(section);
      }
    }
    $('#comingDatedEmpty').hidden=!state.entries||!!data.upcoming.length;$('#comingHistoryEmpty').hidden=!state.entries||!!data.history.length;
    if(editor.open) {
      editor.querySelector('[role=alert]').textContent=state.error;
      for(const control of editor.querySelectorAll('button,input,select,textarea'))control.disabled=state.busy;
      editor.querySelector('[type=submit]').disabled=!ready();editor.querySelector('[data-coming-delete]').disabled=!ready();
      if(!state.busy)formShape();
    }
  }
  async function write(operation) {
    if(!ready())return false;const token=epoch;request++;beforeWrite();state.busy=true;state.notice='Saving…';render();changed();
    try {
      const result=await operation();if(token!==epoch||!isSignedIn())return false;
      if(result?.entry_id){applyResult(result);state.entries=state.entries.filter(e=>e.id!==result.entry_id);if(result.entry)state.entries.push(result.entry);}
      state.notice='Saved.';return true;
    }catch(error){if(token===epoch){state.error=(error.message||'Could not save your plan.')+' Cancel and reload before retrying to check what was saved.';state.notice='';}return false;}
    finally{if(token===epoch&&isSignedIn()){state.busy=false;render();changed();}}
  }
  function formShape() {
    const event=field('kind').value==='event',dated=!!field('start_date').value;
    editor.querySelector('[data-coming-end]').hidden=!event;field('end_date').disabled=!event||!dated;
    editor.querySelector('[data-coming-all-day]').hidden=!event;field('all_day').disabled=!dated;
    field('start_time').disabled=!dated||(event&&field('all_day').checked);
    field('start_time').required=dated&&event&&!field('all_day').checked;
    editor.querySelector('[for=comingTimeInput]').textContent=event?'Start time':'Time (optional)';
    editor.querySelector('#comingDateHint').textContent=dated?'To-dos appear in the daily checklist; events appear above it.':'Leave the date empty to keep this in Someday. Add a date to set a time.';
  }
  function openEditor(item=null,scheduleDate=undefined) {
    if(!isSignedIn()){signIn();return;}
    if(!ready()){location.hash='#coming';render();return;}
    editing={id:item?.id||newId(),version:item?.version??null};returnFocus=document.activeElement;
    editor.querySelector('h2').textContent=item?'Edit plan':'A little something ahead';editor.querySelector('[role=alert]').textContent='';
    for(const control of editor.querySelectorAll('button,input,select,textarea'))control.disabled=false;
    field('kind').value=item?.kind||'event';field('title').value=item?.title||'';field('notes').value=item?.notes||'';
    field('start_date').value=scheduleDate!==undefined?scheduleDate:(item?.start_date||'');field('end_date').value=item?.end_date||'';
    field('start_time').value=item?.start_time?.slice(0,5)||'';field('all_day').checked=item?.all_day??true;
    editor.querySelector('[data-coming-delete]').hidden=!item;editor.querySelector('[type=submit]').disabled=false;
    formShape();editor.showModal();field('title').focus();
  }
  async function remove(item) {
    if(!confirm(`Delete “${item.title}”? This removes only this plan${item.kind==='todo'?' and its shared weekly to-do':''}. Other plans, tasks and routines stay unchanged.`))return;
    if(await write(()=>repository.remove(item.id,item.version))&&editor.open)editor.close();
  }
  editor.querySelector('form').addEventListener('submit',async event=>{
    event.preventDefault();if(!editing||!ready())return;
    try{
      const entry=editing,values=comingValues({kind:field('kind').value,title:field('title').value,notes:field('notes').value,start_date:field('start_date').value,end_date:field('end_date').disabled?'':field('end_date').value,start_time:field('start_time').value,all_day:field('all_day').checked});
      if(await write(()=>repository.save(entry.id,entry.version,values))&&editing===entry)editor.close();
    }catch(error){editor.querySelector('[role=alert]').textContent=error.message;}
  });
  for(const name of ['kind','start_date','all_day'])field(name).addEventListener('change',formShape);
  editor.querySelector('[data-cancel]').addEventListener('click',()=>editor.close());
  editor.addEventListener('cancel',event=>{if(state.busy)event.preventDefault();});
  editor.addEventListener('close',()=>{editing=null;if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});else document.getElementById(root.hidden?'weekHeading':'comingHeading')?.focus({preventScroll:true});});
  editor.querySelector('[data-coming-delete]').addEventListener('click',()=>{const item=items().find(i=>i.id===editing?.id);if(item)void remove(item);});
  $('#comingAdd').addEventListener('click',()=>openEditor(null,dateKey(new Date())));$('#comingAddIdea').addEventListener('click',()=>openEditor(null,''));
  $('#comingJump').addEventListener('click',()=>{$('#comingSomeday').open=true;$('#comingSomeday').scrollIntoView({block:'start'});$('#comingSomeday summary').focus({preventScroll:true});});
  $('#comingReload').addEventListener('click',()=>reload());$('#comingSignIn').addEventListener('click',signIn);
  function calendarRefresh(){render();changed();clearTimeout(midnight);const now=new Date(),next=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1,0,0,1);midnight=setTimeout(calendarRefresh,next-now);}
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)calendarRefresh();});
  const now=new Date();midnight=setTimeout(calendarRefresh,new Date(now.getFullYear(),now.getMonth(),now.getDate()+1,0,0,1)-now);
  return {
    render,open(hash){history=hash==='#coming-history';render();},
    beginLoad(){request++;state.loading=true;state.error='';render();},
    acceptLoad(entries,error){state.loading=false;state.entries=error?null:entries;state.error=error?.message||'';render();},
    async taskChanged(){
      if(!isSignedIn())return;const token=epoch,version=++request;
      try{const entries=await repository.load();if(token===epoch&&version===request&&isSignedIn()){state.entries=entries;state.loading=false;state.error='';}}
      catch(error){if(token===epoch&&version===request){state.loading=false;state.error=error.message+' Reload Coming Up to see current details.';}}
      if(token===epoch){render();changed();}
    },
    events:date=>eventsOn(items(),date),ideas:()=>comingGroups(items()).someday,
    taskMeta:task=>state.entries?.find(e=>String(e.task_id)===String(task.id)),
    editTask(task){const item=items().find(i=>String(i.task_id)===String(task.id));if(item)openEditor(item);else{location.hash='#coming';state.error||='Reload Coming Up before editing this personal task.';render();}},
    editEvent:openEditor,
    schedule(id,date){const item=items().find(i=>i.id===id);if(item)openEditor(item,date);},
    notice:()=>!isSignedIn()?'':state.error?'Coming Up is unavailable. Open Coming Up to reload; existing tasks still work.':state.loading?'Loading Coming Up…':'',
    reset(){epoch++;request++;Object.assign(state,{entries:null,loading:false,busy:false,error:'',notice:''});if(editor.open)editor.close();render();}
  };
}
