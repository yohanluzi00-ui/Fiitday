# Base de données Supabase de Fiitday

## Où est la version à jour ?

- **La référence est l'historique des migrations de Supabase** (tableau de bord › Database › Migrations) : chaque
  changement de la base y est gardé, dans l'ordre, avec son texte exact.
- **`supabase/migrations/`** contient la copie de ces migrations, un fichier par migration, nommé comme dans Supabase
  (`<date>_<nom>.sql`). Les 14 migrations qui n'avaient pas de fichier y ont été recopiées telles quelles (empreinte
  vérifiée), ainsi que toutes les nouvelles.
- **Les fichiers `.sql` directement dans `supabase/`** sont l'historique des débuts (avant les migrations) : ils ont
  déjà été appliqués et **ne doivent jamais être relancés** (ils remplaceraient des protections actuelles par
  d'anciennes versions). Un avertissement est écrit en tête de chacun.

## Règle pour la suite

1. Tout changement de la base passe par une migration (outil « apply_migration » de Supabase), **avec l'accord du
   propriétaire**.
2. Le même texte est enregistré dans `supabase/migrations/<date>_<nom>.sql` (la date est celle que Supabase donne à
   la migration), dans le même commit que le code qui en dépend.
3. On ne modifie jamais une migration déjà appliquée : on en ajoute une nouvelle.
