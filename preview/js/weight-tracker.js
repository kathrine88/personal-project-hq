export function createWeightTracker({host,repository,isSignedIn,onChange}){
  const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=txt;return n;};
  const back=el('button','wellness-back','← Health & Wellbeing');back.type='button';
  const title=el('h2','','Weight & measurements');
  const intro=el('p','','Record your weight in pounds and see your progress over time.');
  const form=el('form','weight-entry-form');
  const date=el('input'),pounds=el('input'),save=el('button','','Save weigh-in');
  date.type='date';date.required=true;pounds.type='number';pounds.step='0.1';pounds.min='1';pounds.max='1499.9';pounds.placeholder='Weight (lb)';pounds.required=true;save.type='submit';
  date.setAttribute('aria-label','Weigh-in date');pounds.setAttribute('aria-label','Weight in pounds');
  form.append(date,pounds,save);
  const status=el('p','weight-status');status.setAttribute('role','status');
  const chart=el('section','wellness-overview-chart');
  const history=el('section','weight-history');
  host.append(back,title,intro,form,status,chart,history);
  const today=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
  const fmt=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric'});
  const dateLabel=s=>fmt.format(new Date(s+'T12:00:00'));
  let visible=false,token=0,entries=[];
  function draw(){
    chart.replaceChildren(el('h3','','Your weight progress'));
    if(!entries.length){chart.append(el('div','wellness-weight-empty','Your first weigh-in will start your chart.'));return;}
    const ascending=[...entries].sort((a,b)=>a.logged_on.localeCompare(b.logged_on));
    const first=ascending[0],last=ascending[ascending.length-1],delta=last.pounds-first.pounds;
    const info=el('p','', 'Starting: '+first.pounds+' lb · Latest: '+last.pounds+' lb · Change: '+(delta>0?'+':'')+delta.toFixed(1)+' lb');
    chart.append(info);
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 330 160');svg.setAttribute('role','img');svg.setAttribute('aria-label','Weight history chart in pounds');
    const values=ascending.map(x=>Number(x.pounds)),min=Math.min(...values),max=Math.max(...values),span=Math.max(max-min,1);
    const points=values.map((v,i)=>[22+(ascending.length===1?0:i*286/(ascending.length-1)),132-(v-min)/span*103]);
    for(let i=0;i<3;i++){const line=document.createElementNS(svg.namespaceURI,'line');line.setAttribute('x1','22');line.setAttribute('x2','310');line.setAttribute('y1',String(29+i*51));line.setAttribute('y2',String(29+i*51));line.setAttribute('stroke','#e0dfd1');svg.append(line);}
    if(points.length>1){const path=document.createElementNS(svg.namespaceURI,'polyline');path.setAttribute('points',points.map(p=>p.join(',')).join(' '));path.setAttribute('fill','none');path.setAttribute('stroke','#74463e');path.setAttribute('stroke-width','3');svg.append(path);}
    points.forEach(([cx,cy])=>{const dot=document.createElementNS(svg.namespaceURI,'circle');dot.setAttribute('cx',String(cx));dot.setAttribute('cy',String(cy));dot.setAttribute('r','3.5');dot.setAttribute('fill','#74463e');svg.append(dot);});
    chart.append(svg);
  }
  async function refresh(){
    if(!visible)return;const current=++token;status.textContent='Loading your weigh-ins…';
    if(!isSignedIn()){status.textContent='Sign in to record your weight.';return;}
    try{entries=await repository.list();if(current!==token)return;status.textContent=entries.length+' weigh-in'+(entries.length===1?'':'s')+' recorded';draw();history.replaceChildren(el('h3','','Weigh-in history'));for(const row of entries){const item=el('div','weight-history-item');item.append(el('span','',dateLabel(row.logged_on)),el('strong','',row.pounds+' lb'));const edit=el('button','','Edit'),del=el('button','','Delete');edit.type=del.type='button';edit.addEventListener('click',()=>{date.value=row.logged_on;pounds.value=row.pounds;pounds.focus();status.textContent='Editing '+dateLabel(row.logged_on)+'. Saving replaces the entry for this date.';});del.addEventListener('click',async()=>{if(!confirm('Delete weigh-in for '+dateLabel(row.logged_on)+'?'))return;try{await repository.remove(row.id);await refresh();onChange?.();}catch(e){status.textContent=e.message;}});item.append(edit,del);history.append(item);}}
    catch(e){if(current===token)status.textContent='Could not load weigh-ins: '+e.message;}
  }
  form.addEventListener('submit',async e=>{e.preventDefault();if(!isSignedIn())return;save.disabled=true;status.textContent='Saving…';try{await repository.save(date.value,Number(pounds.value));pounds.value='';await refresh();onChange?.();}catch(error){status.textContent=error.message;}finally{save.disabled=false;}});
  function show(value){visible=value;host.hidden=!value;if(value){date.value=today();void refresh();}}
  return {show,back,refresh};
}
