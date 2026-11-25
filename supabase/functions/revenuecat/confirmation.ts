// E-mail de confirmation de la commande (Code de la consommation, L221-13) : récapitulatif, demande de début immédiat,
// délai de rétractation, conditions générales de vente et formulaire de rétractation.
import { boutique, encadre, esc, euros, lignes, p, page, PRIX, quand } from "./mail.ts";

// fin du délai de rétractation : 14 jours après le jour de l'achat (heure de Paris), repoussé au lundi si samedi ou dimanche
export function finRetractation(at: number): string {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
  const last = new Date(d + "T12:00:00Z"); last.setUTCDate(last.getUTCDate() + 14);
  const wd = last.getUTCDay(); if (wd === 6) last.setUTCDate(last.getUTCDate() + 2); else if (wd === 0) last.setUTCDate(last.getUTCDate() + 1);
  return quand(last, false);
}

export function confirmationHtml(d: { prenom: string; email: string; product: string; at: number; test: boolean; store: string; consent: { text?: string; at?: string } | null; cg: string }): string {
  const { prenom, email, product, at, test, consent, cg } = d, info = PRIX[product], life = /_vie_/.test(product), r = { store: d.store };
  const corps = p("Bonjour" + (prenom ? " " + esc(prenom) : "") + ",") +
    p("Merci pour ta commande ! Premium est actif sur ton compte Fiitday (" + esc(email) + "), sur tous tes appareils." + (test ? " <b>Achat de test : aucun paiement réel.</b>" : "")) +
    lignes([["Formule", esc(info.label)], ["Prix", esc(euros(info.amount)) + " " + esc(info.period) + " (TTC)"], ["Date", esc(quand(at))], ["Paiement", esc(boutique(String(r.store)))],
      ["Durée", life ? "à vie, sans renouvellement" : "renouvellement automatique " + (/annuel/.test(product) ? "chaque année" : "chaque mois") + " au même prix, sauf résiliation"]]) +
    (consent?.text ? p("Avant le paiement, tu as coché, le " + esc(quand(consent.at || Date.now())) + " : « " + esc(consent.text) + " »") : "") +
    encadre("<b>Droit de rétractation</b> : tu peux te rétracter jusqu'au <b>" + esc(finRetractation(at)) + "</b> inclus, sans motif, avec un remboursement intégral : Réglages › Abonnement › « Renoncer au contrat ici », ou avec le formulaire ci-dessous, ou en répondant à cet e-mail.") +
    (life ? "" : p("Pour arrêter ton abonnement : Réglages › Abonnement › « Résilier mon abonnement »" + (r.store === "PLAY_STORE" ? " (il ouvre ton abonnement dans Google Play)" : "") + ". Tu gardes Premium jusqu'à la fin de la période payée.")) +
    p("Garde cet e-mail : il contient tes conditions de vente.") +
    (cg ? '<hr style="border:0;border-top:1px solid #E4E0EC;margin:20px 0"><h2 style="font-size:17px;margin:0 0 8px">Conditions générales de vente</h2><div style="font-size:14px">' + cg + "</div>"
      : p("Conditions générales de vente : <a href=\"https://fiitday.com/cgv.html\">fiitday.com/cgv.html</a>."));
  return page("Confirmation de ta commande", corps);
}
