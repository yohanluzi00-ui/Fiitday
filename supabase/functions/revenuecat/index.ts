// Messages de RevenueCat (webhook) : achats, renouvellements, résiliations, expirations, achats à vie.
// Sécurité : RevenueCat envoie l'en-tête Authorization configuré dans son tableau de bord ; il doit être exactement
// « Bearer <RC_WEBHOOK_SECRET> » (secret enregistré dans Supabase, jamais dans le code). Sans ce secret, tout est refusé.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const enc = new TextEncoder();
// comparaison à temps constant (évite de deviner le secret caractère par caractère)
function same(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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
  return json(200, data);
});
