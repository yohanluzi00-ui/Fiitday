// Résilier un abonnement et renoncer au contrat (rétractation) en ligne, rappels avant la reconduction annuelle.
// Code de la consommation : L215-1-1 et D215-1 à D215-3, L224-25-9, L221-21 et D221-5, L215-1.
// - « resilier » / « retracter » : demandés par l'appli, au nom du compte connecté (jeton de connexion vérifié ici).
//   Les fonctions SQL vérifient la demande (abonnement à soi, délai de 14 jours…) et l'appliquent ; RevenueCat arrête ou
//   rembourse l'abonnement payé par carte ; un e-mail confirme la demande (date, heure, date de fin, remboursement).
// - « rappels » : lancé chaque jour par la base (pg_cron) avec un secret gardé dans le coffre de Supabase (Vault).
// - « verifier » : administrateur seulement, teste les clés RevenueCat et Brevo.
// Clés (Supabase › Edge Functions › Secrets, jamais dans le code ni dans le chat) : RC_V2_SECRET_KEY (clé secrète
// RevenueCat « API v2 » : Customer information en lecture et écriture, Project configuration en lecture), BREVO_API_KEY.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { envoyer, euros } from "./mail.ts";
import { mailRappel, mailResiliation, mailRetractation } from "./mails.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const URL_ = Deno.env.get("SUPABASE_URL")!;
const srv = () => createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

/* ---------- RevenueCat (API v2) : abonnements et achats payés par carte sur fiitday.com ---------- */
const rcKey = () => (Deno.env.get("RC_V2_SECRET_KEY") || "").trim();
async function rc(path: string, method = "GET"): Promise<{ ok: boolean; status: number; body: any }> {
  const r = await fetch("https://api.revenuecat.com/v2" + path, { method, headers: { Authorization: "Bearer " + rcKey(), "Content-Type": "application/json" } });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}
let projectId = "";
async function project(): Promise<string> {
  if (projectId) return projectId;
  const r = await rc("/projects");
  if (!r.ok) throw new Error("RevenueCat a refusé la clé (" + r.status + ") " + String(r.body?.message || "").slice(0, 100));
  projectId = r.body?.items?.[0]?.id || "";
  if (!projectId) throw new Error("aucun projet RevenueCat");
  return projectId;
}
const storeId = new Map<string, string>();
async function productIdentifier(pid: string, rcProduct: string): Promise<string> {
  if (storeId.has(rcProduct)) return storeId.get(rcProduct)!;
  const r = await rc("/projects/" + pid + "/products/" + encodeURIComponent(rcProduct));
  const id = r.ok ? String(r.body?.store_identifier || "") : "";
  storeId.set(rcProduct, id);
  return id;
}
// trouve l'abonnement (ou l'achat à vie) payé par carte correspondant au produit, puis l'arrête ou le rembourse
async function rcAction(uid: string, product: string, what: "cancel" | "refund"): Promise<string> {
  if (rcKey().length < 20) return "À faire : " + (what === "cancel" ? "arrêter le renouvellement" : "rembourser") + " dans RevenueCat (clé RC_V2_SECRET_KEY absente)";
  try {
    const pid = await project();
    const life = /_vie_/.test(product);
    const list = await rc("/projects/" + pid + "/customers/" + encodeURIComponent(uid) + (life ? "/purchases" : "/subscriptions") + "?limit=50");
    if (!list.ok) throw new Error("lecture du client refusée (" + list.status + ")");
    let found = "";
    for (const it of list.body?.items || []) {
      if (String(it.store || "").toLowerCase() !== "rc_billing") continue;
      if (!life && it.gives_access === false && it.status !== "active") continue;
      if (await productIdentifier(pid, it.product_id) === product) { found = it.id; break; }
    }
    if (!found) throw new Error("achat introuvable chez RevenueCat");
    const path = "/projects/" + pid + (life ? "/purchases/" : "/subscriptions/") + encodeURIComponent(found) + "/actions/" + what;
    const r = await rc(path, "POST");
    if (!r.ok) throw new Error("action refusée (" + r.status + ") " + String(r.body?.message || "").slice(0, 100));
    return what === "cancel" ? "RevenueCat : renouvellement arrêté" : "RevenueCat : remboursé intégralement et arrêté";
  } catch (e) {
    return "À faire : " + (what === "cancel" ? "arrêter le renouvellement" : "rembourser") + " dans RevenueCat (" + String((e as Error).message || e).slice(0, 160) + ")";
  }
}

