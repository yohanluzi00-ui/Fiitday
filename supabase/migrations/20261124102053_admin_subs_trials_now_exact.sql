do $$
declare d text;
begin
  d := pg_get_functiondef('public.admin_subs()'::regprocedure);
  d := replace(d, $r$'trialsNow', (select count(*) from tr where tr.s <= now() and tr.s + interval '30 days' > now())$r$,
                  $r$'trialsNow', (select case when b.launch is not null and b.launch <= now() then (select count(*) from auth.users au where public.plan_info(au.id) ->> 'state' = 'trial') else 0 end from b)$r$);
  if position('plan_info(au.id)' in d) = 0 then raise exception 'remplacement non appliqué'; end if;
  execute d;
end $$;
