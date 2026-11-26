// Messages de RevenueCat (webhook) : achats, renouvellements, résiliations, expirations, achats à vie.
// Sécurité : RevenueCat envoie l'en-tête Authorization configuré dans son tableau de bord ; il doit être exactement
// « Bearer <RC_WEBHOOK_SECRET> » (secret enregistré dans Supabase, jamais dans le code). Sans ce secret, tout est refusé.
// Un même message reçu deux fois n'est appliqué qu'une fois (rc_apply garde l'identifiant de chaque message).
// Après un nouveau contrat (premier achat, achat à vie, changement de formule, réabonnement après la fin), la confirmation
// de la commande part par e-mail (Code de la consommation, L221-13) : récapitulatif, demande de début immédiat, délai de
// rétractation, CGV (intégrées à la fonction par build.js, cgv-texte.ts) et formulaire de rétractation. L'envoi se fait
// après la réponse à RevenueCat ; chaque confirmation est notée (order_confirmations) et retentée chaque jour si elle
// a échoué (« relance », lancée par pg_cron avec le secret du coffre de Supabase). Clé Brevo : BREVO_API_KEY.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { envoyer, PRIX } from "./mail.ts";
import { confirmationHtml } from "./confirmation.ts";
import { CGV_COMPLET, CGV_HTML, CGV_VERSION } from "./cgv-texte.ts";

const enc = new TextEncoder();
// comparaison à temps constant (évite de deviner le secret caractère par caractère)
function same(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const srv = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

type Conf = { event_id: string; user_id: string | null; product: string; store: string; env: string; bought_at: string; tries: number };

// envoie (ou renvoie) une confirmation notée dans order_confirmations, puis note le résultat
// deno-lint-ignore no-explicit-any
async function envoyerConfirmation(sb: any, c: Conf): Promise<string> {
  let st = "";
  const info = PRIX[c.product];
  if (!info) st = "pas envoyé : produit inconnu";
  else if (!c.user_id) st = "pas envoyé : compte supprimé";
  // vraie vente : jamais de confirmation avec des CGV incomplètes ; nouvel essai chaque jour après la mise à jour des CGV
  else if (c.env === "PRODUCTION" && !CGV_COMPLET) st = "pas envoyé : CGV à compléter (champs {{…}}) puis fonction à redéployer";
  if (!st) {
    const { data: u } = await sb.auth.admin.getUserById(c.user_id);
    const email = u?.user?.email;
    if (!email) st = "pas envoyé : adresse e-mail introuvable";
    else {
      const prenom = String(u?.user?.user_metadata?.first_name || "");
      const { data: consent } = await sb.rpc("purchase_consent_for", { p_user: c.user_id, p_product: c.product }) as { data: { text?: string; at?: string } | null };
      const test = c.env !== "PRODUCTION";
      const html = confirmationHtml({ prenom, email, product: c.product, at: Date.parse(c.bought_at), test, store: c.store, consent, cg: CGV_HTML });
      st = await envoyer(email, prenom, (test ? "[Test] " : "") + "Confirmation de ta commande Fiitday Premium", html);
    }
  }
  const ok = st.startsWith("envoyé");
  await sb.from("order_confirmations").update({ status: st.slice(0, 300), tries: (c.tries || 0) + 1, sent_at: ok ? new Date().toISOString() : null, cgv: CGV_VERSION })
    .eq("event_id", c.event_id);
  if (!ok) console.error("confirmation de commande non envoyée : " + st);
  return st;
}

// nouvel essai quotidien des confirmations qui n'ont pas pu partir (14 jours au plus, 6 essais)
// deno-lint-ignore no-explicit-any
async function relance(sb: any) {
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const { data, error } = await sb.from("order_confirmations").select("event_id,user_id,product,store,env,bought_at,tries")
    .not("status", "like", "envoyé%").lt("tries", 6).gte("created_at", since).limit(100);
  if (error) { console.error("relance : " + error.message); return json(500, { ok: false }); }
  let sent = 0;
  for (const c of (data || []) as Conf[]) if ((await envoyerConfirmation(sb, c)).startsWith("envoyé")) sent++;
  return json(200, { ok: true, due: (data || []).length, sent });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "POST seulement" });
  const sb = srv();
  // tâche quotidienne (pg_cron) : relance des confirmations non envoyées
  const cron = req.headers.get("x-cron-secret") || "";
  if (cron) {
    const { data: okSecret } = await sb.rpc("cron_secret_ok", { p: cron });
    if (cron.length < 32 || okSecret !== true) return json(401, { error: "Non autorisé" });
    return relance(sb);
  }
  const secret = Deno.env.get("RC_WEBHOOK_SECRET") || "";
  if (secret.length < 24) return json(503, { error: "Webhook pas encore configuré" });
  if (!same(req.headers.get("Authorization") || "", "Bearer " + secret)) return json(401, { error: "Non autorisé" });
  let body: { event?: Record<string, unknown> };
  try { body = await req.json(); } catch { return json(400, { error: "JSON invalide" }); }
  const ev = body && body.event;
  if (!ev || typeof ev !== "object") return json(400, { error: "event manquant" });
  const { data, error } = await sb.rpc("rc_apply", { ev });
  if (error) { console.error("rc_apply : " + error.message); return json(500, { error: "erreur du serveur" }); }
  // nouveau contrat : confirmation notée tout de suite, envoyée après la réponse (RevenueCat n'attend pas l'e-mail)
  if (data?.applied && data.new_contract && PRIX[String(data.product || "")]) {
    const c: Conf = { event_id: String(ev.id || crypto.randomUUID()).slice(0, 100), user_id: data.user_id, product: String(data.product), store: String(data.store),
      env: String(data.env), bought_at: new Date(Number(ev.purchased_at_ms || ev.event_timestamp_ms || Date.now())).toISOString(), tries: 0 };
    const { error: ie } = await sb.from("order_confirmations").insert(c);
    if (ie) console.error("journal des confirmations : " + ie.message);
    else {
      const job = envoyerConfirmation(sb, c).catch(e => console.error("confirmation de commande : " + String((e as Error).message || e)));
      // deno-lint-ignore no-explicit-any
      const rt = (globalThis as any).EdgeRuntime;
      if (rt && typeof rt.waitUntil === "function") rt.waitUntil(job); else await job;
    }
  }
  return json(200, data);
});
