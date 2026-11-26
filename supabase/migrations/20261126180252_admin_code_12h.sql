-- Administration : le code à 6 chiffres est redemandé si la dernière vérification date de plus de 12 heures
-- (avant : une session validée une fois restait valable sans limite). Si le jeton ne porte pas l'heure de la vérification,
-- la règle d'avant s'applique (aal2 seulement), pour ne jamais bloquer l'accès.
create or replace function public.admin_ok()
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  admin_id constant uuid := '8d8a867f-e766-41ca-b197-7694f5f5e1c4';
  me uuid := auth.uid();
  totp_at bigint;
begin
  select max((a ->> 'timestamp')::bigint) into totp_at
  from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) a
  where a ->> 'method' = 'totp';
  if me is distinct from admin_id or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or (totp_at is not null and totp_at < extract(epoch from now()) - 12 * 3600) then
    if (select count(*) from public.admin_access_log l where l.user_id is not distinct from me and l.at > now() - interval '1 hour') < 60 then
      insert into public.admin_access_log (user_id, reason)
      values (me, case when me is distinct from admin_id then 'autre compte' else 'sans code' end);
    end if;
    return false;
  end if;
  return true;
end $$;
revoke all on function public.admin_ok() from public, anon, authenticated;
