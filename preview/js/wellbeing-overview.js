import {addDays,dateKey,monday} from '../../js/dates.js?v=20261026-datefix';
export function createWellbeingOverview(host,repository,isSignedIn){
  const summary=document.createElement('div');summary.className='wellness-overview-summary';
  const chart=document.createElement('section');chart.className='wellness-overview-chart';
  const weight=document.createElement('section');weight.className='wellness-overview-chart';
  host.append(summary,chart,weight);
  const node=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=txt;return n;};
  function panel(label,value,detail){const n=node('article','wellness-overview-stat');n.append(node('small','',label),node('strong','',value),node('span','',detail));summary.append(n);}
  function plot(parent,title,sub,series){
    parent.replaceChildren(node('h3','',title),node('p','',sub));
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 330 145');svg.setAttribute('role','img');svg.setAttribute('aria-label',title);
    const line=(x1,y1,x2,y2,color)=>{const e=document.createElementNS(svg.namespaceURI,'line');for(const [k,v] of Object.entries({x1,y1,x2,y2,stroke:color,'stroke-width':1}))e.setAttribute(k,v);svg.append(e);};
    [30,65,100].forEach(y=>line(15,y,318,y,'#e0e4d9'));
    series.forEach(({name,color,points})=>{
      const coords=points.filter(p=>Number.isFinite(p.value)).map(p=>[18+p.i*48,112-(p.value-1)*22]);
      if(coords.length>1){const path=document.createElementNS(svg.namespaceURI,'polyline');path.setAttribute('points',coords.map(p=>p.join(',')).join(' '));path.setAttribute('fill','none');path.setAttribute('stroke',color);path.setAttribute('stroke-width','2.5');path.setAttribute('stroke-linecap','round');svg.append(path);}
      coords.forEach(([cx,cy])=>{const dot=document.createElementNS(svg.namespaceURI,'circle');dot.setAttribute('cx',cx);dot.setAttribute('cy',cy);dot.setAttribute('r','3');dot.setAttribute('fill',color);svg.append(dot);});
    });
    ['M','T','W','T','F','S','S'].forEach((d,i)=>{const t=document.createElementNS(svg.namespaceURI,'text');t.setAttribute('x',18+i*48);t.setAttribute('y','135');t.setAttribute('text-anchor','middle');t.setAttribute('font-size','11');t.setAttribute('fill','#6d806d');t.textContent=d;svg.append(t);});
    parent.append(svg);
    const legend=node('p','wellness-chart-legend',series.map(s=>s.name).join(' · '));parent.append(legend);
  }
  async function refresh(){
    summary.replaceChildren();chart.replaceChildren();weight.replaceChildren();
    panel('Weight progress','—','No weigh-ins recorded yet');
    panel('Workouts','—','Workout tracking coming soon');
    panel('Average mood','—','This week');
    panel('Average sleep','—','This week');
    weight.append(node('h3','','Weight progress'),node('p','','Your weight chart will appear here once weight logging is available.'),node('div','wellness-weight-empty','No weight entries yet'));
    if(!isSignedIn()){chart.append(node('p','','Sign in to view your wellbeing trends.'));return;}
    if(!repository){chart.append(node('p','','Check-in history unavailable.'));return;}
    try{
      const start=monday(),rows=await repository.list(dateKey(start),dateKey(addDays(start,6)));
      const map=new Map(rows.map(r=>[r.checkin_date,r]));
      const points=Array.from({length:7},(_,i)=>map.get(dateKey(addDays(start,i))));
      const avg=key=>{const a=rows.map(r=>r[key]).filter(v=>Number.isFinite(v));return a.length?a.reduce((x,y)=>x+y,0)/a.length:null;};
      const mood=avg('mood'),sleep=avg('sleep_minutes');
      summary.replaceChildren();
      panel('Weight progress','—','No weigh-ins recorded yet');
      panel('Workouts','—','Workout tracking coming soon');
      panel('Average mood',mood===null?'—':mood.toFixed(1)+' / 5','This week');
      panel('Average sleep',sleep===null?'—':Math.floor(sleep/60)+'h '+Math.round(sleep%60)+'m','This week');
      plot(chart,'Mood & energy trends','Your check-ins this week',[
        {name:'Mood',color:'#65866c',points:points.map((r,i)=>({i,value:r?.mood}))},
        {name:'Energy',color:'#bc8b6b',points:points.map((r,i)=>({i,value:r?.energy}))}
      ]);
      if(!rows.length)chart.append(node('p','','No check-ins this week yet.'));
    }catch(e){chart.append(node('p','','Could not load check-ins. Please try reopening Health & Wellbeing.'));}
  }
  return {refresh};
}
