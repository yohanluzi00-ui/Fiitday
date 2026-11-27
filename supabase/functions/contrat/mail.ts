// E-mails de Fiitday envoyés par Brevo (clé BREVO_API_KEY enregistrée dans Supabase › Edge Functions › Secrets,
// jamais dans le code ni dans le chat). Même fichier dans les fonctions « contrat » et « revenuecat ».

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
// typographie française : espace insécable avant « ; : ! ? » et à l'intérieur des guillemets (dans le texte, pas dans les balises)
export const fr = (h: string) => (">" + h + "<").replace(/>([^<]+)</g, (_m, t: string) => ">" + t.replace(/ ([?:!;»])/g, "\u00a0$1").replace(/« /g, "«\u00a0") + "<").slice(1, -1);

// date et heure de Paris, en français : « 25 novembre 2026 à 09:44 »
export function quand(t: string | number | Date, heure = true): string {
  const d = new Date(t);
  const j = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" }).format(d);
  if (!heure) return j;
  return j + " à " + new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).format(d);
}
// dernier jour inclus d'une échéance donnée à minuit (heure de Paris) : 8 décembre 00:00 → « 7 décembre 2026 »
export const veille = (t: string) => quand(new Date(new Date(t).getTime() - 60000), false);
export const euros = (n: number) => n.toFixed(2).replace(".", ",") + " €";

export const PRIX: Record<string, { label: string; amount: number; period: string }> = {
  fiitday_solo_annuel: { label: "Premium Solo annuel", amount: 19.9, period: "par an" },
  fiitday_solo_mensuel: { label: "Premium Solo mensuel", amount: 1.99, period: "par mois" },
  fiitday_famille_annuel: { label: "Premium Famille annuel", amount: 69.9, period: "par an" },
  fiitday_famille_mensuel: { label: "Premium Famille mensuel", amount: 6.99, period: "par mois" },
  fiitday_vie_solo: { label: "Premium Solo à vie", amount: 49.9, period: "en une fois" },
  fiitday_vie_famille: { label: "Premium Famille à vie", amount: 149.9, period: "en une fois" },
};
export const boutique = (store: string) => store === "PLAY_STORE" ? "Google Play" : store === "RC_BILLING" ? "carte bancaire sur fiitday.com" : store === "TEST_STORE" ? "magasin de test" : store;

// mise en page simple, lisible dans toutes les messageries (styles en ligne)
export function page(titre: string, corps: string): string {
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(titre) + "</title></head>" +
    '<body style="margin:0;padding:0;background:#F4F2F8;font-family:Arial,Helvetica,sans-serif;color:#16131F;line-height:1.55">' +
    '<div style="max-width:620px;margin:0 auto;padding:24px 16px">' +
    '<div style="font-size:22px;font-weight:bold;color:#C81E64;margin-bottom:16px">Fiitday</div>' +
    '<div style="background:#FFFFFF;border:1px solid #E4E0EC;border-radius:14px;padding:22px 20px">' +
    '<h1 style="font-size:20px;line-height:1.3;margin:0 0 14px">' + fr(esc(titre)) + "</h1>" + corps + "</div>" +
    '<p style="font-size:12px;color:#5D586B;margin:16px 4px 0">Fiitday · contact@fiitday.com · fiitday.com<br>Cet e-mail t\'est envoyé parce que tu as un compte Fiitday ; il concerne ton contrat, tu ne peux pas t\'en désabonner.</p>' +
    "</div></body></html>";
}
export const p = (h: string) => '<p style="margin:0 0 12px">' + fr(h) + "</p>";
export const encadre = (h: string) => '<div style="border:2px solid #C81E64;border-radius:12px;padding:12px 14px;margin:14px 0;font-size:16px">' + fr(h) + "</div>";
export const lignes = (rows: [string, string][]) => '<table style="border-collapse:collapse;width:100%;margin:6px 0 14px;font-size:15px">' +
  rows.map(([k, v]) => '<tr><td style="padding:6px 10px 6px 0;color:#5D586B;vertical-align:top;white-space:nowrap">' + esc(k) + '</td><td style="padding:6px 0;vertical-align:top">' + fr(v) + "</td></tr>").join("") + "</table>";
export const texte = (html: string) => html.replace(/<(br|\/p|\/tr|\/h1|\/div)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();

// conditions générales de vente en ligne (incluses dans la confirmation de commande, avec le formulaire de rétractation)
export async function cgv(): Promise<string> {
  try {
    const r = await fetch("https://fiitday.com/cgv.html", { headers: { "User-Agent": "Fiitday" } });
    if (!r.ok) return "";
    const h = await r.text(), m = h.match(/<main>([\s\S]*?)<\/main>/);
    if (!m) return "";
    return m[1].replace(/<h1>[\s\S]*?<\/h1>/, "").replace(/class="encadre"/g, 'style="border:2px solid #C81E64;border-radius:10px;padding:4px 12px;margin:12px 0"')
      .replace(/class="loi"/g, 'style="font-size:13px;color:#5D586B;border-left:3px solid #E4E0EC;padding-left:12px"').replace(/class="meta"/g, 'style="color:#5D586B;font-size:13px"');
  } catch { return ""; }
}

export async function envoyer(to: string, nom: string, sujet: string, html: string): Promise<string> {
  const key = (Deno.env.get("BREVO_API_KEY") || "").trim();
  if (key.length < 20) return "pas envoyé : clé Brevo absente (BREVO_API_KEY)";
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": key, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sender: { name: "Fiitday", email: "contact@fiitday.com" }, replyTo: { name: "Fiitday", email: "contact@fiitday.com" },
        to: [nom ? { email: to, name: nom } : { email: to }], subject: sujet, htmlContent: html, textContent: texte(html), tags: ["contrat"] }),
    });
    if (r.ok) return "envoyé le " + quand(Date.now());
    const b = await r.json().catch(() => ({})) as { message?: string };
    return "pas envoyé : Brevo a refusé (" + r.status + ") " + String(b.message || "").slice(0, 120);
  } catch {
    return "pas envoyé : Brevo injoignable";
  }
}

