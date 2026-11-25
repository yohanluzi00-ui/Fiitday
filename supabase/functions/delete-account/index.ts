// Suppression du compte demandée depuis l'appli (Réglages › Compte › Supprimer mon compte).
// 1. Efface le client chez RevenueCat (RGPD), avec la clé secrète RevenueCat « API v2 » RC_V2_SECRET_KEY (celle de la
//    fonction contrat : Customer information en lecture et écriture), ou à défaut une clé v1 RC_SECRET_API_KEY,
//    enregistrée dans Supabase (Edge Functions › Secrets) : jamais dans le code ni dans le chat.
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
  const v2 = (Deno.env.get("RC_V2_SECRET_KEY") || "").trim();
  const v1 = (Deno.env.get("RC_SECRET_API_KEY") || "").trim();
  if (v2.length >= 20 || v1.length >= 20) {
    try {
      let r: Response;
      if (v2.length >= 20) {
        const h = { Authorization: "Bearer " + v2, "Content-Type": "application/json" };
        const p = await fetch("https://api.revenuecat.com/v2/projects", { headers: h });
        const pid = p.ok ? String((await p.json().catch(() => ({})))?.items?.[0]?.id || "") : "";
        if (!pid) throw new Error("projet " + p.status);
        r = await fetch("https://api.revenuecat.com/v2/projects/" + pid + "/customers/" + encodeURIComponent(id), { method: "DELETE", headers: h });
      } else {
        r = await fetch("https://api.revenuecat.com/v1/subscribers/" + encodeURIComponent(id), {
          method: "DELETE",
          headers: { Authorization: "Bearer " + v1, "Content-Type": "application/json" },
        });
      }
      revenuecat = r.ok || r.status === 404 ? "effacé" : "erreur " + r.status;
    } catch (e) {
      revenuecat = e instanceof Error && e.message.startsWith("projet") ? "erreur " + e.message : "injoignable";
    }
    // identifiant anonyme seulement : permet de finir l'effacement à la main dans RevenueCat si besoin
    if (revenuecat !== "effacé") console.error("RevenueCat : client non effacé (" + revenuecat + ") " + id);
  }

  const { error } = await asUser.rpc("delete_my_account");
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true, revenuecat });
});
