import { calendarDate, dateKey, validDate } from './dates.js?v=20261026-datefix';
export function comingValues(input) {
  const kind=input.kind;if(!['event','todo'].includes(kind))throw new Error('Choose Event / Appointment or To-do item.');
  const title=String(input.title??'').trim(),notes=String(input.notes??'').trim();
  if(!title||title.length>500)throw new Error('Enter a title of 1–500 characters.');
  if(notes.length>5000)throw new Error('Keep notes to 5,000 characters or fewer.');
  const start_date=input.start_date||null,end_date=kind==='event'?(input.end_date||null):null;
  if((start_date&&!validDate(start_date))||(end_date&&!validDate(end_date)))throw new Error('Choose a valid calendar date.');
  if(end_date&&(!start_date||end_date<start_date))throw new Error('The end date must be on or after the start date.');
  const all_day=!start_date|| (kind==='event'?!!input.all_day:!input.start_time);
  const start_time=all_day?null:(input.start_time||'');
  if(!all_day&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(start_time))throw new Error('Choose a valid time or mark the event All day.');
  return {kind,title,notes,start_date,end_date,start_time,all_day};
}
export function hydrateComing(entries,tasks) {
  const byId=new Map(tasks.map(t=>[String(t.id),t]));
  return entries.flatMap(entry=>{
    if(entry.kind==='event')return [{...entry,completed:false}];
    const task=byId.get(String(entry.task_id));
    // project=null is reserved for independently managed Coming Up tasks.
    return task&&task.project===null?[{...entry,title:task.task,start_date:task.scheduled_date,end_date:null,completed:!!task.completed,task}]:[];
  });
}
export const endDate=item=>item.end_date||item.start_date;
export function comingGroups(items,today=dateKey(new Date())) {
  const result={someday:[],overdue:[],upcoming:[],history:[]};
  for(const item of items) {
    if(!item.start_date)result.someday.push(item);
    else if(item.kind==='todo') {
      if(item.completed)result.history.push(item);
      else if(item.start_date<today)result.overdue.push(item);
      else result.upcoming.push(item);
    } else if(endDate(item)<today)result.history.push(item);
    else result.upcoming.push(item);
  }
  const ascending=(a,b)=>(a.start_date||'').localeCompare(b.start_date||'')||(a.start_time||'').localeCompare(b.start_time||'')||a.title.localeCompare(b.title)||a.id.localeCompare(b.id);
  result.someday.sort((a,b)=>a.title.localeCompare(b.title)||a.id.localeCompare(b.id));
  result.overdue.sort(ascending);
  result.upcoming.sort((a,b)=>upcomingDate(a,today).localeCompare(upcomingDate(b,today))||ascending(a,b));
  result.history.sort((a,b)=>(endDate(b)||'').localeCompare(endDate(a)||'')||ascending(a,b));return result;
}
export const upcomingDate=(item,today)=>item.start_date<today?today:item.start_date;
export function monthGroups(items,today,history=false) {
  const groups=new Map();
  for(const item of items){const key=(history?endDate(item):upcomingDate(item,today)).slice(0,7);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);}
  return [...groups].map(([key,items])=>({key,label:new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric'}).format(calendarDate(key+'-01')),items}));
}
export function eventsOn(items,date) {
  return items.filter(e=>e.kind==='event'&&e.start_date&&e.start_date<=date&&endDate(e)>=date)
    .sort((a,b)=>Number(b.all_day)-Number(a.all_day)||(a.start_time||'').localeCompare(b.start_time||'')||a.title.localeCompare(b.title));
}
export function timing(item,date='') {
  if(!item.start_date)return 'No date yet';
  if(item.kind==='todo')return item.start_time?item.start_time.slice(0,5):'Anytime';
  if(item.all_day)return 'All day';
  return date&&date!==item.start_date?'Continues':(item.start_time||'').slice(0,5);
}
export function itemDate(item) {
  if(!item.start_date)return 'Someday';
  const format=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric'}),weekday=new Intl.DateTimeFormat('en-GB',{weekday:'long'});
  const start=calendarDate(item.start_date),end=calendarDate(endDate(item));
  if(!start||!end)return '';
  if(item.end_date&&item.end_date!==item.start_date)return `${format.format(start)} – ${format.format(end)} · ${weekday.format(start)}–${weekday.format(end)}`;
  return `${format.format(start)} · ${weekday.format(start)}`;
}