/* ---------- factures et avoirs (paiements par carte sur fiitday.com) ---------- */
// identité du vendeur saisie dans Administration › Registre des recettes › « Infos du vendeur » (gardée dans la base)
export type Vendeur = { name?: string; addr?: string; siret?: string; immat?: string; vat?: string };
export const vendeurOk = (s: Vendeur | null) => !!s && String(s.name || "").trim().length > 3 && String(s.addr || "").trim().length > 5 && /^\d{14}$/.test(String(s.siret || ""));
export type Facture = { id: string; number: string; kind: string; test: boolean; email: string; client: string; product: string; label: string; amount: number;
  currency?: string; paid_at: string; period_start?: string | null; period_end?: string | null; ref_number?: string | null; created_at?: string };
const manque = (t: string) => "[" + t + " à compléter]";
export function factureHtml(f: Facture, s: Vendeur): [string, string] {
  const avoir = f.kind === "avoir", montant = euros(Number(f.amount));
  const titre = (avoir ? "Avoir" : "Facture") + " n° " + f.number;
  const vendeur = [String(s.name || "").trim() || manque("nom"), String(s.addr || "").trim() || manque("adresse"), "SIRET " + (s.siret || manque("SIRET")),
    String(s.immat || "").trim(), "contact@fiitday.com"].filter(Boolean).map(esc).join("<br>");
  const periode = /_vie_/.test(f.product) ? " (à vie)" : f.period_start && f.period_end ? " (du " + quand(f.period_start, false) + " au " + quand(f.period_end, false) + ")" : "";
  const cell = 'style="padding:8px 6px;border-bottom:1px solid #E4E0EC;text-align:right;white-space:nowrap"';
  const table = '<table style="border-collapse:collapse;width:100%;margin:8px 0 6px;font-size:14px"><tr style="color:#5D586B">' +
    '<td style="padding:6px 6px 6px 0;border-bottom:1px solid #E4E0EC">Désignation</td><td ' + cell + ">Qté</td><td " + cell + ">Prix unitaire</td><td " + cell + ">Montant</td></tr>" +
    '<tr><td style="padding:8px 6px 8px 0;border-bottom:1px solid #E4E0EC">' + fr(esc((avoir ? "Remboursement : " : "") + "Fiitday " + f.label + periode)) + "</td><td " + cell + ">1</td><td " + cell + ">" + esc(montant) + "</td><td " + cell + ">" + esc(montant) + "</td></tr>" +
    '<tr><td colspan="3" style="padding:8px 6px 8px 0;text-align:right"><b>' + (avoir ? "Total remboursé" : "Total payé") + "</b></td><td " + cell + "><b>" + esc(montant) + "</b></td></tr></table>";
  const corps = (f.test ? p("<b>Document de test</b> : achat de test, aucun paiement réel.") : "") +
    lignes([["Numéro", esc(f.number)], ["Date", esc(quand(f.created_at || f.paid_at, false))], ["Vendeur", vendeur],
      ["Client", esc([String(f.client || "").trim(), f.email].filter(Boolean).join(" · ") || "—")]].concat(avoir && f.ref_number ? [["Facture d'origine", esc(f.ref_number)]] : []) as [string, string][]) +
    table + p(esc(String(s.vat || "").trim() || "TVA non applicable, article 293 B du CGI") + ". Prix en euros.") +
    (avoir ? p("Ce montant t'est remboursé avec le moyen de paiement utilisé lors de l'achat.")
      : p("Payée le " + esc(quand(f.paid_at)) + " par carte bancaire sur fiitday.com (paiement traité par Stripe).")) +
    p("Garde ce document : c'est ton justificatif.");
  return [(f.test ? "[Test] " : "") + (avoir ? "Avoir" : "Facture") + " Fiitday n° " + f.number, page(titre, corps)];
}
// envoie une facture ou un avoir et note le résultat ; une vraie facture n'est jamais envoyée sans l'identité du vendeur
// deno-lint-ignore no-explicit-any
export async function envoyerFacture(sb: any, f: Facture): Promise<string> {
  const { data: s } = await sb.rpc("seller_info");
  let st: string;
  if (!f.test && !vendeurOk(s)) st = "pas envoyé : identité du vendeur à compléter (Administration › Registre des recettes › Infos du vendeur)";
  else if (!f.email) st = "pas envoyé : adresse e-mail introuvable";
  else { const [sujet, html] = factureHtml(f, s || {}); st = await envoyer(f.email, String(f.client || "").trim(), sujet, html); }
  await sb.rpc("invoice_mark", { p_id: f.id, p_mail: st });
  if (!st.startsWith("envoyé")) console.error((f.kind === "avoir" ? "avoir " : "facture ") + f.number + " : " + st);
  return st;
}
