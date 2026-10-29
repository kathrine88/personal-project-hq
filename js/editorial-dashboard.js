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
  const [milestones,movements,weights,coming,purchases,daily]=await Promise.all([
   client.from('hq_project_milestones').select('project,completed'),
   client.from('hq_money_movements').select('kind,amount_pence'),
   client.from('hq_weight_logs').select('logged_on,pounds').order('logged_on',{ascending:false}).limit(8),
   client.from('hq_coming_up').select('title,start_date').gte('start_date',iso).order('start_date').limit(1),
   client.from('hq_money_purchases').select('project,status,actual_pence,estimated_pence'),
   client.from('hq_money_daily').select('amount_pence')
  ]);
  if(current!==generation)return;
  const all=getTasks()||[];
  const todays=all.filter(t=>t.scheduled_date===iso);
  const total=todays.length,done=todays.filter(t=>t.completed).length;
  const rows=milestones.data||[];
  const garden=rows.filter(m=>m.project==='Garden');
  const percentage=a=>a.length?Math.round(a.filter(m=>m.completed).length/a.length*100):null;
  const gardenTasks=all.filter(t=>t.project==='Garden');
  const gardenPurchases=(purchases.data||[]).filter(p=>p.project==='Garden');
  const gardenTotal=garden.length+gardenTasks.length+gardenPurchases.length;
  const gardenDone=garden.filter(m=>m.completed).length+gardenTasks.filter(t=>t.completed).length+gardenPurchases.filter(p=>p.status==='purchased').length;
  const gp=gardenTotal?Math.round(gardenDone/gardenTotal*100):null;
  const moves=movements.data||[];
  const balance=(daily.data||[]).reduce((n,d)=>n+Number(d.amount_pence||0),0)+moves.reduce((n,m)=>n+(m.kind==='deposit'?1:-1)*Number(m.amount_pence||0),0)-(purchases.data||[]).filter(p=>p.status==='purchased').reduce((n,p)=>n+Number(p.actual_pence||0),0);
  const w=weights.data||[];
  const target=(purchases.data||[]).filter(p=>p.status==='planned').reduce((sum,p)=>sum+Number(p.estimated_pence||0),0);
  const saved=Math.max(0,balance);
  const targetPercent=target>0?Math.min(100,Math.max(0,Math.round(saved/target*100))):0;
  const next=coming.data?.[0];
  root.innerHTML = `
  <div class="hq-head"><span class="hq-kicker">PERSONAL PROJECT HQ</span><h1>Your Space</h1><p>${safe(date(today))} · Your life, at a glance.</p></div>
  <div class="hq-editorial-grid">
  ${card('#week','hq-today',`<span class="hq-kicker">TODAY · YOUR PLANNER</span><div class="hq-today-stat"><strong>${total}</strong><span>tasks today<br><b>${done} completed</b></span></div><span class="hq-bar"><i style="width:${total?Math.round(done/total*100):0}%"></i></span>`)}
  ${card('#project/Health%20%26%20Fitness','hq-wellbeing',`<span class="hq-kicker">HEALTH & WELLBEING</span><div class="hq-wellbeing-body"><span><strong>Feeling good, making progress</strong><span class="hq-sub">Mood · movement · sleep</span></span></div><span class="hq-wellbeing-note">${weights.error?'Weight history unavailable':w.length?'Latest weight: '+safe(Number(w[0].pounds).toFixed(1))+' lb':'Your next check-in starts here'}</span>`)}
  ${card('#money','hq-money',`<span class="hq-kicker">PURCHASE FUND</span><strong>${safe(movements.error||daily.error||purchases.error?'—':money(saved))}</strong><span class="hq-sub">${target>0?'of '+money(target)+' planned purchases':'No planned purchase estimates yet'}</span><span class="hq-bar"><i style="width:${targetPercent}%"></i></span>`)}
  ${card('#project/Garden','hq-garden',`<span class="hq-kicker">GARDEN PROGRESS</span><div class="hq-garden-body">${gp===null?'<span class="hq-ring-empty">—</span>':ring(gp)}<span class="hq-sub">${gp===null?'Add milestones to track progress':gardenDone+' of '+gardenTotal+' tasks, milestones & purchases'}</span></div>`)}
  ${card('#coming','hq-coming',`<span class="hq-kicker">COMING UP</span><strong>${next?safe(next.title):'Nothing imminent'}</strong><span class="hq-sub">${next?safe(next.start_date):'Your upcoming events and occasions'}</span>`)}
  </div>`;
 }
 return {refresh,reset(){generation++;root.replaceChildren();}};
}
