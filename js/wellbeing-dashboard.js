import {addDays,calendarDate,dateKey,monday} from './dates.js?v=20261026-datefix';

export function createWellbeingDashboard({host,repository,isSignedIn}) {
  let week=monday(),request=0,visible=false;
  const format=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short'});
  const weekday=new Intl.DateTimeFormat('en-GB',{weekday:'short'});
  const make=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=txt;return n;};
  const header=make('div','wellness-dashboard-header');
  const back=make('button','wellness-back','← Health & Wellbeing');back.type='button';
  const title=make('h2','','Your wellbeing');header.append(back,title);
  const controls=make('div','wellness-week-controls');
  const prev=make('button','','‹');const next=make('button','','›');
  prev.type=next.type='button';prev.setAttribute('aria-label','Previous week');next.setAttribute('aria-label','Next week');
  const range=make('strong');controls.append(prev,range,next);
  const status=make('p','wellness-dashboard-status');
  const cards=make('div','wellness-week-days');
  const summaries=make('div','wellness-summary-grid');
  const notes=make('section','wellness-journal');
  host.append(header,controls,status,cards,summaries,notes);
  const values={mood:['Low','Flat','Okay','Good','Great'],energy:['Very low','Low','Okay','Good','High'],rested:['Exhausted','Tired','Okay','Rested','Refreshed']};
  function metric(label,items,field) {
    const valid=items.map(x=>x[field]).filter(x=>Number.isInteger(x)&&x>=1&&x<=5);
    const box=make('article','wellness-metric');
    box.append(make('small','',label),make('strong','',valid.length?(valid.reduce((a,b)=>a+b,0)/valid.length).toFixed(1)+' / 5':'—'),make('span','',valid.length?valid.length+' days recorded':'No entries yet'));
    summaries.append(box);
  }
  function show(active) {visible=active;host.hidden=!active;if(active)void load();}
  async function load(){
    if(!visible)return;
    const id=++request;
    range.textContent=format.format(week)+' – '+format.format(addDays(week,6));
    next.disabled=dateKey(addDays(week,7))>dateKey(monday());
    cards.replaceChildren();summaries.replaceChildren();notes.replaceChildren();
    if(!isSignedIn()){status.textContent='Sign in to see your private check-ins.';return;}
    if(!repository){status.textContent='Check-in storage is unavailable.';return;}
    status.textContent='Loading saved check-ins…';
    try{
      const records=await repository.list(dateKey(week),dateKey(addDays(week,6)));
      if(id!==request||!visible)return;
      const byDay=new Map(records.map(x=>[x.checkin_date,x]));
      status.textContent=records.length+' of 7 days logged';
      for(let i=0;i<7;i++){
        const day=addDays(week,i),key=dateKey(day),entry=byDay.get(key);
        const cell=make('article','wellness-day'+(entry?' is-logged':''));
        cell.append(make('small','',weekday.format(day)),make('strong','',String(day.getDate())),make('span','',entry?'♥':'○'));
        cell.setAttribute('aria-label',key+(entry?' logged':' not logged'));cards.append(cell);
      }
      metric('Mood',records,'mood');metric('Energy',records,'energy');metric('Restfulness',records,'rested');
      const sleep=records.map(x=>x.sleep_minutes).filter(x=>Number.isFinite(x));
      const box=make('article','wellness-metric');
      const average=sleep.length?sleep.reduce((a,b)=>a+b,0)/sleep.length:null;
      box.append(make('small','','Average sleep'),make('strong','',average===null?'—':Math.floor(average/60)+'h '+Math.round(average%60)+'m'),make('span','',sleep.length?sleep.length+' nights recorded':'No entries yet'));
      summaries.append(box);
      notes.append(make('h3','','Your daily journal'));
      if(!records.length)notes.append(make('p','','No check-ins this week yet. Use the little hearts on your Weekly Planner to start.'));
      for(const row of [...records].sort((a,b)=>b.checkin_date.localeCompare(a.checkin_date))){
        const item=make('article','wellness-journal-entry');
        item.append(make('strong','',format.format(calendarDate(row.checkin_date))));
        const bits=['mood','energy','rested'].filter(k=>row[k]!=null&&values[k][row[k]-1]).map(k=>k[0].toUpperCase()+k.slice(1)+': '+values[k][row[k]-1]);
        if(row.sleep_minutes!=null)bits.push('Sleep: '+Math.floor(row.sleep_minutes/60)+'h '+row.sleep_minutes%60+'m');
        item.append(make('p','',bits.join(' · ')||'Check-in saved'));
        if(row.notes)item.append(make('p','wellness-journal-note',row.notes));
        notes.append(item);
      }
    }catch(error){if(id===request)status.textContent='Could not load your check-ins: '+(error.message||'Please try again.');}
  }
  prev.addEventListener('click',()=>{week=addDays(week,-7);void load();});
  next.addEventListener('click',()=>{if(dateKey(addDays(week,7))<=dateKey(monday())){week=addDays(week,7);void load();}});
  return {show,back,refresh:load};
}
