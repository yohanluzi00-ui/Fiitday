// Suppression du compte demandée depuis l'appli (Réglages › Compte › Supprimer mon compte).
// 1. Abonnement payé par carte (fiitday.com) encore renouvelable : résilié d'abord, comme « Résilier mon abonnement »
//    (fonction contrat, fin immédiate avec remboursement de la part non utilisée, e-mail de confirmation, demande gardée
//    comme preuve) ; si l'arrêt chez RevenueCat échoue, la suppression est refusée (sinon les prélèvements continueraient
//    sans que la personne puisse encore résilier en ligne).
// 2. Efface le client chez RevenueCat (RGPD), avec la clé secrète RevenueCat « API v2 » RC_V2_SECRET_KEY, ou à défaut une
//    clé v1 RC_SECRET_API_KEY (Supabase › Edge Functions › Secrets : jamais dans le code ni dans le chat). En cas d'échec,
//    le compte est noté pour un nouvel essai automatique chaque jour (rc_pending_delete, fonction contrat).
// 3. Supprime le compte et toutes ses données avec delete_my_account, appelée au nom de l'utilisateur.
// Si cette fonction ne répond pas, l'appli appelle directement delete_my_account, qui refuse tant qu'un abonnement par
// carte se renouvelle et note le client RevenueCat à effacer.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const URL_ = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST seulement" });
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Connecte-toi" });
  const asUser = createClient(URL_, ANON, { global: { headers: { Authorization: "Bearer " + token } }, auth: { persistSession: false } });
  const { data: u, error: ue } = await asUser.auth.getUser(token);
  if (ue || !u || !u.user) return json(401, { error: "Connecte-toi" });
  const id = u.user.id, email = u.user.email || "";

  // 1) abonnements par carte encore renouvelables : résiliés avant la suppression
  const sb = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: subs, error: se } = await sb.from("rc_subs").select("store,product").eq("user_id", id).eq("store", "RC_BILLING").eq("renews", true).gt("until", new Date().toISOString());
  if (se) { console.error("rc_subs : " + se.message); return json(500, { error: "La suppression a échoué, réessaie dans un instant." }); }
  const name = String(u.user.user_metadata?.first_name || "").trim() || email;
  for (const s of (subs || []) as { store: string; product: string }[]) {
    let j: { ok?: boolean; reason?: string; auto?: string } = {};
    try {
      const r = await fetch(URL_ + "/functions/v1/contrat", { method: "POST", headers: { Authorization: "Bearer " + token, apikey: ANON, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resilier", store: s.store, product: s.product, wish: "maintenant", name: name.length >= 2 ? name : "Client Fiitday", email }) });
      j = await r.json().catch(() => ({}));
    } catch { j = { ok: false, reason: "service de résiliation injoignable" }; }
    if (!j.ok || /À faire : arrêter le renouvellement/.test(j.auto || "")) {
      console.error("suppression refusée, abonnement non arrêté : " + (j.reason || j.auto || "inconnu") + " " + id);
      return json(409, { error: j.ok ? "Ta résiliation est enregistrée, mais l'arrêt automatique des prélèvements a échoué : nous l'arrêtons à la main. Réessaie la suppression de ton compte demain."
        : "Ton abonnement par carte n'a pas pu être résilié (" + String(j.reason || "erreur") + "). Résilie-le d'abord dans Réglages › Tes achats Premium, puis supprime ton compte." });
    }
  }

  // 2) client RevenueCat effacé
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
  }

  // 3) compte supprimé ; client RevenueCat pas encore effacé : noté pour un nouvel essai quotidien
  const { error } = await asUser.rpc("delete_my_account", { p_rc_done: revenuecat === "effacé" });
  if (error) { console.error("delete_my_account : " + error.message); return json(500, { error: "La suppression a échoué, réessaie dans un instant." }); }
  return json(200, { ok: true, revenuecat });
});
