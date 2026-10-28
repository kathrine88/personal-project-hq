import { validDate } from './dates.js?v=20261026-datefix';
export const repeatLabels={never:'Never',daily:'Every day',weekly:'Every week',monthly:'Every month',yearly:'Every year'};
export function deviceZone(){return Intl.DateTimeFormat().resolvedOptions().timeZone||'Europe/London';}
export function reminderValues(values,source={link_kind:'standalone'}){
 const title=String(values.title||'').trim(),notes=String(values.notes||'');
 if(source.link_kind==='standalone'&&(!title||title.length>2000))throw Error('Enter a title (up to 2,000 characters).');
 if(notes.length>5000)throw Error('Keep notes under 5,001 characters.');
 const timing=values.timing||'custom',repeat_rule=values.repeat_rule||'never';
 if(!['custom','at','hour','day','week'].includes(timing)||!Object.hasOwn(repeatLabels,repeat_rule))throw Error('Choose a reminder timing and repetition.');
 if(source.link_kind!=='standalone'&&repeat_rule!=='never')throw Error('Task and event reminders do not repeat.');
 if(!validDate(values.date)||values.date<'1900-01-01'||values.date>'9998-12-31')throw Error('Choose a date between 1900 and 9998.');
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(values.time||''))throw Error('Choose an actual reminder time.');
 const timezone=values.timezone||deviceZone();try{new Intl.DateTimeFormat('en',{timeZone:timezone});}catch{throw Error('This time zone is not recognised.');}
 return {...source,title,notes,date:values.date,time:values.time,timezone,timing,repeat_rule};
}
export function reminderGroups(snapshot,now=Date.now()){
 const roots=new Map((snapshot?.reminders||[]).map(r=>[r.id,r]));
 const data={attention:[],upcoming:[],history:[]};
 for(const o of snapshot?.occurrences||[]){const reminder=roots.get(o.reminder_id);if(!reminder)continue;const item={...o,reminder};if(o.status!=='pending')data.history.push(item);else if(!reminder.deleted_at)data[Date.parse(o.due_at)<=now?'attention':'upcoming'].push(item);}
 const asc=(a,b)=>Date.parse(a.due_at)-Date.parse(b.due_at)||a.id.localeCompare(b.id);
 data.attention.sort(asc);data.upcoming.sort(asc);data.history.sort((a,b)=>Date.parse(b.dismissed_at||b.cancelled_at)-Date.parse(a.dismissed_at||a.cancelled_at)||asc(a,b));return data;
}
export function formatReminderTime(value){return new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(new Date(value));}
export function findReminder(snapshot,source){return snapshot?.reminders.find(r=>!r.deleted_at&&r.link_kind===source.link_kind&&(['task','plan','routine'].includes(source.link_kind)?r[source.link_kind+'_id']==source[source.link_kind+'_id']&&(source.link_kind!=='routine'||r.occurrence_date===source.occurrence_date):false));}
// Resolve a civil time in an IANA zone. Choose the later instant on overlaps;
// spring gaps move forward, matching PostgreSQL's AT TIME ZONE policy.
export function zonedInstant(date,time,zone){
 if(!validDate(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time||''))return NaN;
 const [y,m,d]=date.split('-').map(Number),[h,min]=time.split(':').map(Number),wall=Date.UTC(y,m-1,d,h,min);
 const format=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const civil=ms=>Object.fromEntries(format.formatToParts(new Date(ms)).map(p=>[p.type,p.value]));
 const offsets=new Set();for(const delta of [-36,0,36]){const ms=wall+delta*3600000,p=civil(ms);offsets.add(Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute)-ms);}
 const candidates=[...offsets].map(o=>wall-o),matches=candidates.filter(ms=>{const p=civil(ms);return +p.year===y&&+p.month===m&&+p.day===d&&+p.hour===h&&+p.minute===min;});return Math.max(...(matches.length?matches:candidates));
}
export function inZone(ms,zone){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms)).map(p=>[p.type,p.value]));return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};}
export function relativeReminder(info,mode,clock,zone){
 if(!info?.start_date||!validDate(info.start_date))return null;
 if(['at','hour'].includes(mode)){if(!info.start_time)return null;return inZone(zonedInstant(info.start_date,info.start_time.slice(0,5),zone)-(mode==='hour'?3600000:0),zone);}
 if(['day','week'].includes(mode)){const d=new Date(info.start_date+'T12:00:00');d.setDate(d.getDate()-(mode==='day'?1:7));return {date:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,time:clock};}return null;
}

export function relativeDue(info,mode,clock,zone){if(['at','hour'].includes(mode))return info?.start_date&&info?.start_time?zonedInstant(info.start_date,info.start_time.slice(0,5),zone)-(mode==='hour'?3600000:0):NaN;const due=relativeReminder(info,mode,clock,zone);return due?zonedInstant(due.date,due.time,zone):NaN;}
