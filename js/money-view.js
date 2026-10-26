import { createMoneyStore } from './money-store.js?v=20261026-money';
import { MONEY_PROJECTS, parsePounds, poundsInput, gbp, moneyTotals, recentMoney, safeSource, newMoneyId } from './money-core.js?v=20261026-money';
import { calendarDate, dateKey, validDate } from './dates.js?v=20261026-datefix';

export function createMoneyView({root,editor,repository,isSignedIn,signIn}) {
  const $=selector=>root.querySelector(selector), form=editor.querySelector('form');
  const field=name=>form.elements.namedItem(name);
  const day=value=>{const date=calendarDate(value);return date?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric'}).format(date):'Date not set';};
  let panel='dashboard', editing=null, returnFocus=null;
  const store=createMoneyStore(repository,{isSignedIn,changed:render});
  const projectName=value=>MONEY_PROJECTS.find(p=>p.value===value)?.name || value;
  MONEY_PROJECTS.forEach(p=>$('#moneyProjectFilter').add(new Option(p.name,p.value)));
  $('#moneyProjectFilter').addEventListener('change',render);
  $('#moneyStatusFilter').addEventListener('change',render);
  $('#moneySignIn').addEventListener('click',signIn);
  $('#moneyReload').addEventListener('click',()=>store.load(true));
  root.querySelectorAll('[data-new-money]').forEach(button=>button.addEventListener('click',()=>open(button.dataset.newMoney)));
  function input(name,label,type='text',value='',options={}) {
    const wrap=document.createElement('div'), caption=document.createElement('label');
    const el=document.createElement(type==='textarea'?'textarea':type==='select'?'select':'input');
    el.name=name;el.id=`money-field-${name}`;caption.htmlFor=el.id;caption.textContent=label;
    if(el.tagName==='INPUT'){el.type=type;el.autocomplete='off';}
    if(type==='select')options.choices.forEach(([value,text])=>el.add(new Option(text,value)));
    el.value=value ?? '';el.required=!!options.required;
    if(options.maxLength)el.maxLength=options.maxLength;
    if(options.inputMode)el.inputMode=options.inputMode;
    if(type==='date'){el.min='0001-01-01';el.max='9999-12-31';}
    wrap.append(caption,el);form.append(wrap);return wrap;
  }
  function statusFields() {
    const purchased=field('status').value==='purchased';
    form.querySelectorAll('[data-purchased-field]').forEach(el=>el.hidden=!purchased);
  }
  function open(kind,row=null,purchased=false) {
    if(!isSignedIn()){signIn();return;}
    if(!store.state.data||store.state.busy||store.state.loading)return;
    editing={kind,id:row?.id || newMoneyId(),version:row?.version ?? null};returnFocus=document.activeElement;
    editor.querySelector('h2').textContent=kind==='daily'?(row?'Edit daily result':'Daily profit or loss'):kind==='movements'?(row?'Edit manual movement':'Deposit or withdrawal'):(row?'Edit purchase':'Plan a purchase');
    form.replaceChildren();
    if(kind==='daily'||kind==='movements'){
      input('date','Date','date',row?.entry_date || dateKey(new Date()),{required:true});
      if(kind==='movements')input('kind','Movement','select',row?.kind || 'deposit',{choices:[['deposit','Deposit'],['withdrawal','Withdrawal']]});
      input('amount',kind==='daily'?'Daily profit / loss (£)':'Amount (£)','text',poundsInput(row?.amount_pence),{required:true,inputMode:kind==='daily'?'text':'decimal'});
      if(kind==='daily'){const hint=document.createElement('p');hint.className='editor-hint';hint.textContent='One combined figure for this date. Use a minus sign for a loss, for example -12.50.';form.append(hint);}
      else input('note','Note (optional)','textarea',row?.note || '',{maxLength:2000});
    }else{
      input('item','Item','text',row?.item || '',{required:true,maxLength:500});
      input('project','Project','select',row?.project || 'Other',{choices:MONEY_PROJECTS.map(p=>[p.value,p.name])});
      input('estimate','Estimated price (£)','text',poundsInput(row?.estimated_pence),{required:true,inputMode:'decimal'});
      input('priority','Priority (optional)','select',row?.priority || '',{choices:[['','No priority'],['low','Low'],['medium','Medium'],['high','High']]});
      input('notes','Notes (optional)','textarea',row?.notes || '',{maxLength:2000});
      input('source','Product / source link (optional)','url',row?.source_url || '',{maxLength:2000});
      input('status','Status','select',purchased?'purchased':row?.status || 'planned',{choices:[['planned','Planned'],['purchased','Purchased']]});
      input('actual','Actual price (£, optional)','text',poundsInput(row?.actual_pence),{inputMode:'decimal'}).dataset.purchasedField='';
      input('purchaseDate','Purchase date (optional)','date',row?.purchase_date || '').dataset.purchasedField='';
      const hint=document.createElement('p');hint.className='editor-hint';hint.dataset.purchasedField='';hint.textContent='If actual price is blank, the estimate becomes the saved actual price. Planned items do not reduce the pot.';form.append(hint);
      field('status').addEventListener('change',statusFields);statusFields();
    }
    const actions=document.createElement('div');actions.className='editor-actions';
    const save=document.createElement('button');save.type='submit';save.className='primary';save.textContent='Save';
    const cancel=document.createElement('button');cancel.type='button';cancel.className='editor-cancel';cancel.textContent='Cancel';cancel.addEventListener('click',close);
    actions.append(save,cancel);
    if(row){const remove=document.createElement('button');remove.type='button';remove.className='delete';remove.textContent='Delete record';remove.addEventListener('click',async()=>{
      if(confirm('Delete this record? The shared balance will be recalculated.')){if(await store.remove(kind,row.id,row.version))close();else editor.querySelector('[role=alert]').textContent=store.state.error;}
    });actions.append(remove);}
    form.append(actions);editor.querySelector('[role=alert]').textContent='';editor.showModal();form.querySelector('input,select').focus();
  }
  function close() {if(store.state.busy)return;editor.close();if(returnFocus?.isConnected)returnFocus.focus();else $('#moneyHeading').focus();}
  editor.addEventListener('cancel',event=>{event.preventDefault();close();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(store.state.busy)return;
    const error=editor.querySelector('[role=alert]');error.textContent='';
    let values;
    try {
      if(editing.kind==='daily'||editing.kind==='movements'){
        if(!validDate(field('date').value))throw Error('Choose a valid date.');
        values={entry_date:field('date').value,amount_pence:parsePounds(field('amount').value,editing.kind==='daily')};
        if(editing.kind==='movements'){
          if(values.amount_pence<=0)throw Error('Enter an amount greater than zero.');
          Object.assign(values,{kind:field('kind').value,note:field('note').value.trim()});
        }
      }else{
        const status=field('status').value,estimate=parsePounds(field('estimate').value),item=field('item').value.trim();
        if(!item)throw Error('Enter an item name.');
        const purchaseDate=field('purchaseDate').value;
        if(status==='purchased'&&purchaseDate&&!validDate(purchaseDate))throw Error('Choose a valid purchase date or leave it blank.');
        values={item,project:field('project').value,estimated_pence:estimate,priority:field('priority').value || null,notes:field('notes').value.trim(),source_url:safeSource(field('source').value),status,
          actual_pence:status==='purchased'?(field('actual').value.trim()?parsePounds(field('actual').value):estimate):null,purchase_date:status==='purchased'?(purchaseDate || null):null};
      }
    }catch(e){error.textContent=e.message;return;}
    if(await store.save(editing.kind,editing.id,editing.version,values))close();else error.textContent=store.state.error;
  });
  function action(label,callback,aria=label) {const button=document.createElement('button');button.type='button';button.className='text-button';button.textContent=label;button.setAttribute('aria-label',aria);button.disabled=store.state.busy||store.state.loading;button.addEventListener('click',callback);return button;}
  function entryList(selector,rows,kind) {
    const list=$(selector);list.replaceChildren();
    rows.slice().sort((a,b)=>b.entry_date.localeCompare(a.entry_date)||a.id.localeCompare(b.id)).forEach(row=>{
      const li=document.createElement('li');li.className='money-entry';
      const copy=document.createElement('div'), date=document.createElement('strong'), note=document.createElement('small');
      date.textContent=day(row.entry_date);note.textContent=kind==='daily'?'Combined hustle result':`${row.kind==='deposit'?'Deposit':'Withdrawal'}${row.note?' · '+row.note:''}`;copy.append(date,note);
      const amount=document.createElement('span');amount.className='money-amount';amount.textContent=gbp((kind==='movements'&&row.kind==='withdrawal'?-1:1)*row.amount_pence);
      li.append(copy,amount,action('Edit',()=>open(kind,row),`Edit ${kind==='daily'?'daily result':row.kind} ${row.entry_date}`));list.append(li);
    });
  }
  function render() {
    const state=store.state,data=isSignedIn()?state.data:null,disabled=!data||state.loading||state.busy;
    root.setAttribute('aria-busy',String(state.loading));
    $('#moneySignIn').hidden=isSignedIn();$('#moneyError').textContent=isSignedIn()?state.error:'';
    $('#moneyStatus').textContent=!isSignedIn()?'Sign in to see your project funds.':state.loading?'Loading your money pot…':state.notice || (data?'All amounts in GBP.':'');
    $('#moneyReload').disabled=state.loading||state.busy;$('#moneyReload').hidden=!isSignedIn();
    root.querySelectorAll('[data-new-money]').forEach(el=>el.disabled=disabled);
    editor.querySelectorAll('input,select,textarea,button').forEach(el=>el.disabled=state.busy);
    root.querySelectorAll('[data-money-panel]').forEach(el=>el.hidden=el.dataset.moneyPanel!==panel);
    root.querySelectorAll('[data-money-tab]').forEach(el=>{if(el.dataset.moneyTab===panel)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
    const totals=data?moneyTotals(data):null;
    for(const key of ['available','hustle','adjustments','spent','planned'])$(`[data-total="${key}"]`).textContent=totals?gbp(totals[key]):'—';
    const recent=$('#moneyRecent');recent.replaceChildren();
    if(data)recentMoney(data).forEach(item=>{const li=document.createElement('li');li.className='money-entry';const copy=document.createElement('div'),title=document.createElement('strong'),date=document.createElement('small'),amount=document.createElement('span');title.textContent=item.title;date.textContent=day(item.date);amount.textContent=gbp(item.amount);amount.className='money-amount';copy.append(title,date);li.append(copy,amount);recent.append(li);});
    $('#moneyRecentEmpty').hidden=!data||recent.children.length>0;
    const overview=$('#moneyProjects');overview.replaceChildren();
    if(data)MONEY_PROJECTS.forEach(project=>{
      const rows=data.purchases.filter(p=>p.status==='planned'&&p.project===project.value);
      const li=document.createElement('li'), button=action('',()=>{$('#moneyProjectFilter').value=project.value;location.hash='#money-purchases';},`View ${project.name} purchases`);button.className='money-project';
      const name=document.createElement('strong'),count=document.createElement('span');name.textContent=project.name;count.textContent=`${rows.length} planned · ${gbp(rows.reduce((sum,p)=>sum+BigInt(p.estimated_pence),0n))}`;button.append(name,count);li.append(button);overview.append(li);
    });
    entryList('#moneyDailyRows',data?.daily || [],'daily');entryList('#moneyMovementRows',data?.movements || [],'movements');
    $('#moneyDailyEmpty').hidden=!data||data.daily.length>0;$('#moneyMovementEmpty').hidden=!data||data.movements.length>0;
    const list=$('#moneyPurchaseRows');list.replaceChildren();
    const purchases=(data?.purchases || []).filter(row=>(!$('#moneyProjectFilter').value||row.project===$('#moneyProjectFilter').value)&&(!$('#moneyStatusFilter').value||row.status===$('#moneyStatusFilter').value));
    purchases.forEach(row=>{
      const li=document.createElement('li');li.className='money-purchase';li.dataset.purchaseId=row.id;
      const top=document.createElement('div');top.className='money-purchase-top';const title=document.createElement('h3'),price=document.createElement('strong');title.textContent=row.item;price.textContent=gbp(row.status==='purchased'?row.actual_pence:row.estimated_pence);top.append(title,price);
      const detail=document.createElement('p');detail.className='editor-hint';detail.textContent=`${projectName(row.project)} · ${row.status==='purchased'?'Purchased · actual':'Planned · estimate'}${row.priority?' · '+row.priority+' priority':''}${row.purchase_date?' · '+day(row.purchase_date):''}`;
      li.append(top,detail);
      if(row.notes){const notes=document.createElement('p');notes.className='money-notes';notes.textContent=row.notes;li.append(notes);}
      try{const url=safeSource(row.source_url);if(url){const link=document.createElement('a');link.className='text-button';link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Product / source';li.append(link);}}catch{}
      const actions=document.createElement('div');actions.className='money-actions';actions.append(action('Edit',()=>open('purchases',row),`Edit purchase ${row.item}`));
      if(row.status==='planned')actions.append(action('Mark purchased',()=>open('purchases',row,true),`Mark ${row.item} purchased`));
      li.append(actions);list.append(li);
    });
    $('#moneyPurchasesEmpty').hidden=!data||purchases.length>0;
  }
  return {
    open(route){panel=route==='#money-daily'?'daily':route==='#money-purchases'?'purchases':'dashboard';render();store.load();},
    reset(){store.reset();if(editor.open)editor.close();form.replaceChildren();editing=null;$('#moneyProjectFilter').value='';$('#moneyStatusFilter').value='';},
    render
  };
}
