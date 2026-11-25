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

## À faire dans l'appli avant de publier les CGV (elles les décrivent)

1. Bouton « Résilier mon abonnement » (Réglages › Abonnement) avec date de fin au choix (fin de période ou sous 10 jours avec remboursement), récapitulatif, « Notifier la résiliation », e-mail de confirmation (L215-1-1, D215-1 à D215-3, L224-25-9).
2. Bouton « Renoncer au contrat ici » pendant 14 jours après un achat, « Confirmer la rétractation », accusé de réception par e-mail avec date et heure (L221-21, D221-5).
3. E-mail de confirmation après chaque achat avec les CGV, le formulaire de rétractation et la demande de début immédiat (L221-13, L224-25-5).
4. E-mail de rappel 1 à 3 mois avant le renouvellement annuel, date limite dans un encadré (L215-1).

## Le jour de la publication

Changer `LEGAL.version` dans `src/app.js` (l'appli redemande l'accord à la confidentialité), mettre `LEGAL.cgv = "https://fiitday.com/cgv.html"` (lien sur l'écran Premium et sur la page de présentation) et ajouter le lien « CGV » dans le pied des pages (`build.js`).
