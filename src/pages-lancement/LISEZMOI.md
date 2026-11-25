# Pages légales du lancement (pas encore publiées)

Ces trois pages remplaceront celles de `src/pages/` le jour du lancement de l'abonnement :
`mentions-legales.html`, `cgv.html` (nouvelle) et `confidentialite.html`.
Relecture juridique complète le 25 novembre 2026 (Code de la consommation à jour du 20 novembre 2026).

## À remplacer avant de les publier

- `{{NOM}}` : prénom et nom de l'entrepreneur individuel (« (EI) » est déjà écrit juste après) ;
- `{{ADRESSE}}` : adresse de l'entreprise (domicile ou domiciliation) ;
- `{{TELEPHONE}}` : numéro de téléphone de l'entreprise (conseil : ligne fixe en 09, non surtaxée) ;
- `{{IMMATRICULATION}}` : « Immatriculé au RNE sous le numéro … » (activité libérale ou artisanale) ou « RCS [ville] [SIREN] » (activité commerciale), comme sur l'avis de situation ;
- `{{SIRET}}` : numéro SIRET (14 chiffres) ;
- `{{MEDIATEUR}}` : nom, site et adresse du médiateur de la consommation choisi ;
- `{{DATE}}` : date de mise en ligne ;
- `{{CONTACT}}` est remplacé automatiquement par la fabrication du site.

« TVA non applicable, article 293 B du CGI » : à garder seulement si l'entreprise est en franchise de TVA.

## Fonctions décrites par les CGV (faites en V1.128)

« Résilier mon abonnement », « Renoncer au contrat ici », e-mail de confirmation après chaque achat et rappel avant le
renouvellement annuel : prêts (fonction Edge « contrat », webhook « revenuecat », SQL `supabase/contrats-en-ligne.sql`).
Il faut seulement enregistrer dans Supabase › Edge Functions › Secrets la clé Brevo (BREVO_API_KEY) et la clé secrète
RevenueCat API v2 (RC_V2_SECRET_KEY), puis vérifier dans Administration › Abonnements › « Vérifier RevenueCat et Brevo ».

## Le jour de la publication

Changer `LEGAL.version` dans `src/app.js` (l'appli redemande l'accord à la confidentialité), mettre `LEGAL.cgv = "https://fiitday.com/cgv.html"` (lien sur l'écran Premium et sur la page de présentation) et ajouter le lien « CGV » dans le pied des pages (`build.js`).
