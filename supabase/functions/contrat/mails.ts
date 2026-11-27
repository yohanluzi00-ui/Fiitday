// Les e-mails de la fonction « contrat » : résiliation, rétractation, rappel avant la reconduction annuelle, compte inactif.
import { boutique, encadre, esc, euros, lignes, p, page, quand } from "./mail.ts";

export function mailResiliation(d: { name: string; label: string; store: string; at: string; end_at: string; refund: number; wish: string; email: string }): [string, string] {
  const fin = quand(d.end_at);
  const corps = p("Bonjour " + esc(d.name) + ",") +
    p("Nous avons bien reçu, le <b>" + esc(quand(d.at)) + "</b>, la notification de résiliation de ton abonnement <b>" + esc(d.label) + "</b> (payé par " + esc(boutique(d.store)) + ").") +
    encadre("Ton abonnement prend fin le <b>" + esc(fin) + "</b>.") +
    p("<b>Effets de la résiliation</b> : plus aucun prélèvement ; tu gardes Premium jusqu'à cette date, puis ton compte passe en version gratuite, plus limitée (1 programme et 2 séances actives, historique des 30 derniers jours). Tes programmes, tes séances et ton historique sont conservés, et tout revient si tu te réabonnes.") +
    (d.refund > 0 ? p("La part de la période payée et non utilisée, <b>" + esc(euros(d.refund)) + "</b>, te sera remboursée avec ton moyen de paiement au plus tard 14 jours après aujourd'hui.") : "") +
    p("Informations que tu as indiquées :") +
    lignes([["Nom", esc(d.name)], ["E-mail", esc(d.email)], ["Contrat", esc(d.label) + " · " + esc(boutique(d.store))], ["Date de fin choisie", d.wish === "maintenant" ? "dès maintenant" : "à la fin de la période déjà payée"]]) +
    p("Une question ? Réponds simplement à cet e-mail.");
  return ["Résiliation de ton abonnement Fiitday Premium", page("Ta résiliation est enregistrée", corps)];
}
export function mailRetractation(d: { name: string; label: string; store: string; at: string; bought: string; refund: number; price: number; kept: number; email: string }): [string, string] {
  // jours utilisés (comptés du jour de l'achat au jour de la rétractation) : payés au prorata, le reste est remboursé (L221-25)
  const jours = d.bought ? Math.max(1, Math.round((Date.parse(d.at) - Date.parse(d.bought)) / 864e5)) : 0;
  const detail = d.kept > 0
    ? " : le prix payé (" + esc(euros(d.price)) + ") moins <b>" + esc(euros(d.kept)) + "</b> pour " + (jours > 1 ? "les " + jours + " jours" : "le jour") + " où Premium a été utilisé, au prorata (article L221-25 du Code de la consommation)"
    : " : la totalité du prix payé";
  const corps = p("Bonjour " + esc(d.name) + ",") +
    p("Voici l'accusé de réception de ta déclaration de rétractation.") +
    encadre("Déclaration envoyée le <b>" + esc(quand(d.at)) + "</b>") +
    p("Contenu de ta déclaration :") +
    lignes([["Déclaration", "Je me rétracte de mon contrat " + esc(d.label) + "."], ["Nom", esc(d.name)], ["Contrat", esc(d.label) + " · " + esc(boutique(d.store))],
      ["Acheté le", d.bought ? esc(quand(d.bought, false)) : "—"], ["E-mail pour cet accusé", esc(d.email)]]) +
    p("<b>Effets</b> : le contrat prend fin aujourd'hui et Premium s'arrête ; ton compte passe en version gratuite, plus limitée (1 programme et 2 séances actives, historique des 30 derniers jours). Tes données sont conservées, et tout revient si tu te réabonnes.") +
    (d.store === "PLAY_STORE"
      ? p("<b>Remboursement</b> : ton achat a été payé par Google Play ; tu es remboursé de <b>" + esc(euros(d.refund)) + "</b>" + detail + ", par Google Play, au plus tard 14 jours après aujourd'hui.")
      : p("<b>Remboursement</b> : tu es remboursé de <b>" + esc(euros(d.refund)) + "</b>" + detail + ", avec le même moyen de paiement, au plus tard 14 jours après aujourd'hui, sans frais pour toi.")) +
    p("Une question ? Réponds simplement à cet e-mail.");
  return ["Accusé de réception de ta rétractation", page("Ta rétractation est bien reçue", corps)];
}
export function mailRappel(d: { first_name: string; label: string; store: string; until: string; amount: number }): [string, string] {
  const corps = p("Bonjour" + (d.first_name ? " " + esc(d.first_name) : "") + ",") +
    p("Ton abonnement <b>" + esc(d.label) + "</b> se renouvellera automatiquement le <b>" + esc(quand(d.until)) + "</b>, pour un an, au prix de <b>" + esc(euros(d.amount)) + "</b>.") +
    p("Tu peux choisir de ne pas le reconduire.") +
    encadre("<b>Date limite pour ne pas reconduire ton abonnement</b> : le " + esc(quand(d.until)) + ".") +
    (d.store === "PLAY_STORE"
      ? p("Pour l'arrêter : dans l'appli, Réglages › Tes achats Premium › « Résilier mon abonnement », ou dans le Play Store › ta photo › Paiements et abonnements › Abonnements › Fiitday › Résilier.")
      : p("Pour l'arrêter : sur fiitday.com ou dans l'appli, Réglages › Tes achats Premium › « Résilier mon abonnement ».")) +
    p("Si tu ne fais rien, il continue au même prix et tu gardes Premium. Si tu l'arrêtes, tu gardes Premium jusqu'à cette date, puis ton compte passe en version gratuite, plus limitée ; tes données sont conservées.");
  return ["Ton abonnement Fiitday Premium se renouvelle le " + quand(d.until, false), page("Renouvellement de ton abonnement", corps)];
}

// compte sans utilisation depuis près de 2 ans : prévenu au moins 30 jours avant la suppression (conservation limitée, RGPD)
export function mailInactif(d: { first_name: string; delete_on: string }): [string, string] {
  const corps = p("Bonjour" + (d.first_name ? " " + esc(d.first_name) : "") + ",") +
    p("Tu n'as pas utilisé Fiitday depuis bientôt 2 ans. Pour ne pas garder tes données plus longtemps que nécessaire, nous supprimons les comptes inutilisés depuis 2 ans.") +
    encadre("Ton compte sera supprimé le <b>" + esc(quand(d.delete_on, false)) + "</b>, avec les données enregistrées sur nos serveurs.") +
    p("<b>Pour le garder</b>, il suffit d'ouvrir Fiitday (l'appli ou fiitday.com) avec ce compte, connecté à internet, avant cette date. Rien d'autre à faire.") +
    p("Si tu ne fais rien, le compte est supprimé à cette date. Les séances déjà enregistrées sur ton téléphone ou ton ordinateur y restent : tu pourras les reprendre avec un nouveau compte, ou en faire une sauvegarde (Réglages › Données).") +
    p("Une question ? Réponds simplement à cet e-mail.");
  return ["Ton compte Fiitday sera supprimé le " + quand(d.delete_on, false), page("Ton compte va être supprimé", corps)];
}
