CREATE OR REPLACE FUNCTION public.delete_my_account()
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare
  uid uuid := auth.uid();
  em text;
begin
  if uid is null then
    raise exception 'non connecté';
  end if;
  -- l'essai déjà utilisé reste noté 3 ans (empreinte de l'e-mail seulement, jamais l'adresse) : un compte recréé n'a pas de nouvel essai
  delete from public.trial_used t where t.at < now() - interval '3 years';
  select u.email into em from auth.users u where u.id = uid;
  if em is not null then
    insert into public.trial_used (email_hash) values (public.email_hash(em)) on conflict (email_hash) do nothing;
  end if;
  delete from auth.users where id = uid;
end $function$;
