// E-mail de confirmation de la commande (Code de la consommation, L221-13) : récapitulatif, demande de début immédiat,
// délai de rétractation, conditions générales de vente et formulaire de rétractation.
import { boutique, encadre, esc, euros, lignes, p, page, PRIX, quand } from "./mail.ts";

// Pâques (calendrier grégorien) : sert aux jours fériés mobiles (lundi de Pâques, Ascension, lundi de Pentecôte)
function paques(y: number): Date {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return new Date(Date.UTC(y, Math.floor(n / 31) - 1, (n % 31) + 1, 12));
}
// jour férié en France (même liste que la fonction jour_ferie de la base)
function ferie(dt: Date): boolean {
  const md = String(dt.getUTCMonth() + 1).padStart(2, "0") + "-" + String(dt.getUTCDate()).padStart(2, "0");
  if (["01-01", "05-01", "05-08", "07-14", "08-15", "11-01", "11-11", "12-25"].includes(md)) return true;
  const p = paques(dt.getUTCFullYear()).getTime(), day = 864e5, t = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), 12);
  return t === p + day || t === p + 39 * day || t === p + 50 * day;
}
// fin du délai de rétractation : 14 jours après le jour de l'achat (heure de Paris), prolongé jusqu'au premier jour
// ouvrable si le dernier jour est un samedi, un dimanche ou un jour férié (L221-19) ; même calcul que retract_until
export function finRetractation(at: number): string {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
  const last = new Date(d + "T12:00:00Z"); last.setUTCDate(last.getUTCDate() + 14);
  while (last.getUTCDay() === 6 || last.getUTCDay() === 0 || ferie(last)) last.setUTCDate(last.getUTCDate() + 1);
  return quand(last, false);
}

export function confirmationHtml(d: { prenom: string; email: string; product: string; at: number; test: boolean; store: string; consent: { text?: string; at?: string } | null; cg: string }): string {
  const { prenom, email, product, at, test, consent, cg } = d, info = PRIX[product], life = /_vie_/.test(product), r = { store: d.store };
  const corps = p("Bonjour" + (prenom ? " " + esc(prenom) : "") + ",") +
    p("Merci pour ta commande ! Premium est actif sur ton compte Fiitday (" + esc(email) + "), sur tous tes appareils." + (test ? " <b>Achat de test : aucun paiement réel.</b>" : "")) +
    lignes([["Formule", esc(info.label)], ["Prix", esc(euros(info.amount)) + " " + esc(info.period) + " (TTC)"], ["Date", esc(quand(at))], ["Paiement", esc(boutique(String(r.store)))],
      ["Durée", life ? "à vie, sans renouvellement" : "renouvellement automatique " + (/annuel/.test(product) ? "chaque année" : "chaque mois") + " au même prix, sauf résiliation"]]) +
    (consent?.text ? p("Avant le paiement, tu as coché, le " + esc(quand(consent.at || Date.now())) + " : « " + esc(consent.text) + " »") : "") +
    encadre("<b>Droit de rétractation</b> : tu peux te rétracter jusqu'au <b>" + esc(finRetractation(at)) + "</b> inclus, sans motif, avec un remboursement intégral : Réglages › Tes achats Premium › « Renoncer au contrat ici », ou avec le formulaire ci-dessous, ou en répondant à cet e-mail.") +
    (life ? "" : p("Pour arrêter ton abonnement : Réglages › Tes achats Premium › « Résilier mon abonnement »" + (r.store === "PLAY_STORE" ? " (il ouvre ton abonnement dans Google Play)" : "") + ". Tu gardes Premium jusqu'à la fin de la période payée.")) +
    p("Garde cet e-mail : il contient tes conditions de vente.") +
    (cg ? '<hr style="border:0;border-top:1px solid #E4E0EC;margin:20px 0"><h2 style="font-size:17px;margin:0 0 8px">Conditions générales de vente</h2><div style="font-size:14px">' + cg + "</div>"
      : p("Conditions générales de vente : <a href=\"https://fiitday.com/cgv.html\">fiitday.com/cgv.html</a>."));
  return page("Confirmation de ta commande", corps);
}
