-- Droits inutiles retirés : les comptes connectés lisent, écrivent et suppriment LEURS lignes (règles RLS),
-- mais n'ont pas besoin de vider la table (TRUNCATE), d'y poser un déclencheur (TRIGGER) ni de la référencer (REFERENCES).
revoke truncate, trigger, references on public.items from authenticated, anon;
-- les prochaines tables créées n'auront plus ces droits par défaut
alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;
