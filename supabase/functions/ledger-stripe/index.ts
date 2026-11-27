// Registre des recettes automatique : lit dans Stripe les paiements par carte et les remboursements des 12 derniers mois
// et prépare une ligne par paiement et une par remboursement dans Administration › Registre des recettes, avec la facture
// (ou l'avoir) comme pièce justificative. Rien n'entre dans le registre sans validation.
// Clé : STRIPE_REFUND_KEY (clé restreinte Stripe : Balance, Customers et PaymentIntents en lecture, Charges en écriture),
// à défaut STRIPE_READ_KEY ; enregistrée dans Supabase (Edge Functions › Secrets), jamais dans le code ni dans le chat.
// Appelée par l'appli, pour le compte administrateur seulement (vérifié par admin_ledger_auto, qui demande aussi la double
// authentification).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Row = { stripe_id: string; charge_id: string; kind: "paiement" | "remboursement"; created: number; amount: number; fee: number; currency: string;
  user_id: string; product: string; note: string };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST seulement" });
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Connecte-toi" });
  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { persistSession: false },
  });
  const { data: chk, error: ce } = await asUser.rpc("admin_ledger_auto");
  if (ce) return json(401, { error: "Connecte-toi" });
  if (!chk || chk.denied) return json(403, { denied: true, mfa: !!(chk && chk.mfa) });
  const srv = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const save = (livemode: boolean | null, ok: boolean, message: string, months: unknown) =>
    srv.rpc("ledger_sync_save", { p_source: "stripe", p_livemode: livemode, p_ok: ok, p_message: message.slice(0, 300), p_months: months });

  const key = (Deno.env.get("STRIPE_REFUND_KEY") || Deno.env.get("STRIPE_READ_KEY") || "").trim();
  if (!/^(rk|sk)_(test|live)_[A-Za-z0-9]+$/.test(key)) {
    await save(null, false, "Clé Stripe absente : STRIPE_REFUND_KEY n'est pas enregistrée dans Supabase (Edge Functions › Secrets).", null);
    return json(200, { ok: false, reason: "no_key" });
  }
  const livemode = /_live_/.test(key);
  // deno-lint-ignore no-explicit-any
  const get = async (path: string): Promise<any> => {
    const r = await fetch("https://api.stripe.com/v1" + path, { headers: { Authorization: "Bearer " + key } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error("Stripe a refusé la lecture (" + r.status + ") : " + ((body.error && body.error.message) || "erreur inconnue"));
    return body;
  };
  const since = Math.floor(Date.now() / 1000) - 366 * 86400; // les 12 derniers mois
  const rows: Row[] = [], piUser = new Map<string, string>(), piProduct = new Map<string, string>();
  // deno-lint-ignore no-explicit-any
  const userOf = (c: any) => (c && typeof c === "object" && c.metadata && c.metadata.rc_customer_id) || "";
  try {
    // paiements réussis : le produit acheté (metadata posée par RevenueCat), le compte Fiitday (client Stripe) et les frais
    let after = "";
    for (let page = 0; page < 100; page++) {
      const b = await get("/payment_intents?limit=100&created[gte]=" + since + (after ? "&starting_after=" + after : "") +
        "&expand[]=data.customer&expand[]=data.latest_charge.balance_transaction");
      const list = b.data || [];
      for (const pi of list) {
        const user = userOf(pi.customer), product = String((pi.metadata && pi.metadata.rc_product_identifier) || "");
        piUser.set(pi.id, user); piProduct.set(pi.id, product);
        if (pi.status !== "succeeded") continue;
        const ch = pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
        const bt = ch && ch.balance_transaction && typeof ch.balance_transaction === "object" ? ch.balance_transaction : null;
        rows.push({ stripe_id: pi.id, charge_id: ch ? ch.id : "", kind: "paiement", created: ch ? ch.created : pi.created, amount: (pi.amount_received || pi.amount) / 100,
          fee: bt ? Math.max(bt.fee, 0) / 100 : 0, currency: pi.currency, user_id: user, product,
          note: pi.currency !== "eur" ? "Paiement en " + String(pi.currency).toUpperCase() + " : montant à vérifier." : "" });
      }
      if (!b.has_more || !list.length) break;
      after = list[list.length - 1].id;
    }
    // remboursements (après les paiements : ils retrouvent ainsi la facture de l'achat remboursé)
    after = "";
    for (let page = 0; page < 100; page++) {
      const b = await get("/refunds?limit=100&created[gte]=" + since + (after ? "&starting_after=" + after : "") + "&expand[]=data.balance_transaction");
      const list = b.data || [];
      for (const rf of list) {
        if (rf.status !== "succeeded") continue;
        const pid = typeof rf.payment_intent === "string" ? rf.payment_intent : (rf.payment_intent && rf.payment_intent.id) || "";
        if (pid && !piUser.has(pid)) { // achat de plus de 12 mois
          try { const pi = await get("/payment_intents/" + encodeURIComponent(pid) + "?expand[]=customer"); piUser.set(pid, userOf(pi.customer)); piProduct.set(pid, String((pi.metadata && pi.metadata.rc_product_identifier) || "")); }
          catch { piUser.set(pid, ""); piProduct.set(pid, ""); }
        }
        const bt = rf.balance_transaction && typeof rf.balance_transaction === "object" ? rf.balance_transaction : null;
        rows.push({ stripe_id: rf.id, charge_id: typeof rf.charge === "string" ? rf.charge : (rf.charge && rf.charge.id) || "", kind: "remboursement", created: rf.created,
          amount: rf.amount / 100, fee: bt ? Math.max(bt.fee, 0) / 100 : 0, currency: rf.currency, user_id: piUser.get(pid) || "", product: piProduct.get(pid) || "",
          note: rf.currency !== "eur" ? "Remboursement en " + String(rf.currency).toUpperCase() + " : montant à vérifier." : "" });
      }
      if (!b.has_more || !list.length) break;
      after = list[list.length - 1].id;
    }
  } catch (e) {
    await save(livemode, false, String((e as Error).message || e), null);
    return json(200, { ok: false, reason: String((e as Error).message || e) });
  }
  rows.sort((a, b) => (a.kind === b.kind ? a.created - b.created : a.kind === "paiement" ? -1 : 1));
  const { error: se } = await save(livemode, true, "", rows);
  if (se) { console.error("ledger_sync : " + se.message); return json(500, { error: "Erreur du serveur, réessaie dans un instant." }); }
  return json(200, { ok: true, livemode, payments: rows.filter(r => r.kind === "paiement").length, refunds: rows.filter(r => r.kind === "remboursement").length });
});