/* ---------- demandes ---------- */
async function demande(token: string, b: any) {
  const asUser = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: "Bearer " + token } }, auth: { persistSession: false } });
  const { data: u, error: ue } = await asUser.auth.getUser(token);
  if (ue || !u?.user) return json(401, { ok: false, reason: "Connecte-toi" });
  const uid = u.user.id, sb = srv();
  const kind = b.action === "retracter" ? "retractation" : "resiliation";
  const store = String(b.store || "").slice(0, 30), product = String(b.product || "").slice(0, 100);
  const wish = kind === "resiliation" ? (b.wish === "maintenant" ? "maintenant" : "fin") : null;
  const name = String(b.name || "").trim().slice(0, 120), email = String(b.email || "").trim().slice(0, 200);
  if (name.length < 2) return json(400, { ok: false, reason: "Indique ton nom et ton prénom" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { ok: false, reason: "Indique une adresse e-mail valide" });
  if (kind === "resiliation" && store === "PLAY_STORE") return json(400, { ok: false, reason: "Un abonnement Google Play se résilie dans Google Play" });
  const { data: chk, error: ce } = await sb.rpc("contract_check", { p_user: uid, p_kind: kind, p_store: store, p_product: product, p_wish: wish });
  if (ce) return json(500, { ok: false, reason: ce.message });
  if (!chk?.ok) return json(400, { ok: false, reason: chk?.reason || "Demande impossible" });
  // l'abonnement ou l'achat est arrêté chez RevenueCat (paiement par carte) ; Google Play et le magasin de test : à la main
  let auto = "";
  if (store === "RC_BILLING") {
    auto = await rcAction(uid, product, kind === "retractation" ? "refund" : "cancel");
    if (kind === "resiliation" && wish === "maintenant" && Number(chk.refund) > 0) auto += " ; À faire : rembourser " + euros(Number(chk.refund)) + " dans Stripe (remboursement partiel)";
  } else if (store === "PLAY_STORE") {
    auto = "À faire : rembourser intégralement dans la Play Console (Gestion des commandes › Rembourser, en retirant l'accès)";
  } else {
    auto = "Achat de test : rien à rembourser";
  }
  const { data: sv, error: se } = await sb.rpc("contract_save", { p_user: uid, p_kind: kind, p_store: store, p_product: product, p_wish: wish, p_name: name, p_email: email, p_auto: auto });
  if (se) return json(500, { ok: false, reason: se.message });
  if (!sv?.ok) return json(400, { ok: false, reason: sv?.reason || "Demande impossible" });
  const [sujet, html] = kind === "resiliation"
    ? mailResiliation({ name, label: sv.label, store, at: sv.at, end_at: sv.end_at, refund: Number(sv.refund), wish: wish!, email })
    : mailRetractation({ name, label: sv.label, store, at: sv.at, bought: chk.at || "", refund: Number(sv.refund), email });
  const mail = await envoyer(email, name, sujet, html);
  await sb.rpc("contract_mail_status", { p_id: sv.id, p_mail: mail });
  return json(200, { ok: true, kind, at: sv.at, end_at: sv.end_at, refund: Number(sv.refund), refund_all: sv.refund_all, label: sv.label, mail_sent: mail.startsWith("envoyé") });
}

// Brevo : une clé restreinte n'a parfois accès qu'aux e-mails transactionnels ; elle expire après 90 jours sans
// utilisation, d'où ce petit appel quotidien (lancé par la tâche des rappels) qui la garde active
async function brevoPing(): Promise<string> {
  const bk = (Deno.env.get("BREVO_API_KEY") || "").trim();
  if (bk.length < 20) return "clé BREVO_API_KEY absente";
  try {
    for (const path of ["/account", "/smtp/templates?limit=1"]) {
      const r = await fetch("https://api.brevo.com/v3" + path, { headers: { "api-key": bk, accept: "application/json" } });
      if (r.ok) return "ok";
      if (r.status !== 401 && r.status !== 403) return "Brevo a répondu " + r.status;
    }
    return "Brevo a refusé la clé (vérifie qu'elle a l'autorisation « Emails transactionnels », et les IP autorisées)";
  } catch { return "Brevo injoignable"; }
}

async function rappels() {
  await brevoPing();
  const sb = srv();
  const { data, error } = await sb.rpc("renewal_due");
  if (error) return json(500, { ok: false, reason: error.message });
  let sent = 0;
  for (const d of (data || []) as any[]) {
    const [sujet, html] = mailRappel(d);
    const st = await envoyer(d.email, d.first_name || "", sujet, html);
    if (st.startsWith("envoyé")) sent++;
    // un rappel non envoyé (clé absente…) sera retenté le lendemain
    if (st.startsWith("envoyé")) await sb.rpc("renewal_mark", { p_user: d.user_id, p_store: d.store, p_product: d.product, p_until: d.until, p_status: st });
  }
  return json(200, { ok: true, due: (data || []).length, sent });
}

async function verifier(token: string) {
  const asUser = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: "Bearer " + token } }, auth: { persistSession: false } });
  const { data: chk } = await asUser.rpc("admin_contracts");
  if (!chk || chk.denied) return json(403, { denied: true });
  let revenuecat = "clé RC_V2_SECRET_KEY absente";
  if (rcKey().length >= 20) { try { await project(); revenuecat = "ok"; } catch (e) { revenuecat = String((e as Error).message || e); } }
  const brevo = await brevoPing();
  let cron = "inconnu";
  try { const { data } = await srv().rpc("cron_status"); cron = data || "inconnu"; } catch { /* rien */ }
  return json(200, { ok: true, revenuecat, brevo, cron });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { ok: false, reason: "POST seulement" });
  const b = await req.json().catch(() => ({}));
  if (b.action === "rappels") {
    const s = req.headers.get("x-cron-secret") || "";
    const { data: okSecret } = await srv().rpc("cron_secret_ok", { p: s });
    if (s.length < 32 || okSecret !== true) return json(401, { ok: false });
    return rappels();
  }
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { ok: false, reason: "Connecte-toi" });
  if (b.action === "verifier") return verifier(token);
  if (b.action === "resilier" || b.action === "retracter") return demande(token, b);
  return json(400, { ok: false, reason: "Action inconnue" });
});
