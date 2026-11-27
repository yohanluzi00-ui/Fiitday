-- Tableau de bord de l'Administration : sans les codes de transfert (supprimés en V1.146)
do $$
declare d text;
begin
  d := pg_get_functiondef('public.admin_kpis()'::regprocedure);
  d := replace(d, $o$    'transfers30', (select count(*) from public.transfers where created_at > now() - interval '30 days'),
$o$, '');
  d := replace(d, $o$      'xferFail24', (select count(*) from public.transfer_tries where at > now() - interval '1 day'),
$o$, '');
  if d ilike '%transfer%' then raise exception 'admin_kpis : remplacement incomplet'; end if;
  execute d;
end $$;
