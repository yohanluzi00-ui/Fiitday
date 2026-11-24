// Suppression du compte demandée depuis l'appli (Réglages › Compte › Supprimer mon compte).
// 1. Efface le client chez RevenueCat (RGPD), seulement si la clé secrète RC_SECRET_API_KEY est enregistrée
//    dans Supabase (Edge Functions › Secrets) : jamais dans le code ni dans le chat.
// 2. Supprime le compte et toutes ses données avec la fonction delete_my_account, appelée au nom de l'utilisateur
//    (elle ne peut supprimer que le compte connecté).
// Si cette fonction ne répond pas, l'appli appelle directement delete_my_account (sans l'étape 1).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST seulement" });
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Connecte-toi" });
  const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { persistSession: false },
  });
  const { data: u, error: ue } = await asUser.auth.getUser(token);
  if (ue || !u || !u.user) return json(401, { error: "Connecte-toi" });
  const id = u.user.id;

  let revenuecat = "sans clé";
  const key = Deno.env.get("RC_SECRET_API_KEY") || "";
  if (key.length >= 20) {
    try {
      const r = await fetch("https://api.revenuecat.com/v1/subscribers/" + encodeURIComponent(id), {
        method: "DELETE",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      });
      revenuecat = r.ok || r.status === 404 ? "effacé" : "erreur " + r.status;
    } catch {
      revenuecat = "injoignable";
    }
    // identifiant anonyme seulement : permet de finir l'effacement à la main dans RevenueCat si besoin
    if (revenuecat !== "effacé") console.error("RevenueCat : client non effacé (" + revenuecat + ") " + id);
  }

  const { error } = await asUser.rpc("delete_my_account");
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true, revenuecat });
});
