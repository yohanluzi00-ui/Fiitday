// Registre des recettes automatique : lit les encaissements par carte dans Stripe (12 derniers mois, heure de Paris)
// et prépare une ligne par mois dans Administration › Registre des recettes. Rien n'entre dans le registre sans validation.
// Clé : STRIPE_READ_KEY, clé restreinte Stripe en lecture seule, enregistrée dans Supabase (Edge Functions › Secrets),
// jamais dans le code ni dans le chat. Appelée par l'appli, pour le compte administrateur seulement
// (vérifié par admin_ledger_auto, qui demande aussi la double authentification).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
// date à Paris au format AAAA-MM-JJ
const dayParis = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

type Month = { n: number; gross: number; fees: number; refunds: number; other: number };

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
  if (ce) return json(401, { error: ce.message });
  if (!chk || chk.denied) return json(403, { denied: true, mfa: !!(chk && chk.mfa) });
  const srv = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const save = (livemode: boolean | null, ok: boolean, message: string, months: unknown) =>
    srv.rpc("ledger_sync_save", { p_source: "stripe", p_livemode: livemode, p_ok: ok, p_message: message.slice(0, 300), p_months: months });

  const key = (Deno.env.get("STRIPE_READ_KEY") || "").trim();
  if (!/^(rk|sk)_(test|live)_[A-Za-z0-9]+$/.test(key)) {
    await save(null, false, "Clé Stripe absente : STRIPE_READ_KEY n'est pas enregistrée dans Supabase (Edge Functions › Secrets).", null);
    return json(200, { ok: false, reason: "no_key" });
  }
  const livemode = /_live_/.test(key);

  // les 12 derniers mois, mois en cours compris
  const today = dayParis(new Date()), Y = +today.slice(0, 4), M = +today.slice(5, 7);
  const months: Record<string, Month> = {};
  for (let i = 11; i >= 0; i--) {
    let y = Y, m = M - i;
    while (m <= 0) { m += 12; y--; }
    months[y + "-" + String(m).padStart(2, "0")] = { n: 0, gross: 0, fees: 0, refunds: 0, other: 0 };
  }
  const first = Object.keys(months)[0];
  const since = Math.floor(Date.UTC(+first.slice(0, 4), +first.slice(5, 7) - 1, 1) / 1000) - 7200; // marge pour le décalage horaire
  let after = "", count = 0;
  try {
    for (let page = 0; page < 100; page++) {
      const u = new URL("https://api.stripe.com/v1/balance_transactions");
      u.searchParams.set("limit", "100");
      u.searchParams.set("created[gte]", String(since));
      if (after) u.searchParams.set("starting_after", after);
      const r = await fetch(u, { headers: { Authorization: "Bearer " + key } });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error("Stripe a refusé la lecture (" + r.status + ") : " + ((body.error && body.error.message) || "erreur inconnue"));
      const list = body.data || [];
      for (const t of list) {
        const mo = months[dayParis(new Date(t.created * 1000)).slice(0, 7)];
        if (!mo) continue;
        const sale = t.type === "charge" || t.type === "payment", refund = t.type === "refund" || t.type === "payment_refund";
        if (!sale && !refund) continue; // virements, ajustements… : pas des recettes
        if (t.currency !== "eur") { if (sale) mo.other++; continue; }
        if (sale) { mo.n++; mo.gross += t.amount; mo.fees += t.fee; } else { mo.refunds += -t.amount; mo.fees += t.fee; }
      }
      count += list.length;
      if (!body.has_more || !list.length) break;
      after = list[list.length - 1].id;
    }
  } catch (e) {
    await save(livemode, false, String((e as Error).message || e), null);
    return json(200, { ok: false, reason: String((e as Error).message || e) });
  }

  const rows = Object.entries(months).map(([k, mo]) => {
    const y = +k.slice(0, 4), m = +k.slice(5, 7), closed = k < today.slice(0, 7);
    const last = String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0");
    return {
      period: k + "-01", paid_on: closed ? k + "-" + last : today, closed,
      n: mo.n, gross: mo.gross / 100, fees: Math.max(mo.fees, 0) / 100, refunds: Math.max(mo.refunds, 0) / 100, other_currency: mo.other,
      ref: "Stripe " + k + (livemode ? "" : " (test)"),
      note: mo.other ? mo.other + " paiement" + (mo.other > 1 ? "s" : "") + " dans une autre devise que l'euro, à ajouter à la main." : "",
    };
  });
  const { error: se } = await save(livemode, true, "", rows);
  if (se) return json(500, { error: se.message });
  return json(200, { ok: true, livemode, transactions: count });
});
