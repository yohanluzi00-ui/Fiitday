// Résilier un abonnement et renoncer au contrat (rétractation) en ligne, rappels avant la reconduction annuelle.
// Code de la consommation : L215-1-1 et D215-1 à D215-3, L224-25-9, L221-21 et D221-5, L215-1.
// - « resilier » / « retracter » : demandés par l'appli, au nom du compte connecté (jeton de connexion vérifié ici).
//   Les fonctions SQL vérifient la demande (abonnement à soi, délai de 14 jours…) et l'appliquent ; RevenueCat arrête ou
//   rembourse l'abonnement payé par carte ; un e-mail confirme la demande (date, heure, date de fin, remboursement).
//   Rétractation : les jours déjà utilisés sont payés au prorata (L221-25), le reste est remboursé ; résiliation « tout de
//   suite » : la part non utilisée est remboursée. Paiement par carte : remboursement partiel fait tout seul dans Stripe,
//   avec un avoir numéroté envoyé par e-mail.
// - « rappels » : lancé chaque jour par la base (pg_cron) avec un secret gardé dans le coffre de Supabase (Vault) :
//   rappels avant la reconduction annuelle, et e-mail aux comptes inutilisés depuis près de 2 ans.
// - « verifier » : administrateur seulement, teste les clés RevenueCat, Stripe et Brevo.
// Clés (Supabase › Edge Functions › Secrets, jamais dans le code ni dans le chat) : RC_V2_SECRET_KEY (clé secrète
// RevenueCat « API v2 » : Customer information en lecture et écriture, Project configuration en lecture), BREVO_API_KEY,
// STRIPE_REFUND_KEY (clé restreinte Stripe : Balance, Customers et PaymentIntents en lecture, Charges en écriture).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { envoyer, envoyerFacture, esc, euros, type Facture, lignes, p, page, quand } from "./mail.ts";
import { mailInactif, mailRappel, mailResiliation, mailRetractation } from "./mails.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
// erreur technique : détail dans les journaux du serveur, message clair pour la personne
const oops = (where: string, e: { message?: string } | null) => { console.error(where + " : " + String(e?.message || e)); return json(500, { ok: false, reason: "Le serveur n'a pas pu traiter la demande. Réessaie dans un instant ; si cela continue, écris-nous à contact@fiitday.com." }); };
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

/* ---------- Stripe : remboursement partiel automatique d'un paiement par carte ---------- */
// RevenueCat crée les paiements dans Stripe : le client Stripe porte l'identifiant du compte Fiitday (metadata rc_customer_id)
// et chaque paiement le produit acheté (metadata rc_product_identifier). On rembourse le dernier paiement réussi de ce produit.
const stripeKey = () => (Deno.env.get("STRIPE_REFUND_KEY") || "").trim();
async function stripe(path: string, form?: Record<string, string>): Promise<{ ok: boolean; status: number; body: any }> {
  const headers: Record<string, string> = { Authorization: "Bearer " + stripeKey() };
  if (form) headers["Content-Type"] = "application/x-www-form-urlencoded";
  const r = await fetch("https://api.stripe.com/v1" + path, { method: form ? "POST" : "GET", headers, body: form ? new URLSearchParams(form) : undefined });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}
const stripeErr = (r: { status: number; body: any }) => "(" + r.status + ") " + String(r.body?.error?.message || "").slice(0, 120);
async function stripeRefund(uid: string, product: string, amount: number, why: string): Promise<string> {
  const cents = Math.round(amount * 100);
  if (cents <= 0) return "";
  if (!/^(rk|sk)_(test|live)_[A-Za-z0-9]+$/.test(stripeKey())) return "À faire : rembourser " + euros(amount) + " dans Stripe (clé STRIPE_REFUND_KEY absente)";
  try {
    const cs = await stripe("/customers/search?limit=20&query=" + encodeURIComponent("metadata['rc_customer_id']:'" + uid + "'"));
    if (!cs.ok) throw new Error("recherche du client refusée " + stripeErr(cs));
    // deno-lint-ignore no-explicit-any
    let best: any = null;
    for (const c of cs.body?.data || []) {
      const pis = await stripe("/payment_intents?limit=50&customer=" + encodeURIComponent(c.id));
      if (!pis.ok) throw new Error("lecture des paiements refusée " + stripeErr(pis));
      for (const pi of pis.body?.data || []) {
        if (pi.status !== "succeeded" || pi.metadata?.rc_product_identifier !== product) continue;
        if (!best || pi.created > best.created) best = pi;
      }
    }
    if (!best) throw new Error("paiement introuvable dans Stripe");
    const amt = Math.min(cents, Number(best.amount_received || best.amount));
    const r = await stripe("/refunds", { payment_intent: best.id, amount: String(amt), reason: "requested_by_customer", "metadata[fiitday]": why, "metadata[compte]": uid });
    if (!r.ok) throw new Error("remboursement refusé " + stripeErr(r));
    return "Stripe : " + euros(amt / 100) + " remboursés";
  } catch (e) {
    return "À faire : rembourser " + euros(amount) + " dans Stripe (" + String((e as Error).message || e).slice(0, 160) + ")";
  }
}

