import { moneyTotals } from './money-core.js?v=20261026-money';
const tables={daily:'hq_money_daily',movements:'hq_money_movements',purchases:'hq_money_purchases'};
function failure(error) {
  if (['PGRST205','PGRST202','42P01','42883'].includes(error?.code)) return new Error('Money Tracker is not available yet. The existing planners still work.');
  if (error?.code==='23505') return new Error('A daily result already exists for that date. Edit the existing entry instead.');
  if (error?.code==='PGRST116') return new Error('This record changed or was deleted. Cancel and reload before editing again.');
  return new Error(error?.message || 'Could not connect. Please try again.');
}
export function createMoneyRepository(client) {
  async function result(query) {const {data,error}=await query;if(error)throw failure(error);return data;}
  function table(kind) {if(!tables[kind])throw new Error('Unknown money record.');return client.from(tables[kind]);}
  return {
    async load() {
      const data=await result(client.rpc('hq_money_snapshot'));
      if (!data || !['daily','movements','purchases'].every(key=>Array.isArray(data[key]))) throw new Error('Could not read the complete money pot. Reload before making changes.');
      moneyTotals(data); // Reject corrupt/unsafe monetary values, never display a partial balance.
      return data;
    },
    async save(kind, id, version, values) {
      if (version != null) {
        const row=await result(table(kind).update({...values,version:version+1}).eq('id',id).eq('version',version).select().single());
        if(!row)throw failure({code:'PGRST116'});return row;
      }
      // Stable client UUID + DO NOTHING makes retrying a new record idempotent.
      const row=await result(table(kind).upsert({id,...values},{onConflict:'id',ignoreDuplicates:true}).select().maybeSingle());
      if(row)return row;
      const existing=await result(table(kind).select().eq('id',id).single());
      if(!existing || Object.entries(values).some(([key,value])=>existing[key]!==value)) throw new Error('This entry was already saved. Cancel and reload to edit its saved version.');
      return existing;
    },
    async remove(kind,id,version) {
      const row=await result(table(kind).delete().eq('id',id).eq('version',version).select('id').single());
      if(!row)throw failure({code:'PGRST116'});return row;
    }
  };
}
