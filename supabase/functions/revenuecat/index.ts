// Messages de RevenueCat (webhook) : achats, renouvellements, résiliations, expirations, achats à vie.
// Sécurité : RevenueCat envoie l'en-tête Authorization configuré dans son tableau de bord ; il doit être exactement
// « Bearer <RC_WEBHOOK_SECRET> » (secret enregistré dans Supabase, jamais dans le code). Sans ce secret, tout est refusé.
// Après un nouvel achat, envoie la confirmation de la commande par e-mail (Code de la consommation, L221-13) :
// récapitulatif, demande de début immédiat cochée avant le paiement, délai de rétractation, conditions générales de vente
// et formulaire de rétractation. Clé Brevo : BREVO_API_KEY (Supabase › Edge Functions › Secrets).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { cgv, envoyer, PRIX } from "./mail.ts";
import { confirmationHtml } from "./confirmation.ts";

const enc = new TextEncoder();
// comparaison à temps constant (évite de deviner le secret caractère par caractère)
function same(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
async function confirmation(sb: any, r: any, ev: any) {
  const product = String(r.product || ""), info = PRIX[product];
  if (!info) return;
  const { data: u } = await sb.auth.admin.getUserById(r.user_id);
  const email = u?.user?.email; if (!email) return;
  const prenom = String(u?.user?.user_metadata?.first_name || "");
  const { data: consent } = await sb.rpc("purchase_consent_for", { p_user: r.user_id, p_product: product }) as { data: { text?: string; at?: string } | null };
  const at = Number(ev.purchased_at_ms || ev.event_timestamp_ms || Date.now());
  const test = r.env !== "PRODUCTION";
  const cg = await cgv();
  const html = confirmationHtml({ prenom, email, product, at, test, store: String(r.store), consent, cg });
  const st = await envoyer(email, prenom, (test ? "[Test] " : "") + "Confirmation de ta commande Fiitday Premium", html);
  if (!st.startsWith("envoyé")) console.error("confirmation de commande non envoyée : " + st);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "POST seulement" });
  const secret = Deno.env.get("RC_WEBHOOK_SECRET") || "";
  if (secret.length < 24) return json(503, { error: "Webhook pas encore configuré" });
  if (!same(req.headers.get("Authorization") || "", "Bearer " + secret)) return json(401, { error: "Non autorisé" });
  let body: { event?: Record<string, unknown> };
  try { body = await req.json(); } catch { return json(400, { error: "JSON invalide" }); }
  const ev = body && body.event;
  if (!ev || typeof ev !== "object") return json(400, { error: "event manquant" });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data, error } = await sb.rpc("rc_apply", { ev });
  if (error) return json(500, { error: error.message });
  // nouvel achat appliqué : confirmation de la commande (ne bloque jamais la réponse à RevenueCat en cas d'échec)
  if (data?.applied && (data.type === "INITIAL_PURCHASE" || data.type === "NON_RENEWING_PURCHASE")) {
    try { await confirmation(sb, data, ev); } catch (e) { console.error("confirmation de commande : " + String((e as Error).message || e)); }
  }
  return json(200, data);
});
