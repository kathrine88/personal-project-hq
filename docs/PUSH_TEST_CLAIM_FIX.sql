-- Stage 3C: incremental repair AFTER 20261026203000_web_push.sql.
-- Safe to rerun. Changes only this function; preserves its owner and ACL.
-- No schema/table grants, device changes, deliveries, secrets or schedules.
begin;
create or replace function public.hq_push_test_claim(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_owner uuid:=auth.uid();
 v_claim hq_push_private.deliveries;
begin
 if v_owner is null then raise exception 'Please sign in.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text,0));
 perform 1 from hq_push_private.devices
  where id=p_id and owner_id=v_owner and enabled for update;
 if not found then
  raise sqlstate 'PT409' using message='PUSH_DEVICE_NOT_ENABLED';
 end if;
 -- Distinct record/alias names avoid PL/pgSQL error 42702 (d.device_id).
 if exists(
  select 1 from hq_push_private.deliveries as previous_delivery
  join hq_push_private.devices as registered_device on registered_device.id=previous_delivery.device_id
  where registered_device.owner_id=v_owner and previous_delivery.occurrence_id is null
   and previous_delivery.created_at>now()-interval '1 minute'
 ) then
  raise sqlstate 'PT429' using message='PUSH_TEST_RATE_LIMITED';
 end if;
 insert into hq_push_private.deliveries(device_id,state,token,claimed_at)
  values(p_id,'claimed',gen_random_uuid(),clock_timestamp()) returning * into v_claim;
 return jsonb_build_object('id',v_claim.id,'token',v_claim.token);
end $$;
notify pgrst,'reload schema';
commit;
