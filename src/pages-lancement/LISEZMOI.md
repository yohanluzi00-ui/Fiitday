# Pages légales du lancement (pas encore publiées)

Ces trois pages remplaceront celles de `src/pages/` le jour du lancement de l'abonnement :
`mentions-legales.html`, `cgv.html` (nouvelle) et `confidentialite.html`.

Avant de les publier, remplacer :
- `{{NOM}}` : prénom et nom de l'entrepreneur individuel (ou nom commercial « Prénom Nom (EI) ») ;
- `{{ADRESSE}}` : adresse de l'entreprise (domicile ou domiciliation) ;
- `{{SIRET}}` : numéro SIRET (14 chiffres) ;
- `{{MEDIATEUR}}` : nom, site et adresse du médiateur de la consommation choisi (obligatoire pour vendre à des particuliers) ;
- `{{DATE}}` : date de mise en ligne ;
- `{{CONTACT}}` est remplacé automatiquement par la fabrication du site.

Puis : changer `LEGAL.version` dans `src/app.js` (l'appli redemande l'accord à la confidentialité) et ajouter le lien « CGV » dans le pied des pages (`build.js`).
