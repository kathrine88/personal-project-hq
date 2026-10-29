export function createEditorialDashboard({root,client,projects,getTasks,getWeekTasks}) {
 const money = n => new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(n/100);
 const date = d => new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'long'}).format(d);
 const safe = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ring = (percent) => '<span class="hq-ring" style="--progress:'+percent+'%"><span>'+percent+'%</span></span>';
 const card=(href,cls,content)=>'<a class="hq-card '+cls+'" href="./index.html'+href+'">'+content+'<span class="hq-arrow" aria-hidden="true">↗</span></a>';
 let generation=0;
 async function refresh() {
  const current=++generation;
  const today=new Date(), iso=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
  const [milestones,movements,weights,coming]=await Promise.all([
   client.from('hq_project_milestones').select('project,completed'),
   client.from('hq_money_movements').select('kind,amount_pence'),
   client.from('hq_weight_logs').select('logged_on,pounds').order('logged_on',{ascending:false}).limit(8),
   client.from('hq_coming_up').select('title,start_date').gte('start_date',iso).order('start_date').limit(1)
  ]);
  if(current!==generation)return;
  const all=getTasks()||[];
  const todays=all.filter(t=>t.scheduled_date===iso);
  const total=todays.length,done=todays.filter(t=>t.completed).length;
  const rows=milestones.data||[];
  const garden=rows.filter(m=>m.project==='Garden');
  const percentage=a=>a.length?Math.round(a.filter(m=>m.completed).length/a.length*100):null;
  const gp=percentage(garden);
  const moves=movements.data||[];
  const balance=moves.reduce((n,m)=>n+(m.kind==='withdrawal'||m.kind==='purchase'?-1:1)*Number(m.amount_pence||0),0);
  const w=weights.data||[];
  const next=coming.data?.[0];
  const projectCards=projects.filter(p=>p.value!=='Garden'&&p.value!=='Health & Fitness').map(p=>{
   const a=rows.filter(m=>m.project===p.value),pct=percentage(a);
   return card('#project/'+encodeURIComponent(p.value),'hq-project-card','<span class="hq-kicker">YOUR PROJECTS</span><strong>'+safe(p.name)+'</strong><span class="hq-sub">'+(pct===null?'Open project to add milestones':pct+'% of milestones completed')+'</span>'+(pct===null?'':'<span class="hq-bar"><i style="width:'+pct+'%"></i></span>'));
  }).join('');
  root.innerHTML='<div class="hq-head"><span class="hq-kicker">PERSONAL PROJECT HQ</span><h1>Your Space</h1><p>'+safe(date(today))+' · Your world, at a glance.</p></div>'+
   '<div class="hq-editorial-grid">'+
   card('#week','hq-today','<span class="hq-kicker">TODAY · WEEKLY PLANNER</span><strong>'+total+' <small>tasks planned</small></strong><span class="hq-sub">'+done+' completed · '+Math.max(0,total-done)+' remaining</span><span class="hq-bar"><i style="width:'+(total?Math.round(done/total*100):0)+'%"></i></span>')+
   card('#money','hq-money','<span class="hq-kicker">MONEY</span><strong>'+safe(movements.error?'—':money(balance))+'</strong><span class="hq-sub">'+(movements.error?'Unable to load balance':'Net recorded movements · Open Money for your targets')+'</span>')+
   card('#project/Garden','hq-garden','<span class="hq-kicker">GARDEN PROJECT</span><div class="hq-garden-body">'+(gp===null?'<span class="hq-ring-empty">—</span>':ring(gp))+'<span><strong>Growing together</strong><span class="hq-sub">'+(gp===null?'Add milestones to see progress':garden.filter(m=>m.completed).length+' of '+garden.length+' milestones completed')+'</span></span></div>')+
   '<div class="hq-section-label">YOUR PROJECTS</div>'+projectCards+
   card('#project/Health%20%26%20Fitness','hq-wellbeing','<span class="hq-kicker">HEALTH & WELLBEING</span><strong>Little steps, lasting change</strong><span class="hq-sub">'+(weights.error?'Weight history unavailable':w.length?('Latest weight: '+Number(w[0].pounds).toFixed(1)+' lb · '+w.length+' recent entries'):'Log your first weight to begin your trend')+'</span>')+
   card('#coming','hq-coming','<span class="hq-kicker">COMING UP</span><strong>'+(next?safe(next.title):'Your next occasion')+'</strong><span class="hq-sub">'+(next?safe(next.start_date):'Open your events')+'</span>')+
   card('#reminders','hq-reminders','<span class="hq-kicker">REMINDERS</span><strong>Things to remember</strong><span class="hq-sub">Open your reminders and notifications</span>')+
   card('#meals','hq-meals','<span class="hq-kicker">MEAL PLANNER</span><strong>What is on the menu?</strong><span class="hq-sub">Open this week’s meals</span>')+
   '</div>';
 }
 return {refresh,reset(){generation++;root.replaceChildren();}};
}
