import {addDays,dateKey,monday} from '../../js/dates.js?v=20261026-datefix';
export function createWellbeingOverview(host,repository,isSignedIn,weightRepository,workoutRepository){
  const summary=document.createElement('div');summary.className='wellness-overview-summary';
  const chart=document.createElement('section');chart.className='wellness-overview-chart';
  const weight=document.createElement('section');weight.className='wellness-overview-chart';
  host.append(summary,chart,weight);
  const node=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=txt;return n;};
  function panel(label,value,detail){const n=node('article','wellness-overview-stat');n.append(node('small','',label),node('strong','',value),node('span','',detail));summary.append(n);}
  function plot(parent,title,sub,series){
    parent.replaceChildren(node('h3','',title),node('p','',sub));
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 330 119');svg.setAttribute('role','img');svg.setAttribute('aria-label',title);
    const line=(x1,y1,x2,y2,color)=>{const e=document.createElementNS(svg.namespaceURI,'line');for(const [k,v] of Object.entries({x1,y1,x2,y2,stroke:color,'stroke-width':1}))e.setAttribute(k,v);svg.append(e);};
    [16,48,80].forEach(y=>line(15,y,318,y,'#e0e4d9'));
    series.forEach(({name,color,points})=>{
      const coords=points.filter(p=>Number.isFinite(p.value)).map(p=>[18+p.i*48,91-(p.value-1)*19]);
      if(coords.length>1){const path=document.createElementNS(svg.namespaceURI,'polyline');path.setAttribute('points',coords.map(p=>p.join(',')).join(' '));path.setAttribute('fill','none');path.setAttribute('stroke',color);path.setAttribute('stroke-width','2.5');path.setAttribute('stroke-linecap','round');svg.append(path);}
      coords.forEach(([cx,cy])=>{const dot=document.createElementNS(svg.namespaceURI,'circle');dot.setAttribute('cx',cx);dot.setAttribute('cy',cy);dot.setAttribute('r','3');dot.setAttribute('fill',color);svg.append(dot);});
    });
    ['M','T','W','T','F','S','S'].forEach((d,i)=>{const t=document.createElementNS(svg.namespaceURI,'text');t.setAttribute('x',18+i*48);t.setAttribute('y','112');t.setAttribute('text-anchor','middle');t.setAttribute('font-size','11');t.setAttribute('fill','#6d806d');t.textContent=d;svg.append(t);});
    parent.append(svg);
    const legend=node('p','wellness-chart-legend',series.map(s=>s.name).join(' · '));parent.append(legend);
  }
  let refreshVersion=0;
  async function refresh(){
    const version=++refreshVersion;
    summary.replaceChildren();chart.replaceChildren();weight.replaceChildren();
    panel('Weight progress','—','No weigh-ins recorded yet');
    panel('Workouts','—','Workout tracking coming soon');
    panel('Average mood','—','This week');
    panel('Average sleep','—','This week');
    weight.append(node('h3','','Weight progress'),node('div','wellness-weight-empty','No weight entries yet')); 
    if(weightRepository && isSignedIn())try{const logs=await weightRepository.list();if(version!==refreshVersion)return;if(logs.length){const asc=[...logs].reverse(),first=Number(asc[0].pounds),last=Number(asc[asc.length-1].pounds);weight.replaceChildren(node('h3','','Weight progress'),node('p','', 'Starting '+first+' lb · Latest '+last+' lb · Change '+(last-first>0?'+':'')+(last-first).toFixed(1)+' lb'));const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 330 120');svg.setAttribute('role','img');svg.setAttribute('aria-label','Weight trend in pounds');const vals=asc.map(x=>Number(x.pounds)),lo=Math.min(...vals),hi=Math.max(...vals),span=Math.max(hi-lo,1);const pts=vals.map((v,i)=>[18+(vals.length===1?0:i*292/(vals.length-1)),89-(v-lo)/span*73]);if(pts.length>1){const line=document.createElementNS(svg.namespaceURI,'polyline');line.setAttribute('points',pts.map(p=>p.join(',')).join(' '));line.setAttribute('fill','none');line.setAttribute('stroke','#74463e');line.setAttribute('stroke-width','3');svg.append(line);}pts.forEach(([cx,cy])=>{const dot=document.createElementNS(svg.namespaceURI,'circle');dot.setAttribute('cx',cx);dot.setAttribute('cy',cy);dot.setAttribute('r','3');dot.setAttribute('fill','#74463e');svg.append(dot);});weight.append(svg);const dates=node('div','wellness-weight-dates');const format=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'2-digit'});const label=d=>format.format(new Date(d+'T12:00:00'));dates.append(node('span','',label(asc[0].logged_on)),node('span','',label(asc[asc.length-1].logged_on)));weight.append(dates);}}catch(e){if(version===refreshVersion)weight.append(node('p','','Weight history temporarily unavailable.'));}
    if(!isSignedIn()){chart.append(node('p','','Sign in to view your wellbeing trends.'));return;}
    if(!repository){chart.append(node('p','','Check-in history unavailable.'));return;}
    try{
      const start=monday(),rows=await repository.list(dateKey(start),dateKey(addDays(start,6)));
      if(version!==refreshVersion)return;
      const map=new Map(rows.map(r=>[r.checkin_date,r]));
      const points=Array.from({length:7},(_,i)=>map.get(dateKey(addDays(start,i))));
      const avg=key=>{const a=rows.map(r=>r[key]).filter(v=>Number.isFinite(v));return a.length?a.reduce((x,y)=>x+y,0)/a.length:null;};
      const mood=avg('mood'),sleep=avg('sleep_minutes');
      summary.replaceChildren();
      const weightLogs=weightRepository?await weightRepository.list().catch(()=>[]):[];
      if(version!==refreshVersion)return;
      const newest=weightLogs[0],oldest=weightLogs[weightLogs.length-1];
      panel('Weight progress',newest?Number(newest.pounds)+' lb':'—',newest?'Change: '+(Number(newest.pounds)-Number(oldest.pounds)).toFixed(1)+' lb':'No weigh-ins recorded yet');
      const completions=workoutRepository?await workoutRepository.completions().catch(()=>[]):[];
      if(version!==refreshVersion)return;
      const weekStart=dateKey(start),weekEnd=dateKey(addDays(start,6));
      const workoutCount=completions.filter(x=>x.completed_on>=weekStart&&x.completed_on<=weekEnd).length;
      panel('Workouts',String(workoutCount),'Completed this week');
      panel('Average mood',mood===null?'—':mood.toFixed(1)+' / 5','This week');
      panel('Average sleep',sleep===null?'—':Math.floor(sleep/60)+'h '+Math.round(sleep%60)+'m','This week');
      plot(chart,'Mood & energy trends','Your check-ins this week',[
        {name:'Mood',color:'#65866c',points:points.map((r,i)=>({i,value:r?.mood}))},
        {name:'Energy',color:'#bc8b6b',points:points.map((r,i)=>({i,value:r?.energy}))}
      ]);
      if(!rows.length)chart.append(node('p','','No check-ins this week yet.'));
    }catch(e){if(version===refreshVersion)chart.append(node('p','','Could not load check-ins. Please try reopening Health & Wellbeing.'));}
  }
  return {refresh};
}
