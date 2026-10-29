import {parsePounds,poundsInput,gbp,newMoneyId} from './money-core.js?v=20261029-null-estimates';
export function createProjectBuyList({host,repository,isSignedIn}) {
  let project='',sections=[],rows=[],filter='',busy=false,opened=false,expanded=null,error='';
  const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
  const sectionOf=row=>{
    const link=row.section_id;
    if(link && sections.some(s=>s.id===link))return link;
    const note=(row.notes||'').match(/Garden subsection:\s*([^\.\n]+)/i);
    return sections.find(s=>s.name.trim().toLowerCase()===note?.[1]?.trim().toLowerCase())?.id||'';
  };
  async function load(){
    if(!opened||!isSignedIn()||busy)return;
    busy=true;error='';render();
    try{const data=await repository.load();rows=data.purchases.filter(p=>p.project===project);}
    catch(e){error=e.message;}
    finally{busy=false;render();}
  }
  function show(nextProject,nextSections,visible){
    const changed=project!==nextProject;
    project=nextProject;sections=nextSections||[];opened=visible;
    host.hidden=!visible;
    if(changed){rows=[];filter='';expanded=null;}
    if(visible){render();if(changed||!rows.length)void load();}
  }
  async function save(row,values){
    busy=true;error='';render();
    try{await repository.save('purchases',row?.id||newMoneyId(),row?.version??null,{...values,project});expanded=null;busy=false;await load();}
    catch(e){error=e.message;busy=false;render();}
  }
  function editor(row=null){
    const modal=document.createElement('dialog');modal.className='project-buy-dialog';
    const form=make('form');form.method='dialog';
    form.append(make('h3','',row?'Purchase details':'Add purchase'));
    const field=(label,value='',tag='input')=>{const wrap=make('label','project-buy-field');wrap.append(make('span','',label));const input=make(tag);input.value=value??'';wrap.append(input);form.append(wrap);return input;};
    const name=field('Item name',row?.item||'');name.required=true;name.maxLength=500;
    const estimate=field('Estimated price (£; leave blank if unknown)',poundsInput(row?.estimated_pence));estimate.inputMode='decimal';
    const section=field('Subsection','','select');section.append(new Option('No subsection',''));sections.forEach(s=>section.append(new Option(s.name,s.id)));section.value=row?sectionOf(row):filter;
    const note=field('Notes',row?.notes||'','textarea');note.rows=3;
    const source=field('Product link',row?.source_url||'');source.type='url';
    const priority=field('Priority','','select');[['','None'],['low','Low'],['medium','Medium'],['high','High']].forEach(([v,t])=>priority.append(new Option(t,v)));priority.value=row?.priority||'';
    const status=field('Status','','select');status.append(new Option('To buy','planned'),new Option('Purchased','purchased'));status.value=row?.status||'planned';
    const actual=field('Actual paid (£; enter 0 if free)',poundsInput(row?.actual_pence));actual.inputMode='decimal';
    const date=field('Purchase date (optional)',row?.purchase_date||'');date.type='date';
    const message=make('p','project-buy-error');form.append(message);
    const actions=make('div','project-buy-actions'),cancel=make('button','','Cancel'),submit=make('button','','Save');
    cancel.type='button';submit.type='submit';actions.append(cancel,submit);form.append(actions);modal.append(form);document.body.append(modal);
    const close=()=>{modal.close();modal.remove();};cancel.onclick=close;modal.addEventListener('cancel',e=>{e.preventDefault();close();});
    form.addEventListener('submit',async e=>{
      e.preventDefault();
      try{
        const est=estimate.value.trim()?parsePounds(estimate.value):null;
        const paid=status.value==='purchased'?(actual.value.trim()?parsePounds(actual.value):est):null;
        if(!name.value.trim())throw Error('Enter an item name.');
        if(status.value==='purchased'&&paid===null)throw Error('Enter the actual price, or 0 if free.');
        let link=null;if(source.value.trim()){const url=new URL(source.value.trim());if(!['https:','http:'].includes(url.protocol))throw Error('Use an http or https link.');link=url.href;}
        let notes=note.value.trim().replace(/^Garden subsection:[^\n]*\.?\s*/i,'').trim();
        const chosen=sections.find(s=>s.id===section.value);
        if(chosen)notes='Garden subsection: '+chosen.name+'.'+(notes?' '+notes:'');
        const values={item:name.value.trim(),estimated_pence:est,priority:priority.value||null,notes,source_url:link,status:status.value,actual_pence:paid,purchase_date:status.value==='purchased'?(date.value||null):null};
        close();await save(row,values);
      }catch(err){message.textContent=err.message;}
    });
    modal.showModal();
  }
  function toggle(row){
    if(row.status==='purchased'){
      if(!confirm('Move this item back to To Buy? Its recorded actual spending will be removed.'))return;
      void save(row,{item:row.item,estimated_pence:row.estimated_pence,status:'planned',actual_pence:null,purchase_date:null,notes:row.notes,priority:row.priority,source_url:row.source_url});
    }else{
      const raw=prompt('Actual amount paid (£). Enter 0 if free.',row.estimated_pence==null?'':poundsInput(row.estimated_pence));
      if(raw===null)return;
      try{const amount=parsePounds(raw);void save(row,{item:row.item,estimated_pence:row.estimated_pence,status:'purchased',actual_pence:amount,purchase_date:new Date().toLocaleDateString('en-CA'),notes:row.notes,priority:row.priority,source_url:row.source_url});}
      catch(e){error=e.message;render();}
    }
  }
  function render(){
    if(!opened)return;
    host.replaceChildren();
    const header=make('div','project-buy-heading');header.append(make('h2','','To Buy'));
    const add=make('button','','+ Add');add.type='button';add.disabled=busy;add.onclick=()=>editor();header.append(add);host.append(header);
    const select=make('select','project-buy-filter');select.setAttribute('aria-label','Filter purchases by subsection');
    select.append(new Option('All subsections',''));sections.forEach(s=>select.append(new Option(s.name,s.id)));select.value=filter;
    select.onchange=()=>{filter=select.value;render();};host.append(select);
    if(error)host.append(make('p','project-buy-error',error));
    if(busy)host.append(make('p','','Loading purchases…'));
    const visible=rows.filter(r=>!filter||sectionOf(r)===filter).sort((a,b)=>(a.status==='purchased')-(b.status==='purchased')||a.item.localeCompare(b.item));
    host.append(make('p','project-buy-count',visible.filter(r=>r.status==='planned').length+' to buy · '+visible.filter(r=>r.status==='purchased').length+' purchased'));
    const list=make('ul','project-buy-list');
    visible.forEach(row=>{
      const li=make('li','project-buy-row'+(row.status==='purchased'?' is-purchased':''));
      const check=make('input');check.type='checkbox';check.checked=row.status==='purchased';check.disabled=busy;check.setAttribute('aria-label','Mark '+row.item+' '+(check.checked?'to buy':'purchased'));check.onchange=()=>toggle(row);
      const detail=make('button','project-buy-detail');detail.type='button';detail.append(make('span','',row.item),make('strong','',row.status==='planned'&&row.estimated_pence==null?'—':gbp(row.status==='purchased'?row.actual_pence:row.estimated_pence)));
      detail.onclick=()=>editor(row);li.append(check,detail);list.append(li);
    });
    host.append(list);if(!visible.length&&!busy)host.append(make('p','','No purchases in this subsection yet.'));
  }
  return {show,refresh:load,hide(){opened=false;host.hidden=true;}};
}
