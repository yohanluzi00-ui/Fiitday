// E-mails de Fiitday envoyés par Brevo (clé BREVO_API_KEY enregistrée dans Supabase › Edge Functions › Secrets,
// jamais dans le code ni dans le chat). Même fichier dans les fonctions « contrat » et « revenuecat ».

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

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
    '<h1 style="font-size:20px;line-height:1.3;margin:0 0 14px">' + esc(titre) + "</h1>" + corps + "</div>" +
    '<p style="font-size:12px;color:#5D586B;margin:16px 4px 0">Fiitday · contact@fiitday.com · fiitday.com<br>Cet e-mail t\'est envoyé parce que tu as un compte Fiitday ; il concerne ton contrat, tu ne peux pas t\'en désabonner.</p>' +
    "</div></body></html>";
}
export const p = (h: string) => '<p style="margin:0 0 12px">' + h + "</p>";
export const encadre = (h: string) => '<div style="border:2px solid #C81E64;border-radius:12px;padding:12px 14px;margin:14px 0;font-size:16px">' + h + "</div>";
export const lignes = (rows: [string, string][]) => '<table style="border-collapse:collapse;width:100%;margin:6px 0 14px;font-size:15px">' +
  rows.map(([k, v]) => '<tr><td style="padding:6px 10px 6px 0;color:#5D586B;vertical-align:top;white-space:nowrap">' + esc(k) + '</td><td style="padding:6px 0;vertical-align:top">' + v + "</td></tr>").join("") + "</table>";
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
