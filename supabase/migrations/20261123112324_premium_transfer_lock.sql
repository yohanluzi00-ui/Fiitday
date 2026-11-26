CREATE OR REPLACE FUNCTION public.create_transfer(p_payload text)
 RETURNS TABLE(transfer_code text, valid_until timestamp with time zone)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  me  uuid := auth.uid();
  exp timestamptz := now() + interval '1 hour';
  b   bytea;
  c   text;
  i   int;
begin
  if me is null then raise exception 'Connecte-toi pour créer un code' using errcode = '28000'; end if;
  if not public.paid_ok() then raise exception 'Le code de transfert est réservé aux abonnés Premium' using errcode = '42501'; end if;
  if p_payload is null or length(p_payload) = 0 or length(p_payload) > 2000000 then
    raise exception 'Sauvegarde vide ou trop grande' using errcode = '22023';
  end if;
  delete from public.transfers t where t.expires_at <= now() or t.user_id = me;
  for attempt in 1..20 loop
    b := pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
    c := '';
    foreach i in array array[0, 1, 2, 3, 4, 5, 9, 10] loop
      c := c || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
    end loop;
    begin
      insert into public.transfers (code, user_id, payload, expires_at) values (c, me, p_payload, exp);
      transfer_code := c; valid_until := exp;
      return next;
      return;
    exception when unique_violation then
      null;
    end;
  end loop;
  raise exception 'Impossible de créer un code, réessaie' using errcode = 'P0001';
end $function$;

CREATE OR REPLACE FUNCTION public.use_transfer(p_code text)
 RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare
  me  uuid := auth.uid();
  c   text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  n   int;
  res text;
begin
  if me is null then raise exception 'Connecte-toi pour utiliser un code' using errcode = '28000'; end if;
  if not public.paid_ok() then raise exception 'Le code de transfert est réservé aux abonnés Premium' using errcode = '42501'; end if;
  select count(*) into n from public.transfer_tries t where t.user_id = me and t.at > now() - interval '1 hour';
  if n >= 20 then raise exception 'Trop de codes faux : réessaie dans une heure' using errcode = 'P0001'; end if;
  select t.payload into res from public.transfers t where t.code = c and t.expires_at > now();
  if res is null then
    insert into public.transfer_tries (user_id) values (me);
    delete from public.transfer_tries t where t.at < now() - interval '1 day';
  end if;
  return res;
end $function$;
