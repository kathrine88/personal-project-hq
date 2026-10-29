export const MONEY_LIMIT = 999999999n;
export const MONEY_PROJECTS = [
  {value:'Garden',name:'Garden'}, {value:'Book Nook',name:'Book Nook'},
  {value:'Christmas Planning',name:'Christmas'}, {value:'Health & Fitness',name:'Health & Fitness'},
  {value:'Home Projects',name:'Home Projects'}, {value:'Other',name:'Other'}
];
export function parsePounds(value, signed = false) {
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(value.trim())) throw new Error('Enter pounds with at most two decimal places, for example 12.50.');
  let text=value.trim(), negative=text.startsWith('-');
  text=text.replace(/^[+-]/,'');const [whole,fraction='']=text.split('.');
  const pence=BigInt(whole || '0')*100n+BigInt(fraction.padEnd(2,'0'));
  if (pence>MONEY_LIMIT) throw new Error('Use an amount up to £9,999,999.99.');
  if (negative && !signed) throw new Error('Enter a positive amount.');
  return Number(negative ? -pence : pence);
}
export function pence(value) {
  if (!Number.isSafeInteger(value) || Math.abs(value)>Number(MONEY_LIMIT)) throw new Error('A saved amount is invalid. Reload before making changes.');
  return BigInt(value);
}
export function poundsInput(value) {
  if (value == null) return '';
  const n=pence(value), absolute=n<0n?-n:n;
  return `${n<0n?'-':''}${absolute/100n}.${String(absolute%100n).padStart(2,'0')}`;
}
export function gbp(value) {
  const n=typeof value==='bigint'?value:pence(value), absolute=n<0n?-n:n;
  return `${n<0n?'-':''}£${new Intl.NumberFormat('en-GB').format(absolute/100n)}.${String(absolute%100n).padStart(2,'0')}`;
}
export function moneyTotals(data) {
  const hustle=data.daily.reduce((sum,row)=>sum+pence(row.amount_pence),0n);
  const adjustments=data.movements.reduce((sum,row)=>sum+(row.kind==='deposit'?1n:-1n)*pence(row.amount_pence),0n);
  const spent=data.purchases.filter(row=>row.status==='purchased').reduce((sum,row)=>sum+pence(row.actual_pence),0n);
  const planned=data.purchases.filter(row=>row.status==='planned').reduce((sum,row)=>sum+(row.estimated_pence == null ? 0n : pence(row.estimated_pence)),0n);
  return {hustle,adjustments,spent,planned,available:hustle+adjustments-spent};
}
export function recentMoney(data) {
  return [
    ...data.daily.map(row=>({id:row.id,date:row.entry_date,title:'Daily hustle result',amount:pence(row.amount_pence)})),
    ...data.movements.map(row=>({id:row.id,date:row.entry_date,title:row.kind==='deposit'?'Manual deposit':'Manual withdrawal',amount:(row.kind==='deposit'?1n:-1n)*pence(row.amount_pence)})),
    ...data.purchases.filter(row=>row.status==='purchased').map(row=>({id:row.id,date:row.purchase_date || row.created_at.slice(0,10),title:row.item,amount:-pence(row.actual_pence)}))
  ].sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id)).slice(0,6);
}
export function safeSource(value) {
  if (!value?.trim()) return null;
  try {const url=new URL(value);if(['https:','http:'].includes(url.protocol))return url.href;} catch {}
  throw new Error('Use a full http:// or https:// product link, or leave it blank.');
}

export function newMoneyId(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  // getRandomValues also works in local HTTP previews / older iPhone browsers.
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