/* ---------- alertes pour le propriétaire (contact@fiitday.com) ---------- */
// remboursement à faire à la main (Google Play, remboursement partiel Stripe, échec RevenueCat) : au plus tard 14 jours après
// la demande (L221-24, sinon majorations L242-4) ; et rétractations répétées d'un même compte ou d'une même adresse (abus possible)
async function alerte(sujet: string, rows: [string, string][], texte: string) {
  const html = page(sujet, p(texte) + lignes(rows) + p("Le détail est dans Réglages › Administration › Abonnements."));
  const st = await envoyer("contact@fiitday.com", "Fiitday", "[Fiitday] " + sujet, html);
  if (!st.startsWith("envoyé")) console.error("alerte non envoyée (" + sujet + ") : " + st);
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
  if (ce) return oops("contract_check", ce);
  if (!chk?.ok) return json(400, { ok: false, reason: chk?.reason || "Demande impossible" });
  // la demande est enregistrée et appliquée (Premium s'arrête à la date de fin), puis les actions automatiques suivent
  const { data: sv, error: se } = await sb.rpc("contract_save", { p_user: uid, p_kind: kind, p_store: store, p_product: product, p_wish: wish, p_name: name, p_email: email, p_auto: "" });
  if (se) return oops("contract_save", se);
  if (!sv?.ok) return json(400, { ok: false, reason: sv?.reason || "Demande impossible" });
  const refund = Number(sv.refund) || 0, life = /_vie_/.test(product);
  const autos: string[] = [];
  if (store === "RC_BILLING") {
    // paiement par carte : renouvellement arrêté chez RevenueCat, remboursement (partiel) fait dans Stripe
    if (!life) autos.push(await rcAction(uid, product, "cancel"));
    if (refund > 0) autos.push(await stripeRefund(uid, product, refund, kind));
  } else if (store === "PLAY_STORE") {
    if (refund > 0) autos.push("À faire : rembourser " + euros(refund) + " dans la Play Console (Gestion des commandes › Rembourser, montant partiel, en retirant l'accès)");
  } else {
    autos.push("Achat de test : rien à rembourser");
  }
  const auto = autos.filter(Boolean).join(" ; ") || "rien à rembourser";
  await sb.rpc("contract_auto_set", { p_id: sv.id, p_auto: auto });
  // avoir numéroté pour un remboursement par carte (rattaché à la facture de l'achat)
  let avoir: Facture | null = null;
  if (store === "RC_BILLING" && refund > 0) {
    const { data: a } = await sb.rpc("invoice_create", { p: { kind: "avoir", user_id: uid, product, amount: refund, store, contract_id: sv.id, email, client: name } });
    if (a?.ok) avoir = a.invoice as Facture;
  }
  const [sujet, html] = kind === "resiliation"
    ? mailResiliation({ name, label: sv.label, store, at: sv.at, end_at: sv.end_at, refund, wish: wish!, email })
    : mailRetractation({ name, label: sv.label, store, at: sv.at, bought: sv.bought || chk.at || "", refund, price: Number(sv.price) || 0, kept: Number(sv.kept) || 0, email });
  const mail = await envoyer(email, name, sujet, html);
  await sb.rpc("contract_mail_status", { p_id: sv.id, p_mail: mail });
  if (avoir) await envoyerFacture(sb, avoir);
  const rows: [string, string][] = [["Demande", kind === "resiliation" ? "Résiliation" : "Rétractation"], ["Contrat", esc(sv.label) + " · " + esc(store)], ["Client", esc(name) + " · " + esc(email)],
    ["Reçue le", esc(quand(sv.at))], ["Remboursement", refund > 0 ? esc(euros(refund)) + (sv.refund_all ? " (intégral)" : Number(sv.kept) > 0 ? " (" + esc(euros(Number(sv.kept))) + " gardés pour les jours utilisés)" : "") : "aucun"],
    ["Avoir", avoir ? esc(avoir.number) : "—"], ["Automatique", esc(auto)]];
  if (/À faire/.test(auto)) {
    const limite = quand(new Date(Date.parse(sv.at) + 14 * 864e5), false);
    await alerte("À faire avant le " + limite + " : " + (kind === "resiliation" ? "résiliation" : "rétractation"), rows,
      "Cette demande nécessite une action à la main. Le remboursement doit être fait au plus tard le <b>" + esc(limite) + "</b> (14 jours après la demande), puis note-le avec « C'est fait ».");
  }
  if (kind === "retractation" && Number(sv.retractations) >= 2) {
    await alerte("Rétractations répétées (" + Number(sv.retractations) + ") : " + name, rows,
      "Ce compte (ou cette adresse e-mail) s'est rétracté " + Number(sv.retractations) + " fois. La rétractation reste un droit à chaque nouvel achat : elle a été appliquée normalement ; à toi de voir s'il s'agit d'un abus (achats et remboursements à répétition).");
  }
  return json(200, { ok: true, kind, at: sv.at, end_at: sv.end_at, refund, refund_all: sv.refund_all, kept: Number(sv.kept) || 0, price: Number(sv.price) || 0, label: sv.label,
    mail_sent: mail.startsWith("envoyé"), auto, avoir: avoir ? avoir.number : null });
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

// clients RevenueCat d'un compte supprimé sans passer par la fonction delete-account (repli) : effacés ici chaque jour
// deno-lint-ignore no-explicit-any
async function rcNettoyage(sb: any): Promise<number> {
  if (rcKey().length < 20) return 0;
  const { data } = await sb.from("rc_pending_delete").select("user_id").limit(50);
  let n = 0;
  for (const row of (data || []) as { user_id: string }[]) {
    try {
      const pid = await project();
      const r = await rc("/projects/" + pid + "/customers/" + encodeURIComponent(row.user_id), "DELETE");
      if (r.ok || r.status === 404) { await sb.from("rc_pending_delete").delete().eq("user_id", row.user_id); n++; }
    } catch (e) { console.error("effacement RevenueCat : " + String((e as Error).message || e)); }
  }
  return n;
}

async function rappels() {
  await brevoPing();
  const sb = srv();
  await rcNettoyage(sb);
  const { data, error } = await sb.rpc("renewal_due");
  if (error) return oops("renewal_due", error);
  let sent = 0;
  for (const d of (data || []) as any[]) {
    const [sujet, html] = mailRappel(d);
    const st = await envoyer(d.email, d.first_name || "", sujet, html);
    if (st.startsWith("envoyé")) sent++;
    // un rappel non envoyé (clé absente…) sera retenté le lendemain
    if (st.startsWith("envoyé")) await sb.rpc("renewal_mark", { p_user: d.user_id, p_store: d.store, p_product: d.product, p_until: d.until, p_status: st });
  }
  // comptes inutilisés depuis près de 2 ans : prévenus par e-mail (la suppression, 30 jours plus tard au moins, est faite par
  // la purge quotidienne de la base, seulement pour un compte prévenu)
  let warned = 0;
  const { data: idle, error: ie } = await sb.rpc("inactive_due");
  if (ie) console.error("inactive_due : " + ie.message);
  for (const d of (idle || []) as { user_id: string; email: string; first_name: string; delete_on: string }[]) {
    const [sj, ht] = mailInactif(d);
    const st = await envoyer(d.email, d.first_name || "", sj, ht);
    await sb.rpc("inactive_mark", { p_user: d.user_id, p_mail: st });
    if (st.startsWith("envoyé")) warned++;
  }
  return json(200, { ok: true, due: (data || []).length, sent, inactive: (idle || []).length, warned });
}

async function verifier(token: string) {
  const asUser = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: "Bearer " + token } }, auth: { persistSession: false } });
  const { data: chk } = await asUser.rpc("admin_contracts");
  if (!chk || chk.denied) return json(403, { denied: true });
  let revenuecat = "clé RC_V2_SECRET_KEY absente";
  if (rcKey().length >= 20) { try { await project(); revenuecat = "ok"; } catch (e) { revenuecat = String((e as Error).message || e); } }
  const brevo = await brevoPing();
  // Stripe (remboursements) : lecture des clients et des paiements, et droit de rembourser vérifié sur un paiement inexistant
  let stripeSt = "clé STRIPE_REFUND_KEY absente";
  if (/^(rk|sk)_(test|live)_/.test(stripeKey())) {
    try {
      const mode = /_live_/.test(stripeKey()) ? "réel" : "test";
      const c = await stripe("/customers?limit=1"), pi = await stripe("/payment_intents?limit=1"), rf = await stripe("/refunds", { payment_intent: "pi_fiitday_verification" });
      const refundOk = rf.status === 400 || rf.status === 404;
      stripeSt = c.ok && pi.ok && refundOk ? "ok (mode " + mode + ")"
        : "droits manquants : " + [!c.ok ? "Customers (lecture)" : "", !pi.ok ? "PaymentIntents (lecture)" : "", !refundOk ? "Charges (écriture, pour rembourser)" : ""].filter(Boolean).join(", ");
    } catch { stripeSt = "Stripe injoignable"; }
  }
  let cron = "inconnu";
  try { const { data } = await srv().rpc("cron_status"); cron = data || "inconnu"; } catch { /* rien */ }
  return json(200, { ok: true, revenuecat, brevo, stripe: stripeSt, cron });
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
