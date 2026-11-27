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
- `{{ADRESSE_SUPABASE}}` et `{{CONTACT_SUPABASE}}` (mentions légales) : adresse postale et e-mail ou téléphone de Supabase, Inc., tels qu'écrits sur supabase.com/privacy (obligation de la LCEN pour l'hébergeur des données) ;
- `{{CONTACT}}` est remplacé automatiquement par la fabrication du site.

« TVA non applicable, article 293 B du CGI » : à garder seulement si l'entreprise est en franchise de TVA.

## Fonctions décrites par les CGV (faites en V1.128)

« Résilier mon abonnement », « Renoncer au contrat ici », e-mail de confirmation après chaque achat et rappel avant le
renouvellement annuel : prêts (fonction Edge « contrat », webhook « revenuecat », SQL `supabase/contrats-en-ligne.sql`).
Il faut seulement enregistrer dans Supabase › Edge Functions › Secrets la clé Brevo (BREVO_API_KEY) et la clé secrète
RevenueCat API v2 (RC_V2_SECRET_KEY), puis vérifier dans Administration › Abonnements › « Vérifier RevenueCat et Brevo ».

## Conditions d'utilisation (CGU)

`src/pages/cgu.html` est déjà publiée (depuis la V1.140) et reste valable au lancement : elle renvoie aux mentions
légales pour l'identité de l'éditeur. Les CGV s'ajoutent aux CGU pour les achats.

## Le jour de la publication

Changer `LEGAL.version` dans `src/app.js` (l'appli remontre la politique de confidentialité), mettre `LEGAL.cgv = "https://fiitday.com/cgv.html"` (lien sur l'écran Premium et sur la page de présentation) et ajouter le lien « CGV » dans le pied des pages (`build.js`).

## Garde-fou

`build.js` refuse de publier une page qui contient encore un champ `{{…}}` (hors `{{CONTACT}}`). Et l'écran Premium
n'active le bouton d'achat (hors achats de test) que si `LEGAL.cgv` est rempli, que le serveur a ouvert les ventes
(date de lancement atteinte) et que cette version de l'appli sait encaisser (`MONETIZATION`).

## Factures, avoirs et remboursements (V1.146)

- Chaque paiement par carte reçoit une facture numérotée (F2027-00001…) par e-mail, chaque remboursement un avoir
  (A2027-00001…). Une vraie facture ne part qu'une fois l'identité du vendeur saisie dans Administration › Registre des
  recettes › « Infos du vendeur » (nom « (EI) », adresse, SIRET, immatriculation) : elle est gardée dans la base, pas dans
  ce dépôt public.
- Rétractation : les jours déjà utilisés sont payés au prorata (L221-25), le reste est remboursé ; résiliation « tout de
  suite » : la part non utilisée est remboursée. Le remboursement partiel est fait tout seul dans Stripe avec la clé
  restreinte `STRIPE_REFUND_KEY` (Balance, Customers et PaymentIntents en lecture, Charges en écriture), qui sert aussi au
  registre des recettes (une ligne par paiement et par remboursement). Au passage aux vrais paiements, remplacer la clé de
  test par une clé « live » avec les mêmes droits.

## Ordre conseillé le jour du lancement

1. Remplir les champs et publier ces pages (copie dans `src/pages/`), mettre `LEGAL.cgv` et `MONETIZATION = true`, et
   saisir les « Infos du vendeur » dans l'Administration (factures).
2. Publier cette version et laisser quelques jours aux appareils pour se mettre à jour.
3. Seulement ensuite, remplir la date de lancement dans Supabase (`app_config.launch_at`).
