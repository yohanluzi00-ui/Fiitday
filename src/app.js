"use strict";
/* Fiitday — suivi des séances de musculation.
   Données gardées sur l'appareil (localStorage) et synchronisées avec Supabase quand on est connecté. */

const SUPABASE_URL = "https://krszgabjpswqjtypalsn.supabase.co";
const SUPABASE_KEY = "sb_publishable_cb_B1dUxgdE-zO1qRjp7tA_BWTYMgUs"; // clé publique (sans danger)
const DB_KEY = "muscuapp-v1";
const WIDE = 900; // largeur (px) à partir de laquelle la séance s'affiche en tableau
// grand écran (PC) : pages sur plusieurs colonnes (liste à gauche, détail à droite…) ; le téléphone n'est jamais concerné
const PC = 1100, isPC = () => window.innerWidth >= PC;
const Native = window.AndroidBridge || null;
const PW_MIN = 12; // longueur minimale d'un nouveau mot de passe, partout (inscription, mot de passe oublié, changement)
// fiitday.com affiché dans le cadre d'un autre site : on en sort, ou on n'affiche rien (pas de faux site autour de la vraie appli)
if (!Native && window.top !== window.self) {
  try { window.top.location.href = location.href; } catch (e) { }
  document.documentElement.innerHTML = "";
  throw new Error("Fiitday ne s'affiche pas dans le cadre d'un autre site");
}
const $app = document.getElementById("app");
let flashTimer = null; // clignotement de fin de repos

/* ================= Outils ================= */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = v => { const n = parseFloat(String(v == null ? "" : v).replace(",", ".")); return isNaN(n) ? null : n; };
const fmtNum = n => String(Math.round(n * 100) / 100).replace(".", ",").replace("-", "−"); // vrai signe moins (poids avec assistance)
const pad = n => String(n).padStart(2, "0");
// rnd : "down" pour un chrono qui monte (0:01 affiché après 1 s pleine), "up" pour un compte à rebours (0:00 seulement à la fin)
function fmtDur(ms, rnd) {
  const s = Math.max(0, rnd === "down" ? Math.floor(ms / 1000 + 1e-6) : rnd === "up" ? Math.ceil(ms / 1000 - 1e-6) : Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? h + ":" + pad(m) + ":" + pad(x) : m + ":" + pad(x);
}
// formateurs de dates créés une seule fois (bien plus rapide qu'un toLocaleDateString par ligne)
const DF = o => new Intl.DateTimeFormat("fr-FR", o);
const dfShort = DF({ weekday: "short", day: "numeric", month: "short" }), dfLong = DF({ weekday: "long", day: "numeric", month: "long" }),
  dfTime = DF({ hour: "2-digit", minute: "2-digit" }), dfMonth = DF({ month: "long", year: "numeric" });
const dfDay = DF({ day: "numeric", month: "short" });
const fmtDate = t => dfShort.format(t);
const fmtDateLong = t => dfLong.format(t);
const fmtTime = t => dfTime.format(t);
function fmtRest(s) { s = num(s) || 0; if (!s) return "—"; return s >= 60 ? (s % 60 ? Math.floor(s / 60) + " min " + pad(s % 60) : s / 60 + " min") : s + " s"; }
function ago(t) {
  const d = Math.floor((startOfDay(Date.now()) - startOfDay(t)) / 86400000);
  return d <= 0 ? "aujourd'hui" : d === 1 ? "hier" : "il y a " + d + " j";
}
function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
const norm = s => String(s || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const ICON = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>',
  dumbbell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6.5 7v10M3.5 9.5v5M17.5 7v10M20.5 9.5v5M6.5 12h11"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>',
};

/* ================= Stockage local ================= */
function emptyDb() { return { items: {}, lastServerAt: null, auth: null, mode: null, seeded: true, live: {}, owner: null }; }
// données illisibles (écriture interrompue…) : le texte brut est mis de côté sous une autre clé avant toute écriture
let unreadable = false;
function load() {
  let raw = null;
  try { raw = localStorage.getItem(DB_KEY); } catch (e) { }
  try { const d = JSON.parse(raw); if (d && d.items) return Object.assign(emptyDb(), d); } catch (e) { }
  if (raw) { unreadable = true; try { localStorage.setItem(DB_KEY + "-illisible-" + new Date().toISOString().slice(0, 10), raw); } catch (e) { } }
  return emptyDb();
}
let db = load();
if (db.auth && !db.owner) db.owner = db.auth.user.id;
let saveTimer = null, frozen = false, storageFull = false;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 300); }
function saveNow() {
  clearTimeout(saveTimer); saveTimer = null;
  if (frozen) return; // page en train de se recharger : rien n'est réécrit
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)); if (storageFull) { storageFull = false; storageBanner(); } }
  catch (e) {
    console.error(e);
    if (!storageFull) { storageFull = true; storageBanner(); }
  }
}
window.addEventListener("pagehide", saveNow);
// stockage de l'appareil plein (ou refusé) : bandeau tant que l'enregistrement échoue
function storageBanner() {
  let b = document.getElementById("storage-full");
  if (!storageFull) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement("div"); b.id = "storage-full"; b.className = "storage-full"; b.setAttribute("role", "alert"); document.body.appendChild(b); }
  b.innerHTML = "<b>Stockage de l'appareil plein</b> : tes dernières modifications ne sont pas enregistrées sur cet appareil. Fais une sauvegarde (Réglages › Données) puis libère de la place." +
    (db.auth ? " Tant que la synchro fonctionne, elles partent quand même sur ton compte." : "");
}
// recharge la page (changement de compte, déconnexion) : rien de l'ancien compte ne reste en mémoire
function restart(hash) { frozen = true; try { if (hash) history.replaceState(null, "", hash); } catch (e) { } location.reload(); }
// plusieurs onglets ouverts (site sur ordinateur) : chaque onglet reprend ce que les autres enregistrent, élément par élément,
// au lieu de les écraser avec sa propre copie
window.addEventListener("storage", e => {
  if (e.key !== DB_KEY || frozen || !e.newValue) return;
  let o; try { o = JSON.parse(e.newValue); } catch (err) { return; }
  if (!o || !o.items) return;
  const uid = x => x && x.auth && x.auth.user ? x.auth.user.id : null;
  if (uid(o) !== uid(db) || (o.owner || null) !== (db.owner || null) || (o.mode || null) !== (db.mode || null)) { restart(); return; } // déconnexion ou autre compte dans l'autre onglet
  const mine = saveTimer !== null; // modifications pas encore enregistrées ici
  let more = mine, changed = false;
  for (const id of Object.keys(o.items)) {
    const t = o.items[id], m = db.items[id];
    if (!t || typeof t.updated_at !== "number") continue;
    if (!m || t.updated_at > m.updated_at) { db.items[id] = t; changed = true; }
    else if (t.updated_at === m.updated_at) { if (m.dirty && !t.dirty) m.dirty = false; }
    else more = true;
  }
  if (!more) for (const id of Object.keys(db.items)) if (!o.items[id]) { more = true; break; }
  if (db.auth && o.auth) { // jeton le plus récent (l'autre onglet a pu le renouveler)
    if (o.auth.access_token !== db.auth.access_token) { if (o.auth.expires_at > db.auth.expires_at) db.auth = o.auth; }
    else if (o.auth.dead && !db.auth.dead) db.auth = o.auth;
  }
  if (o.lastServerAt && (!db.lastServerAt || o.lastServerAt > db.lastServerAt)) db.lastServerAt = o.lastServerAt;
  if (!mine) for (const k of Object.keys(o)) {
    if (k === "items" || k === "auth" || k === "lastServerAt") continue;
    if (JSON.stringify(o[k]) !== JSON.stringify(db[k])) { db[k] = o[k]; changed = true; }
  }
  if (changed) { dataRev++; softRender(); }
  if (more) save(); // l'autre onglet reprendra aussi ce qui n'existe qu'ici
});

// compteur de modifications : permet de ne recalculer les listes triées qu'après un changement
let dataRev = 0;
function all(kind) { return Object.values(db.items).filter(i => i.kind === kind && !i.deleted).map(i => i.data); }
function getItem(id) { const i = db.items[id]; return i && !i.deleted ? i.data : null; }
function put(kind, data) {
  const prev = db.items[data.id];
  let t = Date.now();
  if (prev && prev.updated_at >= t) t = prev.updated_at + 1;
  db.items[data.id] = { id: data.id, kind, data, updated_at: t, deleted: false, dirty: true };
  dataRev++; save(); scheduleSync();
}
function remove(id) {
  const p = db.items[id]; if (!p) return;
  // le contenu est effacé : seule une marque « supprimé » reste (et part sur les autres appareils)
  db.items[id] = { id, kind: p.kind, data: { id }, deleted: true, dirty: true, updated_at: Math.max(Date.now(), p.updated_at + 1) };
  dataRev++; save(); scheduleSync();
}
// enregistrement différé pendant la saisie (évite une écriture à chaque touche)
const pending = {};
function putLater(kind, data) {
  clearTimeout(pending[data.id]);
  pending[data.id] = setTimeout(() => { delete pending[data.id]; if (db.items[data.id] && !db.items[data.id].deleted) put(kind, data); }, 400);
}
function flushPending() {
  for (const id of Object.keys(pending)) { clearTimeout(pending[id]); delete pending[id]; const it = db.items[id]; if (it && !it.deleted) put(it.kind, it.data); }
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { flushPending(); saveNow(); return; }
  tick(); sync(); if (window.__fiitdayPending) window.__fiitdayPending();
  if (Native && route().name === "settings") softRender(); // retour des réglages de notification d'Android
});

/* ================= Données ================= */
// identifiants : lettres, chiffres, « _ » et « - » seulement (ils sont insérés dans les attributs HTML)
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const okId = x => typeof x === "string" && ID_RE.test(x);
const KINDS = { template: 1, workout: 1, settings: 1, weight: 1 }, NOTE_MAX = 1000; // genres d'éléments connus (une sauvegarde n'en apporte pas d'autres)
function validItem(it) {
  if (!it || !okId(it.id) || typeof it.kind !== "string" || !it.data || typeof it.data !== "object") return false;
  if (it.deleted) return true;
  const d = it.data;
  if (d.id !== it.id) return false;
  if (it.kind === "template") return Array.isArray(d.variants) && d.variants.every(v => v && okId(v.id) && Array.isArray(v.exercises) && v.exercises.every(e => e && okId(e.id) && (!e.groupId || okId(e.groupId))));
  if (it.kind === "workout") return okId(d.templateId) && okId(d.variantId) && typeof d.startedAt === "number" && Array.isArray(d.exercises) && d.exercises.every(e => e && okId(e.exId) && (!e.groupId || okId(e.groupId)) && Array.isArray(e.sets));
  if (it.kind === "weight") return /^\d{4}-\d{2}-\d{2}$/.test(d.date || "") && it.id === "poids-" + d.date && typeof d.kg === "number" && d.kg >= 20 && d.kg <= 400;
  return true;
}
// anciens noms « Variante N » → « Séance N » (affichage, et renommage enregistré quand les données sont à jour)
const vLabel = n => String(n == null ? "" : n).replace(/^Variante(?=\s|$)/i, "Séance");
function purgeBody() {
  for (const it of Object.values(db.items)) {
    if (it.kind !== "body" || (it.deleted && Object.keys(it.data || {}).length <= 1)) continue;
    db.items[it.id] = { id: it.id, kind: "body", data: { id: it.id }, updated_at: Math.max(Date.now(), it.updated_at + 1), deleted: true, dirty: true };
    dataRev++; save(); scheduleSync();
  }
}
// notes : chaque séance garde sa propre note ; les anciennes séances (où la note était celle du programme) reçoivent une fois la note actuelle
function freezeNotes() {
  for (const it of Object.values(db.items)) {
    if (it.kind !== "workout" || it.deleted || !it.data || !Array.isArray(it.data.exercises)) continue;
    const w = it.data; let ch = false;
    w.exercises.forEach(e => { if (e.note === undefined) { const te = tplExercise(w, e.exId); e.note = te && te.note ? te.note : ""; ch = true; } });
    if (ch) put("workout", w);
  }
}
function renameVariants() {
  for (const it of Object.values(db.items)) {
    if (it.kind !== "template" || it.deleted) continue;
    let ch = false;
    it.data.variants.forEach(v => { const n = vLabel(v.name); if (n !== v.name) { v.name = n; ch = true; } });
    if (!ch) continue;
    if (it.updated_at === 0) save(); // modèle vide jamais envoyé : on renomme sur place
    else put("template", it.data);
  }
}
const templates = () => all("template").sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name));
let wCache = { rev: -1, list: [] };
const workouts = () => { if (wCache.rev !== dataRev) wCache = { rev: dataRev, list: all("workout").sort((a, b) => b.startedAt - a.startedAt) }; return wCache.list; };
const finished = () => workouts().filter(w => w.endedAt);
const activeWorkout = () => workouts().find(w => !w.endedAt) || null;
function settings() { return Object.assign({ id: "settings", theme: "auto", alert: "vibration", goal: "5" }, getItem("settings") || {}); }
function setSetting(k, v) { const s = settings(); s[k] = v; put("settings", s); applyTheme(); render(); }
// réglages de départ d'un exercice de la bibliothèque (type, cible, repos, charge)
const libDefaults = lib => CARDIO_MACH[lib.cardioOf] || lib.cat === "cardio" ? { type: "cardio", machine: lib.cardioOf || lib.id, sets: 1, target: "", rest: 0 }
  : lib.kind === "time" ? Object.assign({ type: "time", target: String(lib.hold || 45), rest: lib.rest || 60 }, lib.hold ? { sets: 2 } : {})
  : lib.kind === "dist" ? { type: "dist", target: String(lib.dist || 1000), rest: lib.rest || 120, load: !!lib.load }
  : { type: /^Poids du corps/.test(lib.gear || "") ? "rep" : "reps", target: (String(lib.reps || "").match(/^\d+(-\d+)?/) || ["8-10"])[0], rest: lib.rest || 90 };
/* ================= Cardio : machines et indicateurs ================= */
// indicateurs connus : nom, nom court (boutons de Stats), unité ; clock : saisi en m:ss ; low : plus bas = mieux ; add : s'additionne entre deux blocs
const CARDIO_M = {
  dist: { n: "Distance", s: "Distance", u: "km", add: true }, distm: { n: "Distance", s: "Distance", u: "m", add: true, int: true },
  vit: { n: "Vitesse moyenne", s: "Vitesse", u: "km/h" }, incl: { n: "Inclinaison", s: "Inclinaison", u: "%" },
  res: { n: "Résistance", s: "Résistance", u: "niveau" }, cad: { n: "Cadence", s: "Cadence", u: "tr/min", int: true }, watts: { n: "Puissance moyenne", s: "Watts", u: "W", int: true },
  spm: { n: "Foulées", s: "Foulées", u: "/min", int: true }, etages: { n: "Étages montés", s: "Étages", u: "étages", add: true, int: true }, marches: { n: "Marches", s: "Marches", u: "marches", add: true, int: true },
  niv: { n: "Vitesse", s: "Niveau", u: "niveau" }, t500: { n: "Temps aux 500 m", s: "Temps / 500 m", u: "/500 m", clock: true, low: true }, cpm: { n: "Coups de rame", s: "Coups", u: "/min", int: true },
  cal: { n: "Calories", s: "Calories", u: "kcal", add: true, int: true }, fc: { n: "Fréquence cardiaque moyenne", s: "FC moy.", u: "bpm", int: true }
};
// indicateurs de départ de chaque machine ; une activité perso : distance, calories, fréquence cardiaque.
// La fréquence cardiaque peut renseigner sur la santé : elle n'apparaît qu'après un accord exprès (Ajouter un indicateur), retirable à tout moment
const CARDIO_MACH = {
  "tapis-course": ["dist", "vit", "incl", "cal", "fc"], "tapis-incurve": ["dist", "vit", "cal", "fc"],
  "velo-droit": ["dist", "res", "cad", "watts", "cal", "fc"], "velo-semi-allonge": ["dist", "res", "watts", "cal", "fc"], "velo-biking": ["dist", "res", "cad", "cal", "fc"],
  "velo-elliptique": ["dist", "res", "spm", "cal", "fc"], "escalier": ["etages", "marches", "niv", "cal", "fc"], "arc-trainer": ["dist", "res", "incl", "cal", "fc"],
  "rameur": ["distm", "t500", "cpm", "watts", "cal", "fc"], "skierg": ["distm", "t500", "watts", "cal", "fc"], "air-bike": ["dist", "watts", "cal", "fc"]
};
const CARDIO_BASE = ["dist", "cal", "fc"];
const CARDIO_MAX_OWN = 10; // indicateurs perso par machine
const ownCvOf = e => { if (e.machine && CARDIO_MACH[e.machine]) return null; const r = typeof ownEntry === "function" && e.name ? ownEntry(e.name) : null; return r && Array.isArray(r.cv) ? r.cv.filter(k => CARDIO_M[k]) : null; };
const cardioKey = e => (e.machine && CARDIO_MACH[e.machine] ? e.machine : "n:" + norm(e.name || "").slice(0, 40));
function cardioCustom(key) { const c = settings().cardioCustom, l = c && typeof c === "object" ? c[key] : null; return Array.isArray(l) ? l.filter(x => x && /^c[a-z0-9]{2,16}$/.test(x.k) && x.n) : []; }
const cvOwn = (k, d) => Object.assign({ k, n: String(d.n).slice(0, 30), s: String(d.n).slice(0, 14), u: String(d.u || "").slice(0, 12), own: true });
function cardioDefs(e) {
  return (CARDIO_MACH[e.machine] || ownCvOf(e) || CARDIO_BASE).map(k => Object.assign({ k }, CARDIO_M[k])).concat(cardioCustom(cardioKey(e)).map(x => cvOwn(x.k, x)));
}
// indicateurs retirés par l'utilisateur pour une machine (ils restent proposés dans « + Ajouter un indicateur »)
function cardioHidden(key) { const h = settings().cardioHidden, l = h && typeof h === "object" ? h[key] : null; return Array.isArray(l) ? l.filter(k => typeof k === "string") : []; }
const hrOk = () => !!settings().hrOk; // accord donné pour noter la fréquence cardiaque
// (dans un programme, sets est un nombre de séries ; en séance, la liste des séries)
const hasHr = e => Array.isArray(e.sets) && e.sets.some(st => st && st.cv && st.cv.fc != null && st.cv.fc !== "");
const cardioShown = e => { const h = cardioHidden(cardioKey(e)), hr = hrOk() || hasHr(e); return cardioDefs(e).filter(d => !h.includes(d.k) && (d.k !== "fc" || hr)); };
function setCardioHidden(key, list) { const st = settings(), hh = Object.assign({}, st.cardioHidden); hh[key] = list; st.cardioHidden = hh; put("settings", st); }
// fréquence cardiaque notée dans des séances (sets[].cv.fc) : comptée, puis effacée quand l'accord est retiré (RGPD, art. 7.3 et 17)
const hrCount = ws => ws.reduce((a, w) => a + (Array.isArray(w.exercises) ? w.exercises : []).reduce((b, e) => b + (Array.isArray(e.sets) ? e.sets.filter(st => st && st.cv && st.cv.fc != null && st.cv.fc !== "").length : 0), 0), 0);
function stripHr(w) {
  let ch = false;
  (Array.isArray(w.exercises) ? w.exercises : []).forEach(e => (Array.isArray(e.sets) ? e.sets : []).forEach(st => {
    if (st && st.cv && typeof st.cv === "object" && "fc" in st.cv) { const cv = Object.assign({}, st.cv); delete cv.fc; st.cv = cv; ch = true; }
  }));
  return ch;
}
function eraseHr() { flushPending(); let n = 0; all("workout").forEach(w => { if (stripHr(w)) { put("workout", w); n++; } }); return n; }
// accord retiré : une valeur revenue d'un appareil qui ne le savait pas encore (hors ligne) est effacée à son tour
function hrGoneSweep() { if (!hrOk() && settings().hrGoneAt && hrCount(all("workout"))) eraseHr(); }
// définition d'un indicateur d'après sa clé (indicateurs perso : cherchés sur toutes les machines)
function cvDef(k) {
  if (CARDIO_M[k]) return Object.assign({ k }, CARDIO_M[k]);
  const c = settings().cardioCustom || {};
  for (const key in c) { const x = Array.isArray(c[key]) && c[key].find(y => y && y.k === k); if (x) return cvOwn(k, x); }
  return null;
}
const cvNum = v => num(v); // valeurs enregistrées : nombres (les temps « m:ss » en secondes)
const cvFmt = (d, v) => (v == null ? "—" : d.u === "niveau" ? "Niveau " + fmtNum(Math.round(v * 10) / 10) : d.clock ? fmtClock(v) + (d.u ? " " + d.u : "") : fmtNum(d.int ? Math.round(v) : Math.round(v * 100) / 100) + (d.u ? " " + d.u : ""));
const cardioMachineOf = name => { const l = libFor(name); return l && CARDIO_MACH[l.id] ? l.id : ""; };
const cardioMachines = () => Object.keys(CARDIO_MACH).map(id => EXO_LIB.find(x => x.id === id)).filter(Boolean);
const cardioInfo = id => cardioDefs({ machine: id, name: "" }).map(d => d.n + (d.u && !d.clock && !norm(d.n).includes(norm(d.u)) ? " (" + d.u + ")" : ""));
const newExercise = () => ({ id: "e-" + uid(), name: "Nouvel exercice", type: "reps", sets: 3, target: "8-10", rest: 90, note: "" });
const blankSet = drops => ({ kg: "", reps: "", sec: "", done: false, drops: Array.from({ length: Math.max(0, num(drops) || 0) }, () => ({ kg: "", reps: "" })) });
// baisses d'une série en dégressif : toutes les séries, ou seulement la dernière (dropScope "last")
// nombre de baisses en dégressif ; jamais pour un exercice en temps (d'anciennes valeurs pouvaient rester cachées)
const restNextOf = (e, v) => (e && e.restNext != null ? num(e.restNext) || 0 : num(v && v.restBetween) || 0);
const dropsOf = e => (e && (e.type === "reps" || !e.type) ? num(e.drops) : 0) || 0;
// type « dist » (course, rameur, Hyrox) : distance cible en m, temps mesuré, charge facultative
const fmtClock = sec => { sec = Math.round(num(sec) || 0); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (h ? h + ":" + pad(m) : m) + ":" + pad(s); };
// temps tenu (gainage, étirement) : « 45 s », puis « 1:15 » dès 60 s
const fmtHold = v => { const n = num(v); return n == null ? "" : n >= 60 ? fmtClock(n) : fmtNum(n) + " s"; };
// « 4:05 », « 405 » (= 4 min 05) ou « 45 » (= 45 s) → secondes
function parseClock(t) {
  t = String(t || "").trim(); if (!t) return null;
  if (t.includes(":")) { const p = t.split(":").map(x => num(x)); if (p.some(x => x == null)) return null; return p.reduce((a, x) => a * 60 + x, 0); }
  const d = t.replace(/\D/g, ""); if (!d) return null;
  return d.length <= 2 ? +d : +d.slice(0, -2) * 60 + Math.min(59, +d.slice(-2));
}
const dropsFor = (e, k, n) => (dropsOf(e) && (e.dropScope !== "last" || k === n - 1)) ? dropsOf(e) : 0;
const GROUP_LABEL = { superset: "Superset", biset: "Biset", triset: "Triset", circuit: "Circuit" }; // circuit : exercices enchaînés en tours (programmes Fiitday)
const GROUP_SIZE = { superset: 2, biset: 2, triset: 3 };
const LETTERS = "ABCDEFGH";
// regroupe les exercices consécutifs d'un même superset / biset / triset
function blocks(list) {
  const out = [];
  list.forEach((e, i) => {
    const last = out[out.length - 1];
    if (e.groupId && last && last.groupId === e.groupId) last.items.push({ e, i });
    else out.push({ groupId: e.groupId || null, kind: e.groupKind || null, items: [{ e, i }] });
  });
  out.forEach(b => { if (b.items.length < 2) b.groupId = null; });
  return out;
}
function knownNames() {
  const set = new Set();
  all("template").forEach(t => t.variants.forEach(v => v.exercises.forEach(e => e.name && set.add(e.name.trim()))));
  all("workout").forEach(w => w.exercises.forEach(e => e.name && set.add(e.name.trim())));
  return Array.from(set).sort((a, b) => a.localeCompare(b, "fr"));
}
// un groupe de moins de 2 exercices redevient un exercice simple ; un groupe de 3+ est un triset
function cleanGroups(v) {
  const cnt = {};
  v.exercises.forEach(e => { if (e.groupId) cnt[e.groupId] = (cnt[e.groupId] || 0) + 1; });
  v.exercises.forEach(e => {
    if (!e.groupId) return;
    if (cnt[e.groupId] < 2) { delete e.groupId; delete e.groupKind; }
    else if (e.groupKind === "circuit") return; // un circuit reste un circuit, quel que soit le nombre d'exercices
    else if (cnt[e.groupId] >= 3) e.groupKind = "triset";
    else if (e.groupKind === "triset") e.groupKind = "superset";
  });
}
function tplExercise(w, exId) {
  const t = getItem(w.templateId); if (!t) return null;
  const v = t.variants.find(x => x.id === w.variantId); if (!v) return null;
  return v.exercises.find(e => e.id === exId) || null;
}
const cvHas = s => !!(s.cv && Object.keys(s.cv).some(k => cvNum(s.cv[k], cvDef(k)) != null));
const setHasData = (s, type) => type === "cardio" ? num(s.sec) != null || cvHas(s) : type === "time" || type === "dist" ? num(s.sec) != null : (num(s.kg) != null || num(s.reps) != null);
const exHasData = e => e.sets.some(s => setHasData(s, e.type));

function oneLabel(s, type) {
  if (type === "cardio") {
    const out = num(s.sec) != null ? [fmtClock(s.sec)] : [];
    Object.keys(s.cv || {}).forEach(k => { const d = cvDef(k), v = cvNum(s.cv[k], d); if (d && v != null && out.length < 4) out.push(cvFmt(d, v)); });
    return out.join(" · ") || "—";
  }
  if (type === "time") return num(s.sec) != null ? fmtHold(s.sec) : "—";
  if (type === "dist") return num(s.sec) != null ? fmtClock(s.sec) + (num(s.kg) != null ? " · " + fmtNum(num(s.kg)) + " kg" : "") : "—";
  const kg = num(s.kg), r = num(s.reps);
  if (kg != null && r != null) return fmtNum(kg) + " kg × " + fmtNum(r);
  if (r != null) return fmtNum(r) + " reps";
  if (kg != null) return fmtNum(kg) + " kg";
  return "—";
}
function setLabel(s, type) {
  let t = oneLabel(s, type);
  (s.drops || []).forEach(d => { if (setHasData(d, type)) t += " ↘ " + oneLabel(d, type); });
  return t;
}
const exSummary = e => e.sets.filter(s => setHasData(s, e.type)).map(s => setLabel(s, e.type)).join(", ");

/* Dernière performance : même séance + même variante en priorité, sinon même nom d'exercice ailleurs */
let lpCache = { rev: -1, map: new Map() };
function lastPerf(w, ex) {
  // même résultat tant qu'aucune séance n'a changé : évite de tout reparcourir à chaque champ affiché
  if (lpCache.rev !== dataRev) lpCache = { rev: dataRev, map: new Map() };
  const key = w.id + "|" + w.startedAt + "|" + ex.exId + "|" + norm(ex.name) + "|" + ex.type;
  if (lpCache.map.has(key)) return lpCache.map.get(key);
  const res = lastPerfCompute(w, ex);
  lpCache.map.set(key, res);
  return res;
}
function lastPerfCompute(w, ex) {
  const before = finished().filter(x => x.id !== w.id && x.startedAt < w.startedAt + 1);
  for (const x of before) {
    if (x.templateId === w.templateId && x.variantId === w.variantId) {
      const e = x.exercises.find(e => e.exId === ex.exId);
      const la = e && exLib(e), lb = exLib(ex); // renommé avec le nom d'un autre exercice de la liste : ce n'est plus le même exercice
      if (e && exHasData(e) && !(la && lb && la.id !== lb.id)) return { w: x, e, same: true };
    }
  }
  const n = exKey(ex);
  // séance d'un programme : seulement l'historique de CETTE séance (le même exercice dans une autre séance n'est pas repris)
  if (getItem(w.templateId)) {
    for (const x of before) {
      if (x.templateId !== w.templateId || x.variantId !== w.variantId) continue;
      const e = x.exercises.find(e => exKey(e) === n && e.type === ex.type); // exercice ajouté pendant une séance d'avant
      if (e && exHasData(e)) return { w: x, e, same: true };
    }
    if (ex.sw) for (const x of before) { // exercice choisi en renommant : la dernière fois dans tout le programme
      if (x.templateId !== w.templateId) continue;
      const e = x.exercises.find(e => exKey(e) === n && e.type === ex.type);
      if (e && exHasData(e)) return { w: x, e, same: false };
    }
    return null;
  }
  // séance libre ou cardio (sans programme) : la dernière fois que l'exercice a été fait, où que ce soit
  for (const x of before) {
    const e = x.exercises.find(e => exKey(e) === n && e.type === ex.type);
    if (e && exHasData(e)) return { w: x, e, same: false };
  }
  return null;
}

/* ================= Thème, son, vibration ================= */
const darkQuery = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
// couleurs de l'appli (Réglages › Apparence) : nom, libellé, les 3 teintes du dégradé
const ACCENTS = [["rose", "Rose", "#FF8A32,#FF3D7F,#E0209A"], ["bleu", "Bleu", "#1677C9,#2A62E6,#4A2FD8"], ["vert", "Vert", "#B8F03A,#2FD27A,#0FA89A"], ["jaune", "Jaune", "#FFE14D,#FFC21A,#FF9F0A"],
  ["violet", "Violet", "#A532C9,#8636E6,#5A2FD6"], ["orange", "Orange", "#FFB23D,#FF7A1A,#F2492C"], ["marron", "Marron", "#9A6238,#8E5530,#5E341C"]];
function applyTheme() {
  if (flashTimer) return; // pendant le clignotement de fin de repos
  const t = settings().theme;
  const dark = t === "sombre" || (t === "auto" && darkQuery && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.accent = ACCENTS.some(x => x[0] === settings().accent) ? settings().accent : "rose";
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.content = dark ? "#08080D" : "#F4F2F8";
}
if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener("change", applyTheme);

let actx = null;
function audio() {
  try {
    if (!actx) { const C = window.AudioContext || window.webkitAudioContext; if (C) actx = new C(); }
    if (actx && actx.state === "suspended") actx.resume();
  } catch (e) { }
  return actx;
}
document.addEventListener("pointerdown", audio, { passive: true }); // le son doit être « débloqué » par un geste
function beep() {
  const a = audio(); if (!a) return;
  const t = a.currentTime;
  [0, 0.28, 0.56].forEach((d, i) => {
    const o = a.createOscillator(), g = a.createGain();
    o.type = "sine"; o.frequency.value = i === 2 ? 1320 : 880;
    g.gain.setValueAtTime(0.0001, t + d);
    g.gain.exponentialRampToValueAtTime(0.5, t + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.22);
    o.connect(g); g.connect(a.destination); o.start(t + d); o.stop(t + d + 0.25);
  });
}
function vibrate() {
  const p = [350, 150, 350];
  try { if (Native && Native.vibrate) Native.vibrate(JSON.stringify(p)); else if (navigator.vibrate) navigator.vibrate(p); } catch (e) { }
}
function signal(noVib) { const a = settings().alert; if (a === "son" || a === "les deux") beep(); if (!noVib && (a === "vibration" || a === "les deux")) vibrate(); }
// montre connectée (appli Android) : le repos et le chrono arrivent sur la montre, qui vibre à la fin
const nativeWatch = () => !!(Native && typeof Native.startChrono === "function");
const watchOn = () => nativeWatch(); // toujours activé dans l'appli Android : chacun choisit ensuite s'il autorise les notifications sur sa montre
let screenOn = null;
function keepScreen(on) { if (on === screenOn) return; screenOn = on; try { if (Native && Native.keepScreenOn) Native.keepScreenOn(on); } catch (e) { } }

/* ================= Petites fenêtres ================= */
// typographie française : espace insécable avant « ? : ! ; » et à l'intérieur des guillemets (messages et fenêtres)
function frNb(t) { return String(t == null ? "" : t).replace(/ ([?:!;»])/g, "\u00a0$1").replace(/« /g, "«\u00a0"); }
// lecteurs d'écran : deux zones d'annonce vides créées une seule fois (un message inséré tout prêt est souvent ignoré) ;
// le message visible n'est pas lu en double
const srZone = role => { const z = document.createElement("div"); z.className = "sr"; z.setAttribute("role", role); if (role === "status") z.setAttribute("aria-live", "polite"); document.body.appendChild(z); return z; };
const SR = { status: srZone("status"), alert: srZone("alert") };
const URGENT = /impossible|erreur|échou|problème|incorrect|refusé|invalide|expiré|introuvable/i;
function announce(msg, urgent) { const z = urgent ? SR.alert : SR.status; z.textContent = ""; setTimeout(() => { z.textContent = msg; }, 60); }
function toast(msg) {
  const t = frNb(msg), d = document.createElement("div"); d.className = "toast"; d.setAttribute("aria-hidden", "true"); d.textContent = t;
  document.body.appendChild(d); setTimeout(() => d.remove(), 2600);
  announce(t, URGENT.test(t));
}
function ask(o) {
  return new Promise(res => {
    const d = document.createElement("div"); d.className = "modal";
    d.innerHTML = '<div class="modal-box" role="dialog" aria-modal="true" aria-label="' + esc(o.title) + '"><h3>' + esc(frNb(o.title)) + "</h3>" +
      (o.html || "") + (o.text ? "<p>" + esc(frNb(o.text)) + "</p>" : "") +
      (o.input !== undefined ? (o.code ? '<input class="f code-in" aria-label="' + esc(o.title) + '" maxlength="12" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="ex. K7P2X9QM" value="' + esc(o.input) + '">' : o.multiline ? '<textarea class="f" rows="6" aria-label="' + esc(o.title) + '">' + esc(o.input) + "</textarea>" : o.suggest ? '<div class="fl"><input class="f" data-suggest autocomplete="off" maxlength="80" placeholder="Tape un nom ou un muscle" aria-label="' + esc(o.title) + '" value="' + esc(o.input) + '"><div class="sugg" hidden></div></div>' : '<input class="f" aria-label="' + esc(o.title) + '" value="' + esc(o.input) + '">') : "") +
      (o.foot || "") + '<div class="modal-btns">' + (o.cancel === false ? "" : '<button class="btn" data-r="0">' + esc(o.cancel || "Annuler") + "</button>") +
      '<button class="btn ' + (o.danger ? "strong" : "primary") + '" data-r="1">' + esc(o.ok || "OK") + "</button></div></div>";
    document.body.appendChild(d);
    const inp = d.querySelector("input, textarea");
    if (inp) { inp.focus(); if (inp.select) inp.select(); }
    const done = ok => { d.remove(); res(ok ? (inp ? inp.value.trim() : true) : null); };
    if (inp && inp.tagName === "INPUT") inp.addEventListener("keydown", e => { if (e.key === "Enter") done(true); });
    d.addEventListener("click", e => { if (e.target === d) done(false); const b = e.target.closest("[data-r]"); if (b) done(b.dataset.r === "1"); });
  });
}

/* ================= Supabase (connexion + synchro) ================= */
// fonction SQL (rpc) : renvoie son résultat JSON (null si vide)
async function rpc(name, args) {
  await ensureToken();
  const go = () => fetch(SUPABASE_URL + "/rest/v1/rpc/" + name, { method: "POST", body: JSON.stringify(args || {}),
    headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + db.auth.access_token, "Content-Type": "application/json" } });
  let r = await go();
  if (r.status === 401) { await ensureToken(true); r = await go(); }
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { }
  if (!r.ok) { const e = new Error((j && j.message) || shortTxt(t) || ("Erreur " + r.status)); e.status = r.status; e.code = j && j.code; throw e; }
  return j;
}
const syncState = { status: "idle", at: null, error: "" };
// texte d'une réponse d'erreur : gardé seulement s'il est court et n'est pas une page web
const shortTxt = t => t && t.length < 200 && !/[<>]/.test(t) ? t : "";
async function authReq(path, body) {
  const r = await fetch(SUPABASE_URL + "/auth/v1/" + path, { method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error_description || j.msg || j.message || j.error || ("Erreur " + r.status)); e.status = r.status; e.code = j.error_code || j.code; throw e; }
  return j;
}
function setSession(j) {
  db.auth = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000, user: { id: j.user.id, email: j.user.email, name: (j.user.user_metadata && j.user.user_metadata.first_name) || "" } };
  db.mode = "account"; delete db.expired; saveNow();
}
let refreshing = null;
async function ensureToken(force) {
  if (!db.auth) throw new Error("non connecté");
  if (db.auth.dead) { const e = new Error("Ta connexion a expiré : reconnecte-toi à la fin de ta séance pour synchroniser."); e.status = 401; e.expired = true; throw e; }
  if (!force && db.auth.expires_at - 60000 > Date.now()) return;
  if (!refreshing) {
    const base = db, me = db.auth.user.id;
    refreshing = authReq("token?grant_type=refresh_token", { refresh_token: db.auth.refresh_token })
      .then(j => { if (db === base && db.auth && db.auth.user.id === me) setSession(j); })
      .catch(e => { if ((e.status === 400 || e.status === 401) && db === base) expireSession(); throw e; })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}
// connexion refusée par le serveur (session révoquée, mot de passe changé ailleurs…) : les données restent sur l'appareil.
// Pendant une séance, on la laisse finir (sans synchro) ; ensuite, écran de connexion avec un message et l'e-mail déjà rempli.
function expireSession() {
  if (!db.auth || db.auth.dead) return;
  db.expired = { email: db.auth.user.email || "" };
  if (activeWorkout()) {
    db.auth.dead = true; saveNow();
    syncState.status = "err"; syncState.error = "Ta connexion a expiré : reconnecte-toi à la fin de ta séance pour synchroniser."; updateSyncBadges();
    toast("Ta connexion a expiré : continue ta séance, tu te reconnecteras à la fin");
    return;
  }
  db.checkGone = db.auth.user.id; // au redémarrage : le compte a-t-il été supprimé depuis un autre appareil ?
  db.auth = null; db.mode = null; saveNow(); restart();
}
// compte supprimé (depuis un autre appareil) : ses données sont effacées de cet appareil aussi, comme annoncé à la suppression.
// Le serveur répond seulement « existe / n'existe plus » pour cet identifiant ; sans réseau, on revérifiera au prochain lancement.
async function accountGoneCheck(uid) {
  uid = uid || (db.auth && db.auth.user.id) || db.checkGone; if (!uid || !ID_RE.test(uid)) return false;
  let r;
  try {
    const res = await fetch(SUPABASE_URL + "/rest/v1/rpc/account_exists", { method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ p_uid: uid }) });
    if (!res.ok) return false; r = await res.json();
  } catch (e) { return false; }
  if (r !== false) { if (db.checkGone === uid) { delete db.checkGone; saveNow(); } return false; }
  if (db.auth && db.auth.user.id === uid && activeWorkout()) return false; // séance en cours : elle se finit, on revérifiera ensuite
  billingLogout(); db = emptyDb(); dataRev++; saveNow();
  try { localStorage.removeItem(asideKey(uid)); } catch (e) { }
  try { sessionStorage.setItem("fiitday-msg", "Ce compte a été supprimé : ses données ont été effacées de cet appareil"); } catch (e) { }
  restart("#/home"); return true;
}
async function rest(method, path, body, headers) {
  await ensureToken();
  const go = () => fetch(SUPABASE_URL + "/rest/v1/" + path, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: Object.assign({ apikey: SUPABASE_KEY, Authorization: "Bearer " + db.auth.access_token, "Content-Type": "application/json" }, headers || {}),
  });
  let r = await go();
  if (r.status === 401) { await ensureToken(true); r = await go(); }
  if (!r.ok) {
    const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch (e) { }
    const e = new Error(j.message || shortTxt(t) || ("Erreur " + r.status)); e.status = r.status; e.code = j.code; throw e;
  }
  return method === "GET" || /return=representation/.test((headers && headers.Prefer) || "") ? r.json() : null;
}

// textes envoyés au serveur : sans caractère nul ni moitié d'émoji (PostgreSQL les refuse et toute la synchro bloquerait)
function fixStr(s) {
  if (!/[\u0000\ud800-\udfff]/.test(s)) return s;
  let r = "";
  for (let k = 0; k < s.length; k++) {
    const c = s.charCodeAt(k);
    if (c === 0) continue;
    if (c >= 0xd800 && c <= 0xdbff) { const d = s.charCodeAt(k + 1); if (d >= 0xdc00 && d <= 0xdfff) { r += s[k] + s[k + 1]; k++; } continue; }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    r += s[k];
  }
  return r;
}
function cleanData(x) {
  if (typeof x === "string") return fixStr(x);
  if (Array.isArray(x)) return x.map(cleanData);
  if (x && typeof x === "object") { const r = {}; for (const k of Object.keys(x)) r[k] = cleanData(x[k]); return r; }
  return x;
}
// texte coupé à n caractères sans casser un émoji, nettoyé des caractères invisibles de contrôle
const cutStr = (s, n) => Array.from(fixStr(String(s == null ? "" : s)).replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")).slice(0, n).join("");
// erreur propre à un élément (texte refusé, trop gros, contrainte) : on l'isole ; sinon (réseau, connexion) on réessaiera plus tard
const itemError = e => e && !e.expired && (e.status === 400 || e.status === 409 || e.status === 413 || e.status === 422 || /^2[23]/.test(String(e.code || "")));
const itemLabel = i => { const d = i.data || {}; return "« " + (i.kind === "workout" ? (d.variantName ? vLabel(d.variantName) : "séance") + (d.startedAt ? " du " + new Date(d.startedAt).toLocaleDateString("fr-FR") : "") : i.kind === "settings" ? "réglages" : d.name || i.kind) + " »"; };
function syncErrText(e) {
  if (e.expired) return e.message;
  if (e.code === "PGRST205" || e.code === "42P01" || /items/.test(e.message) && e.status === 404) return "La base Supabase n'est pas encore prête (table « items » absente).";
  if (e.message === "Failed to fetch" || e.name === "TypeError" || !e.status) return "Pas de connexion.";
  if (e.status >= 500) return "Le serveur ne répond pas pour le moment : nouvel essai dans une minute.";
  return "Le serveur a refusé la synchro (erreur " + (e.code || e.status) + "). Nouvel essai dans une minute ; si cela continue, écris-nous.";
}
function sendItems(list) {
  const uid = db.auth.user.id;
  return rest("POST", "items?on_conflict=user_id,id&select=id,updated_at", list.map(i => ({ user_id: uid, id: i.id, kind: i.kind, data: cleanData(i.data), updated_at: i.updated_at, deleted: !!i.deleted })),
    { Prefer: "resolution=merge-duplicates,return=representation" });
}
// ligne reçue du serveur : la plus récente gagne ; un programme ou les réglages modifiés ici ET sur un autre appareil depuis la
// dernière synchro sont fusionnés (chaque modification est gardée, élément par élément) au lieu d'être écrasés
const MERGED = { template: 1, settings: 1 };
function takeRow(r) {
  if (!validItem(r)) { console.warn("élément ignoré (format inattendu)", r && r.id); return false; }
  const loc = db.items[r.id], ru = Number(r.updated_at), b = db.base && db.base[r.id];
  if (loc && loc.dirty && ru !== loc.updated_at && MERGED[r.kind] && loc.kind === r.kind && !loc.deleted && !r.deleted && b && b.u !== ru) {
    let base; try { base = JSON.parse(b.d); } catch (e) { base = undefined; }
    if (base !== undefined) {
      const data = merge3(base, loc.data, r.data, loc.updated_at > ru, r.kind === "settings" ? SETTINGS_WHOLE : null);
      data.id = r.id;
      db.items[r.id] = { id: r.id, kind: r.kind, data, updated_at: Math.max(ru, loc.updated_at) + 1, deleted: false, dirty: true };
      setBase(r.id, ru, r.data);
      return true;
    }
  }
  if (!loc || ru > loc.updated_at || (!loc.dirty && ru !== loc.updated_at)) {
    db.items[r.id] = { id: r.id, kind: r.kind, data: r.data, updated_at: ru, deleted: r.deleted, dirty: false };
    keepBase(db.items[r.id]);
    return true;
  }
  if (!loc.dirty && ru === loc.updated_at && !(db.base && db.base[r.id])) keepBase(loc);
  return false;
}
// version de référence (la dernière connue du serveur) des programmes et des réglages, pour fusionner
function setBase(id, u, data) { db.base = db.base || {}; db.base[id] = { u, d: JSON.stringify(data) }; }
function keepBase(it) {
  if (!MERGED[it.kind]) return;
  if (it.deleted) { if (db.base) delete db.base[it.id]; return; }
  setBase(it.id, it.updated_at, it.data);
}
// réglages gardés en un seul bloc lors d'une fusion (programme actif et séances actives de la version gratuite vont ensemble)
const SETTINGS_WHOLE = new Set(["freeActive"]);
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
const isObj = x => !!x && typeof x === "object" && !Array.isArray(x);
const byIds = a => Array.isArray(a) && a.every(x => isObj(x) && typeof x.id === "string");
// fusion à trois versions : b = référence commune, m = ici, t = serveur ; pm = en cas de conflit sur une même valeur, garder celle d'ici
function merge3(b, m, t, pm, whole, atom) { // atom : valeur gardée en un seul bloc
  if (same(m, t)) return m;
  if (same(b, m)) return t;
  if (same(b, t)) return m;
  if (!atom && isObj(m) && isObj(t)) {
    const bo = isObj(b) ? b : {}, r = {};
    for (const k of new Set(Object.keys(bo).concat(Object.keys(m), Object.keys(t)))) {
      const v = whole && whole.has(k) ? merge3(bo[k], m[k], t[k], pm, null, true) : merge3(bo[k], m[k], t[k], pm);
      if (v !== undefined) r[k] = v;
    }
    return r;
  }
  if (!atom && byIds(m) && byIds(t) && (b === undefined || byIds(b))) {
    const bl = b || [], bm = new Map(bl.map(x => [x.id, x])), mm = new Map(m.map(x => [x.id, x])), tm = new Map(t.map(x => [x.id, x]));
    const common = l => l.map(x => x.id).filter(id => bm.has(id) && mm.has(id) && tm.has(id));
    const first = same(common(m), common(bl)) ? t : m, second = first === t ? m : t; // l'ordre de celui qui l'a changé
    const out = [], seen = new Set();
    const one = id => merge3(bm.get(id), mm.get(id), tm.get(id), pm);
    first.forEach(x => { if (seen.has(x.id)) return; seen.add(x.id); const v = one(x.id); if (v !== undefined) out.push(v); });
    second.forEach((x, k) => {
      if (seen.has(x.id)) return; seen.add(x.id);
      const v = one(x.id); if (v === undefined) return;
      let pos = 0;
      for (let j = k - 1; j >= 0; j--) { const q = out.findIndex(o => o.id === second[j].id); if (q >= 0) { pos = q + 1; break; } }
      out.splice(pos, 0, v);
    });
    return out;
  }
  // même valeur changée des deux côtés, ou supprimée d'un côté et modifiée de l'autre : on ne perd pas la modification
  if (m === undefined) return t;
  if (t === undefined) return m;
  return pm ? m : t;
}
// marques « supprimé » déjà envoyées depuis plus de 30 jours : retirées de l'appareil (le serveur les garde)
function purgeTombs() {
  const old = Date.now() - 30 * DAY;
  for (const it of Object.values(db.items)) if (it.deleted && !it.dirty && it.updated_at < old) { delete db.items[it.id]; if (db.base) delete db.base[it.id]; }
}
let syncTimer = null, syncing = false, syncAgain = false, syncRun = null;
function scheduleSync() { if (!db.auth || db.auth.dead) return; clearTimeout(syncTimer); syncTimer = setTimeout(sync, 2500); }
// lit ce qui a changé sur le serveur depuis la dernière lecture (avec 5 s de marge : une écriture validée juste après la
// dernière lecture n'est jamais sautée ; relire deux fois la même ligne est sans effet) ; renvoie true si quelque chose a changé
async function pullServer(gone) {
  let since = db.lastServerAt, maxSeen = db.lastServerAt, changed = false;
  if (since) { const t = Date.parse(since); if (t) since = new Date(t - 5000).toISOString(); }
  for (let page = 0; page < 50; page++) {
    let q = "items?select=id,kind,data,updated_at,deleted,server_at&order=server_at.asc&limit=1000";
    if (since) q += "&server_at=gte." + encodeURIComponent(since);
    const rows = await rest("GET", q);
    if (gone()) return false;
    if (!Array.isArray(rows)) throw Object.assign(new Error("réponse inattendue"), { status: 502 });
    for (const r of rows) {
      if (r && (!maxSeen || r.server_at > maxSeen)) maxSeen = r.server_at;
      if (takeRow(r)) { changed = true; dataRev++; }
    }
    if (rows.length < 1000) break;
    since = rows[rows.length - 1].server_at;
  }
  db.lastServerAt = maxSeen || new Date().toISOString(); // compte vide : la relecture est faite quand même
  return changed;
}
// attend la fin de la synchro en cours (avant une déconnexion ou une suppression de compte)
async function syncIdle() { while (syncRun) { try { await syncRun; } catch (e) { } } }
async function sync() {
  if (!db.auth || db.auth.dead) return;
  const base = db, me = db.auth.user.id;
  // le compte a changé pendant une attente (déconnexion, autre compte) : on s'arrête sans rien écrire
  const gone = () => db !== base || !db.auth || db.auth.dead || db.auth.user.id !== me;
  if (!planTesting()) await loadPlan();
  if (gone()) return;
  if (!db.base) { db.base = {}; for (const it of Object.values(db.items)) if (!it.dirty) keepBase(it); } // première fois : versions de référence
  if (isFree()) { // version gratuite (mode test « essai terminé » compris) : rien n'est envoyé, les données restent sur l'appareil
    // juste après la connexion : on relit une fois ce que le serveur a gardé (séances de l'essai ou de Premium), sans rien envoyer
    if (!db.lastServerAt && !syncing && navigator.onLine !== false) {
      syncing = true;
      try { if (await pullServer(gone)) { saveNow(); softRender(); } else saveNow(); }
      catch (e) { console.warn("relecture du serveur impossible", e); }
      finally { syncing = false; }
    }
    syncState.status = "free"; updateSyncBadges(); return;
  }
  if (syncing) { syncAgain = true; return; }
  if (navigator.onLine === false) { syncState.status = "offline"; updateSyncBadges(); return; }
  syncing = true; if (syncState.status !== "ok") { syncState.status = "busy"; updateSyncBadges(); } // déjà synchronisé : la synchro de fond ne change pas le texte (pas de saut à l'écran)
  let changed = false, endRun;
  syncRun = new Promise(r => { endRun = r; });
  try {
    // 1) récupérer ce qui a changé sur le serveur
    if (await pullServer(gone)) changed = true;
    if (gone()) return;
    purgeBody(); // plus de page Corps : les anciennes mesures sont effacées, contenu compris
    freezeNotes(); renameVariants(); // après la récupération : les données sont à jour, aucun risque d'écraser une modif récente
    hrGoneSweep(); weightGoneSweep();
    // 2) envoyer ce qui a changé ici, par paquets de 200 ; le serveur renvoie ce qu'il a enregistré (il garde sa version
    //    si elle est plus récente) ; un élément qu'il refuse (texte invalide, trop gros…) est mis de côté sans bloquer les autres
    const dirty = Object.values(db.items).filter(i => i.dirty && !i.refused);
    const later = [];
    for (let k = 0; k < dirty.length; k += 200) {
      const chunk = dirty.slice(k, k + 200);
      let saved;
      try { saved = await sendItems(chunk); }
      catch (e) {
        if (gone()) return;
        if (!itemError(e)) throw e;
        saved = [];
        for (const i of chunk) {
          try { saved = saved.concat(await sendItems([i]) || []); }
          catch (e1) {
            if (gone()) return;
            if (!itemError(e1)) throw e1;
            console.warn("élément refusé par le serveur", i.id, e1.message);
            const cur = db.items[i.id]; if (cur && cur.updated_at === i.updated_at) cur.refused = true;
          }
        }
      }
      if (gone()) return;
      const back = Array.isArray(saved) ? new Map(saved.map(x => [x.id, Number(x.updated_at)])) : null;
      chunk.forEach(i => {
        const cur = db.items[i.id]; if (!cur || cur.updated_at !== i.updated_at || cur.refused) return;
        if (!back || back.get(i.id) === i.updated_at) { cur.dirty = false; keepBase(cur); }
        else later.push(i.id); // le serveur a gardé une version plus récente : on la relit pour fusionner
      });
    }
    // versions plus récentes gardées par le serveur : relues tout de suite (fusion des programmes et réglages, sinon la plus récente gagne)
    for (let k = 0; k < later.length; k += 100) {
      const rows = await rest("GET", "items?select=id,kind,data,updated_at,deleted,server_at&id=in.(" + later.slice(k, k + 100).join(",") + ")");
      if (gone()) return;
      for (const r of rows) if (takeRow(r)) { changed = true; dataRev++; }
      syncAgain = true;
    }
    purgeTombs();
    saveNow();
    const refused = Object.values(db.items).filter(i => i.dirty && i.refused);
    syncState.status = "ok"; syncState.at = Date.now();
    syncState.error = refused.length ? (refused.length > 1 ? refused.length + " éléments n'ont pas pu être envoyés" : "Un élément n'a pas pu être envoyé") +
      " (" + refused.slice(0, 3).map(itemLabel).join(", ") + (refused.length > 3 ? "…" : "") + ") : le serveur les refuse. Modifie-les ou supprime-les ; tout le reste est synchronisé." : "";
  } catch (e) {
    console.error(e);
    if (gone()) return;
    if ((e.status === 403 || e.code === "42501") && !planTesting()) { await loadPlan(true); if (isFree()) { syncState.status = "free"; return; } } // le serveur refuse : abonnement fini
    if (e.code === "23503") { accountGoneCheck(); } // le compte n'existe plus côté serveur (supprimé depuis un autre appareil)
    syncState.status = "err";
    syncState.error = syncErrText(e);
  } finally {
    syncing = false; syncRun = null; endRun();
    if (!gone()) {
      updateSyncBadges();
      if (changed) softRender();
      if (syncAgain) { syncAgain = false; scheduleSync(); }
    }
  }
}
setInterval(() => { if (!document.hidden) sync(); }, 60000);
window.addEventListener("online", sync);

function syncBadge() {
  if (!db.auth) return '<span class="sync"><span class="dot"></span>Hors ligne (sans compte)</span>';
  const s = syncState.status;
  const cls = s === "ok" ? "ok" : s === "err" ? "err" : s === "busy" ? "busy" : "";
  const txt = s === "free" ? "Synchro réservée à Premium" : s === "ok" ? "Synchronisé " + fmtTime(syncState.at) : s === "err" ? "Synchro en échec" : s === "busy" ? "Synchronisation…" : s === "offline" ? "Pas de réseau" : "En attente";
  return '<span class="sync" data-sync><span class="dot ' + cls + '"></span>' + esc(txt) + "</span>";
}
// message sous l'état de la synchro (échec, ou élément refusé par le serveur alors que le reste est synchronisé)
const syncMsg = () => syncState.status === "err" || syncState.status === "ok" ? syncState.error || "" : "";
function updateSyncBadges() {
  const html = syncBadge(); document.querySelectorAll("[data-sync]").forEach(el => { if (el.outerHTML !== html) el.outerHTML = html; });
  const e = document.querySelector("[data-sync-error]"); if (e) e.textContent = syncMsg();
}

/* ================= Navigation ================= */
const safeDecode = x => { try { return decodeURIComponent(x); } catch (e) { return ""; } };
function route() { const h = location.hash.replace(/^#\/?/, ""); const p = h.split("/"); return { name: p[0] || "home", args: p.slice(1).map(safeDecode) }; }
const go = path => { location.hash = "#/" + path; };
/* Retour à la même position : chaque page de l'historique garde sa position de défilement. Revenir sur une page déjà vue
   (« ‹ Retour » vers la page d'où l'on vient, bouton retour du téléphone ou du navigateur) la remet exactement où elle était ;
   une nouvelle page s'ouvre en haut. */
try { history.scrollRestoration = "manual"; } catch (e) { }
const navKey = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
let scrollPos = {}; try { scrollPos = JSON.parse(sessionStorage.getItem("fiitday-scroll") || "{}") || {}; } catch (e) { }
let navRestoring = false, navRestoreId = 0, scrollSaveT = null;
const sameHash = (a, b) => { try { return decodeURIComponent(a) === decodeURIComponent(b); } catch (e) { return a === b; } };
function keepScrollPos() {
  try { const ks = Object.keys(scrollPos); if (ks.length > 80) ks.slice(0, ks.length - 80).forEach(k => delete scrollPos[k]); sessionStorage.setItem("fiitday-scroll", JSON.stringify(scrollPos)); } catch (e) { }
}
window.addEventListener("scroll", () => {
  const st = history.state; if (navRestoring || !st || !st.k) return;
  scrollPos[st.k] = Math.round(window.scrollY);
  clearTimeout(scrollSaveT); scrollSaveT = setTimeout(keepScrollPos, 300);
}, { passive: true });
// remet la page à sa position ; un contenu affiché un peu après (liste des exercices…) est attendu jusqu'à 2 s, sauf si tu fais défiler toi-même
function applyScroll(y) {
  const id = ++navRestoreId, t0 = Date.now();
  navRestoring = true;
  const stop = () => { if (id !== navRestoreId) return; navRestoring = false; ["touchstart", "wheel", "keydown"].forEach(ev => window.removeEventListener(ev, stop, true)); };
  ["touchstart", "wheel", "keydown"].forEach(ev => window.addEventListener(ev, stop, true));
  const step = () => {
    if (id !== navRestoreId || !navRestoring) return;
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo(0, Math.min(y, max));
    if (max >= y || Date.now() - t0 > 2000) { stop(); return; }
    setTimeout(step, 50);
  };
  step();
}
function afterNavigate(oldHash) {
  const st = history.state;
  if (st && st.k) { applyScroll(scrollPos[st.k] || 0); return; } // page déjà vue : même position qu'avant
  history.replaceState({ k: navKey(), prev: oldHash || "" }, "");
  navRestoreId++; navRestoring = false; window.scrollTo(0, 0);
}
window.addEventListener("hashchange", e => {
  let old = ""; try { old = e.oldURL ? new URL(e.oldURL).hash : ""; } catch (err) { }
  navRestoring = true; flushPending(); render(); afterNavigate(old);
});
/* Fenêtres (roues, choix, confirmations) : le bouton retour du téléphone (Android, iPhone) ou du navigateur, et Échap sur PC,
   font comme « Annuler ». Chaque fenêtre ouverte ajoute une entrée à l'historique (même adresse) ; le retour la referme au lieu de changer de page. */
let modalStale = false; // l'entrée actuelle vient d'une fenêtre fermée par un bouton : le prochain retour doit changer de page
const openModals = () => Array.from(document.querySelectorAll("body > .modal"));
const cancelModal = m => m.dispatchEvent(new MouseEvent("click", { bubbles: true })); // comme un appui à côté de la fenêtre : toutes les fenêtres le traitent comme « Annuler »
/* Clavier et lecteurs d'écran : à l'ouverture d'une fenêtre, le focus y entre et y reste (Tab / Maj+Tab tournent dedans),
   la page derrière est mise de côté (inert) ; à la fermeture, le focus revient sur le bouton qui l'a ouverte
   (ou sur le même bouton redessiné, retrouvé par ses attributs data-*). */
const isTextField = el => !!el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !/^(button|checkbox|radio|range|submit|reset|file|color)$/i.test(el.type)));
function focusSig(el) { let k = el.tagName + "|" + (el.id || "") + "|" + (el.getAttribute("href") || "") + "|" + (el.getAttribute("name") || ""); for (const a of el.attributes) if (a.name.startsWith("data-")) k += "|" + a.name + "=" + a.value; return k; }
function focusMark(el, root) {
  if (!el || el === document.body || !el.tagName || !root.contains(el)) return null;
  const sig = focusSig(el), same = [...root.querySelectorAll(el.tagName)].filter(x => focusSig(x) === sig);
  return { el, sig, tag: el.tagName, n: Math.max(0, same.indexOf(el)), text: isTextField(el) };
}
function focusBack(m, root) {
  if (!m) return false;
  let el = m.el.isConnected && root.contains(m.el) ? m.el : null;
  if (!el) { const same = [...root.querySelectorAll(m.tag)].filter(x => focusSig(x) === m.sig); el = same[Math.min(m.n, same.length - 1)] || null; }
  if (!el || el.disabled || !el.getClientRects().length) return false;
  el.focus({ preventScroll: true });
  return document.activeElement === el;
}
const focusLost = () => !document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const focusables = box => [...box.querySelectorAll(FOCUSABLE)].filter(x => x.getClientRects().length && !x.closest("[inert]"));
function modalFocus(m) { // le focus va sur la fenêtre elle-même (son titre est lu), le Tab suivant atteint le premier bouton
  if (!m || !m.isConnected || m.contains(document.activeElement)) return;
  const box = m.querySelector(".modal-box") || m;
  if (!box.hasAttribute("tabindex")) box.setAttribute("tabindex", "-1");
  box.focus({ preventScroll: true });
}
function modalLayers() { const ms = openModals(); $app.inert = ms.length > 0; ms.forEach((m, k) => { m.inert = k < ms.length - 1; }); }
let lastFocusEl = null; // dernier élément touché hors des fenêtres (une fenêtre avec un champ y met le focus avant qu'on l'observe)
document.addEventListener("focusin", e => { const t = e.target; if (t && t.closest && !t.closest("body > .modal")) lastFocusEl = t; });
document.addEventListener("keydown", e => {
  if (e.key !== "Tab") return;
  const ms = openModals(); if (!ms.length) return;
  const top = ms[ms.length - 1], box = top.querySelector(".modal-box") || top, f = focusables(box); if (!f.length) return;
  const a = document.activeElement, i = f.indexOf(a);
  if (e.shiftKey ? i <= 0 : i === f.length - 1 || i < 0 && !box.contains(a)) { e.preventDefault(); (e.shiftKey ? f[f.length - 1] : f[0]).focus(); }
});
new MutationObserver(muts => {
  for (const mu of muts) {
    mu.addedNodes.forEach(n => {
      if (n.nodeType !== 1 || !n.classList.contains("modal")) return;
      const st = Object.assign({}, history.state, { modal: true });
      if (history.state && history.state.modal && openModals().length === 1) history.replaceState(st, ""); else history.pushState(st, ""); // une entrée laissée par une fenêtre fermée resert
      modalStale = false; n.__hist = true;
      const a = document.activeElement, opener = a && a !== document.body && !n.contains(a) ? a : lastFocusEl && lastFocusEl.isConnected ? lastFocusEl : null;
      n.__ret = opener ? focusMark(opener, document.body) : null;
      modalLayers();
      setTimeout(() => modalFocus(n), 0);
    });
    mu.removedNodes.forEach(n => {
      if (n.nodeType !== 1 || !n.classList || !n.classList.contains("modal")) return;
      if (n.__hist && !n.__popped && !openModals().length && history.state && history.state.modal) modalStale = true;
      modalLayers();
      const ret = n.__ret;
      setTimeout(() => { // après le redessin éventuel déclenché par le choix fait dans la fenêtre
        const ms = openModals();
        if (ms.length) { modalFocus(ms[ms.length - 1]); return; }
        if (focusLost() && ret && !focusBack(ret, document.body)) lastFocusEl = null;
      }, 0);
    });
  }
}).observe(document.body, { childList: true });
let lastHash = location.hash;
window.addEventListener("popstate", e => {
  const moved = location.hash !== lastHash; lastHash = location.hash;
  if (!e.state && moved) return; // nouvelle page (changement d'adresse), pas un retour
  const ms = openModals();
  if (ms.length) { const top = ms[ms.length - 1]; top.__popped = true; modalStale = false; cancelModal(top); return; }
  if (modalStale) { modalStale = false; history.back(); return; } // on était sur l'entrée d'une fenêtre déjà fermée : on fait le vrai retour
  if (history.state && history.state.modal) history.back(); // entrée d'une fenêtre fermée, retrouvée en revenant en arrière : on la passe
});
window.addEventListener("hashchange", () => { modalStale = false; lastHash = location.hash; });
document.addEventListener("keydown", e => { if (e.key !== "Escape") return; const ms = openModals(); if (ms.length) { e.preventDefault(); cancelModal(ms[ms.length - 1]); } });
// changement de page qui remplace la page actuelle dans l'historique (fiche suivante en glissant) : le « Retour » reste le même
window.__navReplace = hash => {
  const prev = (history.state || {}).prev || "";
  history.replaceState({ k: navKey(), prev }, "", hash);
  navRestoring = true; flushPending(); render(); navRestoreId++; navRestoring = false; window.scrollTo(0, 0);
};
// PC : choisir un élément dans une liste à gauche (séance, exercice) l'affiche à droite sans changer de page ni de position ;
// le « Retour » du navigateur ramène toujours à la page d'avant
window.__navPane = hash => {
  const y = window.scrollY;
  history.replaceState(Object.assign({}, history.state), "", hash); lastHash = location.hash;
  flushPending(); render(); window.scrollTo(0, y);
};
document.addEventListener("click", e => {
  const a = e.target.closest && e.target.closest("a[data-pane]"); if (!a || e.defaultPrevented || e.button || e.ctrlKey || e.metaKey) return;
  e.preventDefault(); window.__navPane(a.getAttribute("href"));
});
// « ‹ Retour » vers la page d'où l'on vient : on revient en arrière dans l'historique (donc à la même position)
document.addEventListener("click", e => {
  const a = e.target.closest && e.target.closest("a.back"); if (!a || e.defaultPrevented || e.button) return;
  const st = history.state, href = a.getAttribute("href");
  if (st && st.prev && href && sameHash(href, st.prev)) { e.preventDefault(); history.back(); }
}, true);
let isWide = window.innerWidth >= WIDE, isPcNow = isPC();
window.addEventListener("resize", () => { const w = window.innerWidth >= WIDE, pc = isPC(); if (w !== isWide || pc !== isPcNow) { isWide = w; isPcNow = pc; softRender(); } });

// rafraîchit l'écran, sauf pendant une saisie (on attend que le champ perde le focus)
let renderWaiting = false;
function softRender() {
  const a = document.activeElement;
  if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && $app.contains(a)) {
    if (!renderWaiting) { renderWaiting = true; a.addEventListener("blur", () => { renderWaiting = false; setTimeout(render, 0); }, { once: true }); }
    return;
  }
  render();
}

const LEGAL = { version: "2026-11-27", privacy: "https://fiitday.com/confidentialite.html", legal: "https://fiitday.com/mentions-legales.html", deletion: "https://fiitday.com/suppression-compte.html",
  cgu: "https://fiitday.com/cgu.html", cgv: "" }; // cgv : « https://fiitday.com/cgv.html » le jour où les conditions générales de vente sont publiées (lien dans la page de présentation)
let consentAsked = false, nameAsked = false, cguAsked = false;
// conditions d'utilisation (CGU) publiées le 27 novembre 2026 : acceptées à l'inscription ; un compte plus ancien les voit une fois
const CGU_SINCE = "2026-11-27";
const cguLink = t => '<a href="' + LEGAL.cgu + '" target="_blank" rel="noopener">' + (t || "conditions d'utilisation") + "</a>";
// un e-mail n'est jamais un prénom (le remplissage automatique du téléphone a pu en glisser un dans le champ Prénom)
const cleanName = n => (n && !/@/.test(n) ? String(n) : "");
const firstName = () => cleanName(settings().firstName) || cleanName(db.auth && db.auth.user && db.auth.user.name) || "";
// bienvenue : la première fois qu'un nouveau compte ouvre l'appli (aucun programme ni séance), après le consentement et le prénom
let welcomeAsked = false;
async function welcomeIfNew() {
  if (welcomeAsked || !db.auth || (!db.lastServerAt && !syncState.at) || !settings().consentAt || settings().welcomeAt) return;
  if (templates().length || workouts().length) { const st = settings(); st.welcomeAt = Date.now(); put("settings", st); return; } // compte déjà utilisé : jamais de bienvenue
  if (document.querySelector("body > .modal")) return; // une autre fenêtre est ouverte : on attendra le prochain affichage
  welcomeAsked = true;
  const st = settings(); st.welcomeAt = Date.now(); put("settings", st);
  if (await showWelcome()) go("guide");
}
function showWelcome() {
  return new Promise(res => {
    const name = firstName(), d = document.createElement("div"); d.className = "modal";
    d.innerHTML = '<div class="modal-box welcome-box" role="dialog" aria-modal="true" aria-label="Bienvenue sur Fiitday"><img class="welcome-logo" src="icon-192.png" alt="" width="64" height="64">' +
      "<h3>Bienvenue sur Fiitday" + (name ? " " + esc(name) : "") + " !</h3>" +
      "<p>Crée ton premier programme, utilise un programme existant dans la page Programmes ou lance une séance libre depuis l'accueil.</p>" +
      '<p>Un mini guide est accessible depuis <b>Réglages › Aide › Guide</b> : il te montre ce que tu peux faire dans chaque page.</p>' +
      '<p class="welcome-wish">L\'équipe Fiitday te souhaite de bonnes séances 💪</p>' +
      '<div class="modal-btns"><button class="btn" data-r="1">Voir le guide</button><button class="btn primary" data-r="0">C\'est parti</button></div></div>';
    document.body.appendChild(d);
    d.addEventListener("click", e => {
      if (e.target === d) { d.remove(); res(false); return; }
      const b = e.target.closest("[data-r]"); if (b) { d.remove(); res(b.dataset.r === "1"); }
    });
  });
}
async function askNameIfNeeded() {
  if (nameAsked || !db.auth || (!db.lastServerAt && !syncState.at) || firstName() || !settings().consentAt) return;
  nameAsked = true;
  const n = await ask({ title: "Comment t'appelles-tu ?", text: "Ton prénom s'affichera sur l'accueil. Tu peux le changer dans Réglages.", input: "", ok: "Enregistrer", cancel: "Plus tard" });
  if (!n) return;
  const st = settings(); st.firstName = n.slice(0, 40); put("settings", st); render();
}
async function askConsentIfNeeded() {
  // attendre une première synchro réussie (même si le compte est encore vide)
  if (consentAsked || !db.auth || (!db.lastServerAt && !syncState.at) || settings().consentAt) return;
  consentAsked = true;
  const ok = await ask({ title: "Confidentialité et conditions", text: "Tes séances et tes réglages sont enregistrés pour faire fonctionner ton compte, comme expliqué dans la politique de confidentialité. Pour continuer, confirme que tu as 15 ans ou plus et que tu acceptes les conditions d'utilisation (les deux sont dans Réglages › Informations légales).", ok: "J'ai 15 ans ou plus et j'accepte", cancel: "Plus tard" });
  if (!ok) return;
  const st = settings(); st.consentAt = new Date().toISOString(); st.consentVersion = LEGAL.version; put("settings", st);
}
// compte créé avant les conditions d'utilisation : on les présente une fois (continuer à utiliser Fiitday vaut acceptation, CGU art. 12)
async function cguNoticeIfNeeded() {
  const st0 = settings();
  if (cguAsked || !db.auth || !st0.consentAt || (st0.consentVersion || "") >= CGU_SINCE) return;
  if (document.querySelector("body > .modal")) return;
  cguAsked = true;
  const read = await ask({ title: "Conditions d'utilisation", text: "Fiitday a maintenant des conditions d'utilisation : les règles des séances partagées, comment signaler un contenu, et ce que l'appli fait ou ne fait pas. Nouveau : un lien de partage est effacé 7\u00a0jours après sa création. Tu les retrouves dans Réglages › Informations légales.", ok: "Les lire", cancel: "J'ai compris" });
  const st = settings(); st.consentVersion = LEGAL.version; st.cguAt = new Date().toISOString(); put("settings", st);
  if (read) openExternal(LEGAL.cgu);
}
// lien externe (page légale…) : navigateur sur le site, navigateur du téléphone dans l'appli Android
function openExternal(url) {
  const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
}
// menu : 4 onglets ; l'historique est dans Stats, les programmes Fiitday (bientôt) en carte sur l'accueil
// titre de l'onglet du navigateur (et annoncé par les lecteurs d'écran) : « Stats · Fiitday »
const PAGE_TITLES = { home: "Accueil", exercices: "Exercices", progress: "Stats", evolution: "Évolution", calendar: "Calendrier", history: "Historique", programs: "Programmes", program: "Programme",
  session: "Séance", settings: "Réglages", premium: "Premium", guide: "Guide", faq: "Questions fréquentes", admin: "Administration", resilier: "Résilier un abonnement", retractation: "Renoncer au contrat" };
const NAV = [["home", "Accueil", "home"], ["exercices", "Exercices", "dumbbell"], ["progress", "Stats", "chart"], ["programs", "Programmes", "grid"], ["settings", "Réglages", "gear"]];
// Remplacer l'écran retire le champ actif : son « blur »/« change » peut redemander un rendu pendant celui-ci.
let rendering = false;
function render() {
  if (rendering) { setTimeout(render, 0); return; }
  rendering = true;
  // l'écran est entièrement redessiné : le bouton qui avait le focus (clavier, lecteur d'écran) le retrouve ensuite
  const fm = openModals().length ? null : focusMark(document.activeElement, $app);
  try { renderNow(); if (fm && !fm.text && focusLost()) focusBack(fm, $app); }
  catch (e) {
    console.error(e);
    $app.innerHTML = '<div class="login"><h1>Oups</h1><p class="muted">Un problème d\'affichage est survenu. Tes données ne sont pas perdues.</p><button type="button" class="btn primary big" data-act="reload">Revenir à l\'accueil</button></div>';
  } finally { rendering = false; }
}
let localFixed = false; // sans compte : anciens noms et anciennes mesures corrigés une fois par lancement
function renderNow() {
  applyTheme();
  if (resetStep === "password") { keepScreen(false); $app.innerHTML = viewReset(); return; } // code validé : choisir le nouveau mot de passe
  if (db.auth && db.auth.dead && !activeWorkout()) { db.checkGone = db.auth.user.id; db.auth = null; db.mode = null; saveNow(); restart(); return; } // séance finie après une session expirée : reconnexion
  if (!db.auth && db.mode !== "local") { keepScreen(false); $app.innerHTML = showLanding() ? viewLanding() : viewLogin(); document.title = showLanding() ? LP_TITLE : "Fiitday"; return; }
  // un nouvel utilisateur arrive sur une page vierge : plus de programmes créés d'office
  // (les programmes déjà enregistrés dans un compte ne sont pas touchés)
  if (!db.auth && !localFixed) { localFixed = true; freezeNotes(); renameVariants(); purgeBody(); }
  const r = route();
  if (ctr && r.name !== "resilier" && r.name !== "retractation") ctr = null; // formulaire de résiliation ou de rétractation quitté
  let body, wide = false, immersive = false;
  switch (r.name) {
    case "session": {
      const gone = db.items[r.args[0]];
      if (gone && gone.deleted) { history.replaceState(history.state, "", "#/history"); body = viewHistory(); break; } // séance supprimée (retour arrière) : l'historique
      if (gone && histHidden(gone.data)) { body = '<a class="back" href="#/history">‹ Historique</a>' + planCard("En version gratuite, tu vois le détail de tes séances des " + FREE_HIST_DAYS + " derniers jours. Celle-ci est gardée : elle revient avec Premium."); break; }
      const v = viewSession(r.args[0]); body = v.html; wide = v.wide; immersive = v.active; break;
    }
    case "programs": body = viewPrograms(); break;
    case "program": body = viewProgram(r.args[0], r.args[1]); break;
    case "history": body = viewHistory(r.args[0]); break;
    case "progress": if (r.args[0]) { history.replaceState(history.state, "", "#/evolution/" + encodeURIComponent(r.args[0])); body = viewEvolutionDetail(r.args[0]); } else body = viewProgress(); break; // ancien lien d'un exercice
    case "evolution": body = isPC() && !isFree() && progressData().length ? viewEvolutionPc(r.args[0]) : r.args[0] === "poids" ? viewWeight() : r.args[0] ? viewEvolutionDetail(r.args[0]) : viewEvolution(); break;
    case "calendar": body = viewCalendar(r.args[0], r.args[1]); break;
    case "body": history.replaceState(history.state, "", "#/progress"); body = viewProgress(); break; // ancienne page Corps
    case "s":
    case "import": {
      const code = r.name === "s" ? SHARE_SHORT + r.args[0] : r.args[0];
      history.replaceState(history.state, "", "#/home");
      body = viewHome();
      setTimeout(() => importShared(code), 0);
      break;
    }
    case "settings": body = viewSettings(); break;
    case "famille": history.replaceState(history.state, "", "#/settings"); body = viewSettings(); setTimeout(() => famJoin(r.args[0] || ""), 0); break;
    case "premium": body = viewPremium(); break;
    case "connexion": history.replaceState(history.state, "", "#/home"); body = viewHome(); break; // connecté depuis la page de présentation
    case "resilier": body = viewContract("resiliation"); break;
    case "retractation": body = viewContract("retractation"); break;
    case "admin": body = viewAdmin(); break;
    case "guide": body = viewGuide(); break;
    case "faq": body = viewFaq(r.args[0]); if (r.args[0]) setTimeout(() => { const d = document.getElementById("faq-" + r.args[0]); if (d) d.scrollIntoView({ block: "start" }); }, 60); break;
    case "exercices": body = '<div id="exo-root"><div class="page-head"><h1>Exercices</h1></div><div class="card empty">Chargement des exercices…</div></div>'; break;
    default: body = viewHome();
  }
  const doneW = r.name === "session" && (() => { const w = getItem(r.args[0]); return w && w.endedAt; })(); // séance terminée : on vient des Stats
  const tab = doneW ? "progress" : { guide: "settings", faq: "settings", premium: "settings", resilier: "settings", retractation: "settings", admin: "settings", famille: "settings", session: "home", program: "home", import: "home", s: "home", calendar: "progress", evolution: "progress", history: "progress", body: "progress" }[r.name] || (NAV.some(n => n[0] === r.name) ? r.name : "home");
  $app.innerHTML = '<div class="shell' + (immersive ? " hide-nav" : "") + '"><nav class="nav" aria-label="Navigation"><div class="brand"><img src="icon-192.png" alt="" width="32" height="32"><span>Fiitday</span></div>' +
    NAV.map(n => '<a href="#/' + n[0] + '" class="' + (n[0] === tab ? "on" : "") + '"' + (n[0] === tab ? ' aria-current="page"' : "") + ">" + ICON[n[2]] + "<span>" + n[1] + "</span></a>").join("") +
    '</nav><main class="main r-' + esc(r.name) + (wide ? " wide" : "") + '">' + body + "</main></div>";
  const pageT = PAGE_TITLES[doneW ? "history" : r.name] || PAGE_TITLES[tab] || "";
  document.title = (pageT ? pageT + " · " : "") + "Fiitday";
  keepScreen(immersive);
  if (r.name === "exercices") mountExercises(r.args[0], r.args[1]);
  tick();
  setTimeout(() => askConsentIfNeeded().then(cguNoticeIfNeeded).then(askNameIfNeeded).then(welcomeIfNew), 800);
}

/* ================= Écran : exercices (bibliothèque 3D, chargée à la demande) ================= */
let exoMod = null, exoReturn = null, stretchSeq = null; // stretchSeq : suite d'étirements proposée après une séance
function mountExercises(id, arg) {
  const root = document.getElementById("exo-root"); if (!root) return;
  if (!id || id === "etirements" || id === "cardio") { exoReturn = null; stretchSeq = null; } // liste ouverte directement : retour normal
  const back = id && exoReturn ? { href: exoReturn, label: /^#\/session/.test(exoReturn) ? "Retour à la séance" : /^#\/(home)?$/.test(exoReturn) ? "Accueil" : "Retour au programme" } : null;
  const ready = exoMod ? Promise.resolve(exoMod) : import("./exercices.js?v=" + encodeURIComponent(window.APP_BUILD || "")).then(m => (exoMod = m));
  ready.then(m => { if (root.isConnected) m.mount(root, id && /^[a-z0-9-]{1,60}$/.test(id) ? id : null, { add: addLibraryExercise, back, seq: stretchSeq, cardioStart, cardioInfo, own: { list: ownList, create: ownCreate, edit: ownEdit, del: ownDelete } }, /^[a-z]{1,12}$/.test(arg || "") ? arg : null); })
    .catch(err => { console.error(err); if (root.isConnected) root.innerHTML = '<div class="page-head"><h1>Exercices</h1></div><div class="card empty">Impossible de charger les exercices' + (navigator.onLine === false ? " sans connexion la première fois" : "") + '. Réessaie dans un instant.</div>'; });
}
// fenêtre soignée (même modèle que la bienvenue) pour confirmer un changement important
function fancyAsk(o) {
  return new Promise(res => {
    const d = document.createElement("div"); d.className = "modal";
    d.innerHTML = '<div class="modal-box welcome-box fancy" role="dialog" aria-modal="true" aria-label="' + esc(o.title) + '"><img class="welcome-logo" src="icon-192.png" alt="" width="64" height="64"><h3>' + esc(o.title) + "</h3>" + o.html +
      '<div class="modal-btns"><button class="btn" data-r="0">' + esc(o.cancel || "Annuler") + '</button><button class="btn ' + (o.danger ? "strong" : "primary") + '" data-r="1">' + esc(o.ok) + "</button></div></div>";
    document.body.appendChild(d);
    d.addEventListener("click", e => { if (e.target === d) { d.remove(); res(false); return; } const b = e.target.closest("[data-r]"); if (b) { d.remove(); res(b.dataset.r === "1"); } });
  });
}
// où un exercice perso est utilisé : séances de programme et séances faites
function ownUses(name) {
  const nn = norm(name), vars = [];
  templates().forEach(t => t.variants.forEach(v => { if (v.exercises.some(e => !exLib(e) && norm(e.name) === nn)) vars.push(t.name + " · " + vLabel(v.name)); }));
  const done = all("workout").filter(w => w.exercises.some(e => !exLib(e) && norm(e.name) === nn && exHasData(e))).length;
  return { vars, done };
}
const TYPE_LABEL = { reps: "Poids × reps", rep: "Reps uniquement", time: "Temps", dist: "Distance", cardio: "Indicateurs au choix" };
const OWN_CV = ["dist", "vit", "incl", "res", "cad", "watts", "spm", "etages", "marches", "niv", "t500", "cpm", "cal", "fc"];
// création / modification d'un exercice perso : nom, ce que tu notes (comme en séance), indicateurs au choix comme pour le cardio
function askOwnEx(cur) {
  return new Promise(res => {
    const used = cur ? ownUses(cur.n).done > 0 : false, key = cur ? cardioKey({ name: cur.n }) : "";
    let type = cur ? cur.t : "reps", load = cur ? !!cur.load : false, cv = cur && Array.isArray(cur.cv) ? cur.cv.slice() : CARDIO_BASE.slice();
    let custom = cur ? cardioCustom(key).map(x => ({ k: x.k, n: x.n, u: x.u, on: true })) : [];
    const d = document.createElement("div"); d.className = "modal sheet";
    const draw = () => {
      const typeBtns = TYPE_CHOICES.map(([k, l, s]) => '<button type="button" class="btn block choice' + (type === k ? " on" : "") + '" data-ty="' + k + '" aria-pressed="' + (type === k) + '"' + (used && type !== k ? " disabled" : "") + "><b>" + esc(k === "cardio" ? "Indicateurs au choix" : l) + '</b><span class="choice-desc">' + esc(k === "cardio" ? "Durée, puis les indicateurs que tu choisis (distance, calories, fréquence cardiaque, les tiens…)" : s) + "</span></button>").join("");
      const ind = type !== "cardio" ? "" : '<div class="own-cv"><div class="small muted" style="margin:10px 0 6px">Indicateurs notés (la durée est toujours notée)</div>' +
        OWN_CV.map(k => '<label class="own-chk"><input type="checkbox" data-cv="' + k + '"' + (cv.includes(k) ? " checked" : "") + "><span>" + esc(CARDIO_M[k].n) + (CARDIO_M[k].u && CARDIO_M[k].u !== "niveau" ? ' <span class="muted small">' + esc(CARDIO_M[k].u) + "</span>" : "") + "</span></label>").join("") +
        custom.map((x, n) => '<label class="own-chk"><input type="checkbox" data-cc="' + n + '"' + (x.on ? " checked" : "") + "><span>" + esc(x.n) + (x.u ? ' <span class="muted small">' + esc(x.u) + "</span>" : "") + ' <span class="tag">perso</span></span></label>').join("") +
        '<button type="button" class="link small" data-newcv>+ Créer un indicateur</button></div>';
      d.innerHTML = '<div class="modal-box own-box" role="dialog" aria-modal="true" aria-label="' + (cur ? "Modifier l'exercice" : "Nouvel exercice") + '"><h3>' + (cur ? "Modifier l'exercice" : "Nouvel exercice") + "</h3>" +
        '<label class="fl">Nom<input class="f" data-on maxlength="80" autocomplete="off" placeholder="Ex. Tirage à l\'élastique" value="' + esc(nameV) + '"></label>' +
        '<div class="small muted" style="margin:12px 0 6px">Ce que tu notes en séance</div><div class="stack" style="gap:8px">' + typeBtns + "</div>" +
        (used ? '<p class="small muted" style="margin:6px 2px 0">Déjà fait en séance : le type ne peut plus changer (tes séances passées restent justes).</p>' : "") +
        (type === "dist" ? '<label class="own-chk" style="margin-top:10px"><input type="checkbox" data-load' + (load ? " checked" : "") + "><span>Avec une charge (kg)</span></label>" : "") + ind +
        '<p class="msg err" data-m></p><div class="modal-btns"><button class="btn" data-r="0">Annuler</button><button class="btn primary" data-r="1">' + (cur ? "Enregistrer" : "Créer") + "</button></div></div>";
    };
    let nameV = cur ? cur.n : "";
    draw(); document.body.appendChild(d);
    const inp = () => d.querySelector("[data-on]");
    if (!cur) setTimeout(() => inp().focus(), 0);
    d.addEventListener("input", e => { if (e.target.matches("[data-on]")) nameV = e.target.value; });
    d.addEventListener("change", e => {
      const t = e.target;
      if (t.dataset.cv) { const k = t.dataset.cv; cv = t.checked ? cv.concat([k]) : cv.filter(x => x !== k); }
      if (t.dataset.cc != null) custom[+t.dataset.cc].on = t.checked;
      if (t.matches("[data-load]")) load = t.checked;
    });
    d.addEventListener("click", async e => {
      if (e.target === d) { d.remove(); res(null); return; }
      const ty = e.target.closest("[data-ty]"); if (ty && !ty.disabled) { type = ty.dataset.ty; draw(); return; }
      if (e.target.closest("[data-newcv]")) { const r = await askIndicator(nameV.trim() || "ton exercice"); if (r) { custom.push({ k: "c" + uid(), n: r.n, u: r.u, on: true }); draw(); } return; }
      const b = e.target.closest("[data-r]"); if (!b) return;
      if (b.dataset.r !== "1") { d.remove(); res(null); return; }
      const n = nameV.replace(/\s+/g, " ").trim(), m = d.querySelector("[data-m]");
      if (!n) { m.textContent = "Donne un nom à ton exercice."; return; }
      const lib = libFor(n); if (lib) { m.textContent = "« " + lib.n + " » est déjà dans la liste des exercices : choisis-le directement, ou donne un autre nom."; return; }
      if ((!cur || norm(n) !== norm(cur.n)) && ownNames().some(x => norm(x) === norm(n))) { m.textContent = "Tu as déjà un exercice « " + n + " »."; return; }
      d.remove(); res({ n: n.slice(0, 80), t: type, load: type === "dist" && load, cv: type === "cardio" ? cv : undefined, custom: custom.filter(x => x.on).map(x => ({ k: x.k, n: x.n, u: x.u })) });
    });
  });
}
function saveOwnEntry(st, old, r) {
  const list = (Array.isArray(st.ownEx) ? st.ownEx : []).filter(x => x && norm(x.n) !== norm(old || r.n) && norm(x.n) !== norm(r.n));
  list.push({ n: r.n, t: r.t, load: r.load || undefined, cv: r.cv, at: Date.now() }); st.ownEx = list;
  st.ownGone = (Array.isArray(st.ownGone) ? st.ownGone : []).filter(k => k !== norm(r.n));
  const nk = cardioKey({ name: r.n }), ok_ = old ? cardioKey({ name: old }) : nk, cc = Object.assign({}, st.cardioCustom), hh = Object.assign({}, st.cardioHidden);
  if (r.t === "cardio") cc[nk] = r.custom.slice(0, CARDIO_MAX_OWN); else delete cc[nk];
  if (ok_ !== nk) { delete cc[ok_]; if (hh[ok_]) { hh[nk] = hh[ok_]; delete hh[ok_]; } }
  st.cardioCustom = cc; st.cardioHidden = hh;
}
async function ownCreate() {
  if (isFree() && ownCount() >= FREE_OWN) { premiumGate("En version gratuite, tu peux avoir " + FREE_OWN + " exercices perso au plus."); return false; }
  const r = await askOwnEx(null); if (!r) return false;
  const st = settings(); saveOwnEntry(st, null, r); put("settings", st);
  toast("« " + r.n + " » ajouté à Mes exercices"); return true;
}
async function ownEdit(name) {
  const e = ownEntry(name), dft = ownDefaults(name) || {}, cur = { n: name, t: e ? e.t : dft.type || "reps", load: e ? !!e.load : !!dft.load, cv: e && Array.isArray(e.cv) ? e.cv : undefined };
  const r = await askOwnEx(cur); if (!r) return false;
  const renamed = r.n !== name, retype = r.t !== cur.t || !!r.load !== !!cur.load, u = ownUses(name);
  if (renamed && !await fancyAsk({ title: "Renommer « " + name + " » ?", ok: "Renommer",
    html: "<p>Il s'appellera <b>« " + esc(r.n) + " »</b> partout dans Fiitday :</p><ul class=\"fancy-list\">" +
      "<li>" + (u.vars.length ? esc(u.vars.length + " séance" + (u.vars.length > 1 ? "s" : "") + " de programme : " + u.vars.join(", ")) : "Dans aucun programme pour l'instant") + "</li>" +
      "<li>" + (u.done ? u.done + " séance" + (u.done > 1 ? "s" : "") + " déjà faite" + (u.done > 1 ? "s" : "") + " dans ton historique" : "Pas encore fait en séance") + "</li></ul>" +
      '<p class="welcome-wish">Ton historique et ta courbe d\'évolution sont gardés.</p>' })) return false;
  const nn = norm(name), fix = (x, tpl) => { if (exLib(x) || norm(x.name) !== nn) return false; x.name = r.n; if (retype && tpl) Object.assign(x, typeDefaults(r.t, r.load), tpl && r.t === "cardio" ? { sets: 1, drops: 0 } : {}); if (retype && !tpl && !x.sets.some(s => s.done || setHasData(s, x.type))) Object.assign(x, { type: r.t, load: !!r.load }); return true; };
  templates().forEach(t => { let ch = false; t.variants.forEach(v => v.exercises.forEach(x => { if (fix(x, true)) ch = true; })); if (ch) put("template", t); });
  all("workout").forEach(w => { let ch = false; w.exercises.forEach(x => { if (fix(x, false)) ch = true; }); if (ch) put("workout", w); });
  const st = settings(); saveOwnEntry(st, name, r); put("settings", st);
  toast(renamed ? "Renommé partout : « " + r.n + " »" : "« " + r.n + " » enregistré"); return true;
}
async function ownDelete(name) {
  const u = ownUses(name);
  if (!await fancyAsk({ title: "Supprimer « " + name + " » ?", ok: "Supprimer", danger: true,
    html: "<p>Il sera retiré de <b>Mes exercices</b>" + (u.vars.length ? " et de tes programmes :" : ".") + "</p>" + (u.vars.length ? '<ul class="fancy-list">' + u.vars.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "") +
      '<p class="welcome-wish">' + (u.done ? "Tes " + u.done + " séance" + (u.done > 1 ? "s" : "") + " passée" + (u.done > 1 ? "s" : "") + " et sa courbe d'évolution sont gardées." : "Tu ne l'as pas encore fait en séance : rien d'autre ne change.") + "</p>" })) return false;
  const nn = norm(name);
  templates().forEach(t => { let ch = false; t.variants.forEach(v => { const n0 = v.exercises.length; v.exercises = v.exercises.filter(x => exLib(x) || norm(x.name) !== nn); if (v.exercises.length !== n0) { ch = true; cleanGroups(v); } }); if (ch) put("template", t); });
  const st = settings(); st.ownEx = (Array.isArray(st.ownEx) ? st.ownEx : []).filter(x => x && norm(x.n) !== nn);
  st.ownGone = (Array.isArray(st.ownGone) ? st.ownGone : []).filter(k => k !== nn).concat([nn]); put("settings", st);
  toast("« " + name + " » supprimé de Mes exercices"); return true;
}
// liste pour la page Exercices
const ownList = () => ownNames().map(n => { const e = ownEntry(n), d = ownDefaults(n) || {}, u = ownUses(n); return { n, t: e ? e.t : d.type || "reps", label: TYPE_LABEL[e ? e.t : d.type || "reps"] || "", vars: u.vars.length, done: u.done }; });
// « Ajouter à une séance » depuis la fiche d'un exercice
async function addLibraryExercise(x) {
  const opts = [];
  const cm = x.cardio && CARDIO_MACH[x.cardio] ? x.cardio : "", act = activeWorkout();
  if (cm) opts.push(act ? ["act", "La séance en cours", act.templateName + " · " + vLabel(act.variantName)] : ["now", "Une séance cardio maintenant", "Lance le chrono tout de suite"]);
  templates().forEach(t => t.variants.forEach(v => opts.push(["t:" + t.id + ":" + v.id, t.name + " · " + vLabel(v.name), v.exercises.length + " exercice" + (v.exercises.length > 1 ? "s" : "")])));
  if (cm) {
    const lib = EXO_LIB.find(y => y.id === cm), te = Object.assign(newExercise(), { name: String(x.name).slice(0, 80), lib: cm }, libDefaults(Object.assign({}, lib, { cardioOf: cm })));
    const c = await choose("Ajouter « " + x.name + " » à…", opts); if (!c) return;
    if (c === "now") { cardioNow([cardioWEx(te)]); return; }
    if (c === "act") { const w = activeWorkout(); if (!w) return; w.exercises.push(cardioWEx(te)); put("workout", w); toast("Ajouté à la séance en cours"); go("session/" + w.id); return; }
    const [, tid, vid] = c.split(":"); const t = getItem(tid); const v = t && t.variants.find(y => y.id === vid); if (!v) return;
    v.exercises.push(te); put("template", t); toast("Ajouté à « " + t.name + " · " + vLabel(v.name) + " »"); return;
  }
  if (!opts.length) { toast(templates().length ? "Crée d'abord une séance dans un de tes programmes (Accueil › + Nouvelle séance)" : "Crée d'abord un programme depuis l'accueil"); return; }
  const c = await choose("Ajouter « " + x.name + " » à…", opts); if (!c) return;
  const [, tid, vid] = c.split(":"); const t = getItem(tid); const v = t && t.variants.find(y => y.id === vid); if (!v) return;
  const reps = (String(x.reps || "").match(/^\d+(-\d+)?/) || [""])[0];
  const e = Object.assign(newExercise(), { name: String(x.name).slice(0, 80) }, libFor(x.name) ? { lib: libFor(x.name).id } : {}, x.time ? Object.assign({ type: "time", target: String(num(x.hold) || 45), rest: x.hold ? Math.max(0, Math.min(1200, num(x.rest) || 15)) : 60 }, x.hold ? { sets: 2 } : {}) : x.dist ? { type: "dist", target: String(x.dist), rest: Math.max(0, Math.min(1200, num(x.rest) || 120)), load: !!x.load } : Object.assign({ target: reps || "8-10", rest: Math.max(0, Math.min(1200, num(x.rest) || 90)) }, x.bw ? { type: "rep" } : {}));
  v.exercises.push(e); put("template", t);
  toast("Ajouté à « " + t.name + " · " + vLabel(v.name) + " »");
}

/* ================= Écran : connexion ================= */
let loginMode = "in", loginEmail = "", loginName = ""; // écran de connexion : « in » se connecter, « up » créer un compte
// écran de connexion ouvert par le lien « Résilier un abonnement » ou « Renoncer au contrat » : on dit pourquoi
const loginForContract = () => { const n = route().name; return n === "resilier" ? "Connecte-toi pour résilier ton abonnement : le formulaire s'ouvre juste après." : n === "retractation" ? "Connecte-toi pour renoncer à ton achat : le formulaire s'ouvre juste après." : ""; };
function viewLogin() {
  if (db.verify) return '<div class="login"><img class="logo" src="icon-192.png" alt="" width="72" height="72"><h1>Vérifie ton e-mail</h1>' +
    '<p class="muted">Nous avons envoyé un code à <b>' + esc(db.verify) + '</b>. Saisis-le ci-dessous pour activer ton compte.</p>' +
    '<form data-form="verify" class="stack">' +
    '<label class="fl">Code reçu par e-mail<input class="f code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" pattern="[0-9 ]*" required></label>' +
    '<button class="btn primary big" type="submit">Valider</button></form>' +
    '<p class="msg" data-msg role="status"></p>' +
    '<p class="muted small">Pas reçu ? Regarde dans les spams.</p><button class="btn" data-act="resend">Renvoyer le code</button>' +
    '<button class="link" data-act="changemail">Changer d\'adresse e-mail</button></div>';
  if (resetStep) return viewReset();
  const up = loginMode === "up", em = esc(loginEmail || (!up && db.expired && db.expired.email) || "");
  // (le mode « sans compte » existe toujours dans le code, mais n'est plus proposé sur cet écran)
  return '<div class="login"><img class="logo" src="icon-192.png" alt="" width="72" height="72"><h1>Fiitday</h1>' +
    '<p class="muted">' + (loginForContract() || (up ? "Crée ton compte pour enregistrer tes séances (et les retrouver sur ton téléphone et ton ordinateur avec Premium)." : "Connecte-toi pour retrouver tes séances.")) + "</p>" +
    (db.expired && !up ? '<p class="msg warn" role="status">Ta connexion a expiré (mot de passe changé ou déconnexion sur un autre appareil ?). Reconnecte-toi : tes données sont gardées sur cet appareil.</p>' : "") +
    '<form data-form="login" class="stack">' +
    (up ? '<label class="fl">Prénom<input class="f" name="firstname" autocomplete="given-name" maxlength="40" value="' + esc(loginName) + '"></label>' : "") +
    '<label class="fl">E-mail<input class="f" type="email" name="email" autocomplete="email" value="' + em + '" required></label>' +
    '<label class="fl">Mot de passe<input class="f" type="password" name="password" minlength="' + (up ? PW_MIN : 6) + '" autocomplete="' + (up ? "new-password" : "current-password") + '" required></label>' +
    (up
      // le compte et les séances reposent sur le contrat (service demandé), pas sur un « accord » : on informe, et on fait confirmer l'âge
      ? '<label class="consent"><input type="checkbox" name="consent" id="consent"><span>J\'ai 15 ans ou plus et j\'accepte les ' + cguLink() + ".</span></label>" +
        '<p class="small muted consent-info">Tes séances et tes réglages sont enregistrés pour faire fonctionner ton compte, comme expliqué dans la <a href="' + LEGAL.privacy + '" target="_blank" rel="noopener">politique de confidentialité</a>.</p>' +
        '<button class="btn primary big" type="submit" value="up">Créer mon compte</button>'
      : '<button class="btn primary big" type="submit" value="in">Se connecter</button>') +
    "</form>" +
    '<p class="msg" data-msg role="status"></p>' +
    (up ? '<button class="link" data-act="loginmode" data-m="in">J\'ai déjà un compte : me connecter</button>'
        : '<button class="link" data-act="forgot">Mot de passe oublié ?</button><button class="link" data-act="loginmode" data-m="up">Créer un compte</button>') +
    (Native ? "" : '<a class="link lp-back" href="#/home">Découvrir Fiitday</a>') + "</div>";
}

/* ================= Page de présentation (fiitday.com, visiteur non connecté) ================= */
// Sur le site sans compte connecté : ce qu'est Fiitday, des captures, les prix et les questions fréquentes, puis « Se connecter »
// ou « Créer mon compte » (#/connexion). Jamais dans l'appli Android (connexion directe). Les liens internes de la page sont des
// boutons : un lien « #… » ouvrirait une page de l'appli. Les captures (données d'exemple) sont dans src/landing, clair et sombre.
const LP_TITLE = "Fiitday · Ton carnet de musculation";
const showLanding = () => !Native && !db.auth && db.mode !== "local" && !db.verify && !db.expired && !resetStep && route().name === "home";
const LP_ICON = {
  cube: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg>',
  body: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="4.5" r="2"/><path d="M4 9l8-1 8 1M12 8v6l-4 7M12 14l4 7"/></svg>',
  pulse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12h4l2.5-6 4 12 2.5-6H22"/></svg>',
  devices: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="14" height="10" rx="1.5"/><path d="M5 18h8" stroke-linecap="round"/><rect x="17.5" y="8" width="4.5" height="12" rx="1"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0112 0"/><circle cx="17.5" cy="9" r="2.4"/><path d="M16 14.6A5 5 0 0121.5 19"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
  laptop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19.5h20" stroke-linecap="round"/></svg>'
};
const LP_FEATURES = [
  ["grid", "Programmes prêts ou sur mesure", "Crée tes programmes, ou ajoute en un appui les 16 séances Fiitday : débutant ou intermédiaire, en salle ou à la maison, musculation ou circuit training."],
  ["dumbbell", "Une séance qui te guide", "Tes charges de la dernière fois s'affichent, une série se valide d'un appui et le repos démarre tout seul. Supersets, dégressifs et circuits compris."],
  ["clock", "Repos et chronos", "Fin du repos par vibration ou par son. Dans l'appli Android, l'alerte arrive aussi écran verrouillé et sur ta montre connectée."],
  ["cube", "Plus de 100 exercices en 3D", "Chaque mouvement est animé par un mannequin 3D que tu fais tourner, avec les muscles travaillés, les bons gestes et les erreurs à éviter."],
  ["body", "Étirements conseillés", "23 étirements guidés en 3D et, après ta séance, ceux qui correspondent aux muscles que tu viens de travailler."],
  ["chart", "Tes progrès en clair", "La courbe de chaque exercice, tes records, ton temps de sport, le tonnage et le calendrier de tes séances."],
  ["pulse", "Musculation, cardio, Hyrox", "Poids et répétitions, répétitions seules, temps, distance ou machines de cardio : chaque exercice se note à sa façon."],
  ["devices", "Téléphone et ordinateur", "Avec Premium, ton compte garde tout à jour entre l'appli Android et fiitday.com. Sans réseau, ta séance continue et s'envoie au retour."]
];
const LP_SHOTS = [["seance", "Une séance : charges de la dernière fois, séries validées, repos"], ["exercice", "Chaque exercice en 3D, avec les muscles travaillés"],
  ["evolution", "La courbe de chaque exercice et tes records"], ["programmes", "Des séances prêtes, pour débutants et intermédiaires"], ["accueil", "Tes programmes, et ta séance en cours"]];
// questions de la page : celles de l'abonnement et de la synchro (sans les liens vers les pages de l'appli), plus la confidentialité
const LP_FAQ = () => {
  const all = FAQ.concat([FAQ_PLAN]).flatMap(c => c[1]), pick = id => all.find(q => q[0] === id);
  return (MONETIZATION ? ["essai", "gratuit", "formules", "souscrire", "resilier", "rembourser", "synchro"] : ["gratuit", "formules", "synchro"]).map(pick).filter(Boolean)
    .map(q => [q[0], q[1], q[2].replace(/<a [^>]*>(.*?)<\/a>/g, "$1")])
    .concat([["donnees", "Qui voit mes données ?", "Toi seul. Fiitday n'a <b>aucune publicité</b> ni aucun outil de pistage, et tes données ne sont <b>jamais vendues</b>. Tu peux les enregistrer dans un fichier ou supprimer ton compte quand tu veux. Le détail est dans la <a href=\"" + LEGAL.privacy + "\" target=\"_blank\" rel=\"noopener\">politique de confidentialité</a>."]]);
};
function viewLanding() {
  const dark = document.documentElement.dataset.theme === "dark";
  const shot = (k, alt, lazy) => '<div class="lp-phone"><img src="presentation/' + k + (dark ? "-sombre" : "") + '.webp" width="600" height="1298" alt="' + esc(alt) + '"' + (lazy ? ' loading="lazy"' : "") + "></div>";
  const ic = k => '<span class="lp-ic">' + (LP_ICON[k] || ICON[k]) + "</span>";
  const life = Date.now() < LIFE_END, lifeTxt = pr => life ? "ou " + pr.life + " à vie : prix de lancement jusqu'au 31 décembre 2027, puis " + pr.lifeAfter : "ou " + pr.lifeAfter + " à vie, en un seul paiement";
  const cta = '<div class="lp-cta"><button class="btn primary big" data-act="lplogin" data-m="up">Essayer gratuitement</button><button class="btn big" data-act="lplogin" data-m="in">J\'ai déjà un compte</button></div>';
  const brand = '<span class="lp-brand"><img src="icon-192.png" alt="" width="32" height="32"><span>Fiitday</span></span>';
  return '<div class="lp">' +
    '<header class="lp-top"><div class="lp-in">' + brand +
      '<nav class="lp-nav" aria-label="Sur cette page"><button data-act="lpgo" data-to="lp-fonctions">Fonctionnalités</button><button data-act="lpgo" data-to="lp-tarifs">Tarifs</button><button data-act="lpgo" data-to="lp-questions">Questions</button></nav>' +
      '<button class="btn sm" data-act="lplogin" data-m="in">Se connecter</button></div></header>' +
    '<section class="lp-hero"><div class="lp-in lp-hero-in"><div>' +
      '<h1>Ton carnet de musculation, <span class="lp-grad">simple et complet</span></h1>' +
      '<p class="lp-lead">Programmes, séances guidées, chrono de repos, plus de 100 exercices en 3D et le suivi de tes progrès. Sur ton téléphone et ton ordinateur.</p>' + cta +
      '<p class="lp-small">' + (MONETIZATION ? TRIAL_DAYS + " jours de Premium offerts à la création du compte, sans carte bancaire." : "Toute l'appli est gratuite pendant le lancement, sans carte bancaire.") + "</p></div>" +
      '<div class="lp-hero-shot">' + shot("seance", LP_SHOTS[0][1]) + "</div></div></section>" +
    '<section class="lp-sec" id="lp-fonctions"><div class="lp-in"><h2>Tout pour t\'entraîner, rien de superflu</h2>' +
      '<p class="lp-lead">Pensé pour la salle comme pour la maison : tu lances ta séance, Fiitday s\'occupe du reste.</p>' +
      '<div class="lp-feats">' + LP_FEATURES.map(([k, t, d]) => '<div class="lp-feat">' + ic(k) + "<h3>" + esc(t) + "</h3><p>" + esc(nbsp(d)) + "</p></div>").join("") + "</div></div></section>" +
    '<section class="lp-sec lp-alt" id="lp-ecrans"><div class="lp-in"><h2>Un coup d\'œil à l\'appli</h2>' +
      '<div class="lp-shots">' + LP_SHOTS.slice(1).map(([k, alt]) => "<figure>" + shot(k, alt, true) + "<figcaption>" + esc(alt) + "</figcaption></figure>").join("") + "</div></div></section>" +
    '<section class="lp-sec" id="lp-tarifs"><div class="lp-in"><h2>Gratuit pour commencer</h2>' +
      '<p class="lp-lead">À la création de ton compte, tu as <b>' + TRIAL_DAYS + ' jours de Premium offerts</b>, sans carte bancaire. Ensuite, soit tu passes à Premium, soit tu continues avec la <b>version gratuite, plus limitée</b> (détail ci-dessous). Rien n\'est supprimé : ce qui dépasse les limites est gardé avec un cadenas, et tout revient avec Premium.</p>' +
      (MONETIZATION ? "" : '<p class="lp-note">Les abonnements ne sont pas encore ouverts : en attendant, toute l\'appli est gratuite. Voici les prix prévus.</p>') +
      '<div class="lp-prices">' +
        '<div class="lp-price"><h3>Gratuit</h3><div class="amt num">0 €</div><div class="lp-small">Sans limite de durée</div><ul><li>1 programme et ' + FREE_VARIANTS + ' séances actives, à changer une fois tous les ' + FREE_SWITCH_DAYS + ' jours</li><li>' + FREE_OWN + ' exercices perso</li><li>Historique des ' + FREE_HIST_DAYS + ' derniers jours</li><li>Stats de la semaine</li><li>Sur un seul appareil, sans synchro</li></ul></div>' +
        [["solo", "Premium Solo", "Pour toi, sur tous tes appareils"], ["family", "Premium Famille", "Toi et 4 proches, chacun avec son compte et ses données"]].map(([k, t, d]) => { const pr = PRICES[k];
          return '<div class="lp-price' + (k === "solo" ? " best" : "") + '"><h3>' + t + '</h3><div class="amt num">' + pr.month + " <small>/ mois</small></div>" +
            '<div class="lp-small">ou ' + pr.year + " par an (soit " + pr.yearMonth + " par mois)<br>" + esc(lifeTxt(pr)) + "</div><ul><li>" + esc(d) + "</li><li>Tout illimité, toutes les stats</li><li>Synchro téléphone et ordinateur</li><li>Les programmes Fiitday</li></ul></div>"; }).join("") +
      "</div>" +
      '<details class="lp-compare"><summary>Comparer Premium et gratuit</summary><div class="card plan-table"><table><thead><tr><th></th><th>Premium</th><th>Gratuit</th></tr></thead><tbody>' +
        PLAN_ROWS.map(r => "<tr><th>" + esc(r[0]) + "</th><td>" + esc(r[1]) + "</td><td>" + esc(r[2]) + "</td></tr>").join("") + "</tbody></table></div></details>" +
      '<p class="lp-small">Prix TTC, en euros. Abonnements sans engagement, résiliables à tout moment. Paiement par carte bancaire sur fiitday.com (ordinateur, iPhone ou Android) : Premium marche ensuite aussi dans l\'appli Android.</p></div></section>' +
    '<section class="lp-sec lp-alt" id="lp-ou"><div class="lp-in"><h2>Sur ton téléphone et ton ordinateur</h2><div class="lp-where">' +
      '<div class="lp-feat">' + ic("phone") + "<h3>Android</h3><p>" + esc(nbsp("L'appli Android arrive bientôt sur Google Play. En attendant, Fiitday marche aussi dans le navigateur du téléphone.")) + "</p></div>" +
      '<div class="lp-feat">' + ic("phone") + "<h3>iPhone</h3><p>" + esc(nbsp("Ouvre fiitday.com dans Safari, puis Partager › « Sur l'écran d'accueil » : Fiitday s'ouvre comme une appli.")) + "</p></div>" +
      '<div class="lp-feat">' + ic("laptop") + "<h3>Ordinateur</h3><p>" + esc(nbsp("Directement sur fiitday.com, avec un affichage pensé pour le grand écran : idéal pour préparer tes programmes et suivre tes progrès.")) + "</p></div>" +
      "</div></div></section>" +
    '<section class="lp-sec" id="lp-questions"><div class="lp-in lp-narrow"><h2>Questions fréquentes</h2><div class="faq-box">' +
      LP_FAQ().map(([id, q, a]) => '<details class="faq-q" id="lpq-' + id + '"><summary>' + esc(nbsp(q)) + '</summary><div class="faq-a">' + nbsp(a) + "</div></details>").join("") + "</div>" +
      '<p class="lp-small">Une autre question ? Écris à <a href="mailto:contact@fiitday.com">contact@fiitday.com</a>.</p></div></section>' +
    '<section class="lp-sec"><div class="lp-in"><div class="hero lp-end"><h2>Prêt pour ta prochaine séance ?</h2><p>Crée ton compte en une minute et retrouve tes séances partout.</p>' + cta + "</div></div></section>" +
    '<footer class="lp-foot"><div class="lp-in">' + brand +
      '<nav aria-label="Informations légales"><a href="' + LEGAL.legal + '">Mentions légales</a><a href="' + LEGAL.privacy + '">Confidentialité</a><a href="' + LEGAL.cgu + '">Conditions d\'utilisation</a>' + (LEGAL.cgv ? '<a href="' + LEGAL.cgv + '">Conditions générales de vente</a>' : "") +
      '<a href="' + LEGAL.deletion + '">Supprimer son compte</a><a href="#/resilier">Résilier un abonnement</a><a href="mailto:contact@fiitday.com">Contact</a></nav>' +
      '<p class="lp-small">© ' + new Date().getFullYear() + " Fiitday</p></div></footer></div>";
}
/* ================= Mot de passe oublié ================= */
// 1) l'e-mail du compte → Supabase envoie un code ; 2) le code + le nouveau mot de passe → connexion
// (si l'e-mail contient un lien au lieu d'un code, le lien ramène sur le site et la fenêtre « Nouveau mot de passe » s'ouvre)
let resetStep = null, resetEmail = "";
function viewReset() {
  const back = '<button class="link" data-act="resetback">Retour à la connexion</button>';
  const head = t => '<div class="login"><img class="logo" src="icon-192.png" alt="" width="72" height="72"><h1>' + t + "</h1>";
  if (resetStep === "password") return head("Nouveau mot de passe") +
    '<p class="muted">Code validé. Choisis maintenant ton nouveau mot de passe.</p>' +
    '<form data-form="reset3" class="stack" autocomplete="on"><input type="email" name="username" autocomplete="username" value="' + esc(resetEmail) + '" readonly hidden tabindex="-1" aria-hidden="true">' +
    '<label class="fl">Nouveau mot de passe<input class="f" type="password" name="password" minlength="' + PW_MIN + '" autocomplete="new-password" required></label>' +
    '<label class="fl">Confirme le nouveau mot de passe<input class="f" type="password" name="password2" minlength="' + PW_MIN + '" autocomplete="new-password" required></label>' +
    '<button class="btn primary big" type="submit">Enregistrer</button></form><p class="msg" data-msg role="status"></p></div>';
  if (resetStep === "code") return head("Code reçu par e-mail") +
    '<p class="muted">Si un compte existe avec <b>' + esc(resetEmail) + '</b>, un code vient d\'y être envoyé. Saisis-le ci-dessous.</p>' +
    '<form data-form="reset2" class="stack">' +
    '<label class="fl">Code reçu par e-mail<input class="f code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" pattern="[0-9 ]*" required></label>' +
    '<button class="btn primary big" type="submit">Valider le code</button></form>' +
    '<p class="msg" data-msg role="status"></p><p class="muted small">Pas reçu ? Regarde dans les spams.</p><button class="btn" data-act="resetresend">Renvoyer le code</button>' + back + "</div>";
  return '<div class="login"><img class="logo" src="icon-192.png" alt="" width="72" height="72"><h1>Mot de passe oublié</h1>' +
    '<p class="muted">Indique l\'e-mail de ton compte : tu vas recevoir un code pour choisir un nouveau mot de passe.</p>' +
    '<form data-form="reset1" class="stack"><label class="fl">E-mail<input class="f" type="email" name="email" autocomplete="email" value="' + esc(resetEmail || loginEmail) + '" required></label>' +
    '<button class="btn primary big" type="submit">Recevoir un code</button></form><p class="msg" data-msg role="status"></p>' + back + "</div>";
}
async function onReset1(form) {
  const msg = $app.querySelector("[data-msg]"), email = form.email.value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) { msg.className = "msg err"; msg.textContent = "Indique une adresse e-mail valide."; return; }
  msg.className = "msg"; msg.textContent = "Envoi du code…"; form.querySelectorAll("button").forEach(b => { b.disabled = true; });
  try { await authReq("recover", { email }); resetEmail = email; resetStep = "code"; render(); }
  catch (e) { msg.className = "msg err"; msg.textContent = authMessage(e); form.querySelectorAll("button").forEach(b => { b.disabled = false; }); }
}
// compte protégé par la double authentification : Supabase exige le code à 6 chiffres avant de changer le mot de passe
async function askMfaCode() {
  const u = await authApi("GET", "user"), f = (u.factors || []).find(x => x.factor_type === "totp" && x.status === "verified");
  if (!f) return false;
  const code = await ask({ title: "Double authentification", text: "Ton compte est protégé : tape le code à 6 chiffres de ton appli d'authentification.", input: "", code: true, ok: "Valider" });
  if (!code) return false;
  const ch = await authApi("POST", "factors/" + f.id + "/challenge", {});
  const j = await authApi("POST", "factors/" + f.id + "/verify", { challenge_id: ch.id, code: code.replace(/\D/g, "") });
  if (j && j.access_token && j.user) setSession(j);
  return true;
}
async function setNewPassword(password) {
  try { await authApi("PUT", "user", { password }); }
  catch (e) {
    if (/aal2|mfa/i.test(String(e.message) + " " + (e.code || "")) && await askMfaCode()) { await authApi("PUT", "user", { password }); return; }
    throw e;
  }
}
async function onReset2(form) {
  const msg = $app.querySelector("[data-msg]"), token = form.code.value.replace(/\D/g, "");
  const err = t => { msg.className = "msg err"; msg.textContent = t; };
  if (token.length < 6) return err("Le code fait au moins 6 chiffres.");
  msg.className = "msg"; msg.textContent = "Vérification…"; form.querySelectorAll("button").forEach(b => { b.disabled = true; });
  try {
    const j = await authReq("verify", { type: "recovery", email: resetEmail, token });
    if (!j.access_token) throw new Error("Code incorrect ou expiré");
    setSession(j); resetStep = "password"; render();
  } catch (e) { err(authMessage(e)); form.querySelectorAll("button").forEach(b => { b.disabled = false; }); }
}
async function onReset3(form) {
  const msg = $app.querySelector("[data-msg]"), pw = form.password.value;
  const err = t => { msg.className = "msg err"; msg.textContent = t; };
  if (pw.length < PW_MIN) return err("Choisis un mot de passe d'au moins " + PW_MIN + " caractères.");
  if (pw !== form.password2.value) return err("Les deux mots de passe ne sont pas identiques.");
  msg.className = "msg"; msg.textContent = "Enregistrement…"; form.querySelectorAll("button").forEach(b => { b.disabled = true; });
  try {
    await setNewPassword(pw);
    resetStep = null; toast("Mot de passe changé, tu es connecté");
    await afterLogin();
  } catch (e) { err(authMessage(e)); form.querySelectorAll("button").forEach(b => { b.disabled = false; }); }
}
// lien de réinitialisation (ancien modèle d'e-mail) : #access_token=…&type=recovery
async function recoveryFromLink() {
  const h = location.hash.replace(/^#\/?/, "");
  if (!/(^|&)(access_token|error_description)=/.test(h)) return;
  const q = new URLSearchParams(h); history.replaceState(null, "", location.pathname + "#/home");
  if (q.get("error_description")) { toast("Lien expiré ou déjà utilisé : demande un nouveau code"); return; }
  if (q.get("type") !== "recovery" || !q.get("access_token")) return;
  try {
    const r = await fetch(SUPABASE_URL + "/auth/v1/user", { headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + q.get("access_token") } });
    const user = await r.json(); if (!r.ok || !user.id) throw new Error("lien");
    setSession({ access_token: q.get("access_token"), refresh_token: q.get("refresh_token"), expires_in: +q.get("expires_in") || 3600, user });
    const pw = await ask({ title: "Nouveau mot de passe", text: "Choisis ton nouveau mot de passe (" + PW_MIN + " caractères au moins).", input: "", ok: "Enregistrer" });
    if (pw && pw.length >= PW_MIN) { await setNewPassword(pw); toast("Mot de passe changé"); }
    else if (pw) toast(PW_MIN + " caractères au moins : recommence depuis « Mot de passe oublié »");
    await afterLogin();
  } catch (e) { toast("Ce lien ne fonctionne plus : demande un nouveau code"); }
}

function authMessage(e) {
  const m = String(e.message || "");
  if (/invalid login credentials/i.test(m)) return "E-mail ou mot de passe incorrect.";
  if (/email not confirmed/i.test(m)) return "Ton e-mail n'est pas encore vérifié.";
  if (/expired|invalid/i.test(m) && /token|otp|code/i.test(m)) return "Code incorrect ou expiré. Vérifie-le ou demande un nouveau code.";
  if (/rate limit/i.test(m)) return "Trop d'e-mails envoyés pour le moment. Réessaie un peu plus tard.";
  if (/security purposes|only request this after/i.test(m)) return "Patiente une minute avant de redemander un code.";
  if (/already registered|already exists/i.test(m)) return "Un compte existe déjà avec cet e-mail : " + (isPC() ? "clique" : "touche") + " « Se connecter ».";
  if (/password/i.test(m) && /6|8|short|weak|characters/i.test(m)) return "Mot de passe trop faible : au moins " + PW_MIN + " caractères.";
  if (m === "Failed to fetch") return "Pas de connexion internet.";
  console.warn("connexion :", e.status, m);
  if (e.status >= 500 || !m) return "Le serveur ne répond pas pour le moment. Réessaie dans un instant.";
  return "Connexion impossible pour le moment (erreur " + (e.code || e.status || "inconnue") + "). Réessaie dans un instant ; si cela continue, écris-nous à contact@fiitday.com.";
}
// données d'un compte gardées à part sur l'appareil (déconnexion avec des modifications pas encore envoyées, version gratuite,
// session expirée puis autre compte) : clé propre à chaque compte, reprises quand CE compte se reconnecte ici
const asideKey = uid => DB_KEY + ":garde:" + uid;
function keepAside(uid, everything) {
  const items = {}; let n = 0;
  for (const it of Object.values(db.items)) if (everything || it.dirty) { items[it.id] = Object.assign({}, it, { dirty: true, refused: undefined }); n++; }
  if (!n || !uid) return 0;
  try { const prev = JSON.parse(localStorage.getItem(asideKey(uid)) || "null"); if (prev && prev.items) for (const id of Object.keys(prev.items)) { const p = prev.items[id]; if (!items[id] || p.updated_at > items[id].updated_at) items[id] = p; } } catch (e) { }
  try { localStorage.setItem(asideKey(uid), JSON.stringify({ at: Date.now(), items })); return n; } catch (e) { return -1; }
}
function takeAside(uid) {
  let k = null; try { k = JSON.parse(localStorage.getItem(asideKey(uid)) || "null"); } catch (e) { }
  try { localStorage.removeItem(asideKey(uid)); } catch (e) { }
  if (!k || !k.items) return 0;
  let n = 0;
  for (const it of Object.values(k.items)) {
    if (!validItem(it) || typeof it.updated_at !== "number" || !KINDS[it.kind]) continue;
    const cur = db.items[it.id];
    if (!cur || it.updated_at > cur.updated_at) { db.items[it.id] = { id: it.id, kind: it.kind, data: it.data, updated_at: it.updated_at, deleted: !!it.deleted, dirty: true }; n++; }
  }
  if (n) dataRev++;
  return n;
}
async function afterLogin() {
  loginMode = "in"; loginEmail = "";
  db.verify = null; db.seeded = true; db.lastServerAt = null; delete db.expired;
  const uidNow = db.auth.user.id;
  if (db.owner && db.owner !== uidNow) {
    // données laissées par un AUTRE compte sur cet appareil (session expirée) : on ne les mélange pas ;
    // ce qui n'avait pas été envoyé est gardé à part et reviendra quand ce compte se reconnectera ici
    const kept = keepAside(db.owner, db.plan && db.plan.state === "free" && db.plan.launched);
    if (kept < 0 && !await ask({ title: "Données de l'autre compte", text: "Des modifications de l'autre compte n'ont pas encore été envoyées et le stockage de l'appareil est plein : elles seront perdues. Annule pour enregistrer d'abord une sauvegarde (Réglages › Données) avec l'autre compte.", ok: "Continuer quand même", cancel: "Annuler", danger: true })) {
      db.auth = null; db.mode = null; saveNow(); restart(); return;
    }
    db.items = {}; db.live = {}; db.base = {}; dataRev++;
    if (kept > 0) toast("Les modifications pas encore envoyées de l'autre compte restent gardées sur cet appareil : elles repartiront à sa prochaine connexion ici");
  } else if (!db.owner) {
    // données saisies sans compte : elles sont envoyées au compte
    Object.values(db.items).forEach(i => { if (i.updated_at > 0) i.dirty = true; });
  }
  db.owner = uidNow; db.plan = null; famSrv = null;
  const back = takeAside(uidNow);
  if (back > 0) toast(back > 1 ? back + " modifications gardées sur cet appareil ont été reprises" : "Une modification gardée sur cet appareil a été reprise");
  saveNow(); await loadPlan(true); render(); await sync();
  if (db.pendingConsent || db.pendingName) {
    const st = settings();
    if (db.pendingConsent) { st.consentAt = db.pendingConsent; st.consentVersion = LEGAL.version; }
    if (db.pendingName) st.firstName = db.pendingName;
    delete db.pendingConsent; delete db.pendingName; put("settings", st);
  }
  render();
}
async function onVerify(form) {
  const msg = $app.querySelector("[data-msg]");
  const token = form.code.value.replace(/\D/g, "");
  if (token.length < 6) { msg.className = "msg err"; msg.textContent = "Le code fait au moins 6 chiffres."; return; }
  msg.className = "msg"; msg.textContent = "Vérification…";
  form.querySelectorAll("button").forEach(b => { b.disabled = true; });
  try {
    const j = await authReq("verify", { type: "signup", email: db.verify, token });
    if (!j.access_token) throw new Error("Code incorrect ou expiré");
    setSession(j); toast("E-mail vérifié, bienvenue !");
    await afterLogin();
  } catch (e) {
    msg.className = "msg err"; msg.textContent = authMessage(e);
  } finally {
    form.querySelectorAll("button").forEach(b => { b.disabled = false; });
  }
}
async function onLogin(form, mode) {
  const msg = $app.querySelector("[data-msg]");
  const email = form.email.value.trim(), password = form.password.value;
  msg.className = "msg"; msg.textContent = mode === "up" ? "Création du compte…" : "Connexion…";
  form.querySelectorAll("button").forEach(b => { b.disabled = true; });
  try {
    if (mode === "up") {
      const fname = form.firstname.value.trim().slice(0, 40);
      if (password.length < PW_MIN) { msg.className = "msg err"; msg.textContent = "Choisis un mot de passe d'au moins " + PW_MIN + " caractères."; return; }
      if (!fname) { msg.className = "msg err"; msg.textContent = "Indique ton prénom."; return; }
      if (!form.consent.checked) { msg.className = "msg err"; msg.textContent = "Coche la case pour confirmer que tu as 15 ans ou plus et que tu acceptes les conditions d'utilisation."; return; }
      const consentAt = new Date().toISOString();
      const j = await authReq("signup", { email, password, data: { consent_at: consentAt, consent_version: LEGAL.version, first_name: fname } });
      // e-mail déjà inscrit : Supabase renvoie un utilisateur sans identité
      if (j.user && Array.isArray(j.user.identities) && j.user.identities.length === 0) throw new Error("already registered");
      db.pendingConsent = consentAt; db.pendingName = fname;
      if (!j.access_token) { db.verify = email; saveNow(); render(); return; } // code de vérification envoyé par e-mail
      setSession(j);
    } else {
      try { setSession(await authReq("token?grant_type=password", { email, password })); }
      catch (e) {
        if (/email not confirmed/i.test(e.message)) { // compte créé mais e-mail jamais vérifié : on renvoie un code
          db.verify = email; saveNow(); render();
          try { await authReq("resend", { type: "signup", email }); } catch (e2) { }
          const m2 = $app.querySelector("[data-msg]"); if (m2) m2.textContent = "Ton e-mail n'est pas encore vérifié : un nouveau code vient de t'être envoyé.";
          return;
        }
        throw e;
      }
    }
    await afterLogin();
  } catch (e) {
    msg.className = "msg err"; msg.textContent = authMessage(e);
  } finally {
    form.querySelectorAll("button").forEach(b => { b.disabled = false; });
  }
}

/* ================= Écran : accueil ================= */
function variantStats(t) {
  const ws = finished().filter(w => w.templateId === t.id);
  return t.variants.map(v => { const last = ws.find(w => w.variantId === v.id); return { v, last }; });
}
function viewHome() {
  const act = activeWorkout();
  let h = '<div class="home-top"><div class="page-head"><div><div class="muted small">' + esc(fmtDateLong(Date.now())) + '</div><h1>Bonjour' + (firstName() ? " " + esc(firstName()) : "") + '</h1></div></div>' +
    homeRecap(act) + homeStretch(act) + planBanner() + backupNudge() +
    '<div class="home-actions"><button class="btn primary" data-act="newtpl">+ Nouveau programme</button><button class="btn" data-act="importvar">Importer</button>' +
      '<button class="btn free-go" data-act="freestart">' + ICON.play + "Séance libre, sans programme</button></div></div>";
  if (act) {
    h += '<div class="hero"><div class="small" style="opacity:.75">Séance en cours</div><div style="font-size:21px;font-weight:800;margin-top:2px">' + esc(act.templateName) + " · " + esc(vLabel(act.variantName)) + "</div>" +
      '<div class="small" style="opacity:.8;margin-top:4px">Commencée à ' + fmtTime(act.startedAt) + ' · <span class="num" data-tick="elapsed" data-id="' + act.id + '"></span></div>' +
      '<a class="btn primary block big" href="#/session/' + act.id + '">Reprendre la séance</a></div>';
  }
  const ts = templates();
  h += '<div class="pc-cols home"><div class="pc-main"><div class="section-title">Mes programmes</div><div class="stack" data-sortable="tpl">';
  if (!ts.length) h += '<div class="card welcome"><h2>Bienvenue sur Fiitday</h2><p class="muted">Commence par créer ton premier programme avec « + Nouveau programme » (par exemple « Push » ou « Haut du corps »), puis ajoute ses séances et ses exercices. Une séance reçue d\'un ami ? Appuie sur « Importer ».</p></div>';
  for (const t of ts) {
    const st = variantStats(t);
    const lastAny = st.filter(x => x.last).sort((a, b) => b.last.startedAt - a.last.startedAt)[0];
    const pl = progLocked(t.id);
    // en-tête sur une ligne : nom du programme, puis la dernière séance (« mar 17 nov · Pull », sans points)
    h += '<div class="card tpl' + (pl ? " locked" : "") + '" data-sort-id="' + t.id + '"><div class="tpl-head"><h2>' + (pl ? LOCK : "") + esc(t.name) + "</h2>" +
      '<span class="tpl-side"><span class="muted small tpl-last">' + (lastAny ? "Dernière : " + esc(vLabel(lastAny.v.name)) : t.variants.length ? "Jamais faite" : "Aucune séance") + "</span>" +
      (ts.length > 1 ? '<span class="grip" data-drag title="Maintiens et fais glisser pour changer l\'ordre">' + GRIP + "</span>" : "") + "</span></div>" +
      // une ligne par séance : nom, puis « 6 exos · il y a 3 j », et ›
      '<div class="variants rows">' + st.map(x => {
        const n = x.v.exercises.length, lk = varLocked(t.id, x.v.id);
        return '<button class="variant' + (lk ? " locked" : "") + '" data-act="start" data-t="' + t.id + '" data-v="' + x.v.id + '"><b>' + (lk ? LOCK : "") + esc(vLabel(x.v.name)) + "</b>" +
          '<span class="vmeta">' + (lk ? '<span class="tag">Premium</span> · ' : "") + (n ? n + " exo" + (n > 1 ? "s" : "") : "vide") + " · " + (x.last ? esc(ago(x.last.startedAt)) : "jamais faite") + "</span>" +
          '<span class="vgo" aria-hidden="true">›</span></button>';
      }).join("") + '<button class="variant add" data-act="homeaddvar" data-t="' + t.id + '" aria-label="Nouvelle séance dans ' + esc(t.name) + '"><b>+ Nouvelle séance</b></button></div></div>';
  }
  h += "</div></div><div class=\"pc-side\">";
  h += '<div class="section-title">Découvrir</div><div class="home-more"><button type="button" class="card" data-act="cardiohome"><b>Séance cardio</b><span class="muted small">Tapis, vélo, elliptique, rameur… avec tes indicateurs</span></button>' +
    '<a class="card" href="#/programs"><b>Programmes Fiitday</b><span class="muted small">' + (isFree() ? '<span class="tag">Premium</span> ' : "") + 'Programmes prêts à l\'emploi et circuit training</span></a></div>';
  const recent = finished().filter(w => !histHidden(w)).slice(0, 3);
  if (recent.length) {
    h += '<div class="section-title">Dernières séances</div><div class="list">' + recent.map(w => historyRow(w)).join("") + "</div>" +
      '<a class="home-hist" href="#/history">Voir l\'historique ›</a>';
  }
  return h + "</div></div>";
}
// fenêtre affichée en touchant une séance sur l'accueil : « Modifier » | « C'est parti », et « Retour » en dessous
function startChoice(t, v) {
  return new Promise(res => {
    const n = v.exercises.length, title = t.name + " · " + vLabel(v.name);
    const d = document.createElement("div"); d.className = "modal";
    d.innerHTML = '<div class="modal-box" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><h3>' + esc(title) + "</h3><p>" + n + " exercice" + (n > 1 ? "s" : "") + "</p>" +
      '<div class="modal-btns"><button class="btn" data-c="edit">Modifier</button><button class="btn primary" data-c="go">C\'est parti</button></div>' +
      '<button class="linkbtn" data-c="">Retour</button></div>';
    document.body.appendChild(d);
    d.addEventListener("click", e => {
      if (e.target === d) { d.remove(); res(null); return; }
      const b = e.target.closest("[data-c]"); if (b) { d.remove(); res(b.dataset.c || null); }
    });
  });
}
// « Lancer la séance 1 » (nom par défaut) ou « Lancer « Push A » »
const launchLabel = v => { const n = vLabel(v.name); return /^séance\b/i.test(n) ? "la " + n.charAt(0).toLowerCase() + n.slice(1) : "« " + n + " »"; };
async function startWorkout(tid, vid, direct) {
  const t = getItem(tid); if (!t) return;
  const v = t.variants.find(x => x.id === vid); if (!v) return;
  if (varLocked(tid, vid)) { lockedChoice(tid, vid); return; }
  if (!v.exercises.length) { toast("Ajoute d'abord des exercices à cette séance"); go("program/" + tid + "/" + vid); return; }
  const choice = direct ? "go" : await startChoice(t, v);
  if (choice === "edit") { go("program/" + tid + "/" + vid); return; }
  if (choice !== "go") return;
  const act = activeWorkout();
  if (act) {
    const ok = await ask({ title: "Une séance est déjà en cours", text: act.templateName + " · " + vLabel(act.variantName) + "\nLa terminer et commencer celle-ci ?", ok: "Oui, la terminer" });
    if (!ok) return;
    act.endedAt = Date.now(); put("workout", act);
  }
  const w = {
    id: "w-" + uid(), templateId: t.id, variantId: v.id, templateName: t.name, variantName: v.name, startedAt: Date.now(), endedAt: null,
    exercises: v.exercises.map(e => ({ exId: e.id, name: e.name, lib: exLib(e) ? exLib(e).id : undefined, note: e.note || "", type: e.type, machine: e.type === "cardio" ? e.machine || "" : undefined, target: e.target, rest: e.rest, load: !!e.load, restNext: restNextOf(e, v), drops: dropsOf(e), groupId: e.groupId || null, groupKind: e.groupKind || null,
      dropScope: e.dropScope === "last" ? "last" : "all", sw: e.sw ? 1 : undefined,
      sets: (n => Array.from({ length: n }, (_, k) => blankSet(dropsFor(e, k, n))))(e.type === "cardio" ? 1 : Math.max(1, num(e.sets) || 1)) })),
  };
  put("workout", w);
  db.live = {}; save();
  go("session/" + w.id); setTimeout(notifIntro, 600);
}

/* ================= Séance libre (accueil) : sans programme ================= */
// exercices choisis dans la liste → exercices de la séance (un exercice nouveau demande son type)
async function picksToSession(picks) {
  const tes = [];
  for (const p of picks) {
    const te = libExercise(p);
    if (!p.lib && !ownDefaults(p.name)) { // exercice nouveau : son type, pour savoir quoi noter
      const type = await choose("Type de « " + te.name + " »", TYPE_CHOICES); if (!type) return null;
      Object.assign(te, { type }, type === "time" ? { target: "45", rest: 60 } : type === "dist" ? { target: "1000", rest: 120 } : type === "cardio" ? { target: "", rest: 0, sets: 1, machine: "" } : {});
    }
    tes.push(te);
  }
  const wnew = tes.map(te => ({ exId: te.id, name: te.name, lib: te.lib || undefined, note: "", type: te.type, machine: te.type === "cardio" ? te.machine || "" : undefined, target: te.target, rest: te.rest, load: !!te.load, drops: 0, groupId: null, groupKind: null, dropScope: "all", restNext: 0,
    sets: Array.from({ length: te.type === "cardio" ? 1 : Math.max(1, num(te.sets) || 1) }, () => blankSet(0)) }));
  return { tes, wnew };
}
async function freeStart() {
  const picks = await pickExercises("muscu", "Séance libre : tes exercices"); if (!picks) return;
  const conv = await picksToSession(picks); if (!conv) return;
  const exercises = await orderNew([], conv.wnew, "exercice"); if (!exercises) return;
  const act = activeWorkout();
  if (act) {
    const ok = await ask({ title: "Une séance est déjà en cours", text: act.templateName + " · " + vLabel(act.variantName) + "\nLa terminer et commencer la séance libre ?", ok: "Oui, la terminer" });
    if (!ok) return;
    act.endedAt = Date.now(); put("workout", act);
  }
  const w = { id: "w-" + uid(), templateId: "libre", variantId: "libre", templateName: "Séance libre", variantName: "Sans programme", free: true, startedAt: Date.now(), endedAt: null, exercises };
  put("workout", w); db.live = {}; save(); go("session/" + w.id); setTimeout(notifIntro, 600);
}
// à la fin d'une séance libre : la garder comme séance d'un programme, pour la relancer plus tard
async function keepFreeSession(w) {
  if (!w || !w.free || !w.exercises.length) return;
  const ts = templates().filter(t => !progLocked(t.id));
  const opts = (isFree() && templates().length >= 1 ? [] : [["new", "Nouveau programme", "Crée un programme avec cette séance"]])
    .concat(ts.filter(t => !(isFree() && t.variants.length >= FREE_VARIANTS)).map(t => ["t:" + t.id, "Ajouter à « " + t.name + " »", "Comme nouvelle séance de ce programme"]));
  if (!opts.length) return;
  if (!await ask({ title: "Garder cette séance ?", text: "Enregistre-la dans un programme pour la relancer plus tard en un appui.", ok: "La garder", cancel: "Non merci" })) return;
  const dest = await choose("Où la ranger ?", opts); if (!dest) return;
  const name = await ask({ title: "Nom de la séance", input: "Séance libre", ok: "Enregistrer" }); if (!name) return;
  const exercises = w.exercises.map(e => ({ id: "e-" + uid(), name: e.name, lib: exLib(e) ? exLib(e).id : undefined, type: e.type || "reps", machine: e.type === "cardio" ? e.machine || "" : undefined, sets: e.type === "cardio" ? 1 : Math.max(1, e.sets.length), target: e.target, rest: e.rest, load: !!e.load, note: e.note || "",
    drops: dropsOf(e) || 0, dropScope: e.dropScope === "last" ? "last" : "all", groupId: e.groupId || undefined, groupKind: e.groupKind || undefined }));
  let t;
  if (dest === "new") {
    const pn = await ask({ title: "Nom du programme", input: "", ok: "Créer" }); if (!pn) return;
    t = { id: "tpl-" + uid(), name: pn.slice(0, 60), order: templates().length, variants: [] };
  } else { t = getItem(dest.slice(2)); if (!t) return; }
  const v = { id: "v" + uid(), name: name.slice(0, 60), exercises }; t.variants.push(v); put("template", t); render();
  toast("Séance gardée dans « " + t.name + " »");
}

/* ================= Séance cardio (accueil, onglet Cardio des exercices) ================= */
async function cardioStart() {
  const act = activeWorkout();
  const c = await choose("Séance cardio", [["now", act ? "Ajouter à la séance en cours" : "Lancer maintenant", act ? act.templateName + " · " + vLabel(act.variantName) + " : ajoute tes machines à la suite" : "Choisis tes machines, lance le chrono, puis note tes indicateurs à la fin"],
    ["past", "Ajouter une séance faite", "Indique le jour, puis la durée et les indicateurs de chaque machine"]]);
  if (c === "now") cardioNow(); else if (c === "past") cardioPast();
}
const cardioWEx = te => ({ exId: te.id, name: te.name, lib: te.lib || te.machine || undefined, note: "", type: "cardio", machine: te.machine || "", target: te.target || "", rest: 0, load: false, drops: 0, groupId: null, groupKind: null, dropScope: "all", restNext: 0, sets: [blankSet(0)] });
async function cardioPick(title) {
  const picks = await pickExercises("cardio", title); if (!picks) return null;
  return picks.map(p => cardioWEx(p.lib ? libExercise(p) : Object.assign(newExercise(), { name: String(p.name).slice(0, 80), type: "cardio", machine: cardioMachineOf(p.name), sets: 1, target: "", rest: 0 })));
}
const cardioWorkout = (start, exercises, manual) => Object.assign({ id: "w-" + uid(), templateId: "cardio", variantId: "cardio", templateName: "Cardio", variantName: "Séance cardio", cardio: true, startedAt: start, endedAt: manual ? start : null, exercises }, manual ? { manual: true } : {});
// séance ajoutée après coup : elle dure le total des durées notées
function syncManual(w) { const tot = w.exercises.reduce((a, e) => a + e.sets.reduce((b, st) => b + Math.max(0, num(st.sec) || 0), 0), 0); w.endedAt = w.startedAt + Math.min(tot, 12 * 3600) * 1000 || w.startedAt; }
async function cardioNow(exs) {
  const act = activeWorkout();
  exs = exs || await cardioPick(act ? "Ajouter à la séance en cours" : "Lancer une séance cardio"); if (!exs || !exs.length) return;
  if (act) { act.exercises.push(...exs); put("workout", act); toast(exs.length > 1 ? "Machines ajoutées à la séance en cours" : "Ajouté à la séance en cours"); go("session/" + act.id); return; }
  const w = cardioWorkout(Date.now(), exs, false);
  put("workout", w); db.live = {}; save(); go("session/" + w.id); setTimeout(notifIntro, 600);
}
async function cardioPast() {
  const at = await askWhen(); if (!at) return;
  const exs = await cardioPick("Machines de ta séance"); if (!exs || !exs.length) return;
  const w = cardioWorkout(at, exs, true);
  put("workout", w); save(); go("session/" + w.id);
  toast("Note maintenant la durée et les indicateurs de chaque machine");
}
// jour et heure d'une séance déjà faite (pas dans le futur)
function askWhen() {
  return new Promise(res => {
    const now = new Date(), d0 = new Date(now.getTime() - 3600e3), day = x => x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate());
    const d = document.createElement("div"); d.className = "modal";
    d.innerHTML = '<div class="modal-box" role="dialog" aria-modal="true" aria-label="Séance cardio faite"><h3>Séance cardio faite</h3><p>Quand l\'as-tu faite ? Tu choisis ensuite les machines, puis tu notes la durée et les indicateurs.</p>' +
      '<div class="row duo when-row"><label class="fl">Jour<input class="f" type="date" data-wd max="' + day(now) + '" value="' + day(d0) + '" required></label>' +
      '<label class="fl">Heure de début<input class="f" type="time" data-wt value="' + pad(d0.getHours()) + ":" + pad(Math.floor(d0.getMinutes() / 5) * 5) + '" required></label></div>' +
      '<p class="msg err" data-m></p><div class="modal-btns"><button class="btn" data-r="0">Annuler</button><button class="btn primary" data-r="1">Continuer</button></div></div>';
    document.body.appendChild(d);
    const ok = () => {
      const a = (d.querySelector("[data-wd]").value || "").split("-").map(Number), b = (d.querySelector("[data-wt]").value || "").split(":").map(Number), m = d.querySelector("[data-m]");
      const t = a.length === 3 && b.length >= 2 ? new Date(a[0], a[1] - 1, a[2], b[0], b[1]).getTime() : NaN;
      if (isNaN(t)) { m.textContent = "Choisis le jour et l'heure."; return; }
      if (t > Date.now()) { m.textContent = "Choisis un moment déjà passé."; return; }
      if (t < Date.now() - 5 * 366 * DAY) { m.textContent = "Choisis une date de moins de 5 ans."; return; }
      d.remove(); res(t);
    };
    d.addEventListener("click", e => {
      if (e.target === d) { d.remove(); res(null); return; }
      const r = e.target.closest("[data-r]"); if (!r) return;
      if (r.dataset.r === "1") ok(); else { d.remove(); res(null); }
    });
  });
}
// nouvel indicateur de cardio : nom et unité, gardés pour cette machine
function askIndicator(name) {
  return new Promise(res => {
    const d = document.createElement("div"); d.className = "modal";
    d.innerHTML = '<div class="modal-box" role="dialog" aria-modal="true" aria-label="Nouvel indicateur"><h3>Nouvel indicateur</h3><p>Pour « ' + esc(name) + ' ». Il te sera proposé à chaque fois que tu feras cette machine.</p>' +
      '<label class="fl">Nom<input class="f" data-in maxlength="30" placeholder="Ex. Pente moyenne, Watts max" autocomplete="off"></label>' +
      '<label class="fl">Unité (facultatif)<input class="f" data-iu maxlength="12" placeholder="Ex. %, W, tours" autocomplete="off"></label>' +
      '<p class="msg err" data-m></p><div class="modal-btns"><button class="btn" data-r="0">Annuler</button><button class="btn primary" data-r="1">Ajouter</button></div></div>';
    document.body.appendChild(d);
    const n = d.querySelector("[data-in]"), u = d.querySelector("[data-iu]"); n.focus();
    const ok = () => { const v = n.value.replace(/\s+/g, " ").trim(); if (!v) { d.querySelector("[data-m]").textContent = "Donne un nom à l'indicateur."; return; } d.remove(); res({ n: v.slice(0, 30), u: u.value.replace(/\s+/g, " ").trim().slice(0, 12) }); };
    n.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); u.focus(); } });
    u.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); ok(); } });
    d.addEventListener("click", e => {
      if (e.target === d) { d.remove(); res(null); return; }
      const r = e.target.closest("[data-r]"); if (!r) return;
      if (r.dataset.r === "1") ok(); else { d.remove(); res(null); }
    });
  });
}

/* ================= Écran : séance ================= */
// valeurs de la dernière fois, affichées en grisé dans les champs vides (d = numéro de baisse en dégressif)
function phOf(w, e, s, d) {
  const lp = lastPerf(w, e);
  let src = lp && lp.e.sets[s];
  if (src && d != null) src = src.drops && src.drops[d];
  const has = src && setHasData(src, e.type);
  const f = k => (has && num(src[k]) != null ? fmtNum(num(src[k])) : null);
  return { kg: f("kg") || "0", reps: f("reps") || "reps", sec: has && num(src.sec) != null ? fmtHold(src.sec) : "—", clock: has && num(src.sec) != null ? fmtClock(src.sec) : "m:ss" };
}
function inputsHtml(w, e, i, k, d, label) {
  const s = e.sets[k], v = d == null ? s : ((s.drops || [])[d] || {}), ph = phOf(w, e, k, d);
  const a = ' data-i="' + i + '" data-s="' + k + '"' + (d == null ? "" : ' data-d="' + d + '"');
  if (e.type === "cardio") return '<button type="button" class="f pick cv-pick' + (num(v.sec) != null ? "" : " empty") + '" data-act="cvdur"' + a + ' aria-label="Durée ' + label + '">' + (num(v.sec) != null ? fmtClock(v.sec) : "Durée") + "</button>";
  if (e.type === "time") return '<input class="ro" readonly tabindex="-1" aria-readonly="true" aria-label="Temps ' + label + ' (rempli par le chrono)" data-f="sec"' + a + ' value="' + esc(fmtHold(v.sec)) + '" placeholder="' + esc(ph.sec) + '">';
  const nb = (f, lab) => '<button type="button" class="f pick npick' + (num(v[f]) != null ? "" : " empty") + '" data-act="setpick" data-f="' + f + '"' + a + ' aria-label="' + lab + " " + label + " : " + (num(v[f]) != null ? fmtNum(num(v[f])) : "à choisir") + '">' + (num(v[f]) != null ? fmtNum(num(v[f])) : esc(ph[f])) + "</button>";
  if (e.type === "rep") return nb("reps", "Répétitions");
  if (e.type === "dist") return (e.load ? nb("kg", "Kilos") : "") +
    '<button type="button" class="f pick tpick' + (num(v.sec) != null ? "" : " empty") + '" data-act="distclock"' + a + ' aria-label="Temps ' + label + " : " + (num(v.sec) != null ? fmtClock(v.sec) : "à choisir") + '">' + (num(v.sec) != null ? fmtClock(v.sec) : ph.clock === "m:ss" ? "Temps" : ph.clock) + "</button>";
  return nb("kg", "Kilos") + nb("reps", "Répétitions");
}
function chronoBtn(w, i, s) {
  const c = db.live.chrono, run = c && c.wid === w.id && c.i === i && c.s === s;
  return '<button class="chrono' + (run ? " run" : "") + '" data-act="chrono" data-i="' + i + '" data-s="' + s + '" aria-label="' + (run ? "Arrêter le chrono" : "Lancer le chrono") + '">' +
    (run ? ICON.stop + '<span class="num" data-tick="chrono">0:00</span>' : ICON.play + (w.exercises[i] && w.exercises[i].type === "dist" && w.exercises[i].load ? "" : '<span class="cl">Chrono</span>')) + "</button>";
}
function okBtn(s, i, k) {
  return '<button class="ok' + (s.done ? " on" : "") + '" data-act="done" data-i="' + i + '" data-s="' + k + '" aria-label="Valider la série ' + (k + 1) + '" aria-pressed="' + !!s.done + '">✓</button>';
}
// une série (et ses baisses) dans la grille des cartes
function setRows(w, e, i, k, label) {
  const s = e.sets[k], d = s.done ? " done-row" : "";
  let h = '<div class="n">' + label + '</div><div class="set' + d + '">' + inputsHtml(w, e, i, k, null, "série " + (k + 1)) + (e.type === "time" || e.type === "dist" || e.type === "cardio" ? chronoBtn(w, i, k) : "") + "</div>" + okBtn(s, i, k);
  (s.drops || []).forEach((x, n) => {
    h += '<div class="n drop" title="Baisse ' + (n + 1) + '">↘</div><div class="set' + d + '">' + inputsHtml(w, e, i, k, n, "série " + (k + 1) + " baisse " + (n + 1)) + "</div><div></div>";
  });
  return h;
}
function metaText(e, inGroup, live) {
  if (e.type === "cardio") return "Cardio" + (num(e.target) ? " · objectif " + fmtNum(num(e.target)) + " min" : "") + (live ? " · lance le chrono, puis note tes indicateurs" : "");
  const time = e.type === "time";
  const tg = e.type === "dist" ? esc(fmtNum(num(e.target) || 0)) + " m" : time ? esc(fmtHold(e.target) || "—") : esc(e.target || "—");
  let t = inGroup ? "Cible " + tg + (time || e.type === "dist" ? "" : " reps") : e.sets.length + " × " + tg + (live ? "" : " · repos " + esc(fmtRest(e.rest)));
  const d = dropsOf(e);
  if (d) t += " · dégressif (" + d + " baisse" + (d > 1 ? "s" : "") + (e.dropScope === "last" ? ", dernière série" : "") + ")";
  if (!inGroup && num(e.restNext)) t += " · puis " + esc(fmtRest(e.restNext)) + " avant le suivant";
  return t;
}
function exHead(w, e, i, letter) {
  const lib = exLib(e), live = !w.endedAt, time = e.type === "time";
  const cd = e.type === "cardio", mid = cd && e.machine && CARDIO_MACH[e.machine] ? e.machine : lib && lib.id;
  const chips = (mid ? '<button class="chip-mini" data-act="exoview" data-id="' + mid + '"' + (cd ? ' data-arg="cardio"' : "") + ">" + ICON.play + "Voir</button>" : "") +
    (live && !letter && !cd ? '<button class="chip-mini" data-act="sesspick" data-sf="rest" data-i="' + i + '">Repos ' + esc(fmtShort(num(e.rest) || 0)) + " ✎</button>" : "") +
    (live && !letter ? nextChip(w, [e], i) : "") +
    (live && time ? '<button class="chip-mini" data-act="sesspick" data-sf="target" data-i="' + i + '">Objectif ' + esc(fmtShort(num(e.target) || 0)) + " ✎</button>" : "");
  const nm = (letter ? '<span class="letter">' + letter + "</span>" : "") + esc(e.name), fk = letter ? null : "w:" + w.id + ":" + (e.exId || i);
  return '<div class="spread">' + (fk ? foldTitle(fk, '<span class="ex-name">' + nm + "</span>", folded.has(fk)) : '<div class="ex-name">' + nm + "</div>") + '<span class="ex-links"><button class="link" data-act="rename" data-i="' + i + '">Renommer</button>' + '<button class="link del" data-act="wdelex" data-i="' + i + '">Retirer</button>' + "</span></div>" +
    '<div class="ex-meta">' + metaText(e, !!letter, live) + "</div>" + (chips ? '<div class="ex-chips' + (live && time ? " wrap" : "") + '">' + chips + "</div>" : "");
}
function setActions(idx, count, word, extra) {
  const g = idx.join(",");
  return '<div class="ex-actions"><button class="btn sm" data-act="addset" data-g="' + g + '">+ ' + word + "</button>" +
    (count > 1 ? '<button class="btn sm" data-act="delset" data-g="' + g + '">− ' + word + "</button>" : "") + (extra || "") + "</div>";
}
// séance : ajouter / retirer un dégressif (exercices poids × reps)
const dropBtn = (e, i) => (e.type === "reps" || !e.type) ? '<button class="btn sm' + (dropsOf(e) ? " on-drop" : "") + '" data-act="wdrop" data-i="' + i + '">' + (dropsOf(e) ? "Dégressif ✎" : "+ Dégressif") + "</button>" : "";
// superset / biset / triset : un seul bouton, puis choix de l'exercice (A, B…) qui reçoit le dégressif
const groupDropBtn = blk => { const ok = blk.items.filter(x => x.e.type === "reps" || !x.e.type); if (!ok.length) return ""; const on = ok.some(x => dropsOf(x.e));
  return '<button class="btn sm' + (on ? " on-drop" : "") + '" data-act="wdrop" data-g="' + ok.map(x => x.i).join(",") + '">' + (on ? "Dégressif ✎" : "+ Dégressif") + "</button>"; };
// baisses des séries pas encore validées : n par série (toutes, ou seulement la dernière) ; les séries validées ne bougent pas
function applyDrops(e, n, scope) {
  e.drops = n; e.dropScope = scope === "last" ? "last" : "all";
  e.sets.forEach((st, k) => {
    if (st.done) return;
    const want = n && (scope !== "last" || k === e.sets.length - 1) ? n : 0;
    st.drops = (st.drops || []).slice(0, want);
    while (st.drops.length < want) st.drops.push({ kg: "", reps: "" });
  });
}
function noteBox(w, e, i, letter) {
  const te = e.note == null ? tplExercise(w, e.exId) : null, note = e.note != null ? e.note : (te && te.note) || ""; // la note de CETTE séance
  return '<textarea class="f" data-f="note" data-i="' + i + '" maxlength="' + NOTE_MAX + '" placeholder="Notes' + (letter ? " " + letter + " · " + esc(e.name) : " (réglages, sensations…)") + '" aria-label="Notes ' + esc(e.name) + '">' + esc(note) + "</textarea>";
}
// machine de cardio en séance : durée (chrono ou saisie), indicateurs de la machine et les tiens, validation
function cardioBody(w, e, i) {
  const defs = cardioShown(e), lp = lastPerf(w, e), many = e.sets.length > 1;
  return e.sets.map((s, k) => {
    const src = lp && lp.e.sets[k], a = ' data-i="' + i + '" data-s="' + k + '"', lab = many ? " bloc " + (k + 1) : "";
    return '<div class="cardio-set' + (s.done ? " done-row" : "") + '">' + (many ? '<div class="cv-bloc">Bloc ' + (k + 1) + "</div>" : "") +
      '<div class="cv-dur"><div class="cv"><span class="cv-n">Durée</span><button type="button" class="f pick cv-pick' + (num(s.sec) != null ? "" : " empty") + '" data-act="cvdur"' + a + ' aria-label="Durée' + lab + ' : ' + (num(s.sec) != null ? fmtClock(s.sec) : "à choisir") + '">' +
        (num(s.sec) != null ? fmtClock(s.sec) : src && num(src.sec) != null ? fmtClock(src.sec) : "") + "</button></div>" + (w.endedAt ? "" : chronoBtn(w, i, k)) + "</div>" +
      '<div class="cv-grid">' + defs.map(d => {
        const v = s.cv ? s.cv[d.k] : null, pv = src && src.cv ? cvNum(src.cv[d.k]) : null;
        return '<div class="cv"><span class="cv-n">' + esc(d.n) + '<button type="button" class="cv-del" data-act="cvdel" data-i="' + i + '" data-k="' + d.k + '" aria-label="Retirer l\'indicateur ' + esc(d.n) + '">×</button>' + "</span>" +
          (d.k === "dist" || d.k === "distm" ? '<button type="button" class="f pick cv-pick' + (num(v) != null ? "" : " empty") + '" data-act="cvdist" data-k="' + d.k + '"' + a + ' aria-label="' + esc(d.n + lab) + " : " + (num(v) != null ? fmtNum(num(v)) + " " + d.u : "à choisir") + '">' +
            (num(v) != null ? fmtNum(num(v)) + " " + d.u : pv != null ? fmtNum(pv) + " " + d.u : "") + "</button>" :
          d.clock ? '<button type="button" class="f pick cv-pick' + (num(v) != null ? "" : " empty") + '" data-act="cvclock" data-k="' + d.k + '"' + a + ' aria-label="' + esc(d.n + lab) + " : " + (num(v) != null ? fmtClock(v) : "à choisir") + '">' +
            (num(v) != null ? fmtClock(v) : pv != null ? fmtClock(pv) : "") + "</button>" :
          '<button type="button" class="f pick cv-pick' + (num(v) != null ? "" : " empty") + '" data-act="cvnum" data-k="' + d.k + '"' + a + ' aria-label="' + esc(d.n + lab) + " : " + (num(v) != null ? esc(cvFmt(d, num(v))) : "à choisir") + '">' +
            (num(v) != null ? esc(cvFmt(d, num(v))) : pv != null ? esc(cvFmt(d, pv)) : "") + "</button>") + "</div>";
      }).join("") + "</div>" +
      '<div class="cv-foot"><button type="button" class="link small" data-act="cvadd" data-i="' + i + '">+ Ajouter un indicateur</button><span class="cv-ok">' + (s.done ? "Validé" : "Valider") + okBtn(s, i, k) + "</span></div></div>";
  }).join("");
}
function cardioCard(w, e, i) {
  const fk = "w:" + w.id + ":" + (e.exId || i), f = folded.has(fk);
  return '<section class="card ex cardio-ex' + (f ? " folded" : "") + '">' + exHead(w, e, i, "") + (f ? '<div class="fold-sum muted small">' + esc(exSummary(e) || "À remplir") + "</div>" :
    '<div class="blk-body">' + cardioBody(w, e, i) + noteBox(w, e, i, "") + "</div>") + "</section>";
}
function exCard(w, e, i) {
  if (e.type === "cardio") return cardioCard(w, e, i);
  let rows = '<div class="h">Série</div><div class="h hdr">' + (e.type === "time" ? "<span>Temps</span>" : e.type === "rep" ? "<span>Reps</span>" : e.type === "dist" ? (e.load ? "<span>Kg</span>" : "") + "<span>Temps</span>" : "<span>Kg</span><span>Reps</span>") + '</div><div class="h"></div>';
  e.sets.forEach((s, k) => { rows += setRows(w, e, i, k, k + 1); });
  const f = folded.has("w:" + w.id + ":" + (e.exId || i)), dn = e.sets.filter(x => x.done).length;
  return '<section class="card ex' + (f ? " folded" : "") + '">' + exHead(w, e, i, "") + (f ? '<div class="fold-sum muted small">' + dn + " / " + e.sets.length + " série" + (e.sets.length > 1 ? "s" : "") + " validée" + (dn > 1 ? "s" : "") + "</div>" :
    '<div class="blk-body"><div class="sets">' + rows + "</div>" + setActions([i], e.sets.length, "Série", dropBtn(e, i)) + linkNext(w, i, false) + noteBox(w, e, i, "") + "</div>") + "</section>";
}
// séance en cours : repos avant l'exercice suivant (après la dernière série, ou le dernier tour d'un superset), s'il y a un exercice après
const restNextVal = mem => num(mem[mem.length - 1].restNext) || num(mem[0].restNext) || 0;
function nextChip(w, mem, i) {
  const last = w.exercises.indexOf(mem[mem.length - 1]); if (last < 0 || last >= w.exercises.length - 1) return "";
  const v = restNextVal(mem) || num(w.restBetween) || 0;
  return '<button class="chip-mini" data-act="sesspick" data-sf="next" data-i="' + i + '" title="Repos avant l\'exercice suivant">Suivant ' + esc(fmtShort(v)) + " ✎</button>";
}
// séance en cours : enchaîner avec l'exercice suivant (superset, biset, puis triset) ; pas pour le cardio
function linkNext(w, i, inGroup) {
  const e = w.exercises[i], n = w.exercises[i + 1];
  if (w.endedAt || !n || n.groupId || e.type === "cardio" || n.type === "cardio") return "";
  if (inGroup && w.exercises.filter(x => x.groupId === e.groupId).length >= 3) return "";
  return '<button type="button" class="link link-next" data-act="wlink" data-i="' + i + '">' + (inGroup ? "Ajouter « " + esc(n.name) + " » au groupe (triset)" : "Enchaîner avec « " + esc(n.name) + " »") + "</button>";
}
function groupCard(w, blk) {
  const first = blk.items[0].e, rounds = Math.max(...blk.items.map(x => x.e.sets.length));
  const gi = blk.items[0].i, live = !w.endedAt;
  const fk = "w:" + w.id + ":" + (first.groupId || gi), fo = folded.has(fk);
  let h = '<section class="card ex group' + (fo ? " folded" : "") + '">' + foldTitle(fk, '<span class="group-tag">' + esc(GROUP_LABEL[first.groupKind] || "Enchaînement") + " · " + rounds + " tour" + (rounds > 1 ? "s" : "") +
    (live ? "" : " · repos " + esc(fmtRest(first.rest)) + " après chaque tour") + "</span>", fo);
  if (fo) return h + '<div class="fold-members">' + blk.items.map((x, n) => '<div class="ex-name"><span class="letter">' + LETTERS[n] + "</span>" + esc(x.e.name) + "</div>").join("") + "</div></section>";
  h += '<div class="blk-body">' +
    (live ? '<div class="ex-chips"><button class="chip-mini" data-act="sesspick" data-sf="grest" data-i="' + gi + '" title="Repos après chaque tour">Repos ' + esc(fmtShort(num(first.rest) || 0)) + " ✎</button>" + nextChip(w, blk.items.map(x => x.e), gi) + "</div>" : "");
  blk.items.forEach((x, n) => { h += '<div class="member">' + exHead(w, x.e, x.i, LETTERS[n]) + "</div>"; });
  for (let k = 0; k < rounds; k++) {
    h += '<div class="round-title">Tour ' + (k + 1) + '</div><div class="sets">';
    blk.items.forEach((x, n) => { if (x.e.sets[k]) h += setRows(w, x.e, x.i, k, LETTERS[n]); });
    h += "</div>";
  }
  h += setActions(blk.items.map(x => x.i), rounds, "Tour", live ? groupDropBtn(blk) : "");
  if (live) h += '<div class="row link-row">' + linkNext(w, blk.items[blk.items.length - 1].i, true) + '<button type="button" class="link" data-act="wungroup" data-i="' + gi + '">Séparer</button></div>';
  blk.items.forEach((x, n) => { h += noteBox(w, x.e, x.i, LETTERS[n]); });
  return h + "</div></section>";
}
function viewSession(id, pane) {
  const w = getItem(id);
  if (!w) return { html: '<a class="back" href="#/home">‹ Accueil</a><div class="card empty">Séance introuvable.</div>', wide: false, active: false };
  const active = !w.endedAt;
  const wide = !pane && window.innerWidth >= WIDE;
  let h = pane ? "" : '<div class="spread"><a class="back" href="#/' + (active ? "home" : "history") + '">‹ ' + (active ? "Accueil" : "Historique") + "</a>" +
    (active ? '<button class="btn sm primary" data-act="finish">Terminer la séance</button>' : "") + "</div>";
  h += '<div class="page-head"><div><div class="muted small">' + esc(vLabel(w.variantName)) + " · " + esc(fmtDateLong(w.startedAt)) + "</div><h1>" + esc(w.templateName) + "</h1></div>" +
    '<div class="row"><span class="num" style="font-size:18px;font-weight:700" data-tick="elapsed" data-id="' + w.id + '"></span>' +
    (active ? '<button class="btn sm" data-act="cancel">Annuler</button>' : "") + "</div></div>";
  if (!active) { const tn = workoutTon(w), kc = workoutKcal(w);
    h += '<div class="sess-sum"><div class="card stat"><div class="muted small">Durée</div><div class="v num">' + fmtDurH(workoutDur(w)) + "</div></div>" +
      (w.cardio || (!tn && kc) ? '<div class="card stat"><div class="muted small">Calories</div><div class="v num">' + (kc ? fmtNum(Math.round(kc)) + " kcal" : "—") + "</div></div>" : '<div class="card stat"><div class="muted small">Tonnage</div><div class="v num">' + (tn ? fmtTon(tn) : "—") + "</div></div>") + "</div>" +
      '<div class="banner">' + (w.manual ? "Séance ajoutée après coup : note la durée et les indicateurs de chaque machine. La durée de la séance se calcule toute seule." : "Séance terminée. Tu peux encore corriger les valeurs.") + "</div>"; }
  h += wide ? sessionTable(w) : sessionCards(w);
  h += '<div class="add-row" style="margin-top:16px">' + (w.cardio ? '<button class="btn" data-act="addcardio">+ Ajouter une machine</button>' : '<button class="btn" data-act="addex">+ Ajouter un exercice</button>') + '<button class="btn" data-act="sessstretch">+ Ajouter un étirement</button></div>';
  if (active) h += '<div class="restpop" data-restpop hidden><div class="rp-box" role="timer" aria-label="Minuteur de repos"><div class="rp-label">Repos</div>' +
    '<div class="rp-time num" data-rptime>0:00</div><div class="rp-bar"><span data-rpbar></span></div>' +
    '<div class="rp-btns"><button class="rp-b" data-act="restadd" data-v="-15">−15 s</button><button class="rp-b rp-go" data-act="skiprest">Passer</button><button class="rp-b" data-act="restadd" data-v="15">+15 s</button></div>' +
    '<button class="rp-min" data-act="restmin">Réduire</button></div></div>' +
    '<button class="restpill num" data-restpill data-act="restmax" hidden></button>' +
    '<div class="restpop" data-chronopop hidden><div class="rp-box gain-box" role="timer" aria-label="Chrono de gainage"><div class="rp-label">Gainage</div><div class="rp-sub" data-cpname></div>' +
    '<div class="rp-time num" data-cptime>0:00</div><div class="rp-bar"><span data-cpbar></span></div><div class="rp-sub" data-cpgoal style="margin-top:10px"></div>' +
    '<div class="rp-btns"><button class="rp-b" data-act="chronocancel">Annuler</button><button class="rp-b rp-go" data-act="chronostop">Terminer</button></div>' +
    '<button class="rp-min" data-act="chronomin">Réduire</button></div></div>' +
    '<button class="restpill gain num" data-chronopill data-act="chronomax" hidden></button>';
  else h += '<button class="btn danger block" data-act="delworkout" style="margin-top:16px">Supprimer cette séance</button>'; // en bas de page (une barre fixe couvrait le menu du bas)
  return { html: h, wide, active };
}
function sessionCards(w) {
  return '<div class="stack">' + blocks(w.exercises).map(b => b.groupId ? groupCard(w, b) : exCard(w, b.items[0].e, b.items[0].i)).join("") + "</div>";
}
function sessionTable(w) {
  const max = Math.max(1, ...w.exercises.map(e => e.sets.length));
  let h = '<div class="table-wrap"><table class="grid"><thead><tr><th>Exercice</th><th>Séries</th><th>Reps cible</th><th>Repos</th>';
  for (let k = 0; k < max; k++) h += "<th>Série " + (k + 1) + "</th>";
  h += "<th>Notes</th></tr></thead><tbody>";
  blocks(w.exercises).forEach(b => {
    const idx = b.items.map(x => x.i);
    b.items.forEach((x, n) => {
      const e = x.e, i = x.i, time = e.type === "time", isDist = e.type === "dist", grouped = !!b.groupId, lastOfGroup = n === b.items.length - 1;
      if (e.type === "cardio" && !grouped) {
        h += '<tr><td><div class="spread" style="align-items:flex-start"><b style="font-size:15px">' + esc(e.name) + '</b><span class="ex-links"><button class="link" data-act="rename" data-i="' + i + '">Renommer</button><button class="link del" data-act="wdelex" data-i="' + i + '">Retirer</button></span></div><div class="muted small">' + esc(metaText(e, false, false)) + "</div>" +
          (e.machine && CARDIO_MACH[e.machine] ? '<button class="chip-mini" data-act="exoview" data-id="' + e.machine + '" data-arg="cardio">' + ICON.play + "Voir</button>" : "") + "</td>" +
          '<td colspan="' + (3 + max) + '">' + cardioBody(w, e, i) + "</td><td>" + noteBox(w, e, i, "") + "</td></tr>";
        return;
      }
      h += '<tr class="' + (grouped && !lastOfGroup ? "chained" : "") + '"><td>' +
        (grouped ? '<div class="gtag">' + esc(GROUP_LABEL[e.groupKind] || "Enchaînement") + " · " + LETTERS[n] + "</div>" : "") +
        '<div class="spread" style="align-items:flex-start"><b style="font-size:15px">' + esc(e.name) + '</b><span class="ex-links"><button class="link" data-act="rename" data-i="' + i + '">Renommer</button><button class="link del" data-act="wdelex" data-i="' + i + '">Retirer</button></span></div>' +
        (exLib(e) ? '<button class="chip-mini" data-act="exoview" data-id="' + exLib(e).id + '">' + ICON.play + "Voir</button>" : "") +
        (dropsOf(e) ? '<div class="muted small">Dégressif · ' + dropsOf(e) + " baisse" + (dropsOf(e) > 1 ? "s" : "") + "</div>" : "") +
        (!grouped || lastOfGroup ? setActions(grouped ? idx : [i], e.sets.length, grouped ? "Tour" : "Série", grouped ? (w.endedAt ? "" : groupDropBtn({ items: idx.map(k => ({ e: w.exercises[k], i: k })) })) : dropBtn(e, i)) : "") + "</td>" +
        "<td>" + e.sets.length + "</td><td>" + (isDist ? esc(fmtNum(num(e.target) || 0)) + " m" : time && !w.endedAt ? '<button class="chip-mini" data-act="sesspick" data-sf="target" data-i="' + i + '">' + esc(fmtSecs(num(e.target) || 0)) + " ✎</button>" : time ? esc(fmtHold(e.target) || "—") : esc(e.target || "—")) + "</td><td>" +
        (grouped && !lastOfGroup ? "enchaîné" : !w.endedAt ? '<button class="chip-mini" data-act="sesspick" data-sf="' + (grouped ? "grest" : "rest") + '" data-i="' + (grouped ? idx[0] : i) + '">' + esc(fmtSecs(num(e.rest) || 0)) + " ✎</button>" : esc(fmtRest(e.rest))) + "</td>";
      for (let k = 0; k < max; k++) {
        const s = e.sets[k];
        if (!s) { h += "<td></td>"; continue; }
        const d = s.done ? " done-row" : "";
        h += '<td><div class="cellwrap"><div class="cell' + d + '">' + inputsHtml(w, e, i, k, null, "série " + (k + 1)) + (time || isDist ? chronoBtn(w, i, k) : "") + okBtn(s, i, k) + "</div>" +
          (s.drops || []).map((y, m) => '<div class="cell drop' + d + '"><span class="dl" aria-hidden="true">↘</span>' + inputsHtml(w, e, i, k, m, "série " + (k + 1) + " baisse " + (m + 1)) + "</div>").join("") + "</div></td>";
      }
      h += "<td>" + noteBox(w, e, i, grouped ? LETTERS[n] : "") + "</td></tr>";
    });
  });
  return h + "</tbody></table></div>";
}
function currentWorkout() { const r = route(); return r.name === "session" ? getItem(r.args[0]) : r.name === "history" && isPC() ? histSel(r.args[0]) : null; }
function fillFrom(set, src, type) {
  if (!src) return;
  for (const f of type === "cardio" ? [] : type === "time" ? ["sec"] : type === "dist" ? ["sec", "kg"] : type === "rep" ? ["reps"] : ["kg", "reps"]) if ((set[f] === "" || set[f] == null) && src[f] !== "" && src[f] != null) set[f] = src[f];
}
function markDone(w, i, s) {
  const e = w.exercises[i], set = e.sets[s];
  if (!set.done) {
    // champs vides : on reprend la dernière performance (ou la série précédente)
    const lp = lastPerf(w, e);
    const src = (lp && lp.e.sets[s]) || e.sets[s - 1] || null;
    fillFrom(set, src, e.type);
    (set.drops || []).forEach((d, n) => fillFrom(d, src && src.drops && src.drops[n], e.type));
    set.done = true;
    afterSet(w, i, s);
    var rec = checkRecord(w, i, s);
  } else set.done = false;
  put("workout", w);
  render();
  if (rec) celebrate(rec);
}
// repos : après chaque série, ou seulement à la fin du tour pour un superset / biset / triset
function afterSet(w, i, s) {
  if (w.endedAt) return;
  w.lastAt = Date.now(); // heure de la dernière série validée (pour terminer une séance oubliée ouverte)
  const e = w.exercises[i];
  // toute la séance est validée : pas de repos, on félicite et on propose de terminer
  if (w.exercises.every(x => x.sets.every(st => st.done))) {
    db.live.restEnd = null; save();
    whenFree(() => congrats(w.id));
    return;
  }
  const mem = e.groupId ? w.exercises.filter(x => x.groupId === e.groupId) : [e];
  if (e.groupId && !mem.every(x => !x.sets[s] || x.sets[s].done)) return; // tour pas encore fini
  // exercice (ou superset / biset / triset) entièrement validé : repos entre exercices, s'il est réglé
  const exDone = mem.every(x => x.sets.every(st => st.done));
  const next = num(mem[mem.length - 1].restNext) || num(mem[0].restNext) || num(w.restBetween) || 0;
  if (exDone && next > 0) startRest(next, "Repos · exercice suivant");
  else startRest(mem[0].rest);
}
// attend que la fenêtre « Nouveau record » soit fermée avant d'en ouvrir une autre
function whenFree(fn) { setTimeout(() => { if (document.querySelector(".recordpop")) whenFree(fn); else fn(); }, 400); }
async function congrats(wid) {
  const w = getItem(wid); if (!w || w.endedAt) return;
  const name = firstName();
  const ok = await ask({ title: "Félicitations" + (name ? " " + name : "") + " 🥳 !", text: "Tu as validé toutes les séries de ta séance.", ok: "Terminer la séance", cancel: "Continuer" });
  if (ok) finishWorkout(getItem(wid));
}
// au lancement : une séance restée ouverte depuis plus de 5 h (oubliée) peut être terminée à l'heure de sa dernière modification
async function staleWorkout() {
  const w = activeWorkout(); if (!w || (!db.auth && db.mode !== "local") || document.querySelector("body > .modal")) return;
  if (Date.now() - w.startedAt < 5 * 3600e3) return;
  const it = db.items[w.id], last = Math.max(w.startedAt + 60000, Math.min(Date.now(), w.lastAt || (it && it.updated_at) || w.startedAt));
  const when = new Date(last), day = new Date().toDateString() === when.toDateString() ? "" : " le " + fmtDate(last);
  const c = await choose("Séance encore ouverte", [["end", "Terminer à " + fmtTime(last) + day, w.lastAt ? "L'heure de ta dernière série validée" : "L'heure de ta dernière modification"], ["go", "Continuer la séance", "Elle reste ouverte"]],
    "« " + w.templateName + " · " + vLabel(w.variantName) + " » est ouverte depuis le " + fmtDate(w.startedAt) + " à " + fmtTime(w.startedAt) + ".");
  if (c !== "end") return;
  const cur = getItem(w.id); if (!cur || cur.endedAt) return;
  flushPending(); cur.endedAt = last; put("workout", cur); db.live = {}; save(); sync();
  toast("Séance enregistrée, terminée à " + fmtTime(last)); if (route().name === "session") go("home"); else render();
}
function finishWorkout(w) {
  if (!w || w.endedAt) return;
  flushPending();
  w.endedAt = Date.now(); put("workout", w); db.live = {}; save(); sync();
  toast("Séance enregistrée"); go("home");
  if (w.free) setTimeout(() => keepFreeSession(w), 500);
}
// arrête le chrono de gainage : le temps est noté dans la série, qui est validée, puis le repos démarre
const CHRONO_PREP = 5;
// bip court du décompte de préparation (3, 2, 1) et bip plus long au départ
function prepBeep(go) {
  const a = settings().alert;
  if (a === "son" || a === "les deux") {
    const ac = audio(); if (ac) { const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
      o.type = "sine"; o.frequency.value = go ? 1320 : 880;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.45, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + (go ? 0.45 : 0.15));
      o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + (go ? 0.5 : 0.2)); }
  }
  if (go && (a === "vibration" || a === "les deux")) { try { if (Native && Native.vibrate) Native.vibrate("[250]"); else if (navigator.vibrate) navigator.vibrate(250); } catch (e) { } }
}
function stopChrono(w, at) {
  const c = db.live.chrono; if (!c || c.wid !== w.id) return;
  const t = at || Date.now();
  const set = w.exercises[c.i] && w.exercises[c.i].sets[c.s];
  db.live.chrono = null;
  if (!set) return;
  if (t < c.start) return; // arrêté pendant la préparation : rien n'est noté
  set.sec = String(Math.round((t - c.start) / 1000));
  if (w.exercises[c.i].type === "cardio") { // cardio : la durée est notée ; la machine se valide avec ✓ (après les indicateurs)
    put("workout", w); toast("Durée notée : note tes indicateurs, puis valide ✓");
    return;
  }
  set.done = true;
  afterSet(w, c.i, c.s);
  put("workout", w);
  const rec = checkRecord(w, c.i, c.s);
  if (rec) setTimeout(() => celebrate(rec), 50);
}
function startRest(sec, label) {
  sec = num(sec) || 0;
  if (sec <= 0) return;
  db.live.restEnd = Date.now() + sec * 1000; db.live.restTotal = sec * 1000; db.live.restAlerted = false; db.live.restMin = false; db.live.restLabel = label || ""; save(); setTimeout(armEdge, 0);
}

/* ================= Écran : programmes ================= */
const GRIP = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
// ---- Programmes Fiitday : séances prêtes, par niveau (débutant : moins d'un an de musculation ; intermédiaire : à partir d'un an) ----
// Musculation : 3 séances en salle + 1 à la maison (poids du corps) ; circuit training : 2 à la maison + 2 en salle.
// Exercice : [id de la bibliothèque, séries, cible (reps ou secondes ou mètres), repos (s), type si différent de la bibliothèque].
// Circuit : exercices enchaînés sans pause, « rounds » tours, « rest » secondes de repos entre les tours.
const PRESETS = {
  debutant: { label: "Débutant", sub: "Moins d'un an de musculation : tout le corps à chaque séance, des mouvements simples, surtout guidés.",
    muscu: [
      { key: "d-fba", name: "Full body A", where: "salle", note: "Machines et haltères : idéal pour apprendre les mouvements. 3 séances par semaine, avec un jour de repos entre deux.",
        ex: [["presse-cuisses", 3, "10-12", 90], ["developpe-couche-halteres", 3, "10-12", 90], ["tirage-vertical", 3, "10-12", 90], ["developpe-epaules-machine", 2, "10-12", 75], ["leg-curl-assis", 2, "12-15", 60], ["gainage", 3, "30", 45, "time"]] },
      { key: "d-fbb", name: "Full body B", where: "salle", note: "Ajoute un peu de charge dès que tu fais le haut de la fourchette de répétitions sur toutes les séries.",
        ex: [["squat-goblet", 3, "10-12", 90], ["developpe-machine", 3, "10-12", 90], ["tirage-horizontal", 3, "10-12", 90], ["hip-thrust-machine", 3, "10-12", 90], ["elevations-laterales", 2, "12-15", 60], ["curl-halteres", 2, "10-12", 60], ["crunch", 2, "15", 45]] },
      { key: "d-fbc", name: "Full body C", where: "salle", note: "Fentes et rowing : fais toutes les répétitions d'un côté, puis de l'autre.",
        ex: [["fentes", 3, "10", 90], ["developpe-incline-halteres", 3, "10-12", 90], ["rowing-haltere", 3, "10-12", 60], ["leg-extension", 2, "12-15", 60], ["extension-poulie", 2, "12-15", 60], ["face-pull", 2, "15", 60], ["releve-jambes-allonge", 2, "12", 45]] },
      { key: "d-fbm", name: "Full body maison", where: "maison", note: "Sans matériel : une chaise ou un banc suffit pour les pompes inclinées.",
        ex: [["squat-poids-du-corps", 3, "15", 60], ["pompes-inclinees", 3, "10-12", 60], ["pont-fessier", 3, "15", 45], ["superman", 3, "12", 45], ["chaise", 2, "30", 60, "time"], ["gainage", 3, "30", 45, "time"], ["planche-laterale", 2, "20", 30, "time"]] }],
    circuit: [
      { key: "d-cm1", name: "Circuit maison · cardio et jambes", where: "maison", rounds: 3, rest: 60, note: "30 secondes par exercice, enchaînés sans pause, puis 1 minute de repos avant le tour suivant.",
        work: [["jumping-jacks", "30", "time"], ["squat-poids-du-corps", "30", "time"], ["pompes-inclinees", "30", "time"], ["montees-de-genoux", "30", "time"], ["pont-fessier", "30", "time"], ["gainage", "30", "time"]] },
      { key: "d-cm2", name: "Circuit maison · haut du corps et gainage", where: "maison", rounds: 3, rest: 60, note: "Va à ton rythme : la qualité du mouvement d'abord, la vitesse ensuite.",
        work: [["talons-fesses", "30", "time"], ["pompes-inclinees", "30", "time"], ["superman", "30", "time"], ["mountain-climbers", "30", "time"], ["crunch", "30", "time"], ["chaise", "30", "time"]] },
      { key: "d-cs1", name: "Circuit salle · machines", where: "salle", rounds: 3, rest: 90, note: "Une charge légère, que tu pourrais soulever 15 fois : on enchaîne les machines.",
        work: [["presse-cuisses", "12"], ["developpe-machine", "12"], ["tirage-vertical", "12"], ["leg-curl-assis", "12"], ["developpe-epaules-machine", "12"], ["crunch-machine", "15"]] },
      { key: "d-cs2", name: "Circuit salle · haltères et kettlebell", where: "salle", rounds: 3, rest: 90, note: "Rowing et fentes : les répétitions sont par côté.",
        work: [["squat-goblet", "12"], ["rowing-haltere", "10"], ["kettlebell-swing", "15"], ["pompes", "8-10"], ["fentes", "10"], ["gainage", "30", "time"]] }] },
  intermediaire: { label: "Intermédiaire", sub: "À partir d'un an de musculation : Push, Pull, Legs, plus de séries et des charges plus lourdes.",
    muscu: [
      { key: "i-push", name: "Push · pectoraux, épaules, triceps", where: "salle", note: "Échauffe-toi avec 2 séries légères avant le développé couché.",
        ex: [["developpe-couche", 4, "6-8", 150], ["developpe-incline-halteres", 3, "8-10", 120], ["developpe-halteres-assis", 3, "8-10", 90], ["elevations-laterales", 3, "12-15", 60], ["ecarte-poulie", 3, "12-15", 60], ["extension-poulie", 3, "10-12", 60], ["extension-triceps-poulie-nuque", 2, "12", 60]] },
      { key: "i-pull", name: "Pull · dos, biceps", where: "salle", note: "Tractions : ajoute du poids quand tu dépasses 10 répétitions, ou aide-toi d'un élastique si besoin.",
        ex: [["tractions", 4, "6-10", 120], ["rowing-barre", 4, "8-10", 120], ["tirage-horizontal", 3, "10-12", 90], ["face-pull", 3, "15", 60], ["curl-barre", 3, "8-10", 75], ["curl-marteau", 3, "10-12", 60]] },
      { key: "i-legs", name: "Legs · jambes, fessiers", where: "salle", note: "Squat et soulevé de terre roumain : dos neutre, charge maîtrisée avant d'augmenter.",
        ex: [["squat", 4, "6-8", 150], ["souleve-roumain", 3, "8-10", 120], ["presse-cuisses", 3, "10-12", 90], ["leg-curl-assis", 3, "10-12", 60], ["mollets-debout", 4, "12-15", 60], ["releve-jambes-suspendu", 3, "10-12", 60]] },
      { key: "i-fbm", name: "Full body maison", where: "maison", note: "Sans matériel : descends lentement (3 secondes) pour rendre chaque répétition plus difficile.",
        ex: [["pompes-declinees", 4, "10-15", 75], ["squat-poids-du-corps", 4, "20", 60], ["pompes-diamant", 3, "8-12", 60], ["pont-fessier", 4, "20", 45], ["superman", 3, "15", 45], ["releve-jambes-allonge", 3, "15", 45], ["planche-laterale", 3, "30", 30, "time"], ["chaise", 3, "45", 60, "time"]] }],
    circuit: [
      { key: "i-cm1", name: "Circuit maison · HIIT", where: "maison", rounds: 4, rest: 60, note: "40 secondes par exercice, enchaînés sans pause, puis 1 minute de repos entre les tours.",
        work: [["burpees", "40", "time"], ["squat-saute", "40", "time"], ["pompes", "40", "time"], ["mountain-climbers", "40", "time"], ["fentes-sautees", "40", "time"], ["gainage", "40", "time"]] },
      { key: "i-cm2", name: "Circuit maison · gainage et cardio", where: "maison", rounds: 4, rest: 60, note: "Garde le dos plat sur les exercices au sol.",
        work: [["jumping-jacks", "40", "time"], ["pompes-diamant", "40", "time"], ["crunch-velo", "40", "time"], ["talons-fesses", "40", "time"], ["russian-twist", "40", "time"], ["superman", "40", "time"], ["battements-jambes", "40", "time"]] },
      { key: "i-cs1", name: "Circuit salle · force et cardio", where: "salle", rounds: 4, rest: 90, note: "Choisis des charges moyennes : tu dois tenir les 4 tours sans casser la technique.",
        work: [["kettlebell-swing", "15"], ["wall-balls", "15"], ["rameur", "250", "dist"], ["burpees", "10"], ["developpe-militaire-halteres", "10"], ["fentes", "10"]] },
      { key: "i-cs2", name: "Circuit salle · type Hyrox", where: "salle", rounds: 3, rest: 120, note: "Les ateliers de l'Hyrox, en version courte : régulier plutôt que rapide.",
        work: [["skierg", "250", "dist"], ["sled-push", "25", "dist"], ["farmers-carry", "50", "dist"], ["wall-balls", "15"], ["burpees-sautes", "20", "dist"], ["fentes-sandbag", "20", "dist"]] }] }
};
let progLevel = "debutant";
const presetLib = id => EXO_LIB.find(x => x.id === id);
const presetByKey = k => { for (const lv of Object.values(PRESETS)) for (const s of lv.muscu.concat(lv.circuit)) if (s.key === k) return s; return null; };
// exercices de la séance, prêts à entrer dans un programme (mêmes réglages que si tu les ajoutais toi-même)
function presetExercises(s) {
  const mk = (id, sets, target, rest, type) => { const lib = presetLib(id) || { id, n: id }; const d = libDefaults(lib);
    return Object.assign(newExercise(), { name: lib.n, lib: lib.id }, d, { type: type || d.type, sets, target: String(target), rest, load: type === "dist" || d.type === "dist" ? !!lib.load : !!d.load }); };
  if (s.work) { const gid = "g-" + uid(); return s.work.map(([id, target, type]) => Object.assign(mk(id, s.rounds, target, s.rest, type), { groupId: gid, groupKind: "circuit" })); }
  return s.ex.map(([id, sets, target, rest, type]) => mk(id, sets, target, rest, type));
}
// durée estimée : environ 40 s par série de répétitions, le temps prévu pour le gainage, 1 s pour 4 m de distance
function presetMinutes(s) {
  const work = (target, type, id) => type === "time" ? +target : type === "dist" ? Math.max(30, +target / 4) : 40;
  if (s.work) { const lap = s.work.reduce((t, [id, target, type]) => t + work(target, type, id) + 10, 0); return Math.round((s.rounds * lap + (s.rounds - 1) * s.rest) / 60 / 5) * 5 || 5; }
  const t = s.ex.reduce((sum, [id, sets, target, rest, type]) => sum + sets * (work(target, type || (presetLib(id) && presetLib(id).kind === "time" ? "time" : ""), id) + rest), 0);
  return Math.round(t / 60 / 5) * 5 || 5;
}
const presetDose = (target, type, id) => { const lib = presetLib(id) || {}; const side = /par (bras|jambe|côté)/.test(lib.reps || "") || ["fentes", "rowing-haltere"].includes(id);
  return type === "time" ? fmtSecs(+target) : type === "dist" ? fmtDist(+target, "m") : target + (side ? " par côté" : "") + " reps"; };
function presetCard(s) {
  const n = s.work ? s.work.length : s.ex.length;
  const rows = s.work ? s.work.map(([id, target, type]) => [id, presetDose(target, type || (presetLib(id) && presetLib(id).kind === "time" ? "time" : ""), id)])
    : s.ex.map(([id, sets, target, rest, type]) => [id, sets + " × " + presetDose(target, type || (presetLib(id) && presetLib(id).kind === "time" ? "time" : ""), id) + " · repos " + fmtRest(rest)]);
  return '<div class="card preset"><div class="spread"><b>' + esc(s.name) + '</b><span class="tag">' + (s.where === "maison" ? "Maison" : "Salle") + "</span></div>" +
    '<div class="small muted">' + (s.work ? s.rounds + " tours de " + n + " exercices · repos " + fmtRest(s.rest) + " entre les tours" : n + " exercices") + " · environ " + presetMinutes(s) + " min</div>" +
    '<p class="small preset-note">' + esc(s.note) + "</p>" +
    '<details class="preset-list"><summary class="small">Voir les exercices</summary><ol>' + rows.map(([id, dose]) => '<li><button type="button" class="link" data-act="exoview" data-id="' + esc(id) + '">' + esc((presetLib(id) || { n: id }).n) + '</button> <span class="muted">· ' + esc(dose) + "</span></li>").join("") + "</ol></details>" +
    '<button class="btn sm primary" data-act="presetadd" data-k="' + s.key + '">Ajouter à mes programmes</button></div>';
}
function viewPrograms() {
  // programmes Fiitday prêts à l'emploi (musculation, circuit training) ; tes propres programmes se gèrent depuis l'accueil
  const head = '<div class="page-head"><div><h1>Programmes Fiitday</h1><div class="muted small">Des séances prêtes, à ajouter à tes programmes</div></div></div>';
  if (isFree()) return head + planCard("Les programmes Fiitday (musculation et circuit training) sont réservés aux abonnés Premium. Tes propres programmes restent sur l'accueil.");
  const lv = PRESETS[progLevel] || PRESETS.debutant;
  const block = (cat, title, list) => '<div class="spread preset-head"><div class="section-title">' + title + '</div><button class="btn sm" data-act="presetall" data-cat="' + cat + '">Tout ajouter (' + list.length + " séances)</button></div>" +
    ["salle", "maison"].filter(w => list.some(s => s.where === w)).map(w => '<div class="small muted preset-where">' + (w === "salle" ? "En salle" : "À la maison, sans matériel") + '</div><div class="presets">' + list.filter(s => s.where === w).map(presetCard).join("") + "</div>").join("");
  return head + '<div class="seg prog-level" role="group" aria-label="Niveau">' + Object.entries(PRESETS).map(([k, x]) => '<button class="' + (k === progLevel ? "on" : "") + '" aria-pressed="' + (k === progLevel) + '" data-act="proglevel" data-val="' + k + '">' + x.label + "</button>").join("") + "</div>" +
    '<p class="small muted" style="margin:8px 2px 0">' + esc(lv.sub) + "</p>" +
    block("muscu", "Musculation", lv.muscu) + block("circuit", "Circuit training", lv.circuit) +
    '<p class="muted small" style="margin-top:14px">Durées indiquées sans l\'échauffement (5 à 10 minutes). Une fois ajoutée, une séance est à toi : change les exercices, les séries ou les charges depuis l\'<a href="#/home">Accueil</a>.</p>';
}
// ajoute une ou plusieurs séances prêtes dans un nouveau programme ou dans un programme existant
async function addPresets(list, defName) {
  const ts = templates().filter(t => !progLocked(t.id));
  const opts = [["new", "Nouveau programme", "« " + defName + " »"]].concat(ts.map(t => ["t:" + t.id, "Ajouter à « " + t.name + " »", t.variants.length + " séance" + (t.variants.length > 1 ? "s" : "") + " aujourd'hui"]));
  const dest = await choose(list.length > 1 ? "Ajouter les " + list.length + " séances" : "Ajouter « " + list[0].name + " »", opts); if (!dest) return;
  let t;
  if (dest === "new") {
    const n = await ask({ title: "Nom du programme", input: defName, ok: "Créer" }); if (!n) return;
    t = { id: "tpl-" + uid(), name: n.slice(0, 60), order: templates().length, variants: [] };
  } else { t = getItem(dest.slice(2)); if (!t) return; }
  list.forEach(s => t.variants.push({ id: "v" + uid(), name: s.name.slice(0, 60), exercises: presetExercises(s) }));
  put("template", t); render();
  toast(list.length > 1 ? list.length + " séances ajoutées à « " + t.name + " »" : "« " + list[0].name + " » ajoutée à « " + t.name + " »");
}
function exFields(e, k, letter, inGroup) {
  const time = e.type === "time", dist = e.type === "dist", rep = e.type === "rep", cardio = e.type === "cardio", d = dropsOf(e);
  return (inGroup ? '<div class="spread cfg-head"><b><span class="letter">' + letter + '</span><span data-title="' + k + '">' + esc(e.name) + '</span></b><span class="cfg-acts"><button class="link" data-act="cfgrename" data-e="' + k + '">Renommer</button><button class="btn sm danger" data-act="delex" data-e="' + k + '">Retirer</button></span></div>' : "") +
    '<div class="ed-grid">' +
    (exLib(e) ? '<div class="full" data-exolink="' + k + '"><button type="button" class="chip-mini" data-act="exoview" data-id="' + exLib(e).id + '">' + ICON.play + "Voir le mouvement</button></div>" : '<div class="full" data-exolink="' + k + '" hidden></div>') +
    '<label class="fl">Type<select class="f" data-p="type" data-e="' + k + '"><option value="reps"' + (!time && !dist && !rep ? " selected" : "") + '>Poids × reps</option><option value="rep"' + (rep ? " selected" : "") + '>Reps uniquement</option><option value="time"' + (time ? " selected" : "") + '>Temps (gainage)</option><option value="dist"' + (dist ? " selected" : "") + '>Distance (course, Hyrox)</option><option value="cardio"' + (cardio ? " selected" : "") + ">Cardio</option></select></label>" +
    (cardio ? '<div class="fl"><span>Durée cible</span><button type="button" class="f pick" data-act="picksec" data-sf="ctarget" data-e="' + k + '">' + (num(e.target) ? fmtNum(num(e.target)) + " min" : "Aucune") + "</button></div>" +
      '<div class="fl full cv-info" data-cvinfo="' + k + '"><span>Indicateurs notés</span><span class="small muted">Durée, ' + esc(cardioShown(e).map(x => x.n.toLowerCase()).join(", ")) + ". Tu peux en ajouter pendant la séance.</span></div>" : "") +
    (inGroup || cardio ? "" : '<div class="fl"><span>Séries</span><button type="button" class="f pick" data-act="picksec" data-sf="sets" data-e="' + k + '">' + (num(e.sets) || 1) + "</button></div>") +
    (cardio ? "" : dist ? '<div class="fl"><span>Distance</span><button type="button" class="f pick" data-act="picksec" data-sf="dtarget" data-e="' + k + '">' + fmtDist(num(e.target) || 1000, "m") + "</button></div>" +
      '<label class="fl">Charge<select class="f" data-p="load" data-e="' + k + '"><option value="0"' + (!e.load ? " selected" : "") + '>Sans charge</option><option value="1"' + (e.load ? " selected" : "") + ">Avec charge (kg)</option></select></label>"
    : time ? '<div class="fl"><span>Temps cible</span><button type="button" class="f pick" data-act="picksec" data-sf="target" data-e="' + k + '">' + fmtSecs(num(e.target) || 0) + "</button></div>"
      : '<div class="fl"><span>Reps cible</span><button type="button" class="f pick" data-act="picksec" data-sf="reps" data-e="' + k + '">' + esc(String(e.target || "8-10").replace("-", " à ")) + "</button></div>") +
    (inGroup || cardio ? "" : '<div class="fl"><span>Repos</span><button type="button" class="f pick" data-act="picksec" data-sf="rest" data-e="' + k + '">' + fmtSecs(num(e.rest) || 0) + "</button></div>") +
    (time || dist || rep || cardio ? "" : '<label class="fl">Dégressif<select class="f" data-p="drops" data-e="' + k + '">' + [0, 1, 2, 3].map(n => '<option value="' + n + '"' + (d === n ? " selected" : "") + ">" + (n ? "Oui · " + n + " baisse" + (n > 1 ? "s" : "") : "Non") + "</option>").join("") + "</select></label>") +
    (time || dist || rep || cardio || !d ? "" : '<label class="fl">Dégressif sur<select class="f" data-p="dscope" data-e="' + k + '"><option value="all"' + (e.dropScope !== "last" ? " selected" : "") + '>Toutes les séries</option><option value="last"' + (e.dropScope === "last" ? " selected" : "") + ">La dernière série</option></select></label>") +
    '<label class="fl full">Notes<textarea class="f" data-p="note" data-e="' + k + '" maxlength="' + NOTE_MAX + '" placeholder="Réglages de la machine, consignes…">' + esc(e.note) + "</textarea></label></div>";
}
function viewProgram(tid, vid) {
  const t = getItem(tid);
  if (!t) return '<a class="back" href="#/home">‹ Accueil</a><div class="card empty">Programme introuvable.</div>';
  const v = t.variants.find(x => x.id === vid) || t.variants[0];
  if (v ? varLocked(t.id, v.id) : progLocked(t.id)) return viewLockedProgram(t, v);
  const launch = v ? '<button class="btn sm primary" data-act="launchvar" data-t="' + t.id + '" data-v="' + v.id + '">Lancer ' + esc(launchLabel(v)) + "</button>" : "";
  let h = '<h1 class="sr">Programme « ' + esc(t.name) + " »</h1>" + '<div class="spread"><a class="back" href="#/home">‹ Accueil</a>' + launch + "</div>" +
    '<label class="fl" style="margin-top:8px">Nom du programme<input class="f" data-p="tname" maxlength="60" value="' + esc(t.name) + '" style="font-size:20px;font-weight:700"></label>' +
    '<div class="section-title">Séances</div>';
  const delTpl = '<div style="margin-top:32px"><button class="btn danger" data-act="deltpl">Supprimer le programme « ' + esc(t.name) + " »</button></div>";
  if (!t.variants.length) return h + '<div class="card empty-prog"><p class="muted">Ce programme n\'a pas encore de séance. Ajoute la première, puis ses exercices.</p>' +
    '<button class="btn primary block" data-act="addvar">+ Nouvelle séance</button></div>' + delTpl;
  h += '<div class="tabs" data-sortable="var" data-axis="x">' +
    t.variants.map(x => '<button class="' + (v && x.id === v.id ? "on" : "") + '" data-act="tab" data-v="' + x.id + '" data-sort-id="' + x.id + '">' +
      (t.variants.length > 1 ? '<span class="grip" data-drag title="Maintiens et fais glisser pour changer l\'ordre">' + GRIP + "</span>" : "") +
      (varLocked(t.id, x.id) ? LOCK : "") + "<span" + (v && x.id === v.id ? " data-vtab" : "") + ">" + esc(vLabel(x.name)) + "</span></button>").join("") +
    '<button data-act="addvar">+ Séance</button></div>';
  if (!v) return h;
  h += '<div class="card"><label class="fl">Nom de la séance<input class="f" data-p="vname" maxlength="60" value="' + esc(vLabel(v.name)) + '"></label>' +
    '<div class="row" style="margin-top:10px;flex-wrap:wrap">' +
    '<button class="btn sm" data-act="dupvar">Dupliquer</button><button class="btn sm" data-act="sharevar">Partager</button>' +
    '<button class="btn sm danger" data-act="delvar">Supprimer cette séance</button>' + "</div></div>";
  const allKeys = blocks(v.exercises).map(b => "t:" + (b.groupId || b.items[0].e.id)), allFolded = allKeys.length && allKeys.every(k => folded.has(k));
  h += '<div class="spread ex-title-row"><div class="section-title">Exercices (' + v.exercises.length + ")</div>" + (allKeys.length > 1 ? '<button type="button" class="link small" data-act="foldall" data-v="' + (allFolded ? 0 : 1) + '">' + (allFolded ? "Tout déplier" : "Tout réduire") + "</button>" : "") + '</div><div class="stack" data-sortable="blk">';
  const grip = allKeys.length > 1 ? '<span class="grip" data-drag title="Maintiens et fais glisser pour changer l\'ordre">' + GRIP + "</span>" : "";
  const bl = blocks(v.exercises);
  bl.forEach((blk, bi) => {
    const nextField = bi < bl.length - 1 ? '<div class="fl next-rest"><span>Repos avant l\'exercice suivant</span><button type="button" class="f pick" data-act="picksec" data-sf="next" data-e="' + blk.items[0].i + '">' + fmtSecs(restNextOf(blk.items[0].e, v)) + "</button>" +
      '<span class="small">Démarre quand toutes les séries ' + (blk.groupId ? "du groupe" : "de cet exercice") + " sont validées. « Aucun » : le repos habituel.</span></div>" : "";

    if (blk.groupId) {
      const f = blk.items[0].e, fi = blk.items[0].i, label = GROUP_LABEL[f.groupKind] || "Enchaînement";
      const k = "t:" + blk.groupId, fo = folded.has(k);
      h += '<div class="card group' + (fo ? " folded" : "") + '" data-sort-id="' + esc(k) + '"><div class="spread">' + grip + foldTitle(k, '<span class="group-tag">' + esc(label) + " · " + blk.items.length + " exercices enchaînés</span>", fo) + '<div class="row">' + "</div></div>";
      if (fo) { h += '<div class="fold-sum muted small">' + blk.items.map((y, n) => LETTERS[n] + ". " + esc(y.e.name)).join(" · ") + " — " + esc(f.sets) + " tours</div></div>"; return; }
      h += '<div class="blk-body">' +
        '<div class="ed-grid"><label class="fl">Enchaînement<select class="f" data-p="gkind" data-e="' + fi + '">' +
        (blk.items.length >= 3 ? '<option value="triset" selected>Triset</option>' : '<option value="superset"' + (f.groupKind !== "biset" ? " selected" : "") + '>Superset</option><option value="biset"' + (f.groupKind === "biset" ? " selected" : "") + ">Biset</option>") + "</select></label>" +
        '<div class="fl"><span>Tours (séries)</span><button type="button" class="f pick" data-act="picksec" data-sf="gsets" data-e="' + fi + '">' + (num(f.sets) || 1) + "</button></div>" +
        '<div class="fl"><span>Repos</span><button type="button" class="f pick" data-act="picksec" data-sf="grest" data-e="' + fi + '">' + fmtSecs(num(f.rest) || 0) + "</button></div></div>";
      blk.items.forEach((x, n) => { h += '<div class="member">' + exFields(x.e, x.i, LETTERS[n], true) + "</div>"; });
      h += nextField;
      h += '<div class="row" style="margin-top:12px;flex-wrap:wrap">' + (blk.items.length < 4 ? '<button class="btn sm" data-act="addmember" data-e="' + fi + '">+ Ajouter un exercice au ' + esc(label.toLowerCase()) + "</button>" : "") +
        '<button class="btn sm" data-act="ungroup" data-e="' + fi + '">Séparer</button><button class="btn sm danger" data-act="delgroup" data-e="' + fi + '">Supprimer</button></div></div></div>';
    } else {
      const x = blk.items[0];
      const k = "t:" + x.e.id, f = folded.has(k);
      h += '<div class="card' + (f ? " folded" : "") + '" data-sort-id="' + esc(k) + '"><div class="spread cfg-head">' + grip + foldTitle(k, '<b><span data-title="' + x.i + '">' + esc(x.e.name) + "</span></b>", f) + '<div class="row">' +
        '<button class="link" data-act="cfgrename" data-e="' + x.i + '">Renommer</button><button class="btn sm danger" data-act="delex" data-e="' + x.i + '">Supprimer</button></div></div>' + (f ? '<div class="fold-sum muted small">' + esc(tplLine(x.e)) + "</div>" : '<div class="blk-body">' + exFields(x.e, x.i, "", false) + nextField +
        (bi < bl.length - 1 && !bl[bi + 1].groupId ? '<button class="link" style="margin-top:6px" data-act="link" data-b="' + bi + '">Enchaîner avec l\'exercice suivant (superset / biset)</button>' : "") + "</div>") + "</div>";
    }
  });
  h += '<div class="add-row"><button class="btn" data-act="addtplex">+ Ajouter un exercice</button><button class="btn" data-act="addstretch">+ Ajouter un étirement</button></div></div>' + delTpl;
  return h;
}
// blocs réduits (configuration d'une séance et séance en cours) : un appui sur le nom réduit / déplie le bloc
const folded = new Set();
const foldTitle = (k, inner, f) => '<button type="button" class="fold-t" data-act="fold" data-k="' + esc(k) + '" aria-expanded="' + !f + '" title="' + (f ? "Déplier" : "Réduire") + '">' + inner + '<span class="fold-i" aria-hidden="true">' + (f ? "▸" : "▾") + "</span></button>";
const ADD_CHOICES = [
  ["simple", "Exercice simple", "Séries classiques avec repos entre chaque série"],
  ["degressif", "Dégressif", "Après la série, tu baisses la charge et tu continues sans repos"],
  ["superset", "Superset", "2 exercices enchaînés sans repos (souvent des muscles opposés)"],
  ["biset", "Biset", "2 exercices enchaînés sans repos pour le même muscle"],
  ["triset", "Triset", "3 exercices enchaînés sans repos"],
];
function choose(title, opts, text, foot) {
  return new Promise(res => {
    const d = document.createElement("div"); d.className = "modal";
    d.innerHTML = '<div class="modal-box" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><h3>' + esc(frNb(title)) + "</h3>" + (text ? '<p class="small muted" style="margin:0">' + esc(frNb(text)) + "</p>" : "") + '<div class="stack" style="gap:8px">' +
      opts.map(o => '<button class="btn block choice" data-c="' + o[0] + '"><b>' + esc(frNb(o[1])) + "</b>" + (o[2] ? '<span class="choice-desc">' + esc(frNb(o[2])) + "</span>" : "") + "</button>").join("") +
      "</div>" + (foot || "") + '<div class="modal-btns"><button class="btn" data-c="">Annuler</button></div></div>';
    document.body.appendChild(d);
    d.addEventListener("click", e => {
      if (e.target === d) { d.remove(); res(null); return; }
      const b = e.target.closest("[data-c]"); if (b) { d.remove(); res(b.dataset.c || null); }
    });
  });
}
// choix d'un ou plusieurs exercices (ou étirements) de la bibliothèque : recherche, filtres, cases à cocher ;
// en musculation, aussi tes propres exercices et un exercice à créer avec le nom tapé
const PK_GROUPS = [["", "Tous"], ["pectoraux", "Pectoraux"], ["dos", "Dos"], ["epaules", "Épaules"], ["bras", "Bras"], ["jambes", "Jambes"], ["abdos", "Abdos"], ["machines", "Cardio"], ["cardio", "Circuit Training"], ["hyrox", "Hyrox"], ["maison", "Sans matériel"], ["own", "Mes exercices"]];
const TYPE_CHOICES = [["reps", "Poids × reps", "Charge et nombre de répétitions"], ["rep", "Reps uniquement", "Pompes, tractions… sans charge"], ["time", "Temps", "Gainage, chaise… avec chrono"], ["dist", "Distance", "Course, rameur, Hyrox… avec chrono"], ["cardio", "Cardio", "Machine ou activité cardio : durée et indicateurs (distance, calories…)"]];
const cardioPickLib = () => cardioMachines().map(x => x.cat === "cardio" ? x : Object.assign({}, x, { id: "c:" + x.id, g: "machines", cardioOf: x.id }));
function pickExercises(mode, title) {
  const etir = mode === "etir", cdo = mode === "cardio";
  return new Promise(res => {
    const lib = cdo ? cardioPickLib() : EXO_LIB.filter(x => etir ? x.cat === "etirement" : x.cat !== "etirement").concat(etir ? [] : cardioPickLib().filter(x => x.cardioOf));
    const own = etir || cdo ? [] : ownNames().map(n => ({ id: "own:" + n, n, own: true, nn: norm(n) }));
    const byKey = new Map(); lib.forEach(x => byKey.set(x.id, x)); own.forEach(x => byKey.set(x.id, x));
    const stretchKey = new Map(); if (!etir && !cdo) EXO_LIB.filter(x => x.cat === "etirement").forEach(x => stretchKey.set(x.id, x)); // trouvés aussi par la recherche
    const picked = [], created = new Map(); // clés dans l'ordre où elles sont cochées ; exercices créés (nom tapé)
    let filt = "", q = "";
    const chips = cdo ? [] : etir ? [["", "Tous"], ["haut", "Haut"], ["milieu", "Milieu"], ["bas", "Bas"]] : PK_GROUPS.filter(g => g[0] !== "own" || own.length);
    const inFilt = x => !filt || (etir ? x.zone === filt : filt === "own" ? !!x.own : filt === "maison" ? /^Poids du corps/.test(x.gear || "") : !x.own && x.g === filt);
    const sub = x => x.own ? "Mes exercices" : x.g === "machines" ? "Cardio · " + cardioInfo(x.cardioOf || x.id).slice(0, 3).map(t => t.replace(/ \(.*\)$/, "").toLowerCase()).join(", ") + "…" : etir || x.cat === "etirement" ? (etir ? "" : "Étirement · ") + x.mus + " · " + x.hold + " s" + (x.side ? " de chaque côté" : "") : x.mus + " · " + x.gear;
    const row = (key, name, s, cls) => '<label class="pk-row' + (cls || "") + '"><input type="checkbox" data-pk="' + esc(key) + '"' + (picked.includes(key) ? " checked" : "") + "><span><b>" + esc(name) + '</b><span class="muted small">' + esc(s) + "</span></span></label>";
    const what = etir ? "étirement" : cdo ? "machine" : "exercice";
    const listHtml = () => {
      let h = "";
      created.forEach((c, key) => { h += row(key, c.n, "Ton exercice (réglages modifiables ensuite)", " pk-new"); });
      const qt = q.trim();
      if (qt) {
        const exists = libFor(qt) || own.some(o => o.nn === norm(qt)) || created.has("new:" + qt.slice(0, 80));
        const found = searchExercises(qt), v = found.map(c => byKey.get(c.own ? "own:" + c.n : c.id) || (cdo ? byKey.get("c:" + c.id) : null)).filter(x => x && inFilt(x));
        if (!filt) found.forEach(c => { const x = !c.own && stretchKey.get(c.id); if (x) v.push(x); }); // étirements : après les exercices
        // « Créer » : en premier si rien ne correspond, sinon après les exercices trouvés
        const full = !etir && !exists && isFree() && ownCount() + created.size >= FREE_OWN; // version gratuite : 5 exercices perso au plus
        const mk = !etir && !exists && !full ? row("new:" + qt.slice(0, 80), "+ Créer « " + qt.slice(0, 80) + " »", cdo ? "Ton activité cardio, si elle n'est pas dans la liste" : "Ton propre exercice, s'il n'est pas dans la liste", " pk-new")
          : full ? '<div class="pk-row pk-lock">' + LOCK + "<span><b>" + FREE_OWN + ' exercices perso au plus en version gratuite</b><span class="muted small">Avec Premium, tu peux créer « ' + esc(qt.slice(0, 80)) + " » et tous les exercices que tu veux.</span></span></div>" : "";
        return h + (v.length ? v.map(x => row(x.id, x.n, sub(x))).join("") + mk : mk + '<p class="muted small" style="margin:8px 2px">Aucun ' + what + " de la liste ne correspond." + (mk && !full ? " Coche « Créer » pour ajouter le tien." : "") + "</p>");
      }
      const v = lib.concat(own).filter(inFilt);
      const secs = cdo ? [["Machines de cardio", v]] : etir ? ["haut", "milieu", "bas"].map(z => [ZONE_NAMES[z], v.filter(x => x.zone === z)])
        : PK_GROUPS.filter(g => g[0] && g[0] !== "maison").map(([g, n]) => [n, v.filter(x => g === "own" ? x.own : !x.own && x.g === g)]);
      return h + secs.filter(s => s[1].length).map(([n, it]) => '<div class="pk-h">' + esc(n) + "</div>" + it.map(x => row(x.id, x.n, sub(x))).join("")).join("");
    };
    const okLabel = () => picked.length ? "Ajouter (" + picked.length + ")" : "Ajouter";
    const d = document.createElement("div"); d.className = "modal sheet";
    d.innerHTML = '<div class="modal-box pk" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><h3>' + esc(title) + "</h3>" +
      '<p class="muted small" style="margin:0 0 8px">' + (cdo ? "Coche une ou plusieurs machines, dans l'ordre où tu les fais. Pas dans la liste ? Tape son nom pour la créer." : (etir ? "Chaque étirement est ajouté en mode temps : 2 séries de 30 s. " : "") + "Coche-les, puis choisis leur ordre dans la séance.") + "</p>" +
      '<input class="f" type="search" data-pkq placeholder="' + (etir ? "Rechercher un étirement, un muscle" : cdo ? "Rechercher (ex. vélo, tapis, rameur)" : "Rechercher (ex. dev, pec, rowing)") + '" autocomplete="off" aria-label="Rechercher un ' + what + '">' +
      (chips.length ? '<div class="pk-zones" role="group" aria-label="Filtrer">' + chips.map(z => '<button type="button" class="chip-btn" data-pkz="' + z[0] + '" aria-pressed="' + (z[0] === filt) + '">' + z[1] + "</button>").join("") + "</div>" : "") +
      '<div class="pk-list">' + listHtml() + '</div><div class="modal-btns"><button class="btn" data-r="0">Annuler</button><button class="btn primary" data-r="1">' + okLabel() + "</button></div></div>";
    document.body.appendChild(d);
    const box = d.querySelector(".pk-list"), ok = d.querySelector('[data-r="1"]'), qin = d.querySelector("[data-pkq]");
    qin.addEventListener("input", e => { q = e.target.value; box.innerHTML = listHtml(); });
    qin.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); qin.blur(); } });
    d.addEventListener("change", e => {
      const key = e.target.dataset && e.target.dataset.pk; if (!key) return;
      if (e.target.checked) { if (key.startsWith("new:")) created.set(key, { n: key.slice(4) }); if (!picked.includes(key)) picked.push(key); }
      else { const k = picked.indexOf(key); if (k >= 0) picked.splice(k, 1); if (key.startsWith("new:")) created.delete(key); }
      if (key.startsWith("new:")) box.innerHTML = listHtml(); // l'exercice créé passe en haut de la liste
      ok.textContent = okLabel();
    });
    d.addEventListener("click", e => {
      if (e.target === d) { d.remove(); res(null); return; }
      const z = e.target.closest("[data-pkz]"); if (z) { filt = z.dataset.pkz; d.querySelectorAll("[data-pkz]").forEach(x => x.setAttribute("aria-pressed", String(x === z))); box.innerHTML = listHtml(); box.scrollTop = 0; return; }
      const b = e.target.closest("[data-r]"); if (!b) return;
      if (b.dataset.r === "1" && !picked.length) { ok.textContent = "Coche au moins un " + what; return; }
      d.remove();
      const get = k => byKey.get(k) || stretchKey.get(k);
      res(b.dataset.r === "1" ? picked.map(k => k.startsWith("new:") ? { name: created.get(k).n, custom: true } : get(k).own ? { name: get(k).n, own: true } : { lib: get(k), name: get(k).n }) : null);
    });
  });
}
const stretchExercise = x => Object.assign(newExercise(), { name: x.n, lib: x.id }, libDefaults(x));
// réglages d'un exercice choisi : ceux de la bibliothèque, sinon ceux que tu utilises déjà pour ce nom dans tes programmes
const typeDefaults = (type, load) => type === "cardio" ? { type, sets: 1, target: "", rest: 0, machine: "" } : type === "time" ? { type, target: "45", rest: 60 } : type === "dist" ? { type, target: "1000", rest: 120, load: !!load } : { type, target: "8-10", rest: 90 };
function ownDefaults(name) {
  const nn = norm(name);
  for (const t of all("template")) for (const v of t.variants) for (const e of v.exercises) if (norm(e.name) === nn && !exLib(e))
    return { type: e.type || "reps", sets: e.sets, target: e.target, rest: e.rest, load: !!e.load };
  const r = ownEntry(name); if (r) return typeDefaults(r.t || "reps", !!r.load);
  const w = all("workout").filter(x => x.exercises.some(e => !exLib(e) && norm(e.name) === nn)).sort((a, b) => b.startedAt - a.startedAt)[0]; // seulement dans l'historique
  if (w) { const e = w.exercises.find(e => !exLib(e) && norm(e.name) === nn); return { type: e.type || "reps", sets: e.sets.length || undefined, target: e.target, rest: e.rest, load: !!e.load }; }
  return null;
}
function libExercise(p) {
  if (p.lib && (p.lib.cardioOf || p.lib.cat === "cardio")) return Object.assign(newExercise(), { name: p.lib.n, lib: p.lib.cardioOf || p.lib.id }, libDefaults(p.lib));
  if (p.lib) return Object.assign(p.lib.cat === "etirement" ? stretchExercise(p.lib) : Object.assign(newExercise(), { name: p.lib.n }, libDefaults(p.lib)), { lib: p.lib.id });
  if (p.lib) return p.lib.cat === "etirement" ? stretchExercise(p.lib) : Object.assign(newExercise(), { name: p.lib.n }, libDefaults(p.lib));
  return Object.assign(newExercise(), { name: String(p.name).slice(0, 80) }, ownDefaults(p.name) || {});
}
// ordre dans la séance après un ajout : les nouveaux arrivent à la fin, on les place où on veut (⠿ à faire glisser, ou ↑ ↓) ;
// un superset / biset / triset se déplace en entier ; renvoie la nouvelle liste (ou null si « Annuler »)
function orderNew(list, news, what) {
  return new Promise(res => {
    const bl = blocks(list);
    if (!bl.length && news.length < 2) { res(list.concat(news)); return; }
    const rows = bl.map((b, bi) => ({ key: "b" + bi, n: b.groupId ? (GROUP_LABEL[b.kind] || "Groupe") + " : " + b.items.map(x => x.e.name).join(" + ") : b.items[0].e.name }))
      .concat(news.map((e, k) => ({ key: "n" + k, n: e.name, isNew: true })));
    const d = document.createElement("div"); d.className = "modal sheet";
    d.innerHTML = '<div class="modal-box ord" role="dialog" aria-modal="true" aria-label="Ordre dans la séance"><h3>Ordre dans la séance</h3>' +
      '<p class="muted small" style="margin:0">' + (news.length > 1 ? "Tes " + what + "s sont" : "Ton " + what + " est") + " à la fin. Fais glisser ⠿, ou utilise ↑ ↓, pour choisir l'ordre.</p>" +
      '<div class="ord-list">' + rows.map(r => '<div class="ord-row' + (r.isNew ? " new" : "") + '" data-key="' + r.key + '"><span class="grip" data-odrag title="Maintiens et fais glisser">' + GRIP + '</span><span class="ord-n">' + esc(r.n) + (r.isNew ? ' <span class="tag">Nouveau</span>' : "") + "</span>" +
        '<button type="button" class="btn sm" data-om="-1" aria-label="Monter ' + esc(r.n) + '">↑</button><button type="button" class="btn sm" data-om="1" aria-label="Descendre ' + esc(r.n) + '">↓</button></div>').join("") + "</div>" +
      '<div class="modal-btns"><button class="btn" data-r="0">Annuler</button><button class="btn primary" data-r="1">Valider</button></div></div>';
    document.body.appendChild(d);
    const L = d.querySelector(".ord-list");
    const last = L.lastElementChild; if (last) setTimeout(() => last.scrollIntoView({ block: "nearest" }), 0);
    L.addEventListener("pointerdown", e => {
      const h = e.target.closest("[data-odrag]"); if (!h || e.button) return;
      e.preventDefault(); e.stopPropagation();
      liveDrag(e, h.closest(".ord-row"), { axis: "y", scroller: L, items: () => [...L.children], onDrop: () => { } });
    });
    d.addEventListener("click", e => {
      if (e.target === d) { d.remove(); res(null); return; }
      const m = e.target.closest("[data-om]");
      if (m) { const r = m.closest(".ord-row"); if (+m.dataset.om < 0 && r.previousElementSibling) L.insertBefore(r, r.previousElementSibling); else if (+m.dataset.om > 0 && r.nextElementSibling) L.insertBefore(r.nextElementSibling, r); m.focus(); return; }
      const b = e.target.closest("[data-r]"); if (!b) return;
      d.remove();
      if (b.dataset.r !== "1") { res(null); return; }
      const out = [];
      [...L.children].forEach(r => { const k = r.dataset.key; if (k[0] === "b") bl[+k.slice(1)].items.forEach(x => out.push(x.e)); else out.push(news[+k.slice(1)]); });
      res(out);
    });
  });
}
// demande le nom d'un ou plusieurs exercices, avec la liste des exercices déjà connus
function askNames(title, n, text) {
  return new Promise(res => {
    const d = document.createElement("div"); d.className = "modal";
    let f = "";
    for (let k = 0; k < n; k++) f += '<label class="fl">' + (n > 1 ? "Exercice " + LETTERS[k] : "Nom de l'exercice") + '<input class="f" data-suggest autocomplete="off" data-k="' + k + '" placeholder="Tape un nom ou un muscle (ex. dev, pec)"><div class="sugg" hidden></div></label>';
    d.innerHTML = '<div class="modal-box" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><h3>' + esc(title) + "</h3>" + (text ? "<p>" + esc(text) + "</p>" : "") + f +
      '<p class="msg err" data-m></p><div class="modal-btns"><button class="btn" data-r="0">Annuler</button><button class="btn primary" data-r="1">Ajouter</button></div></div>';
    document.body.appendChild(d);
    const ins = Array.from(d.querySelectorAll("input"));
    ins[0].focus();
    const ok = () => {
      const vals = ins.map(x => x.value.trim());
      if (vals.some(x => !x)) { d.querySelector("[data-m]").textContent = "Donne un nom à chaque exercice."; return; }
      d.remove(); res(vals);
    };
    ins.forEach((x, k) => x.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); if (ins[k + 1]) ins[k + 1].focus(); else ok(); } }));
    d.addEventListener("click", e => {
      if (e.target === d) { d.remove(); res(null); return; }
      const b = e.target.closest("[data-r]"); if (!b) return;
      if (b.dataset.r === "1") ok(); else { d.remove(); res(null); }
    });
  });
}
function currentProgram() {
  const r = route(); if (r.name !== "program") return {};
  const t = getItem(r.args[0]); if (!t) return {};
  const v = t.variants.find(x => x.id === r.args[1]) || t.variants[0];
  return { t, v };
}

/* ================= Étirements conseillés après une séance ================= */
// zone travaillée d'après les muscles principaux des exercices de la bibliothèque, sinon d'après le nom
const ZONE_OF = { pectoraux: "haut", deltoides: "haut", trapezes: "haut", dorsaux: "haut", biceps: "haut", triceps: "haut", "avant-bras": "haut",
  abdominaux: "milieu", obliques: "milieu", lombaires: "milieu", quadriceps: "bas", "ischio-jambiers": "bas", fessiers: "bas", adducteurs: "bas", abducteurs: "bas", mollets: "bas" };
const ZONE_NAMES = { haut: "Haut du corps", milieu: "Milieu du corps", bas: "Bas du corps" };
function zonesOf(e) {
  const lib = exLib(e), out = new Set();
  if (lib && lib.cat === "etirement") return out;
  if (lib) words(lib.mus).forEach(m => { const z = ZONE_OF[m] || (/^deltoide/.test(m) ? "haut" : /^ischio/.test(m) ? "bas" : /^avant/.test(m) ? "haut" : null); if (z) out.add(z); });
  if (!out.size) { const n = norm(e.name);
    if (/squat|fente|jambe|leg|mollet|cuisse|fessier|hip thrust|soulev|presse|ischio|adduc|course|velo|rameur/.test(n)) out.add("bas");
    if (/abdo|gainage|crunch|planche|oblique|lombaire|russian/.test(n)) out.add("milieu");
    if (/develop|pompe|curl|tirage|rowing|traction|dips|epaule|biceps|triceps|pec|oiseau|elevation|face pull/.test(n)) out.add("haut"); }
  return out;
}
/* Version gratuite : les données ne sont que sur l'appareil ; un rappel discret propose une sauvegarde de temps en temps
   (séances terminées depuis la dernière sauvegarde faite ici, et pas plus d'une fois tous les 14 jours) */
const lsNum = k => { try { return Number(localStorage.getItem(k)) || 0; } catch (e) { return 0; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) { } };
function backupNudge() {
  if (!isFree()) return "";
  const last = lsNum("fiitday-backup-at"), later = lsNum("fiitday-backup-later"), now = Date.now();
  if (now - Math.max(last, later) < 14 * DAY || !finished().some(w => w.endedAt > last)) return "";
  return '<div class="card backup-nudge"><h2 class="card-h">Pense à ta sauvegarde</h2><p class="small muted">En version gratuite, tes séances sont enregistrées seulement sur cet appareil. ' +
    "Une sauvegarde de temps en temps (fichier à garder sur ton téléphone, ton ordinateur ou un cloud) te permet de tout retrouver si tu changes d'appareil.</p>" +
    '<div class="row duo"><button class="btn sm primary" data-act="filesave">Faire une sauvegarde</button><button class="btn sm" data-act="backuplater">Plus tard</button></div></div>';
}
/* Fin de séance : récapitulatif en haut de l'accueil (15 min, ou jusqu'à « Masquer »), au-dessus des étirements conseillés */
function recapDismissed(id) { try { return localStorage.getItem("fiitday-recap-ok") === id; } catch (e) { return false; } }
// records de la séance : meilleur 1RM estimé de l'exercice, au-dessus de tout ce qui a été fait avant (même règle que pendant la séance)
function sessionRecords(w) {
  const out = [];
  w.exercises.forEach(e => {
    if (e.type && e.type !== "reps") return;
    let cur = null, top = null;
    e.sets.forEach(st => { if (!st.done) return; const o = e1rm(num(st.kg), num(st.reps)); if (o != null && (cur == null || o > cur)) { cur = o; top = st; } });
    if (cur == null) return;
    const n = exKey(e); let best = null;
    for (const x of finished()) if (x.id !== w.id && x.startedAt < w.startedAt) for (const ex of x.exercises) if (exKey(ex) === n && (ex.type || "reps") === (e.type || "reps")) ex.sets.forEach(st => { const o = e1rm(num(st.kg), num(st.reps)); if (o != null && (best == null || o > best)) best = o; });
    if (best != null && cur > best + 0.05) out.push({ name: e.name, kg: num(top.kg), reps: num(top.reps) });
  });
  return out;
}
function homeRecap(act) {
  const w = finished()[0]; if (act || !w || recapDismissed(w.id) || Date.now() - w.endedAt > STRETCH_MIN * 60000) return "";
  const sets = w.exercises.reduce((a, e) => a + e.sets.filter(st => st.done).length, 0), ton = workoutTon(w), recs = sessionRecords(w);
  const name = w.free ? "Séance libre" : vLabel(w.variantName) || w.templateName || "Séance";
  return '<div class="card recap-card"><div class="spread"><h2 class="card-h">Séance terminée · ' + esc(name) + '</h2><button type="button" class="linkbtn" data-act="recapok" data-id="' + esc(w.id) + '">Masquer</button></div>' +
    '<div class="recap-row"><span><b class="num">' + esc(fmtDurH(shownDur(w))) + "</b></span><span><b class=\"num\">" + sets + "</b> série" + (sets > 1 ? "s" : "") + "</span>" +
    (ton > 0 ? '<span><b class="num">' + esc(fmtTon(ton)) + "</b> soulevés</span>" : "") + "</div>" +
    (recs.length ? '<ul class="recap-rec">' + recs.slice(0, 3).map(r => "<li>" + TROPHY + "<span>Record\u00a0: " + esc(r.name) + " · " + fmtNum(r.kg) + "\u00a0kg\u00a0×\u00a0" + fmtNum(r.reps) + "</span></li>").join("") + (recs.length > 3 ? '<li class="muted small">et ' + (recs.length - 3) + " autre" + (recs.length > 4 ? "s" : "") + "</li>" : "") + "</ul>" : "") +
    '<a class="link small recap-go" href="#/session/' + esc(w.id) + '">Voir le détail ›</a></div>';
}
function stretchDismissed(id) { try { return localStorage.getItem("fiitday-stretch-ok") === id; } catch (e) { return false; } }
const STRETCH_MIN = 15; // la carte reste 15 min en haut de l'accueil après la fin d'une séance
let stretchTimer = null;
function homeStretch(act) {
  clearTimeout(stretchTimer);
  const w = finished()[0]; if (act || !w || stretchDismissed(w.id) || settings().stretchTips === "non") return ""; // désactivable dans Réglages
  const left = w.endedAt + STRETCH_MIN * 60000 - Date.now(); if (left <= 0) return "";
  stretchTimer = setTimeout(() => { if (route().name === "home") softRender(); }, left + 500); // disparaît toute seule
  return stretchCard(w, true);
}
// étirements conseillés : ceux des muscles travaillés (retour au calme), et ceux des zones reposées (souplesse) ;
// une séance qui fait travailler tout le corps n'a que le retour au calme ; les étirements déjà faits pendant la séance ne sont pas reproposés
// exercice perso → exercice de la bibliothèque le plus proche (mots, abréviations, acronymes, fautes de frappe) ; null si pas assez sûr
const FILLER = new Set(["a", "au", "aux", "de", "du", "des", "la", "le", "les", "l", "d", "en", "et", "avec", "sur", "sans", "the", "with", "prise", "serree", "large", "lourd", "leger", "lent", "lente", "explosif", "tempo", "pause", "serie", "series", "kg", "rpe", "max", "variante", "perso", "mon", "ma"]);
const matchCache = {};
function matchLib(name) {
  const exact = libFor(name); if (exact) return exact;
  const key = norm(name); if (key in matchCache) return matchCache[key];
  const toks = words(name).filter(t => !FILLER.has(t) && !/^\d+$/.test(t));
  let best = null, bestSc = 0;
  if (toks.length) for (const c of EXO_LIB) {
    if (c.cat === "etirement") continue;
    let sc = 0, hit = 0, strong = false, firstHit = false;
    const head = { w: [c.w[0]] }; // 1er mot du nom de la bibliothèque : le mouvement (Squat, Curl, Développé, Oiseau…)
    for (const t of toks) {
      const v = tokScore(t, c); if (!v) continue;
      hit++; sc += v; if (v >= 2.7) strong = true;
      if (direct(t, head) >= 3) firstHit = true;
      // abréviation / nom anglais qui donne le nom complet (« skull » → barre au front, « bench » → développé couché)
      if (SYN[t] && SYN[t].split("|").some(alt => { const ws = alt.split(" "); return direct(ws[0], head) >= 3 && ws.every(x => direct(x, c) >= 3); })) { firstHit = true; strong = true; }
    }
    // un mot qui correspond vraiment, et plus de la moitié des mots retrouvés (ou le mot du mouvement)
    if (!strong || !(hit / toks.length > 0.5 || firstHit)) continue;
    sc += 2 * hit / toks.length + (firstHit ? 2 : 0);
    if (sc > bestSc) { best = c; bestSc = sc; }
  }
  return (matchCache[key] = best);
}
// muscles cités dans le nom (« machine pecs », « jambes », « fessiers élastique »…) : utilisés si aucun exercice ne correspond
const MUSCLE_WORDS = [[/^pecs?$|pecto|chest|torse/, ["Pectoraux"]], [/bicep|^bi$/, ["Biceps"]], [/tricep|^tri$/, ["Triceps"]],
  [/epaul|deltoid|delt|shoulder/, ["Deltoïdes antérieurs", "Deltoïdes latéraux", "Deltoïdes postérieurs"]], [/^dos$|dorsa|^back$/, ["Dorsaux"]], [/trap/, ["Trapèzes"]],
  [/lombaire|lowerback/, ["Lombaires"]], [/abdo|^abs?$|^core$/, ["Abdominaux"]], [/oblique/, ["Obliques"]], [/quadri|^quads?$|cuisse/, ["Quadriceps"]], [/ischio|hamstring/, ["Ischio-jambiers"]],
  [/fess|glute|booty/, ["Fessiers"]], [/adduct/, ["Adducteurs"]], [/abduct/, ["Abducteurs (moyen fessier)"]], [/mollet|^calf$|calves/, ["Mollets"]], [/avantbras|forearm|poignet/, ["Avant-bras"]],
  [/^jambes?$|^legs?$/, ["Quadriceps", "Ischio-jambiers", "Fessiers"], 1], [/^bras$|^arms?$/, ["Biceps", "Triceps"], 1]];
// vague (1) : « jambes », « bras » désignent souvent la partie du corps qui bouge (« Relevé de jambes ») : seulement si aucun exercice ne correspond
function musclesOf(name, precise) {
  const ws = words(name.replace(/avant[- ]bras/i, "avantbras").replace(/lower back/i, "lowerback")), out = new Set();
  if (ws.length && ws.every(w => FILLER.has(w) || MUSCLE_WORDS.some(([re]) => re.test(w)))) precise = false; // le nom n'est fait que de muscles (« Jambes », « Pecs triceps »)
  ws.forEach(w => MUSCLE_WORDS.forEach(([re, ms, vague]) => { if (re.test(w) && !(precise && vague)) ms.forEach(m => out.add(m)); }));
  return Array.from(out);
}
window.__fiitdayMatch = n => { const om = words(n).every(x => FILLER.has(x) || MUSCLE_WORDS.some(([re]) => re.test(x))), m = om ? null : matchLib(n), named = musclesOf(n, !!m), keep = m && !(named.length && !m.mus.split(", ").some(x => named.includes(x))); return { lib: keep ? m : null, mus: keep ? [] : named }; }; // vérification de la concordance (tests)
function stretchPlan(w) {
  const lib = EXO_LIB.filter(x => x.cat === "etirement"), done = new Set(), mus = {}, zones = new Set();
  const used = w.exercises.filter(exHasData), list = used.length ? used : w.exercises;
  for (const e of w.exercises) { const l = exLib(e); if (l && l.cat === "etirement" && (exHasData(e) || !used.length)) done.add(l.id); }
  for (const e of list) {
    const l = exLib(e); if (l && l.cat === "etirement") continue;
    // muscles travaillés : ceux de l'exercice de la bibliothèque, ou de celui qui correspond à ton exercice perso, sinon ceux cités dans son nom
    const named0 = l ? [] : musclesOf(e.name, false), onlyMus = !l && words(e.name).every(x => FILLER.has(x) || MUSCLE_WORDS.some(([re]) => re.test(x)));
    const m = l || (onlyMus ? null : matchLib(e.name)), named = l ? [] : onlyMus ? named0 : musclesOf(e.name, !!m);
    // un muscle cité dans le nom que l'exercice trouvé ne travaille pas (« Machine pecs », « Calf raise ») : c'est le nom qui compte
    const ms = m && !(named.length && !m.mus.split(", ").some(x => named.includes(x))) ? m.mus.split(", ") : named;
    ms.forEach(x => { mus[norm(x)] = (mus[norm(x)] || 0) + 1; });
    ms.forEach(x => { const z = ZONE_OF[words(x)[0]] || (/^deltoide|^avant/.test(norm(x)) ? "haut" : /^ischio|^abducteur/.test(norm(x)) ? "bas" : null); if (z) zones.add(z); });
  }
  const left = lib.filter(x => !done.has(x.id));
  const score = x => x.mus.split(", ").reduce((n, m) => n + (mus[norm(m)] || 0), 0);
  let calm = left.filter(x => score(x) > 0);
  if (calm.length > 8) { const keep = new Set(calm.slice().sort((a, b) => score(b) - score(a) || a.k - b.k).slice(0, 8)); calm = calm.filter(x => keep.has(x)); }
  const worked = ["haut", "milieu", "bas"].filter(z => zones.has(z)), rested = ["haut", "milieu", "bas"].filter(z => !zones.has(z));
  const flex = worked.length && worked.length < 3 ? left.filter(x => rested.includes(x.zone) && !calm.includes(x)) : [];
  return { calm, flex, worked, rested: rested.filter(z => flex.some(x => x.zone === z)), done: done.size };
}
function stretchCard(w, onHome) {
  const P = stretchPlan(w);
  if (!P.calm.length && !P.flex.length) return "";
  const zl = zs => zs.map(z => ZONE_NAMES[z].toLowerCase()).join(" et ");
  const go = (seq, label) => '<button type="button" class="btn sm" data-act="stretchgo" data-seq="' + seq.map(x => x.id).join(",") + '">' + esc(label) + " ›</button>";
  const row = (title, txt, seq) => '<div class="sc-row"><div><b>' + esc(title) + '</b><span class="muted small">' + esc(txt) + "</span></div>" + go(seq, "Commencer (" + seq.length + ")") + "</div>";
  let rows = "";
  if (P.calm.length) rows += row("Maintenant, en douceur", "Retour au calme des muscles travaillés : 1 à 2 fois 20 à 30 s par étirement, sans forcer", P.calm);
  if (P.flex.length) rows += row("Pour gagner en souplesse", ZONE_NAMES[P.rested[0]] + (P.rested[1] ? " et " + ZONE_NAMES[P.rested[1]].toLowerCase() : "") + " : ces muscles sont chauds et reposés, 2 à 4 fois 30 s", P.flex);
  const intro = P.worked.length === 3 ? "tout le corps a travaillé, donc seulement un retour au calme" : P.worked.length ? "surtout le " + zl(P.worked) : "";
  return '<div class="card stretch-card' + (onHome ? " top" : "") + '"><div class="spread"><h2>Étirements conseillés</h2>' + (onHome ? '<button type="button" class="linkbtn" data-act="stretchok" data-id="' + esc(w.id) + '">Masquer</button>' : "") + "</div>" +
    '<p class="muted small" style="margin:2px 0 8px">' + (onHome ? "Après ta séance " + esc(w.templateName) : "Cette séance") + (intro ? " : " + esc(intro) : "") + "." + (P.done ? " Les étirements déjà faits pendant la séance ne sont pas reproposés." : "") + "</p>" + rows +
    '<a class="exo-link small" href="#/exercices/conseils-etirements" data-act="stretchtips">Conseils pour bien s\'étirer ›</a></div>';
}

/* ================= Écran : historique ================= */
function historyRow(w, sel) {
  const done = w.exercises.reduce((n, e) => n + e.sets.filter(s => s.done || setHasData(s, e.type)).length, 0);
  // glisser la ligne de droite à gauche fait apparaître « Supprimer »
  return '<div class="swipe"><button type="button" class="swipe-del" data-act="swipedel" data-id="' + esc(w.id) + '" tabindex="-1">Supprimer</button>' +
    '<a class="swipe-row' + (sel === w.id ? " pc-on" : "") + '" draggable="false" href="#/' + (sel !== undefined ? "history" : "session") + "/" + w.id + '"' + (sel !== undefined ? " data-pane" : "") + (sel === w.id ? ' aria-current="true"' : "") + '><div><b>' + esc(w.templateName) + '</b> <span class="muted">· ' + esc(vLabel(w.variantName)) + '</span><div class="muted small">' +
    esc(fmtDate(w.startedAt)) + " · " + (w.cardio ? w.exercises.length + " machine" + (w.exercises.length > 1 ? "s" : "") + (workoutKcal(w) ? " · " + fmtNum(Math.round(workoutKcal(w))) + " kcal" : "") : w.exercises.length + " exercices · " + done + " séries" + (workoutTon(w) ? " · " + fmtTon(workoutTon(w)) : "")) + '</div></div><span class="muted small num">' + fmtDur(shownDur(w)) + "</span></a></div>";
}
// glisser pour supprimer : la ligne suit le doigt (ou la souris) horizontalement ; le défilement vertical reste normal
const SW_W = 104;
let sw = null, swOpen = null, swipedAt = 0;
function swClose(row) { if (row) { row.style.transform = ""; row.parentElement.classList.remove("open"); } if (swOpen === row) swOpen = null; }
$app.addEventListener("pointerdown", e => {
  const row = e.target.closest && e.target.closest(".swipe-row");
  if (swOpen && swOpen !== row && !(e.target.closest && e.target.closest(".swipe-del"))) swClose(swOpen);
  if (!row || e.button > 0) return;
  sw = { row, x: e.clientX, y: e.clientY, base: swOpen === row ? -SW_W : 0, dir: null, dx: 0, id: e.pointerId };
});
$app.addEventListener("pointermove", e => {
  if (!sw || e.pointerId !== sw.id) return;
  const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
  if (!sw.dir) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    sw.dir = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
    if (sw.dir === "h") { sw.row.classList.add("swiping"); try { sw.row.setPointerCapture(e.pointerId); } catch (err) { } }
  }
  if (sw.dir !== "h") return;
  sw.dx = Math.max(-SW_W - 30, Math.min(0, sw.base + dx));
  sw.row.style.transform = "translateX(" + sw.dx + "px)";
});
const swEnd = e => {
  if (!sw || e.pointerId !== sw.id) return;
  const s0 = sw; sw = null;
  if (s0.dir !== "h") return;
  s0.row.classList.remove("swiping"); swipedAt = Date.now();
  if (s0.dx < -SW_W / 2) { s0.row.style.transform = "translateX(" + -SW_W + "px)"; s0.row.parentElement.classList.add("open"); swOpen = s0.row; }
  else swClose(s0.row);
};
$app.addEventListener("pointerup", swEnd);
$app.addEventListener("pointercancel", swEnd);
// juste après un glissé, la séance ne s'ouvre pas ; toucher une ligne ouverte la referme
$app.addEventListener("click", e => {
  const row = e.target.closest && e.target.closest(".swipe-row"); if (!row) return;
  const justSwiped = Date.now() - swipedAt < 350;
  if (justSwiped || row === swOpen) { e.preventDefault(); e.stopPropagation(); if (!justSwiped) swClose(row); }
}, true);
// séances visibles dans l'historique (version gratuite : les 30 derniers jours)
function histList() { const every = finished(), cut = freeHistCut(); return { every, ws: isFree() ? every.filter(w => w.startedAt >= cut) : every }; }
const freeHistCut = () => nowSafe() - FREE_HIST_DAYS * DAY; // version gratuite : historique des 30 derniers jours (heure sûre)
const histHidden = w => isFree() && !!w.endedAt && w.startedAt < freeHistCut();
// PC : séance affichée à droite de l'historique (celle de l'adresse, sinon la plus récente)
function histSel(id) { const ws = histList().ws; return ws.find(w => w.id === id) || ws[0] || null; }
function viewHistory(id) {
  const { every, ws } = histList(), hidden = every.length - ws.length, pc = isPC(), sel = pc ? histSel(id) : null;
  const head = '<div class="page-head"><h1>Stats</h1></div>' + statsTabs("history");
  const more = hidden ? planCard(hidden + " séance" + (hidden > 1 ? "s" : "") + " de plus de " + FREE_HIST_DAYS + " jours " + (hidden > 1 ? "sont gardées" : "est gardée") + ". Avec Premium, tu revois tout ton historique.") : "";
  if (!ws.length) return head + (hidden ? more : '<div class="card empty">Aucune séance terminée pour l\'instant.</div>');
  let h = (pc ? head + '<div class="pc-cols hist"><div class="pc-main">' : head) + '<p class="muted small" style="margin:0 2px 4px">' + ws.length + " séance" + (ws.length > 1 ? "s" : "") + " terminée" + (ws.length > 1 ? "s" : "") + ". " + (pc ? "Clique une séance pour la voir ou la corriger à droite" : "Touche une séance pour la voir ou la corriger") + ", glisse-la vers la gauche pour la supprimer.</p>", month = "";
  ws.slice(0, histLimit).forEach(w => {
    const m = dfMonth.format(w.startedAt);
    if (m !== month) { if (month) h += "</div>"; month = m; h += '<div class="section-title">' + esc(m) + '</div><div class="list">'; }
    h += historyRow(w, sel ? sel.id : undefined);
  });
  h += "</div>";
  // longue liste : affichée par tranches de 100
  if (ws.length > histLimit) h += '<button class="btn block" data-act="histmore" style="margin-top:12px">Afficher les séances plus anciennes (' + (ws.length - histLimit) + ")</button>";
  if (pc && sel) return h + more + '</div><div class="pc-side pc-pane">' + viewSession(sel.id, true).html + "</div></div>";
  return h + more;
}
let histLimit = 100;

/* ================= Écran : progression ================= */
// tonnage (kg × reps des séries remplies, baisses comprises ; exercices « poids × reps ») et temps passé à la salle
const setTon = st => { let t = 0; const k = num(st.kg), r = num(st.reps); if (k > 0 && r > 0) t += k * r; (st.drops || []).forEach(d => { const dk = num(d.kg), dr = num(d.reps); if (dk > 0 && dr > 0) t += dk * dr; }); return t; };
const exTon = e => (!e.type || e.type === "reps") ? e.sets.reduce((a, st) => a + setTon(st), 0) : 0;
const workoutTon = w => w.exercises.reduce((a, e) => a + exTon(e), 0);
const workoutKcal = w => w.exercises.reduce((a, e) => a + (e.type === "cardio" ? e.sets.reduce((b, st) => b + (st.cv && num(st.cv.cal) > 0 ? num(st.cv.cal) : 0), 0) : 0), 0);
const workoutDur = w => { const d = (w.endedAt || 0) - (w.startedAt || 0); return d > 60000 ? Math.min(d, 5 * 3600e3) : 0; }; // une séance oubliée ouverte compte 5 h au plus
// durée affichée : séance terminée = la même que dans les stats (5 h au plus) ; séance en cours = le temps qui défile
const shownDur = w => w.endedAt ? Math.min(Math.max(0, w.endedAt - w.startedAt), 5 * 3600e3) : Date.now() - w.startedAt;
const fmtDurH = ms => { const m = Math.round(ms / 60000), hh = Math.floor(m / 60); return hh ? hh + " h " + pad(m % 60) : m + " min"; };
const fmtTon = v => v >= 10000 ? (v / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " t" : Math.round(v).toLocaleString("fr-FR") + " kg";
// courbes de l'onglet Évolution : recalculées seulement quand les données changent (appelé plusieurs fois par affichage)
let pdCache = { rev: -1, list: [] };
function progressData() {
  if (pdCache.rev !== dataRev) pdCache = { rev: dataRev, list: progressDataNow() };
  return pdCache.list;
}
function progressDataNow() {
  const map = {};
  for (const w of finished().slice().reverse()) {
    for (const e of w.exercises) {
      if (!exHasData(e)) continue;
      if (e.type === "cardio") { // cardio : une courbe par machine, avec la durée et chaque indicateur noté
        const key = (e.machine && CARDIO_MACH[e.machine] ? "lib:" + e.machine : norm(e.name)) + "|cardio", cv = {};
        let dur = 0, hasDur = false;
        e.sets.forEach(st => {
          if (num(st.sec) > 0) { dur += num(st.sec); hasDur = true; }
          Object.keys(st.cv || {}).forEach(k => { const v = cvNum(st.cv[k]), d = cvDef(k); if (v == null || !d) return;
            cv[k] = cv[k] == null ? v : d.add ? cv[k] + v : d.low ? Math.min(cv[k], v) : Math.max(cv[k], v); });
        });
        (map[key] = map[key] || { key, name: e.name, type: "cardio", machine: e.machine || "", entries: [] }).entries.push({ w, e, dur: hasDur ? dur : null, cv });
        map[key].name = e.name;
        continue;
      }
      const D = e.type === "dist", dd = D ? Math.round(num(e.target) || 0) : 0; // distance : une courbe par distance (1 000 m et 5 000 m ne se comparent pas)
      const lb = exLib(e), key = exKey(e) + "|" + e.type + (dd > 0 ? "|" + dd : ""); // ancien et nouveau nom d'un même exercice de la bibliothèque : une seule courbe
      const T = e.type === "time" || D, RO = e.type === "rep", vs = e.sets.map(s => num(T ? s.sec : RO ? s.reps : s.kg)).filter(x => x != null && (!D || x > 0));
      const best = vs.length ? (D ? Math.min(...vs) : Math.max(...vs)) : -Infinity;
      const reps = T ? null : Math.max(...e.sets.map(s => num(s.reps)).filter(x => x != null), -Infinity);
      const orm = T || RO ? null : Math.max(...e.sets.map(s => e1rm(num(s.kg), num(s.reps))).filter(x => x != null), -Infinity);
      const kgs = e.sets.map(s => num(s.kg)).filter(x => x != null && x !== 0), kg = kgs.length ? Math.max(...kgs) : null; // avec assistance (négatif) : moins d'assistance = mieux
      const sec = T && vs.length ? (D ? Math.min(...vs) : Math.max(...vs)) : null, tn = exTon(e);
      (map[key] = map[key] || { key, name: e.name, lib: lb ? lb.id : "", type: e.type, dist: dd, entries: [] }).entries.push({ w, e, best: best === -Infinity ? null : best, reps: reps === -Infinity ? null : reps, orm: orm === -Infinity ? null : orm, kg, sec, ton: tn > 0 ? tn : null });
      map[key].name = e.name;
    }
  }
  return Object.values(map).sort((a, b) => a.name.localeCompare(b.name, "fr"));
}
const unitOf = p => p.type === "time" ? " s" : p.type === "dist" ? "" : p.type === "rep" ? " reps" : " kg";
const bestOf = (p, vs) => (vs.length ? (p.type === "dist" ? Math.min(...vs) : Math.max(...vs)) : null);
const fmtVal = (p, v) => (p.type === "dist" ? fmtClock(v) : p.type === "time" ? fmtHold(v) : fmtNum(v) + unitOf(p));
const noRM = p => p.type === "time" || p.type === "dist" || p.type === "rep";
function weekStart(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); }
function prevWeek(t) { const d = new Date(t); d.setDate(d.getDate() - 7); return d.getTime(); }
let statsMetric = "n"; // graphique de Stats › Séances : séances, temps ou tonnage par semaine
function viewProgress() {
  const ws = finished(), now = Date.now(), goal = num(settings().goal) || 5;
  let h = '<div class="page-head"><h1>Stats</h1></div>' + statsTabs("progress");
  if (!ws.length) return h + '<div class="card empty">Termine une première séance pour voir tes stats.</div>';
  const perWeek = {}; ws.forEach(w => { const k = weekStart(w.startedAt); perWeek[k] = (perWeek[k] || 0) + 1; });
  const cur = weekStart(now), thisWeek = perWeek[cur] || 0;
  const m0 = new Date(now); m0.setHours(0, 0, 0, 0); m0.setDate(1);
  const thisMonth = ws.filter(w => w.startedAt >= m0.getTime()).length;
  // semaines d'affilée avec l'objectif atteint (la semaine en cours compte si l'objectif est déjà atteint)
  let streak = 0, wk = (perWeek[cur] || 0) >= goal ? cur : prevWeek(cur);
  while ((perWeek[wk] || 0) >= goal) { streak++; wk = prevWeek(wk); }
  const pct = Math.min(100, Math.round(100 * thisWeek / goal));
  const weekCard = '<div class="card stat"><div class="muted small">Cette semaine</div><div class="v num">' + thisWeek + " <small>/ " + goal + '</small></div><div class="meter" role="img" aria-label="' + thisWeek + " séances sur " + goal + '"><span style="width:' + pct + '%"></span></div></div>';
  if (isFree()) return h + '<div class="stats k1">' + weekCard + "</div>" + planCard("En version gratuite, tu vois ta semaine en cours. Avec Premium : le mois, le total, les semaines d'affilée, le temps à la salle, le tonnage et les graphiques.");
  h += '<div class="pc-tiles"><div class="stats k3">' + weekCard +
    '<div class="card stat"><div class="muted small">Ce mois-ci</div><div class="v num">' + thisMonth + "</div></div>" +
    '<div class="card stat"><div class="muted small">Au total</div><div class="v num">' + ws.length + "</div></div>" +
    '<div class="card stat"><div class="muted small">Semaines objectif atteint</div><div class="v num">' + streak + " <small>d'affilée</small></div></div>" +
    "</div>";
  // temps passé à la salle et tonnage
  const durWeek = {}, tonWeek = {}; let durAll = 0, tonAll = 0;
  ws.forEach(w => { const k = weekStart(w.startedAt), d = workoutDur(w), tn = workoutTon(w); durWeek[k] = (durWeek[k] || 0) + d; tonWeek[k] = (tonWeek[k] || 0) + tn; durAll += d; tonAll += tn; });
  h += '<div class="stats" style="margin-top:10px">' +
    '<div class="card stat"><div class="muted small">Temps de sport cette semaine</div><div class="v num">' + fmtDurH(durWeek[cur] || 0) + "</div></div>" +
    '<div class="card stat"><div class="muted small">Temps de sport depuis le début</div><div class="v num">' + fmtDurH(durAll) + '</div><div class="muted small">' + (ws.length ? "moyenne " + fmtDurH(durAll / ws.length) + " par séance" : "") + "</div></div></div></div>";
  // séances par semaine (8 dernières), avec la ligne d'objectif
  const weeks = []; let t = cur; for (let k = 0; k < 8; k++) { weeks.unshift(t); t = prevWeek(t); }
  const SM = statsMetric, src = SM === "time" ? durWeek : SM === "ton" ? tonWeek : perWeek, fmtV = v => SM === "time" ? fmtDurH(v) : SM === "ton" ? fmtTon(v) : String(v);
  // valeur courte au-dessus des barres (elles sont étroites) : « 2,1 t », « 1h05 », « 45 min »
  const barLab = v => SM === "ton" ? (v >= 1000 ? fmtNum(Math.round(v / 100) / 10) + " t" : Math.round(v) + " kg") : SM === "time" ? (m => m >= 60 ? Math.floor(m / 60) + "h" + pad(m % 60) : m + " min")(Math.round(v / 60000)) : String(v);
  const vals = weeks.map(k => src[k] || 0), max = Math.max(SM === "n" ? goal : 0, ...vals, 1);
  const W = 360, H = 150, top = 18, bw = W / weeks.length, y = v => H - (v / max) * (H - top);
  let svg = '<svg class="chart" viewBox="0 0 ' + W + " " + (H + 26) + '" role="img" aria-label="Séances par semaine sur les 8 dernières semaines, objectif ' + goal + '">';
  svg += '<line class="base" x1="0" x2="' + W + '" y1="' + H + '" y2="' + H + '"></line>';
  weeks.forEach((k, n) => {
    const v = vals[n], x = n * bw + bw * 0.22, w = bw * 0.56, d = new Date(k), lab = pad(d.getDate()) + "/" + pad(d.getMonth() + 1);
    const tip = "Semaine du " + lab + " : " + (SM === "n" ? v + " séance" + (v > 1 ? "s" : "") : fmtV(v));
    svg += "<g><title>" + esc(tip) + "</title>" + '<rect class="hit" x="' + n * bw + '" y="0" width="' + bw + '" height="' + H + '"></rect>';
    if (v > 0) { const hh = H - y(v), r = Math.min(4, hh / 2, w / 2); svg += '<path class="bar' + ((perWeek[k] || 0) >= goal ? " ok" : "") + (k === cur ? "" : " dim") + '" d="M' + x + "," + H + "V" + (y(v) + r) + "Q" + x + "," + y(v) + " " + (x + r) + "," + y(v) + "H" + (x + w - r) + "Q" + (x + w) + "," + y(v) + " " + (x + w) + "," + (y(v) + r) + "V" + H + 'Z"></path>'; }
    svg += '<text x="' + (n * bw + bw / 2) + '" y="' + (H + 18) + '" text-anchor="middle">' + lab + "</text></g>";
    // valeur au-dessus de chaque barre ; en « Séances », pas de chiffre quand l'objectif est pile atteint (barre verte)
    if (v > 0 && !(SM === "n" && v === goal)) svg += '<text class="bar-v' + (k === cur ? " cur" : "") + '" x="' + (n * bw + bw / 2) + '" y="' + (y(v) - 6) + '" text-anchor="middle">' + esc(barLab(v)) + "</text>";
  });
  if (SM === "n") svg += '<line class="goal" x1="0" x2="' + W + '" y1="' + y(goal) + '" y2="' + y(goal) + '"></line><text x="4" y="' + (y(goal) - 6) + '">Objectif ' + goal + "</text>";
  svg += "</svg>";
  const segS = [["n", "Séances"], ["time", "Temps"], ["ton", "Tonnage"]].map(([k, l]) => '<button type="button" data-act="statm" data-v="' + k + '"' + (k === SM ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + ">" + l + "</button>").join("");
  h += '<div class="pc-cols stats"><div class="pc-main"><div class="card" style="margin-top:12px"><div class="seg evo-seg stat-seg" role="group" aria-label="Afficher par semaine">' + segS + '</div><div class="muted small" style="font-weight:600;margin:10px 0 8px">' + (SM === "time" ? "Temps de sport par semaine" : SM === "ton" ? "Tonnage par semaine" : "Séances par semaine") + "</div>" + svg + "</div>";
  // par programme
  const byTpl = {};
  ws.forEach(w => { const k = w.templateId; (byTpl[k] = byTpl[k] || { name: w.templateName, n: 0, last: 0 }); byTpl[k].n++; byTpl[k].last = Math.max(byTpl[k].last, w.startedAt); const t = getItem(k); if (t) byTpl[k].name = t.name; });
  h += '</div><div class="pc-side"><div class="section-title">Par programme</div><div class="list">' + Object.values(byTpl).sort((a, b) => b.n - a.n).map(x =>
    '<div><div><b>' + esc(x.name) + '</b><div class="muted small">Dernière : ' + esc(fmtDate(x.last)) + '</div></div><span class="num"><b>' + x.n + '</b> <span class="muted small">séance' + (x.n > 1 ? "s" : "") + "</span></span></div>").join("") + "</div></div></div>";
  return h;
}
/* ================= Stats : évolution d'un exercice ================= */
// courbes possibles selon le type d'exercice ; « low » : plus bas = mieux (temps d'un exercice à distance)
const EVO_M = {
  kg: { label: "Charge max", short: "Charge", unit: " kg" },
  ton: { label: "Tonnage de l'exercice", short: "Tonnage", unit: " kg", ton: true },
  orm: { label: "1RM estimé", short: "1RM estimé", unit: " kg" },
  reps: { label: "Répétitions max", short: "Répétitions", unit: " reps" },
  sec: { label: "Temps max", short: "Temps", unit: " s" },
  run: { label: "Meilleur temps", short: "Temps", unit: "", low: true, clock: true },
  poids: { label: "Poids", short: "Poids", unit: " kg", neutral: true } // ni « record » ni « mieux » : une courbe, sans objectif
};
// courbe d'un indicateur de cardio (« cv:dist ») ou de la durée (« dur »)
function evoDef(m) {
  if (EVO_M[m]) return EVO_M[m];
  if (m === "dur") return { label: "Durée", short: "Durée", unit: "", clock: true };
  const d = /^cv:/.test(m) && cvDef(m.slice(3));
  return d ? { label: d.n, short: d.s || d.n, unit: d.u && !d.clock ? " " + d.u : "", clock: !!d.clock, low: !!d.low, cv: d } : { label: m, short: m, unit: "" };
}
const EVO_P = [["1m", "1 mois", 31], ["3m", "3 mois", 92], ["6m", "6 mois", 183], ["1a", "1 an", 366], ["all", "Tout", 0]];
const evo = { q: "", m: {}, per: "all" };
const evoVal = (x, m) => { const v = m === "run" ? x.sec : /^cv:/.test(m) ? (x.cv ? x.cv[m.slice(3)] : null) : x[m]; return v == null ? null : v; };
function evoMetrics(p) {
  const has = f => p.entries.some(x => evoVal(x, f) != null);
  if (p.type === "cardio") { // les indicateurs de la machine d'abord, puis les autres notés
    const keys = cardioDefs({ machine: p.machine, name: p.name }).map(d => d.k);
    p.entries.forEach(x => Object.keys(x.cv || {}).forEach(k => { if (!keys.includes(k) && cvDef(k)) keys.push(k); }));
    const out = (has("dur") ? ["dur"] : []).concat(keys.map(k => "cv:" + k).filter(has));
    return out.length ? out : ["dur"];
  }
  if (p.type === "time") return ["sec"];
  if (p.type === "dist") return ["run"].concat(has("kg") ? ["kg"] : []);
  if (p.type === "rep") return ["reps"];
  const out = []; if (has("kg")) out.push("kg"); if (has("orm")) out.push("orm"); if (has("reps")) out.push("reps"); if (has("ton")) out.push("ton");
  return out.length ? out : ["reps"];
}
const evoFmt = (m, v) => { const M = evoDef(m); return v == null ? "—" : m === "poids" ? wFmt(v) : M.clock ? fmtClock(v) + (M.cv && M.cv.u ? " " + M.cv.u : "") : m === "sec" ? fmtHold(v) : m === "ton" ? fmtTon(v) : fmtNum(m === "orm" ? Math.round(v * 2) / 2 : M.cv && M.cv.int ? Math.round(v) : v) + M.unit; };
function evoDiff(m, d) {
  if (d == null) return "—";
  const r = Math.round(Math.abs(d) * (m === "orm" ? 2 : 100)) / (m === "orm" ? 2 : 100);
  if (!r) return "Stable";
  const M = evoDef(m);
  return (d > 0 ? "+" : "−") + (M.clock ? fmtClock(r) : m === "sec" ? fmtHold(r) : m === "ton" ? fmtTon(r) : fmtNum(r) + M.unit);
}
// recherche parmi les exercices déjà faits (mêmes règles que la recherche d'exercices : fautes, synonymes, muscles)
function evoCands() {
  const ps = progressData(), seen = {};
  ps.forEach(p => { seen[p.name] = (seen[p.name] || 0) + 1; });
  return ps.map(p => {
    const lib = libById[p.lib] || libFor(p.name), last = p.entries[p.entries.length - 1].w.startedAt;
    return { p, n: p.name, nn: norm(p.name), w: words(p.name), a: lib ? words(lib.n + " " + lib.al.join(" ")) : [], o: lib ? lib.o : [], last,
      dup: p.dist > 0 ? fmtNum(p.dist) + " m" : seen[p.name] > 1 ? ({ time: "temps", dist: "distance", cardio: "cardio", rep: "reps" }[p.type] || "poids × reps") : "" };
  });
}
function evoSearch(q) {
  const toks = words(q), cs = evoCands();
  if (!toks.length) return cs.sort((a, b) => b.last - a.last);
  return cs.map(c => { let sc = 0; for (const t of toks) { const v = tokScore(t, c); if (!v) return null; sc += v; } return { c, sc: sc + (c.nn.startsWith(norm(q)) ? 2 : 0) }; })
    .filter(Boolean).sort((a, b) => b.sc - a.sc || b.c.last - a.c.last).map(x => x.c);
}
function sparkline(vals, low) {
  if (vals.length < 2) return "";
  const W = 64, H = 22, mn = Math.min(...vals), mx = Math.max(...vals), r = mx - mn || 1;
  const pt = (v, k) => (k * (W - 4) / (vals.length - 1) + 2).toFixed(1) + "," + (H - 3 - ((low ? mx - v : v - mn) / r) * (H - 6)).toFixed(1);
  return '<svg class="spark" viewBox="0 0 ' + W + " " + H + '" aria-hidden="true"><polyline points="' + vals.map(pt).join(" ") + '"></polyline></svg>';
}
function evoListHtml() {
  const hits = evoSearch(evo.q);
  if (!hits.length) {
    const lib = evo.q.trim() ? searchExercises(evo.q).filter(c => !c.own)[0] : null;
    return '<div class="card empty">' + (lib
      ? "Tu n'as pas encore fait « " + esc(lib.n) + " » pendant une séance. Sa courbe apparaîtra dès que tu auras terminé une séance avec cet exercice."
      : "Aucun exercice fait en séance ne correspond à « " + esc(evo.q.trim()) + " ».") + "</div>";
  }
  return '<div class="list">' + hits.map(c => {
    const p = c.p, m = evoMetrics(p)[0], vs = p.entries.map(x => evoVal(x, m)).filter(v => v != null);
    const M = evoDef(m), rec = vs.length ? (M.low ? Math.min(...vs) : Math.max(...vs)) : null;
    return '<a href="#/evolution/' + encodeURIComponent(p.key) + '"' + (evoSel ? " data-pane" : "") + (p.key === evoSel ? ' class="pc-on" aria-current="true"' : "") + '><div><b>' + esc(p.name) + "</b>" + (c.dup ? ' <span class="muted small">· ' + c.dup + "</span>" : "") +
      '<div class="muted small">' + p.entries.length + " séance" + (p.entries.length > 1 ? "s" : "") + " · " + esc(dfDay.format(c.last)) + "</div></div>" +
      '<span class="evo-r">' + sparkline(vs.slice(-12), M.low) + '<span class="small"><b>' + evoFmt(m, rec) + '</b> <span class="muted">' + (p.type === "cardio" && m === "dur" ? "plus longue" : "record") + "</span></span></span></a>";
  }).join("") + "</div>";
}
let evoSel = null; // exercice affiché à droite de la liste (PC)
function viewEvolutionPc(key) {
  const all_ = progressData(), hits = evoSearch(evo.q), wsel = key === "poids", p = wsel ? null : all_.find(x => x.key === key) || (hits[0] && hits[0].p) || all_[0];
  evoSel = wsel ? "poids" : p ? p.key : null;
  const detail = wsel ? viewWeight(true) : p ? viewEvolutionDetail(p.key, true) : "";
  evoSel = wsel ? "poids" : p ? p.key : null;
  return '<div class="page-head"><h1>Stats</h1></div>' + statsTabs("evolution") + '<div class="pc-cols evo"><div class="pc-main">' + weightRowHtml() +
    '<label class="evo-search"><span class="sr">Rechercher un exercice</span><input type="search" class="f" data-evo-q placeholder="Rechercher un exercice" autocomplete="off" value="' + esc(evo.q) + '"></label>' +
    '<p class="muted small" style="margin:6px 2px 10px">Choisis un exercice pour voir sa courbe à droite. Seuls ceux que tu as faits en séance apparaissent.</p><div id="evo-list">' + evoListHtml() + "</div>" + weightShowLink() + "</div>" +
    '<div class="pc-side pc-pane">' + detail + "</div></div>";
}
function viewEvolution() {
  evoSel = null;
  let h = '<div class="page-head"><h1>Stats</h1></div>' + statsTabs("evolution") + weightRowHtml();
  if (isFree()) return h + planCard("La courbe de chaque exercice et de chaque machine de cardio (charge, répétitions, distance, calories, records) est réservée à Premium. Tes séances sont gardées : la courbe sera complète dès que tu t'abonnes.") + weightShowLink();
  if (!progressData().length) return h + '<div class="card empty">Termine une séance pour voir l\'évolution de tes exercices. Seuls les exercices faits pendant une séance terminée apparaissent ici.</div>' + weightShowLink();
  return h + '<label class="evo-search"><span class="sr">Rechercher un exercice</span><input type="search" class="f" data-evo-q placeholder="Rechercher un exercice" autocomplete="off" value="' + esc(evo.q) + '"></label>' +
    '<p class="muted small" style="margin:6px 2px 10px">Choisis un exercice pour voir sa courbe dans le temps. Seuls ceux que tu as faits en séance apparaissent.</p><div id="evo-list">' + evoListHtml() + "</div>" + weightShowLink();
}
document.addEventListener("input", e => {
  if (!e.target.matches || !e.target.matches("input[data-evo-q]")) return;
  evo.q = e.target.value; clearTimeout(evoQTimer); // une courte pause dans la frappe avant de refaire la liste (long historique)
  evoQTimer = setTimeout(() => { const box = document.getElementById("evo-list"); if (box) box.innerHTML = evoListHtml(); }, 150);
});
let evoQTimer = 0;
// courbe : axe du temps à l'échelle, une seule série, info-bulle qui suit le doigt
let evoCur = null;
function niceStep(raw, clock) {
  const steps = clock ? [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600] : null;
  if (steps) return steps.find(x => x >= raw) || 3600;
  const p10 = Math.pow(10, Math.floor(Math.log10(raw || 1))), f = raw / p10;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p10;
}
function evoChart(p, m, pts, W) {
  W = W || 360; const H = W > 520 ? 250 : 210, L = 44, R = 16, T = 26, B = 28, pw = W - L - R, ph = H - T - B, M = evoDef(m);
  const vs = pts.map(x => x.v), mn = Math.min(...vs), mx = Math.max(...vs);
  let step = niceStep(((mx - mn) || Math.max(1, mx * 0.1)) / 3, M.clock || m === "sec"); // temps tenu : graduations en secondes rondes (5 s, 10 s, 15 s…)
  if (!M.clock && m !== "orm" && step < 1 && (m === "reps" || m === "sec")) step = 1;
  let y0 = Math.floor(mn / step) * step, y1 = Math.ceil(mx / step) * step;
  if (y1 === y0) { y0 = Math.max(0, y0 - step); y1 += step; }
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t, span = t1 - t0;
  const X = t => L + (span ? ((t - t0) / span) * pw : pw / 2), Y = v => T + (1 - (v - y0) / (y1 - y0)) * ph;
  const recV = M.low ? mn : mx, recK = M.neutral ? -1 : pts.map(x => x.v).lastIndexOf(recV), lastK = pts.length - 1;
  pts.forEach(x => { x.x = X(x.t); x.y = Y(x.v); });
  let svg = '<svg class="chart evo-svg" viewBox="0 0 ' + W + " " + H + '" tabindex="0" role="img" aria-label="' + esc(M.neutral ? M.label + " : " + pts.length + " pesée" + (pts.length > 1 ? "s" : "") + ", dernière " + evoFmt(m, pts[lastK].v) : M.label + " de " + p.name + " : " + pts.length + " séances, record " + evoFmt(m, recV) + ", dernière " + evoFmt(m, pts[lastK].v)) + '">' +
    '<defs><linearGradient id="evoG" x1="0" x2="0" y1="0" y2="1"><stop offset="0"></stop><stop offset="1"></stop></linearGradient></defs>';
  for (let v = y0; v <= y1 + step / 1000; v += step) {
    const y = Y(v).toFixed(1);
    svg += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '"></line><text x="' + (L - 8) + '" y="' + (+y + 4) + '" text-anchor="end">' + (M.clock || (m === "sec" && v >= 60) ? fmtClock(v) : fmtNum(v)) + "</text>";
  }
  const dfx = span > 300 * 86400000 ? DF({ month: "short", year: "2-digit" }) : DF({ day: "numeric", month: "short" });
  const xl = pts.length > 1 ? [0, lastK] : [0];
  if (pts.length > 2 && span > 0) { const mid = (t0 + t1) / 2; let k = 0; pts.forEach((x, n) => { if (Math.abs(x.t - mid) < Math.abs(pts[k].t - mid)) k = n; }); if (k !== 0 && k !== lastK && Math.abs(pts[k].x - pts[0].x) > 70 && Math.abs(pts[lastK].x - pts[k].x) > 70) xl.splice(1, 0, k); }
  xl.forEach(k => { const x = pts[k].x, anchor = pts.length === 1 ? "middle" : k === 0 ? "start" : k === lastK ? "end" : "middle";
    svg += '<text x="' + (anchor === "start" ? x - 4 : anchor === "end" ? x + 4 : x).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + anchor + '">' + esc(dfx.format(pts[k].t)) + "</text>"; });
  if (pts.length > 1) {
    const line = pts.map((x, k) => (k ? "L" : "M") + x.x.toFixed(1) + "," + x.y.toFixed(1)).join("");
    svg += '<path class="area" d="' + line + "L" + pts[lastK].x.toFixed(1) + "," + (T + ph) + "L" + pts[0].x.toFixed(1) + "," + (T + ph) + 'Z"></path><path class="line" d="' + line + '"></path>';
  }
  const dots = pts.length <= 40;
  pts.forEach((x, k) => { if (dots || k === recK || k === lastK) svg += '<circle class="dot' + (k === recK ? " rec" : "") + '" cx="' + x.x.toFixed(1) + '" cy="' + x.y.toFixed(1) + '" r="' + (k === recK ? 5.5 : 4) + '"></circle>'; });
  // étiquettes choisies : le record et la dernière séance seulement
  const lab = (k, txt) => { const x = Math.min(W - R - 2, Math.max(L + 2, pts[k].x)), y = pts[k].y - 11 < T - 14 ? pts[k].y + 20 : pts[k].y - 11;
    const anchor = pts[k].x > W - R - 40 ? "end" : pts[k].x < L + 40 ? "start" : "middle";
    return '<text class="lab" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" text-anchor="' + anchor + '">' + esc(txt) + "</text>"; };
  if (pts.length > 1 && M.neutral) svg += lab(lastK, evoFmt(m, pts[lastK].v));
  else if (pts.length > 1) { svg += lab(recK, "Record " + evoFmt(m, recV)); if (lastK !== recK && Math.abs(pts[lastK].x - pts[recK].x) > 90) svg += lab(lastK, evoFmt(m, pts[lastK].v)); }
  svg += '<line class="xhair" x1="0" x2="0" y1="' + T + '" y2="' + (T + ph) + '" visibility="hidden"></line><circle class="focus" r="6" cx="0" cy="0" visibility="hidden"></circle></svg>';
  return svg;
}
function evoPick(k) {
  if (!evoCur || !evoCur.pts[k]) return;
  evoCur.k = k; const x = evoCur.pts[k], svg = document.querySelector(".evo-svg"), out = document.querySelector(".evo-read"); if (!svg || !out) return;
  const xh = svg.querySelector(".xhair"), f = svg.querySelector(".focus");
  xh.setAttribute("x1", x.x); xh.setAttribute("x2", x.x); xh.setAttribute("visibility", "visible");
  f.setAttribute("cx", x.x); f.setAttribute("cy", x.y); f.setAttribute("visibility", "visible");
  out.querySelector("b").textContent = evoFmt(evoCur.m, x.v);
  out.querySelector(".d").textContent = fmtDateLong(x.t) + (x.ses ? " · " + x.ses : "");
  out.querySelector(".s").textContent = x.sum;
}
function evoNearest(ev) {
  const svg = ev.target.closest && ev.target.closest(".evo-svg"); if (!svg || !evoCur) return;
  const r = svg.getBoundingClientRect(), vx = ((ev.clientX - r.left) / r.width) * (evoCur.W || 360);
  let k = 0; evoCur.pts.forEach((x, n) => { if (Math.abs(x.x - vx) < Math.abs(evoCur.pts[k].x - vx)) k = n; });
  if (k !== evoCur.k) evoPick(k);
}
$app.addEventListener("pointerdown", evoNearest);
$app.addEventListener("pointermove", evoNearest);
$app.addEventListener("keydown", e => {
  if (!evoCur || !e.target.classList || !e.target.classList.contains("evo-svg")) return;
  const d = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "Home" ? -1e9 : e.key === "End" ? 1e9 : 0; if (!d) return;
  e.preventDefault(); evoPick(Math.max(0, Math.min(evoCur.pts.length - 1, (evoCur.k == null ? evoCur.pts.length - 1 : evoCur.k) + d)));
});
// la courbe est redessinée à la largeur réelle de l'écran (textes à la bonne taille sur PC)
function evoFit() {
  if (!evoCur) return;
  const card = document.querySelector(".evo-card"), old = card && card.querySelector(".evo-svg"); if (!old) return;
  const W = Math.max(300, Math.min(1000, Math.round(old.getBoundingClientRect().width)));
  if (Math.abs(W - evoCur.W) > 24) { evoCur.W = W; old.outerHTML = evoChart(evoCur.p, evoCur.m, evoCur.pts, W); }
  evoPick(evoCur.k);
}
window.addEventListener("resize", () => { if (document.querySelector(".evo-svg")) evoFit(); });
function viewEvolutionDetail(key, pane) {
  evoCur = null; if (!pane) evoSel = null;
  const all_ = progressData(); let p = all_.find(x => x.key === key);
  if (!p && key && !/^lib:/.test(key)) { const [nm, ty] = String(key).split("|"), lb = libFor(nm); if (lb) p = all_.find(x => x.key === "lib:" + lb.id + "|" + ty); } // ancien lien (nom de l'exercice)
  if (!p && key) p = all_.find(x => x.key.indexOf(key + "|") === 0); // ancien lien d'un exercice Distance (avant une courbe par distance)
  const back = pane ? "" : '<a class="back" href="#/evolution">‹ Évolution</a>';
  if (isFree()) return back + planCard("La courbe de chaque exercice est réservée à Premium.");
  if (!p) return back + '<div class="card empty">Pas encore de données pour cet exercice.</div>';
  const ms = evoMetrics(p), m = ms.includes(evo.m[key]) ? evo.m[key] : ms[0], M = evoDef(m);
  const allT = p.entries.map(x => x.w.startedAt), fullSpan = allT[allT.length - 1] - allT[0];
  const pers = EVO_P.filter(x => !x[2] || fullSpan > x[2] * 86400000 * 0.9);
  const per = pers.some(x => x[0] === evo.per) ? evo.per : "all", days = (EVO_P.find(x => x[0] === per) || [0, 0, 0])[2];
  const from = days ? Date.now() - days * 86400000 : -Infinity;
  const ent = p.entries.filter(x => x.w.startedAt >= from);
  const pts = ent.filter(x => evoVal(x, m) != null).map(x => ({ t: x.w.startedAt, v: evoVal(x, m), ses: x.w.templateName + " · " + vLabel(x.w.variantName), sum: exSummary(x.e) }));
  const lib = libById[p.lib] || libFor(p.name), cdm = p.type === "cardio" && CARDIO_MACH[p.machine] ? p.machine : "", lid = cdm || (lib && lib.id);
  let h = back + '<div class="page-head"><h1>' + esc(p.name) + (p.dist > 0 ? ' <span class="muted">· ' + esc(fmtNum(p.dist)) + " m</span>" : "") + "</h1></div>" +
    (lid ? '<div class="ex-chips" style="margin:-4px 0 12px"><button type="button" class="chip-mini" data-act="exoview" data-id="' + esc(lid) + '"' + (cdm ? ' data-arg="cardio"' : "") + ">" + ICON.play + (cdm ? "Voir la machine" : "Voir le mouvement") + "</button></div>" : "");
  const seg = (list, on, act) => '<div class="seg evo-seg seg-' + act + '" role="group">' + list.map(x => '<button type="button" data-act="' + act + '" data-k="' + esc(key) + '" data-v="' + x[0] + '"' + (x[0] === on ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + ">" + esc(x[1]) + "</button>").join("") + "</div>";
  if (ms.length > 1 || pers.length > 1) h += '<div class="evo-filters">' + (ms.length > 1 ? seg(ms.map(x => [x, evoDef(x).short]), m, "evometric") : "") + (pers.length > 1 ? seg(pers, per, "evoper") : "") + "</div>";
  if (!pts.length) return h + '<div class="card empty">Aucune séance avec cet exercice sur cette période.</div>';
  const vs = pts.map(x => x.v), best = M.low ? Math.min(...vs) : Math.max(...vs), first = pts[0].v, last = pts[pts.length - 1].v;
  const dlt = pts.length > 1 ? last - first : null, good = dlt == null || !dlt ? "" : (M.low ? dlt < 0 : dlt > 0) ? " up" : " down";
  h += '<div class="stats k3">' +
    '<div class="card stat"><div class="muted small">' + (per === "all" ? "Record" : "Meilleur") + '</div><div class="v">' + evoFmt(m, best) + "</div></div>" +
    '<div class="card stat"><div class="muted small">Dernière séance</div><div class="v">' + evoFmt(m, last) + "</div></div>" +
    '<div class="card stat"><div class="muted small">Évolution</div><div class="v' + good + '">' + evoDiff(m, dlt) + '</div><div class="muted small">' + (pts.length > 1 ? "depuis le " + esc(fmtDate(pts[0].t)) : "une seule séance") + "</div></div>" +
    '<div class="card stat"><div class="muted small">Séances</div><div class="v">' + ent.length + "</div></div></div>";
  evoCur = { pts, m, k: pts.length - 1, W: 360, p };
  const lx = pts[pts.length - 1];
  h += '<div class="card evo-card"><div class="spread" style="align-items:baseline"><div class="muted small" style="font-weight:600">' + esc(M.label) + (M.low ? " · plus bas = plus rapide" : "") + "</div></div>" +
    '<div class="evo-read" aria-live="polite"><b>' + evoFmt(m, lx.v) + '</b><span class="d">' + esc(fmtDateLong(lx.t) + " · " + lx.ses) + '</span><span class="s">' + esc(lx.sum) + "</span></div>" +
    evoChart(p, m, pts) +
    (pts.length === 1 ? '<p class="muted small" style="margin:8px 0 0">Une seule séance pour l\'instant : la courbe se dessinera dès la prochaine.</p>' : '<p class="muted small" style="margin:8px 0 0">Fais glisser le doigt sur la courbe pour voir chaque séance.</p>') + "</div>";
  if (m === "orm") h += '<p class="muted small">1RM estimé : la charge que tu pourrais soulever une seule fois, calculée à partir de tes séries (formule d\'Epley).</p>';
  h += '<div class="section-title">Historique</div><div class="list">' + ent.slice().reverse().map(x =>
    '<a href="#/session/' + x.w.id + '"><div><b>' + esc(fmtDate(x.w.startedAt)) + '</b><div class="muted small">' + esc(x.w.templateName) + " · " + esc(vLabel(x.w.variantName)) + '</div></div><span class="small" style="text-align:right">' + esc(exSummary(x.e)) + (x.orm != null ? '<br><span class="muted">1RM ≈ ' + fmtNum(Math.round(x.orm * 2) / 2) + " kg</span>" : "") + "</span></a>").join("") + "</div>";
  setTimeout(evoFit, 0);
  return h;
}

/* ================= Stats › Évolution : poids (facultatif, avec accord exprès) ================= */
// Une pesée par jour : élément « weight », id « poids-AAAA-MM-JJ » (deux appareils le même jour : la dernière pesée gagne).
// Le poids peut renseigner sur la santé : il n'est noté qu'après un accord exprès, séparé et retirable ; « Retirer mon accord »
// efface toutes les pesées. Pas d'objectif, pas d'IMC, pas d'interprétation : une courbe neutre.
// Version gratuite : les 30 derniers jours ; Premium : tout l'historique (les pesées plus anciennes sont gardées, juste masquées).
const W_FREE_DAYS = 30, W_MIN = 20, W_MAX = 400;
const W_CONSENT = "C'est facultatif. Ton poids peut renseigner sur ta santé : si tu le notes, il est enregistré (et synchronisé entre tes appareils avec Premium), visible de toi seul, jamais partagé ni utilisé pour autre chose, et supprimé avec ton compte. Tu peux retirer ton accord quand tu veux (« Ne plus suivre mon poids », puis « Retirer mon accord ») : tes pesées sont alors effacées.";
const weightOk = () => !!settings().weightOk;
const weights = () => all("weight").filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.date || "") && typeof x.kg === "number").sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const wTime = d => new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), 12).getTime();
const wFmt = kg => (Math.round(kg * 10) / 10).toFixed(1).replace(".", ",") + " kg"; // toujours une décimale : 79,0 kg
const wFreeFrom = () => ymd(Date.now() - (W_FREE_DAYS - 1) * 86400000);
const weightsShown = () => isFree() ? weights().filter(x => x.date >= wFreeFrom()) : weights();
function eraseWeights() { flushPending(); let n = 0; for (const it of Object.values(db.items)) if (it.kind === "weight" && !it.deleted) { remove(it.id); n++; } return n; }
// accord retiré : une pesée revenue d'un appareil qui ne le savait pas encore (hors ligne) est effacée à son tour
function weightGoneSweep() { if (!weightOk() && settings().weightGoneAt && weights().length) eraseWeights(); }
// ligne « Poids » en haut de Stats › Évolution (aussi en version gratuite)
function weightRowHtml() {
  if (settings().weightHidden) return "";
  const ws = weightsShown(), last = ws[ws.length - 1], ok = weightOk();
  const sub = !ok ? "Facultatif : suis l'évolution de ton poids" : last ? ws.length + " pesée" + (ws.length > 1 ? "s" : "") + " · " + dfDay.format(wTime(last.date)) : "Note ton poids pour voir sa courbe";
  const right = ok && last ? '<span class="evo-r">' + sparkline(ws.slice(-12).map(x => x.kg)) + '<span class="small"><b>' + wFmt(last.kg) + '</b> <span class="muted">dernière</span></span></span>' : "";
  return '<div class="list evo-weight"><a href="#/evolution/poids"' + (evoSel ? " data-pane" : "") + (evoSel === "poids" ? ' class="pc-on" aria-current="true"' : "") + '><div><b>Poids</b><div class="muted small">' + esc(sub) + "</div></div>" + right + "</a></div>";
}
const weightShowLink = () => settings().weightHidden ? '<button type="button" class="linkbtn" data-act="wshow">+ Suivre mon poids</button>' : "";
let wPer = "all";
function viewWeight(pane) {
  evoCur = null; if (!pane) evoSel = null;
  let h = (pane ? "" : '<a class="back" href="#/evolution">‹ Évolution</a>') + '<div class="page-head"><h1>Poids</h1></div>';
  if (!weightOk()) return h + '<div class="card w-ask"><h3>Suivre ton poids ?</h3><p class="small">' + esc(W_CONSENT) + '</p>' +
    '<div class="w-btns"><button type="button" class="btn primary" data-act="wok">J\'accepte de noter mon poids</button><button type="button" class="btn" data-act="wno">Non merci</button></div></div>';
  const all_ = weights(), ws = weightsShown(), today = ymd(Date.now()), cur = all_.find(x => x.date === today);
  h += '<div class="card w-form"><div class="muted small" style="font-weight:600">Noter mon poids</div><div class="w-row">' +
    '<label class="fl">Jour<input type="date" class="f" data-w-date max="' + today + '"' + (isFree() ? ' min="' + wFreeFrom() + '"' : "") + ' value="' + today + '"></label>' +
    '<label class="fl">Poids (kg)<input class="f" data-w-kg inputmode="decimal" autocomplete="off" maxlength="6" placeholder="ex. 72,4" value="' + (cur ? esc(fmtNum(cur.kg)) : "") + '"></label></div>' +
    '<button type="button" class="btn primary" data-act="wsave">Enregistrer</button><p class="muted small">Une valeur par jour, en kg avec une décimale : en noter une autre pour le même jour la remplace.</p></div>';
  if (isFree()) h += '<p class="muted small w-free">Version gratuite : les ' + W_FREE_DAYS + ' derniers jours. Avec <a href="#/premium">Premium</a>, tout l\'historique de ton poids.</p>';
  const span = ws.length > 1 ? wTime(ws[ws.length - 1].date) - wTime(ws[0].date) : 0;
  const pers = isFree() ? [] : EVO_P.filter(x => !x[2] || span > x[2] * 86400000 * 0.9);
  const per = pers.some(x => x[0] === wPer) ? wPer : "all", days = (EVO_P.find(x => x[0] === per) || [0, 0, 0])[2];
  const from = days ? ymd(Date.now() - (days - 1) * 86400000) : "", ent = ws.filter(x => !from || x.date >= from);
  if (pers.length > 1) h += '<div class="evo-filters"><div class="seg evo-seg" role="group" aria-label="Période">' + pers.map(x => '<button type="button" data-act="wper" data-v="' + x[0] + '"' + (x[0] === per ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + ">" + esc(x[1]) + "</button>").join("") + "</div></div>";
  if (!ent.length) h += '<div class="card empty">' + (ws.length ? "Aucune pesée sur cette période." : "Note ton poids ci-dessus pour commencer ta courbe.") + "</div>";
  else {
    const first = ent[0], last = ent[ent.length - 1], dlt = ent.length > 1 ? Math.round((last.kg - first.kg) * 10) / 10 : null;
    h += '<div class="stats">' +
      '<div class="card stat"><div class="muted small">Dernière pesée</div><div class="v">' + wFmt(last.kg) + '</div><div class="muted small">' + esc(fmtDate(wTime(last.date))) + "</div></div>" +
      '<div class="card stat"><div class="muted small">Évolution</div><div class="v">' + (dlt == null ? "—" : !dlt ? "Stable" : (dlt > 0 ? "+" : "−") + wFmt(Math.abs(dlt))) + '</div><div class="muted small">' + (ent.length > 1 ? ent.length + " pesées depuis le " + esc(fmtDate(wTime(first.date))) : "une seule pesée") + "</div></div></div>";
    const pts = ent.map(x => ({ t: wTime(x.date), v: x.kg, ses: "", sum: "" })), p = { name: "Poids" };
    evoCur = { pts, m: "poids", k: pts.length - 1, W: 360, p };
    h += '<div class="card evo-card"><div class="muted small" style="font-weight:600">Poids</div>' +
      '<div class="evo-read" aria-live="polite"><b>' + wFmt(last.kg) + '</b><span class="d">' + esc(fmtDateLong(wTime(last.date))) + '</span><span class="s"></span></div>' + evoChart(p, "poids", pts) +
      '<p class="muted small" style="margin:8px 0 0">' + (pts.length === 1 ? "Une seule pesée pour l'instant : la courbe se dessinera dès la prochaine." : "Fais glisser le doigt sur la courbe pour voir chaque pesée.") + "</p></div>";
    h += '<div class="section-title">Pesées</div><div class="list w-list">' + ent.slice().reverse().map(x => '<div><b>' + esc(fmtDate(wTime(x.date))) + '</b><span class="w-r"><b class="num">' + wFmt(x.kg) + '</b>' +
      '<button type="button" class="cv-del" data-act="wdel" data-id="' + x.id + '" aria-label="Supprimer la pesée du ' + esc(fmtDate(wTime(x.date))) + '">×</button></span></div>').join("") + "</div>";
    setTimeout(evoFit, 0);
  }
  return h + '<button type="button" class="linkbtn" data-act="woff">Ne plus suivre mon poids</button>';
}
async function weightAction(act, b) {
  const st = settings();
  if (act === "wok") { st.weightOk = new Date().toISOString(); st.weightHidden = false; put("settings", st); render(); return; }
  if (act === "wno") { st.weightHidden = true; put("settings", st); toast("Le poids n'est plus proposé. « + Suivre mon poids », en bas de l'onglet Évolution, le réaffiche"); go("evolution"); return; }
  if (act === "wshow") { st.weightHidden = false; put("settings", st); go("evolution/poids"); return; }
  if (act === "wper") { wPer = b.dataset.v; render(); return; }
  if (act === "wsave") {
    if (!weightOk()) return;
    const di = document.querySelector("[data-w-date]"), ki = document.querySelector("[data-w-kg]"); if (!di || !ki) return;
    const date = di.value, today = ymd(Date.now()), kg = Math.round(Number(String(ki.value).replace(",", ".").replace(/\s/g, "")) * 10) / 10;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) { toast("Choisis un jour passé ou aujourd'hui"); return; }
    if (isFree() && date < wFreeFrom()) { toast("En version gratuite, tu peux noter les " + W_FREE_DAYS + " derniers jours"); return; }
    if (!ki.value.trim() || !(kg >= W_MIN && kg <= W_MAX)) { toast("Note un poids entre " + W_MIN + " et " + W_MAX + " kg"); ki.focus(); return; }
    const id = "poids-" + date, had = getItem(id);
    put("weight", { id, date, kg, at: Date.now() });
    toast(had ? "Pesée du " + fmtDate(wTime(date)) + " remplacée : " + wFmt(kg) : "Poids enregistré : " + wFmt(kg)); render(); return;
  }
  if (act === "wdel") {
    const x = getItem(b.dataset.id); if (!x) return;
    if (!await ask({ title: "Supprimer cette pesée ?", text: fmtDate(wTime(x.date)) + " : " + wFmt(x.kg), ok: "Supprimer", danger: true })) return;
    remove(x.id); render(); return;
  }
  if (act === "woff") {
    const n = weights().length;
    const c = await choose("Suivi du poids", [
      ["hide", "Masquer seulement", "Le poids disparaît de l'onglet Évolution ; ton accord et " + (n > 1 ? "tes " + n + " pesées sont gardés" : n ? "ta pesée sont gardés" : "ton suivi sont gardés") + ". « + Suivre mon poids », en bas de l'onglet, le réaffiche."],
      ["erase", n > 1 ? "Retirer mon accord et effacer mes " + n + " pesées" : n ? "Retirer mon accord et effacer ma pesée" : "Retirer mon accord",
        "Ton poids n'est plus noté" + (n ? ", et " + (n > 1 ? "tes pesées sont effacées" : "ta pesée est effacée") + " (aussi sur tes autres appareils, à la prochaine synchronisation)" : "") + ". Tu pourras redonner ton accord plus tard."]
    ], "Que veux-tu faire ?");
    if (!c) return;
    if (c === "hide") { st.weightHidden = true; put("settings", st); toast("Poids masqué : ton accord et tes pesées sont gardés"); go("evolution"); return; }
    eraseWeights();
    const s2 = settings(); s2.weightOk = null; s2.weightGoneAt = new Date().toISOString(); s2.weightHidden = true; put("settings", s2);
    toast(n ? "Accord retiré : " + (n > 1 ? n + " pesées effacées" : "1 pesée effacée") : "Accord retiré : ton poids n'est plus noté"); go("evolution");
  }
}
// jour choisi : le poids déjà noté ce jour-là s'affiche (pour le corriger)
document.addEventListener("change", e => {
  if (!e.target.matches || !e.target.matches("input[data-w-date]")) return;
  const x = getItem("poids-" + e.target.value), ki = document.querySelector("[data-w-kg]");
  if (ki) ki.value = x && typeof x.kg === "number" ? fmtNum(x.kg) : "";
});

/* ================= Records et 1RM estimé ================= */
// 1RM estimé (formule d'Epley), fiable jusqu'à une quinzaine de répétitions
const e1rm = (kg, r) => (kg == null || kg <= 0 || r == null || r <= 0 || r > 20) ? null : (r === 1 ? kg : kg * (1 + r / 30));
const TROPHY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0z"/><path d="M17 5h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3"/></svg>';
// record = la série qu'on vient de valider donne le meilleur 1RM estimé jamais atteint sur cet exercice
function checkRecord(w, i, s) {
  const e = w.exercises[i], set = e.sets[s], n = exKey(e);
  if (e.type !== "reps" && e.type) return null;
  const cur = e1rm(num(set.kg), num(set.reps));
  if (cur == null) return null;
  let best = null;
  const consider = st => { const o = e1rm(num(st.kg), num(st.reps)); if (o != null && (best == null || o > best)) best = o; };
  for (const x of finished()) if (x.id !== w.id) for (const ex of x.exercises) if (exKey(ex) === n && ex.type === e.type) ex.sets.forEach(consider);
  w.exercises.forEach((ex, ii) => { if (exKey(ex) === n && ex.type === e.type) ex.sets.forEach((st, ss) => { if (st.done && !(ii === i && ss === s)) consider(st); }); });
  if (best == null || cur <= best + 0.05) return null; // première fois, ou pas mieux
  return { title: "Nouveau record !", text: e.name + " : 1RM estimé " + fmtNum(Math.round(cur * 2) / 2) + " kg (" + fmtNum(num(set.kg)) + " kg × " + fmtNum(num(set.reps)) + ")" };
}
function celebrate(rec) {
  if (!rec) return;
  document.querySelectorAll(".recordpop").forEach(x => x.remove());
  const d = document.createElement("div"); d.className = "recordpop"; d.setAttribute("role", "alert");
  d.innerHTML = '<div class="rec-box"><div class="rec-icon">' + TROPHY + '</div><div class="rec-title">' + esc(rec.title) + '</div><div class="rec-text">' + esc(rec.text) + "</div></div>";
  document.body.appendChild(d);
  d.addEventListener("click", () => d.remove());
  setTimeout(() => d.remove(), 3000);
  if (settings().alert !== "aucune") { try { if (Native && Native.vibrate) Native.vibrate("[80,60,80,60,160]"); else if (navigator.vibrate) navigator.vibrate([80, 60, 80, 60, 160]); } catch (e) { } }
}

/* ================= Stats : onglets ================= */
// de simples liens (celui de la page affichée porte aria-current), pas une « liste d'onglets »
function statsTabs(on) {
  return '<div class="tabs stabs">' + [["progress", "Séances"], ["evolution", "Évolution"], ["calendar", "Calendrier"], ["history", "Historique"]].map(t =>
    '<a href="#/' + t[0] + '" class="tab' + (t[0] === on ? " on" : "") + '"' + (t[0] === on ? ' aria-current="page"' : "") + ">" + (isFree() && t[0] === "calendar" ? LOCK : "") + t[1] + "</a>").join("") + "</div>";
}

/* ================= Calendrier ================= */
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const ymd = t => { const d = new Date(t); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
function viewCalendar(ym, day) {
  const now = new Date();
  let y = now.getFullYear(), m = now.getMonth();
  if (/^\d{4}-\d{2}$/.test(ym || "") && +ym.slice(5, 7) >= 1 && +ym.slice(5, 7) <= 12) { y = +ym.slice(0, 4); m = +ym.slice(5, 7) - 1; } // sinon : le mois en cours
  const first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate(), lead = (first.getDay() + 6) % 7;
  if (isFree()) return '<div class="page-head"><h1>Stats</h1></div>' + statsTabs("calendar") + planCard("Le calendrier de tes séances est réservé à Premium. Ta semaine en cours est dans « Séances ».");
  const byDay = {}; finished().forEach(w => { const k = ymd(w.startedAt); (byDay[k] = byDay[k] || []).push(w); });
  const goal = num(settings().goal) || 5, perWeek = {}; finished().forEach(w => { const k = weekStart(w.startedAt); perWeek[k] = (perWeek[k] || 0) + 1; });
  const prev = new Date(y, m - 1, 1), next = new Date(y, m + 1, 1);
  const key = d => d.getFullYear() + "-" + pad(d.getMonth() + 1);
  const monthCount = Object.keys(byDay).filter(k => k.startsWith(y + "-" + pad(m + 1))).reduce((n, k) => n + byDay[k].length, 0);
  let h = '<div class="page-head"><h1>Stats</h1></div>' + statsTabs("calendar") +
    '<div class="card"><div class="spread"><a class="btn sm" href="#/calendar/' + key(prev) + '" aria-label="Mois précédent">‹</a>' +
    '<div style="text-align:center"><b class="cal-title">' + MONTHS[m] + " " + y + '</b><div class="muted small">' + monthCount + " séance" + (monthCount > 1 ? "s" : "") + "</div></div>" +
    '<a class="btn sm" href="#/calendar/' + key(next) + '" aria-label="Mois suivant">›</a></div>' +
    '<div class="cal">' + ["L", "M", "M", "J", "V", "S", "D"].map(x => '<div class="cal-h">' + x + "</div>").join("");
  for (let k = 0; k < lead; k++) h += "<div></div>";
  const today = ymd(Date.now());
  for (let d = 1; d <= days; d++) {
    const k = y + "-" + pad(m + 1) + "-" + pad(d), ws = byDay[k] || [];
    const ok = ws.length && (perWeek[weekStart(new Date(y, m, d, 12).getTime())] || 0) >= goal; // semaine où l'objectif est atteint
    const cls = "cal-d" + (ws.length ? " has" : "") + (ok ? " goal" : "") + (k === today ? " today" : "") + (k === day ? " sel" : "");
    const label = d + " " + MONTHS[m] + (ws.length ? " : " + ws.map(w => w.templateName).join(", ") : "");
    h += ws.length ? '<a class="' + cls + '" href="#/calendar/' + y + "-" + pad(m + 1) + "/" + k + '" aria-label="' + esc(label) + '"><span>' + d + "</span>" + (ws.length > 1 ? "<i>" + ws.length + "</i>" : "") + "</a>"
      : '<div class="' + cls + '" aria-label="' + esc(label) + '"><span>' + d + "</span></div>";
  }
  h += '</div><div class="cal-legend"><span class="lg"><span class="cal-key goal"></span>Semaine où ton objectif (' + goal + " séance" + (goal > 1 ? "s" : "") + ') est atteint</span><span class="lg"><span class="cal-key"></span>Autres séances</span></div></div>';
  const list = day && byDay[day] ? byDay[day] : finished().filter(w => ymd(w.startedAt).startsWith(y + "-" + pad(m + 1)));
  h += '<div class="section-title">' + (day && byDay[day] ? esc(fmtDateLong(byDay[day][0].startedAt)) : "Séances du mois") + "</div>" +
    (list.length ? '<div class="list">' + list.map(historyRow).join("") + "</div>" : '<div class="card empty">Aucune séance ce mois-ci.</div>');
  return h;
}

/* ================= Partager une séance ================= */
const b64url = str => btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = s => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4))));
const SHARE_BASE = "https://fiitday.com/#/import/";
const SHARE_SHORT = "https://fiitday.com/#/s/";
// récupère une séance partagée par son code court (lisible sans compte, uniquement si on connaît le code)
async function fetchShare(code) {
  if (!db.auth) { const e = new Error("connexion"); e.login = true; throw e; } // l'import d'un lien court demande d'être connecté
  const headers = { apikey: SUPABASE_KEY, "Content-Type": "application/json" };
  if (db.auth) { try { await ensureToken(); headers.Authorization = "Bearer " + db.auth.access_token; } catch (e) { } }
  const r = await fetch(SUPABASE_URL + "/rest/v1/rpc/get_share", { method: "POST", headers, body: JSON.stringify({ p_code: code }) });
  if (!r.ok) throw new Error("Erreur " + r.status);
  return r.json();
}
async function shareVariant(t, v) {
  const data = { app: "muscuapp-share", v: 1, prog: t.name, name: vLabel(v.name),
    ex: v.exercises.map(e => ({ n: e.name, li: exLib(e) ? exLib(e).id : undefined, t: e.type, m: e.type === "cardio" && e.machine ? e.machine : undefined, l: e.load ? 1 : undefined, s: e.sets, c: e.target, r: e.rest, rn: restNextOf(e, v), no: e.note || "", d: dropsOf(e), ds: dropsOf(e) && e.dropScope === "last" ? "last" : undefined, g: e.groupId || null, k: e.groupKind || null })) };
  // lien court (séance enregistrée dans Supabase avec un code) ; lien long en secours (sans compte, hors ligne…)
  let url = null;
  if (db.auth) {
    const code = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"[b % 56]).join("");
    try { await rest("POST", "shares", { code, data, user_id: db.auth.user.id }, { Prefer: "return=minimal" }); url = SHARE_SHORT + code; }
    catch (e) { console.warn("partage court indisponible", e); }
  }
  if (!url) url = SHARE_BASE + b64url(JSON.stringify(data));
  const text = "Je te partage ma séance « " + t.name + " · " + vLabel(v.name) + " » sur Fiitday :\n" + url + "\n\nDans l'appli : Accueil › Importer, puis colle ce lien." + (url.startsWith(SHARE_SHORT) ? " Il reste valable 7 jours." : "");
  try {
    if (Native && Native.share) { Native.share(text); return; }
    if (navigator.share) { await navigator.share({ title: "Séance Fiitday", text }); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(text); toast("Lien copié : envoie-le à la personne"); }
  catch (e) { await ask({ title: "Partager la séance", text: "Copie ce texte et envoie-le :", input: text, multiline: true, cancel: false, ok: "Fermer" }); }
}
// « Signaler ce contenu » (règlement européen sur les services numériques, art. 16) : e-mail prérempli avec ce qu'il faut
// pour traiter le signalement (code, raisons, nom et e-mail, bonne foi) ; examiné par l'éditeur (Administration › Signalements)
function reportMail(code) {
  const sub = "Signalement d'une séance partagée (code " + code + ")";
  const body = "Code de la séance : " + code + "\nLien : " + SHARE_SHORT + code + "\n\nCe qui pose problème, et pourquoi (contenu illégal ou contraire aux conditions d'utilisation) :\n\n\n" +
    "Ton nom et ton adresse e-mail :\n\n\nJe déclare de bonne foi que les informations de ce signalement sont exactes et complètes.";
  return "mailto:contact@fiitday.com?subject=" + encodeURIComponent(sub) + "&body=" + encodeURIComponent(body);
}
const reportFoot = code => '<p class="small muted report-foot">Contenu illégal ou choquant ? <a class="link" href="' + esc(reportMail(code)) + '">Signaler ce contenu</a></p>';
async function importShared(code) {
  let data, shareCode = "";
  try {
    const str = String(code || "").trim();
    const short = str.match(/(?:#\/s\/|^)([A-Za-z0-9]{6,12})$/);
    if (short) {
      try { data = await fetchShare(short[1]); }
      catch (e) { toast(e && e.login ? "Connecte-toi à ton compte pour importer cette séance" : navigator.onLine === false ? "Pas de connexion internet" : "Impossible de récupérer la séance, réessaie"); return; }
      if (!data) { toast("Cette séance partagée n'existe plus (un lien de partage est effacé au bout de 7 jours)"); return; }
      shareCode = short[1];
    } else {
      const m = str.match(/import\/([A-Za-z0-9_-]+)/);
      data = JSON.parse(unb64url(m ? m[1] : str));
    }
    if (!data || data.app !== "muscuapp-share" || !Array.isArray(data.ex) || !data.ex.length || data.ex.length > 60) throw new Error();
  } catch (e) { toast("Ce lien de séance n'est pas valide"); return; }
  const ts = templates(), title = "Importer « " + data.prog + " · " + data.name + " » (" + data.ex.length + " exercice" + (data.ex.length > 1 ? "s" : "") + ")";
  let opts;
  if (isFree()) {
    // version gratuite : 1 programme et 2 séances actives ; la séance reçue va dans le programme actif (place libre, ou à la
    // place d'une séance active si le changement des 30 jours est possible), jamais dans un nouveau programme ni un programme verrouillé
    const at = ts.length ? getItem(freeActive().t) : null;
    if (!at) opts = [["new", "Nouveau programme « " + data.prog + " »", "Crée ton programme avec cette séance"]];
    else if (at.variants.length < FREE_VARIANTS) opts = [["t:" + at.id, "Ajouter à « " + at.name + " »", "Elle sera une de tes 2 séances actives"]];
    else if (freeCanSwitch()) opts = [["swap:" + at.id, "Remplacer une de mes séances actives", "Ajoutée à « " + at.name + " », puis tu choisis tes 2 séances actives (prochain changement dans " + FREE_SWITCH_DAYS + " jours)"]];
    else {
      if (await ask({ title: "Séance reçue", text: "En version gratuite, tu as 2 séances actives. " + freeSwitchTxt() + " Avec Premium, toutes tes séances sont actives.", ok: "Voir Premium", cancel: "Plus tard", foot: shareCode ? reportFoot(shareCode) : "" })) go("premium");
      return;
    }
  } else opts = [["new", "Nouveau programme « " + data.prog + " »", "Crée un programme avec cette séance"]].concat(ts.map(t => ["t:" + t.id, "Ajouter à « " + t.name + " »", "Comme nouvelle séance de ce programme"]));
  let dest = await choose(title, opts, "", shareCode ? reportFoot(shareCode) : "");
  if (!dest) return;
  const swap = dest.startsWith("swap:"); if (swap) dest = "t:" + dest.slice(5);
  const gmap = {};
  const exercises = data.ex.map(x => {
    const e = { id: "e-" + uid(), name: cutStr(x.n || "Exercice", 80) || "Exercice", lib: libById[x.li] ? x.li : undefined, type: x.t === "time" ? "time" : x.t === "dist" ? "dist" : x.t === "rep" ? "rep" : x.t === "cardio" ? "cardio" : "reps", machine: x.t === "cardio" && CARDIO_MACH[x.m] ? x.m : undefined, load: x.t === "dist" && !!x.l, sets: Math.max(1, Math.min(20, num(x.s) || 3)), target: cutStr(x.c, 20), rest: Math.max(0, num(x.r) || 0), restNext: Math.max(0, Math.min(1200, num(x.rn) || num(data.rb) || 0)), note: cutStr(x.no, NOTE_MAX), drops: x.t !== "reps" && x.t ? 0 : Math.max(0, Math.min(3, num(x.d) || 0)), dropScope: x.ds === "last" ? "last" : "all" };
    if (x.g && GROUP_LABEL[x.k]) { gmap[x.g] = gmap[x.g] || "g-" + uid(); e.groupId = gmap[x.g]; e.groupKind = x.k; }
    return e;
  });
  let t, vid = "v" + uid();
  if (dest === "new") {
    t = { id: "tpl-" + uid(), name: cutStr(data.prog, 60) || "Programme partagé", order: ts.length, variants: [{ id: vid, name: cutStr(data.name, 60) || "Séance partagée", exercises }] };
  } else {
    t = getItem(dest.slice(2)); if (!t) return;
    let name = cutStr(data.name, 60) || "Séance partagée";
    if (t.variants.some(v => vLabel(v.name) === name)) name += " (partagée)";
    t.variants.push({ id: vid, name, exercises });
  }
  put("template", t); toast("Séance importée"); go("program/" + t.id + "/" + vid);
  if (swap) setTimeout(() => changeActive(t.id, vid), 300); // choisir l'autre séance active à garder
}

/* ================= Minuteur de repos dans les notifications (appli Android) ================= */
let nativeRestSent = null, nativeRestEnd = 0, nativeChronoSent = null, notifAsked = false;
function askNotif() { if (!notifAsked && Native.askNotifications) { notifAsked = true; Native.askNotifications(); } }
// notifications de Fiitday refusées (appli Android) ?
const notifOff = () => { try { return !!(Native && typeof Native.notificationsOn === "function" && Native.notificationsOn() === "0"); } catch (e) { return false; } };
function notifCard() {
  if (!notifOff()) return "";
  return '<div class="small notif-off"><b>Notifications de Fiitday désactivées.</b> Le téléphone vibre quand même à la fin du repos, mais le temps restant ne s\'affiche pas à l\'écran verrouillé ni sur ta montre.' +
    '<div style="margin-top:8px"><button class="btn sm" data-act="notifon">Autoriser les notifications</button></div></div>';
}
// première séance dans l'appli Android : on explique à quoi servent les notifications, puis Android pose sa question (une seule fois)
async function notifIntro() {
  if (!notifOff() || typeof Native.enableNotifications !== "function") return;
  try { if (localStorage.getItem("fiitday-notif-intro")) return; localStorage.setItem("fiitday-notif-intro", "1"); } catch (e) { return; }
  if (await ask({ title: "Être prévenu à la fin du repos", text: "Fiitday affiche le temps de repos dans les notifications (écran verrouillé, montre) et te prévient à la fin. Autorise les notifications à l'étape suivante.\n\nTu pourras changer d'avis dans Réglages › Alerte de fin de repos.", ok: "Continuer", cancel: "Pas maintenant" })) Native.enableNotifications();
}
// minuteur refusé par Android (appli en arrière-plan) : on prévient
window.__fiitdayTimerFail = () => { toast("Android n'a pas pu lancer le minuteur : garde Fiitday ouvert pendant ce repos"); return true; };
function syncNativeRest() {
  if (!Native || !Native.startRestTimer) return;
  const L = db.live || {}, v = L.restEnd || 0, wOn = watchOn();
  const key = v ? [v, L.restLabel || "", wOn, settings().alert].join("|") : "";
  if (key === nativeRestSent) return;
  nativeRestSent = key;
  try {
    if (v) {
      if (typeof Native.enableNotifications !== "function") askNotif(); // ancienne appli : question d'Android au premier repos
      if (typeof Native.startRest === "function") Native.startRest(String(v), settings().alert, L.restLabel || "Repos", wOn);
      else Native.startRestTimer(String(v), settings().alert);
      nativeRestEnd = v;
    } else {
      // repos arrivé au bout : Android finit seul (alerte, montre) ; repos passé ou annulé : on l'arrête
      if (!nativeRestEnd || Date.now() < nativeRestEnd - 500) Native.stopRestTimer();
      nativeRestEnd = 0;
    }
  } catch (e) { }
}
// chrono (gainage, étirement, course) : notification qui défile, et sur la montre avec l'option
function syncNativeChrono() {
  if (!nativeWatch()) return;
  const c = db.live && db.live.chrono, wOn = watchOn();
  const key = c ? [c.wid, c.i, c.s, c.start, c.target || 0, wOn, settings().alert].join("|") : "";
  if (key === nativeChronoSent) return;
  nativeChronoSent = key;
  try {
    if (c) {
      const w = getItem(c.wid), ex = w && w.exercises[c.i];
      const title = chronoKind(w, c) + (ex ? " · " + ex.name : "");
      const text = c.target ? "Objectif " + fmtHold(c.target) : c.dist ? "Distance : " + fmtNum(c.dist) + " m" : "";
      if (typeof Native.enableNotifications !== "function") askNotif();
      Native.startChrono(String(c.start), String(Math.round(c.target || 0)), settings().alert, title, text, wOn);
    } else Native.stopChrono();
  } catch (e) { }
}
// boutons « Passer » / « Terminer » appuyés dans une notification ou sur la montre : at = heure de l'appui
function nativeAction(act, at) {
  const L = db.live || {};
  if (act === "skiprest") { if (L.restEnd && at < L.restEnd) { L.restEnd = null; L.restMin = false; save(); tick(); } return; }
  if (act === "chronostop") {
    const c = L.chrono; if (!c || at < c.start - 10000) return;
    const w = getItem(c.wid);
    if (w) stopChrono(w, at); else L.chrono = null;
    save(); render(); tick(); // le repos suivant part tout de suite dans le minuteur d'Android (encore en marche)
  }
}
window.__fiitdayPending = () => {
  try { const t = Native && Native.takeAction && Native.takeAction(); if (t) { const a = JSON.parse(t); nativeAction(a.act, Number(a.at) || Date.now()); } } catch (e) { }
  return true;
};

/* ================= Glisser-déposer pour l'ordre des programmes et des séances ================= */
let lastDragEnd = 0;
// glisser-déposer « en direct » : l'élément saisi suit le doigt, les autres s'écartent pour lui faire de la place,
// la liste défile toute seule près des bords ; au lâcher, l'élément prend sa nouvelle place (onDrop reçoit le nouvel ordre)
function liveDrag(e, item, opts) {
  const axis = opts.axis === "x" ? "x" : "y", els = opts.items(), i0 = els.indexOf(item);
  if (i0 < 0 || els.length < 2) return;
  const sc = opts.scroller || null;
  const A = r => axis === "y" ? r.top : r.left, S = r => axis === "y" ? r.height : r.width, P = ev => axis === "y" ? ev.clientY : ev.clientX;
  const scrollPos = () => sc ? (axis === "y" ? sc.scrollTop : sc.scrollLeft) : (axis === "y" ? window.scrollY : window.scrollX);
  const rects = els.map(x => x.getBoundingClientRect()), s0 = scrollPos(), p0 = P(e);
  const gap = Math.max(0, A(rects[1]) - A(rects[0]) - S(rects[0])), size = S(rects[i0]) + gap;
  const T = v => axis === "y" ? "translate3d(0," + v + "px,0)" : "translate3d(" + v + "px,0,0)";
  let target = i0, raf = 0, last = e, moved = false;
  item.classList.add("dragging"); Object.assign(item.style, { transition: "none", position: "relative", zIndex: "6", willChange: "transform" });
  els.forEach(x => { if (x !== item) x.style.transition = "transform .18s ease"; });
  document.documentElement.classList.add("is-dragging");
  const update = () => {
    raf = 0;
    const d = P(last) - p0 + (scrollPos() - s0); if (Math.abs(d) > 3) moved = true;
    item.style.transform = T(d);
    const c = A(rects[i0]) + S(rects[i0]) / 2 + d;
    target = els.reduce((n, x, j) => n + (j !== i0 && A(rects[j]) + S(rects[j]) / 2 < c ? 1 : 0), 0);
    els.forEach((x, j) => {
      if (j === i0) return;
      const sh = i0 < target && j > i0 && j <= target ? -size : target < i0 && j >= target && j < i0 ? size : 0;
      x.style.transform = sh ? T(sh) : "";
    });
  };
  // défilement automatique près des bords (liste longue, page qui dépasse l'écran)
  const auto = setInterval(() => {
    const p = P(last), box = sc ? sc.getBoundingClientRect() : null, lo = box ? A(box) : 0, hi = box ? lo + S(box) : (axis === "y" ? innerHeight : innerWidth);
    const v = p < lo + 48 ? -12 : p > hi - 72 ? 12 : 0; if (!v) return;
    if (sc) { if (axis === "y") sc.scrollTop += v; else sc.scrollLeft += v; } else window.scrollBy(axis === "y" ? 0 : v, axis === "y" ? v : 0);
    update();
  }, 16);
  const move = ev => { if (ev.pointerId !== e.pointerId) return; ev.preventDefault(); last = ev; if (!raf) raf = requestAnimationFrame(update); };
  const up = ev => {
    if (ev.pointerId !== e.pointerId) return;
    document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up);
    clearInterval(auto); if (raf) cancelAnimationFrame(raf);
    if (ev.type === "pointerup") { last = ev; update(); }
    els.forEach(x => Object.assign(x.style, { transition: "", transform: "", position: "", zIndex: "", willChange: "" }));
    item.classList.remove("dragging"); document.documentElement.classList.remove("is-dragging");
    lastDragEnd = Date.now();
    if (!moved || target === i0) return;
    const rest = els.filter(x => x !== item), ref = rest[target];
    if (ref) ref.parentElement.insertBefore(item, ref); else rest[rest.length - 1].after(item);
    opts.onDrop(rest.slice(0, target).concat([item], rest.slice(target)));
  };
  document.addEventListener("pointermove", move, { passive: false });
  document.addEventListener("pointerup", up); document.addEventListener("pointercancel", up);
}
// listes de l'appli : poignée ⠿ (data-drag) dans un élément data-sort-id d'une liste data-sortable
document.addEventListener("pointerdown", e => {
  const h = e.target.closest && e.target.closest("[data-drag]"); if (!h || e.button) return;
  const item = h.closest("[data-sort-id]"), box = item && item.closest("[data-sortable]"); if (!box) return;
  e.preventDefault();
  const axis = box.dataset.axis === "x" ? "x" : "y";
  liveDrag(e, item, {
    axis, scroller: axis === "x" && box.scrollWidth > box.clientWidth ? box : null,
    items: () => Array.from(box.querySelectorAll("[data-sort-id]")).filter(x => x.parentElement === item.parentElement),
    onDrop: order => {
      const ids = order.map(x => x.dataset.sortId), kind = box.dataset.sortable;
      if (kind === "tpl") {
        const ts = templates();
        ids.forEach((id, n) => { const t = ts.find(x => x.id === id); if (t && t.order !== n) { t.order = n; put("template", t); } });
      } else if (kind === "var") {
        const { t } = currentProgram(); if (!t) return;
        const byId = {}; t.variants.forEach(v => { byId[v.id] = v; });
        const next = ids.map(id => byId[id]).filter(Boolean);
        if (next.length === t.variants.length) { t.variants = next; put("template", t); }
      } else if (kind === "blk") { // blocs d'exercices de la configuration d'une séance (un superset se déplace en entier)
        const { t, v } = currentProgram(); if (!v) return;
        const byKey = {}; blocks(v.exercises).forEach(b => { byKey["t:" + (b.groupId || b.items[0].e.id)] = b.items.map(x => x.e); });
        const next = ids.flatMap(k => byKey[k] || []);
        if (next.length === v.exercises.length) { v.exercises = next; put("template", t); }
      }
      render();
    }
  });
});

/* ================= Roue de choix des temps (repos, gainage) ================= */
const fmtShort = v => (!v ? "aucun" : v < 60 ? v + "s" : Math.floor(v / 60) + "min" + (v % 60 ? pad(v % 60) : ""));
const fmtSecs = v => (v === 0 ? "Aucun" : v < 60 ? v + " s" : Math.floor(v / 60) + " min" + (v % 60 ? " " + pad(v % 60) : ""));
function pickSeconds(title, value, min, max) {
  const vals = []; for (let x = min; x <= max; x += 5) vals.push(x);
  value = Math.round(num(value) || 0);
  if (value >= min && value <= max && !vals.includes(value)) { vals.push(value); vals.sort((a, b) => a - b); }
  return pickWheels(title, [{ vals, fmt: fmtSecs, value: Math.min(Math.max(value, min), max) }]).then(r => (r ? r[0] : null));
}
// durée d'une machine de cardio : une roue pour les minutes, une pour les secondes (comme le temps de repos)
function pickDuration(title, sec) {
  sec = Math.max(0, Math.round(num(sec) || 0));
  const mins = Array.from({ length: 301 }, (_, k) => k), secs = Array.from({ length: 60 }, (_, k) => k);
  return pickWheels(title, [{ name: "Minutes", vals: mins, fmt: x => x + " min", value: Math.min(300, Math.floor(sec / 60)) }, { name: "Secondes", vals: secs, fmt: x => pad(x) + " s", value: sec % 60 }]).then(r => (r ? r[0] * 60 + r[1] : null));
}
// distance avec des roues : en km (km entiers + centièmes) ou en mètres (km + mètres, par 10 m)
const rng = (n, step) => Array.from({ length: n }, (_, k) => k * (step || 1));
function pickDistance(title, value, unit) {
  const v = Math.max(0, num(value) || 0);
  if (unit === "km") { const c = Math.round(v * 100); return pickWheels(title, [{ name: "Kilomètres", vals: rng(201), fmt: x => String(x), value: Math.min(200, Math.floor(c / 100)) }, { name: "Centièmes de kilomètre", vals: rng(100), fmt: x => "," + pad(x) + " km", value: c % 100 }]).then(r => (r ? Math.round(r[0] * 100 + r[1]) / 100 : null)); }
  const m = Math.round(v / 10) * 10;
  return pickWheels(title, [{ name: "Kilomètres", vals: rng(43), fmt: x => x + " km", value: Math.min(42, Math.floor(m / 1000)) }, { name: "Mètres", vals: rng(100, 10), fmt: x => String(x).padStart(3, "0") + " m", value: m % 1000 }]).then(r => (r ? r[0] * 1000 + r[1] : null));
}
// roues d'un indicateur de cardio : [maximum, décimales (10 : dixièmes), valeur de départ]
const CV_W = { vit: [30, 10, 10], incl: [40, 10, 1], res: [40, 0, 8], cad: [200, 0, 80], watts: [1000, 0, 150], spm: [250, 0, 120], etages: [500, 0, 50], marches: [3000, 0, 500],
  niv: [30, 0, 8], cpm: [60, 0, 25], cal: [2000, 0, 200], fc: [220, 0, 130] };
function pickNumber(title, value, spec, unit) {
  const [max, dec, def] = spec, v = num(value) != null ? num(value) : def, u = unit ? " " + unit : "";
  if (!dec) return pickWheels(title, [{ vals: rng(max + 1), fmt: x => (unit === "niveau" ? "Niveau " + x : x + u), value: Math.min(max, Math.round(v)) }]).then(r => (r ? r[0] : null));
  const t = Math.round(v * dec);
  return pickWheels(title, [{ name: "Unités", vals: rng(max + 1), fmt: x => String(x), value: Math.min(max, Math.floor(t / dec)) }, { name: "Dixièmes", vals: rng(dec), fmt: x => "," + x + u, value: t % dec }]).then(r => (r ? Math.round((r[0] + r[1] / dec) * 10) / 10 : null));
}
// une case de série : les kilos (entiers + quarts) ou les répétitions
const KG_DEC = [0, 0.25, 0.5, 0.75];
function pickSet(title, kg, reps) {
  const cols = [];
  if (kg != null) { // poids négatif = assistance (machine à contrepoids, élastique) : −20 kg ; « −0 » permet −0,25 / −0,50 / −0,75 kg
    const q = Math.max(-100, Math.min(400, Math.round(kg * 4) / 4)), a = Math.abs(q), i = Math.floor(a), fr = a - i;
    const ints = rng(100).map(x => x - 100).concat(["m0"], rng(401));
    cols.push({ name: "Kilos", vals: ints, fmt: x => (x === "m0" ? "−0" : x < 0 ? "−" + -x : String(x)), value: q < 0 ? (i ? -i : "m0") : i }, { name: "Quarts de kilo", vals: KG_DEC, fmt: x => "," + String(Math.round(x * 100)).padStart(2, "0") + " kg", value: fr });
  }
  if (reps != null) cols.push({ name: "Répétitions", vals: rng(101), fmt: x => (x ? x + " reps" : "—"), value: Math.min(100, Math.round(reps)) });
  return pickWheels(title, cols).then(r => r && { kg: kg != null ? (r[0] === "m0" ? -r[1] : r[0] < 0 ? r[0] - r[1] : r[0] + r[1]) : null, reps: reps != null ? r[r.length - 1] : null });
}
const fmtDist = (v, unit) => (unit === "km" ? fmtNum(v) + " km" : v >= 1000 ? fmtNum(v / 1000) + " km" : fmtNum(v) + " m");
// fenêtre à une ou plusieurs roues à faire défiler ; renvoie les valeurs choisies (ou null)
let wheelSeq = 0;
function pickWheels(title, cols) {
  return new Promise(res => {
    const d = document.createElement("div"); d.className = "modal sheet";
    const tl = String(title).split(" · "), uid = "wv" + (++wheelSeq); // chaque colonne a son nom (« Kilos », « Quarts de kilo »…) et annonce sa valeur
    const ctxT = tl.length > 1 && cols.some(c => (c.name || c.label) === tl[0]) ? tl.slice(1).join(" · ") : title; // « Kilos · Développé couché » : pas « Kilos · Kilos · … »
    d.innerHTML = '<div class="modal-box" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><h3 class="wheel-title">' + tl.map((x, k) => k ? '<span class="wt-' + (k === 1 ? "ex" : "sub") + '">' + esc(x) + "</span>" : "<span>" + esc(x) + "</span>").join("") + '</h3><div class="wheels' + (cols.length > 1 ? " multi" : "") + '" style="--n:' + cols.length + '">' +
      (cols.some(c => c.label) ? cols.map(c => '<div class="wheel-lab">' + esc(c.label || "") + "</div>").join("") : "") +
      cols.map((c, n) => '<div class="wheel-wrap"><div class="wheel-band" aria-hidden="true"></div><div class="wheel" data-col="' + n + '" tabindex="0" role="listbox" aria-label="' + esc(cols.length > 1 ? (c.name || c.label || "Colonne " + (n + 1)) + " · " + ctxT : title) + '">' +
        c.vals.map((x, k) => '<div class="wv" role="option" id="' + uid + "-" + n + "-" + k + '" aria-selected="false" data-k="' + k + '">' + esc(c.fmt(x)) + "</div>").join("") + "</div></div>").join("") + "</div>" +
      '<div class="modal-btns"><button class="btn" data-r="0">Annuler</button><button class="btn primary" data-r="1">OK</button></div></div>';
    document.body.appendChild(d);
    const H = 44, wheels = [...d.querySelectorAll(".wheel")];
    const idx = cols.map(c => Math.max(0, c.vals.indexOf(c.value)));
    const items = wheels.map(w => w.children), shown = cols.map(() => -1), raf = cols.map(() => 0), touching = cols.map(() => false);
    const mark = n => {
      const w = wheels[n]; idx[n] = Math.max(0, Math.min(cols[n].vals.length - 1, Math.round(w.scrollTop / H)));
      if (shown[n] === idx[n]) return;
      const old = items[n][shown[n]], cur = items[n][idx[n]];
      if (old) { old.classList.remove("on"); old.setAttribute("aria-selected", "false"); }
      if (cur) { cur.classList.add("on"); cur.setAttribute("aria-selected", "true"); w.setAttribute("aria-activedescendant", cur.id); }
      shown[n] = idx[n];
    };
    const settle = n => { const w = wheels[n], t = idx[n] * H; if (Math.abs(w.scrollTop - t) > 1) w.scrollTo({ top: t, behavior: "smooth" }); };
    requestAnimationFrame(() => { wheels.forEach((w, n) => { w.scrollTop = idx[n] * H; mark(n); }); wheels[0].focus(); });
    // calage sur une valeur seulement quand le doigt est levé ET que la roue est vraiment immobile (élan terminé) :
    // on regarde la position image après image, ce qui marche même si le téléphone est occupé (aucun arrêt en plein élan)
    const watch = n => {
      if (raf[n]) return;
      let last = wheels[n].scrollTop, still = 0;
      const step = () => {
        if (touching[n] || !d.isConnected) { raf[n] = 0; return; }
        const y = wheels[n].scrollTop;
        if (Math.abs(y - last) < 0.5) still++; else { still = 0; last = y; }
        if (still >= 4) { raf[n] = 0; settle(n); return; }
        raf[n] = requestAnimationFrame(step);
      };
      raf[n] = requestAnimationFrame(step);
    };
    const done = ok => { raf.forEach(cancelAnimationFrame); wheels.forEach((w, n) => mark(n)); d.remove(); res(ok ? cols.map((c, n) => c.vals[idx[n]]) : null); };
    wheels.forEach((w, n) => {
      w.addEventListener("scroll", () => { mark(n); if (!touching[n]) watch(n); }, { passive: true });
      w.addEventListener("touchstart", () => { touching[n] = true; if (raf[n]) { cancelAnimationFrame(raf[n]); raf[n] = 0; } }, { passive: true });
      ["touchend", "touchcancel"].forEach(ev => w.addEventListener(ev, () => { touching[n] = false; watch(n); }, { passive: true }));
      w.addEventListener("keydown", e => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); w.scrollTo({ top: (idx[n] + (e.key === "ArrowDown" ? 1 : -1)) * H, behavior: "smooth" }); }
        if (e.key === "Enter") done(true);
      });
    });
    d.addEventListener("click", e => {
      if (e.target === d) { done(false); return; }
      const v = e.target.closest(".wv"); if (v) { v.closest(".wheel").scrollTo({ top: +v.dataset.k * H, behavior: "smooth" }); return; }
      const b = e.target.closest("[data-r]"); if (b) done(b.dataset.r === "1");
    });
  });
}

/* ================= Propositions de noms d'exercices (recherche intelligente) ================= */
// bibliothèque de l'onglet Exercices (index léger inclus dans la page) : [id, nom, muscles, matériel, temps ?, reps, repos]
const EXO_LIB = (window.EXO_INDEX || []).map(([id, n, mus, gear, kind, reps, rest, dist, load, cat, al, hold, zone, side, g], k) => ({ id, n, mus, gear, kind: ["reps", "time", "dist"][kind] || "reps", reps, rest, dist, load: !!load, cat: cat || "", al: al || [], hold: hold || 0, zone: zone || "", side: !!side, g: g || "", nn: norm(n), k }));
const words = t => norm(t).split(/[^a-z0-9]+/).filter(Boolean);
EXO_LIB.forEach(x => { x.w = words(x.n); x.a = words(x.al.join(" ")); x.o = words(x.mus + " " + x.gear + " " + x.cat); });
const libByName = {}; EXO_LIB.forEach(x => { libByName[x.nn] = x; x.al.forEach(a => { libByName[norm(a)] = x; }); }); // anciens noms reconnus aussi
const libFor = name => (name ? libByName[norm(name)] || null : null);
// l'exercice choisi dans la liste reste le même s'il est renommé : identité enregistrée (lib), sinon reconnue d'après le nom
const libById = {}; EXO_LIB.forEach(x => { libById[x.id] = x; });
const exLib = e => (e ? (e.lib && libById[e.lib]) || (e.machine && libById[e.machine]) || libFor(e.name) : null);
const exKey = e => { const l = exLib(e); return l ? "lib:" + l.id : norm(e.name); }; // même exercice, quel que soit son nom
// renommer : le nom d'un autre exercice de la liste change d'exercice ; un nom perso garde l'exercice (et son mannequin)
// renommer avec un autre exercice proposé (de la liste ou des tiens) : c'est un autre exercice ; un nom perso nouveau garde l'exercice
function isSwitch(e, name) {
  const m = libFor(name), cur = exLib(e);
  if (m) return !cur || cur.id !== m.id;
  if (norm(name) === norm(e.name || "")) return false;
  return ownNames().some(x => norm(x) === norm(name));
}
// nouveau nom : on garde l'exercice (nom perso), ou on prend l'autre exercice avec sa fiche (mannequin, type, cible, repos)
function applyName(e, name, sw, tpl) {
  const n = String(name).slice(0, 80);
  if (!sw) { renameEx(e, n); e.name = n; return; }
  const m = libFor(n), keepCardio = m && e.type === "cardio" && CARDIO_MACH[m.id]; // rameur, SkiErg : la machine de cardio, pas l'atelier Hyrox
  const d = (keepCardio ? { type: "cardio", machine: m.id, sets: 1, target: e.target, rest: 0 } : m ? libDefaults(m) : ownDefaults(n)) || {};
  e.name = n;
  if (m) e.lib = m.id; else delete e.lib;
  if (d.type) e.type = d.type;
  if (d.target != null) e.target = d.target;
  if (d.rest != null) e.rest = d.rest;
  e.load = !!d.load;
  if (e.type === "cardio") e.machine = d.machine || ""; else delete e.machine;
  if (tpl) { if (d.sets) e.sets = e.type === "cardio" ? 1 : d.sets; if (e.type !== "reps") e.drops = 0; }
  e.sw = 1; // la dernière fois : aussi dans les autres séances du programme
}
const askRename = cur => ask({ title: "Renommer l'exercice", text: "Choisis un exercice proposé pour reprendre sa fiche (mouvement, réglages, historique), ou tape ton propre nom.", input: cur, suggest: true, ok: "Renommer" });
function renameEx(e, name) {
  const cur = exLib(e); if (cur && !e.lib) e.lib = cur.id;
  const m = libFor(name); if (m) { e.lib = m.id; if (e.type === "cardio" && CARDIO_MACH[m.id]) e.machine = m.id; }
}
// noms de tes propres exercices (pas ceux de la liste, même renommés)
// tes exercices créés dans la page Exercices (nom, type, indicateurs) ; ceux que tu as supprimés ne sont plus proposés
const ownReg = () => { const l = settings().ownEx; return Array.isArray(l) ? l.filter(x => x && typeof x.n === "string" && x.n.trim()) : []; };
const ownGone = () => { const l = settings().ownGone; return Array.isArray(l) ? l.filter(x => typeof x === "string") : []; };
const ownEntry = name => ownReg().find(x => norm(x.n) === norm(name)) || null;
// exercices perso : relus seulement quand les données changent (la recherche d'exercices l'appelle à chaque lettre)
let onCache = { rev: -1, list: [] };
function ownNames() {
  if (onCache.rev !== dataRev) onCache = { rev: dataRev, list: ownNamesNow() };
  return onCache.list.slice();
}
function ownNamesNow() {
  const seen = new Map(), live = new Set();
  const add = (e, inUse) => { if (!e.name || exLib(e)) return; const k = norm(e.name); if (!seen.has(k)) seen.set(k, e.name.trim()); if (inUse) live.add(k); };
  all("template").forEach(t => t.variants.forEach(v => v.exercises.forEach(e => add(e, true))));
  all("workout").forEach(w => w.exercises.forEach(e => add(e, !w.endedAt)));
  ownReg().forEach(x => add({ name: x.n }, true));
  const gone = new Set(ownGone());
  return Array.from(seen).filter(([k]) => live.has(k) || !gone.has(k)).map(x => x[1]).sort((a, b) => a.localeCompare(b, "fr"));
}
// mots courants (anglais, abréviations, pluriels) → mots de la bibliothèque ; « | » sépare des choix possibles
const SYN = { bench: "developpe couche", dc: "developpe couche", di: "developpe incline", ohp: "developpe militaire", military: "militaire", sdt: "souleve terre", deadlift: "souleve terre",
  rdl: "roumain", lunge: "fentes", lunges: "fentes", fente: "fentes", pec: "pectoraux", pecs: "pectoraux", torse: "pectoraux", epaule: "deltoides", epaules: "deltoides", dos: "dorsaux|trapezes|lombaires",
  jambe: "quadriceps|ischio|fessiers", jambes: "quadriceps|ischio|fessiers", cuisse: "quadriceps", cuisses: "quadriceps", fesse: "fessiers", fesses: "fessiers", abdo: "abdominaux", abdos: "abdominaux",
  planche: "gainage", plank: "gainage", lat: "tirage vertical|laterales", rear: "oiseau|pec deck inverse", row: "rowing", pull: "tirage|tractions", pullup: "tractions", traction: "tractions", tricep: "triceps", bicep: "biceps", mollet: "mollets",
  butterfly: "pec deck", fly: "ecarte", flys: "ecarte", haltere: "halteres", dumbbell: "halteres", press: "presse|developpe", pushup: "pompes", pompe: "pompes", crunchs: "crunch", kb: "kettlebell",
  // abréviations et acronymes courants en salle
  dm: "developpe militaire", dmh: "developpe militaire halteres", dch: "developpe couche halteres", dih: "developpe incline halteres", dd: "pompes declinees", dev: "developpe", dvp: "developpe", devlp: "developpe",
  ht: "hip thrust", hipthrust: "hip thrust", thrust: "hip thrust", rdl: "roumain", sdtr: "roumain", sdtjt: "roumain", jt: "roumain", goodmorning: "roumain", bulgarian: "bulgare", split: "bulgare", fentes: "fentes",
  pulldown: "tirage vertical", latpulldown: "tirage vertical", tv: "tirage vertical", th: "tirage horizontal", seatedrow: "tirage horizontal", tbar: "rowing", rm: "rowing menton", uprightrow: "rowing menton",
  pushdown: "extension triceps poulie", skull: "barre au front", skullcrusher: "barre au front", crusher: "barre au front", french: "barre au front|extension nuque", kickback: "kickback", hammer: "marteau", preacher: "pupitre", larry: "pupitre", spider: "curl",
  shrug: "shrugs", haussement: "shrugs", raise: "elevations", lateral: "laterales", elev: "elevations", elevation: "elevations", oiseaux: "oiseau", reardelt: "oiseau|pec deck inverse", facepull: "face pull",
  legext: "leg extension", extension: "extension", legpress: "presse", presse: "presse", hack: "hack squat", goblet: "squat goblet", calf: "mollets", calves: "mollets", mollets: "mollets",
  adduction: "adducteurs", abduction: "abducteurs", adducteur: "adducteurs", abducteur: "abducteurs", glute: "fessiers", glutes: "fessiers", fessier: "fessiers", quad: "quadriceps", quads: "quadriceps",
  ischios: "ischio", hamstring: "ischio", hamstrings: "ischio", chest: "pectoraux", pecto: "pectoraux", shoulder: "deltoides", shoulders: "deltoides", delt: "deltoides", delts: "deltoides",
  back: "dorsaux", dorsal: "dorsaux", lats: "dorsaux", trap: "trapezes", traps: "trapezes", abs: "abdominaux", ab: "abdominaux", core: "gainage", gainage: "gainage", tri: "triceps", bi: "biceps",
  mc: "mountain climbers", climber: "mountain climbers", climbers: "mountain climbers", swing: "kettlebell swing", wheel: "roue abdominale", rollout: "roue abdominale", leg: "leg|jambes", legs: "quadriceps|ischio|fessiers",
  sit: "crunch", situp: "crunch", relevé: "releve", releve: "releve", knee: "genoux", knees: "genoux", russian: "russian twist", burpee: "burpees", jumpingjack: "jumping jacks", rameur: "rameur", row: "rowing|rameur" };
// distance d'édition (fautes de frappe, lettres inversées)
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
const fuzzy = (tok, w) => { const tol = tok.length >= 7 ? 2 : tok.length >= 4 ? 1 : 0; if (!tol) return false; for (const L of [tok.length - 1, tok.length, tok.length + 1]) if (L > 2 && lev(tok, w.slice(0, L)) <= tol) return true; return false; };
function direct(tok, c) {
  let best = 0;
  for (const w of c.w) { if (w === tok) best = Math.max(best, 4); else if (w.startsWith(tok)) best = Math.max(best, 3); else if (tok.length >= 3 && w.includes(tok)) best = Math.max(best, 2); else if (fuzzy(tok, w)) best = Math.max(best, 1.5); }
  for (const w of c.a || []) { if (w === tok) best = Math.max(best, 3.6); else if (w.startsWith(tok)) best = Math.max(best, 2.7); else if (fuzzy(tok, w)) best = Math.max(best, 1.3); } // autres noms (« rear kick »…)
  for (const w of c.o || []) { if (w.startsWith(tok)) best = Math.max(best, 1.2); else if (fuzzy(tok, w)) best = Math.max(best, 0.6); }
  return best;
}
function tokScore(tok, c) {
  let best = direct(tok, c);
  if (SYN[tok]) for (const alt of SYN[tok].split("|")) { // tous les mots de l'expression doivent correspondre
    let sc = 0; for (const w of alt.split(" ")) { const v = direct(w, c); if (!v) { sc = 0; break; } sc += v; }
    best = Math.max(best, sc * 0.9);
  }
  return best;
}
function searchExercises(q) {
  const toks = words(q); if (!toks.length) return [];
  const own = ownNames().map(n => ({ n, nn: norm(n), w: words(n), own: true }));
  return EXO_LIB.concat(own).map(c => {
    let sc = 0; for (const t of toks) { const v = tokScore(t, c); if (!v) return null; sc += v; }
    return { c, sc: sc + (c.nn.startsWith(norm(q)) ? 2 : 0) };
  }).filter(Boolean).sort((a, b) => b.sc - a.sc || (a.c.own ? 1 : 0) - (b.c.own ? 1 : 0) || (a.c.k || 0) - (b.c.k || 0) || a.c.n.localeCompare(b.c.n, "fr")).map(x => x.c);
}
function suggestFor(input) {
  const box = input.nextElementSibling;
  if (!box || !box.classList.contains("sugg")) return;
  const q = input.value.trim(), toks = words(q);
  const hits = q ? searchExercises(q).filter(c => c.nn !== norm(q)).slice(0, 8) : [];
  if (!hits.length) { box.hidden = true; box.innerHTML = ""; return; }
  // met en gras le début des mots qui correspondent à ce qui est tapé
  const hl = n => n.split(/(\s+)/).map(part => { const w = norm(part), t = toks.find(x => w.startsWith(x)); return t ? "<b>" + esc(part.slice(0, t.length)) + "</b>" + esc(part.slice(t.length)) : esc(part); }).join("");
  box.innerHTML = hits.map(c => '<button type="button" data-pick="' + esc(c.n) + '"><span class="sg-n">' + hl(c.n) + '</span><span class="sg-d">' + (c.own ? "Mes exercices" : esc(c.mus + " · " + c.gear)) + "</span></button>").join("");
  box.hidden = false;
}
document.addEventListener("input", e => { if (e.target.matches && e.target.matches("input[data-suggest]")) suggestFor(e.target); });
document.addEventListener("focusout", e => {
  if (!e.target.matches || !e.target.matches("input[data-suggest]")) return;
  const box = e.target.nextElementSibling;
  setTimeout(() => { if (box && box.classList.contains("sugg") && !box.contains(document.activeElement)) box.hidden = true; }, 150);
});
// le choix se fait au « pointerdown » pour garder le champ actif (pas de fermeture avant le clic)
document.addEventListener("pointerdown", e => {
  const b = e.target.closest && e.target.closest(".sugg [data-pick]"); if (!b) return;
  e.preventDefault();
  const box = b.parentElement, input = box.previousElementSibling;
  input.value = b.dataset.pick;
  box.hidden = true; box.innerHTML = "";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
});

/* ================= Sauvegarde compressée ================= */
// séances : seules les valeurs remplies sont gardées dans la sauvegarde (texte plus court), et remises à l'identique à la restauration
function slimData(x) {
  if (x.kind !== "workout" || !x.data || !Array.isArray(x.data.exercises)) return x.data;
  const clean = o => { const r = {}; for (const k in o) { const v = o[k]; if (v === "" || v === null || v === false || (Array.isArray(v) && !v.length)) continue; r[k] = v; } return r; };
  return Object.assign({}, x.data, { exercises: x.data.exercises.map(e => Object.assign(clean(e), { sets: (e.sets || []).map(st => Object.assign(clean(st), st.drops && st.drops.length ? { drops: st.drops.map(clean) } : {})) })) });
}
function fatWorkout(d) {
  if (!d || !Array.isArray(d.exercises)) return d;
  return Object.assign({}, d, { exercises: d.exercises.map(e => Object.assign({ groupId: null, groupKind: null, note: "" }, e, { sets: (Array.isArray(e.sets) ? e.sets : []).map(st => Object.assign({ kg: "", reps: "", sec: "", done: false }, st, { drops: (st.drops || []).map(dr => Object.assign({ kg: "", reps: "" }, dr)) })) })) });
}
// contenu complet d'une sauvegarde (fichier, code de transfert, ancien texte)
async function backupText() {
  flushPending();
  return packBackup(JSON.stringify({ app: "muscuapp", v: 2, at: Date.now(), owner: db.auth ? db.auth.user.id : undefined, items: Object.values(db.items).filter(x => !x.deleted).map(x => ({ id: x.id, kind: x.kind, data: slimData(x), updated_at: x.updated_at })) }));
}
const backupName = () => { const d = new Date(); return "fiitday-sauvegarde-" + d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + ".txt"; };
// fichier : dans l'appli Android, le téléphone demande où l'enregistrer (Téléchargements, Drive…) ; sur le site, téléchargement classique
const nativeFiles = () => !!(window.AndroidBridge && typeof window.AndroidBridge.saveFile === "function" && typeof window.AndroidBridge.openFile === "function");
let fileCb = null;
window.__fiitdayFile = (kind, status, text) => {
  const cb = fileCb; fileCb = null;
  if (cb) { cb(status, text); return; }
  // la page a été rechargée pendant que le sélecteur de fichiers était ouvert (Android a fermé l'appli) : on finit ici
  if (kind === "save") toast(status === "ok" ? "Sauvegarde enregistrée" : status === "error" ? "La sauvegarde n'a pas pu être enregistrée" : "Enregistrement annulé");
  else if (kind === "open" && status === "ok" && text) setTimeout(() => restoreBackup(text, "Ce fichier n'est pas une sauvegarde Fiitday"), 800);
  else if (kind === "open" && status === "error") toast("Ce fichier n'a pas pu être lu");
};
window.__fiitdayFileReady = () => {
  try {
    const t = Native && typeof Native.takeFile === "function" ? Native.takeFile() : "";
    if (t) { const r = JSON.parse(t); window.__fiitdayFile(r.kind, r.status, r.text == null ? null : r.text); }
  } catch (e) { }
  return true;
};
function saveFile(name, text) {
  if (nativeFiles()) return new Promise(res => { fileCb = st => res(st); window.AndroidBridge.saveFile(name, text); });
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return Promise.resolve("download");
}
// texte du fichier choisi, null si rien n'est choisi, false s'il n'a pas pu être lu
function openFile() {
  if (nativeFiles()) return new Promise(res => { fileCb = (st, text) => res(st === "ok" ? text : st === "error" ? false : null); window.AndroidBridge.openFile(); });
  return new Promise(res => {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".txt,.json,text/plain,application/json";
    inp.addEventListener("change", () => { const f = inp.files && inp.files[0]; if (!f) return res(null); if (f.size > 20e6) return res(false); f.text().then(res, () => res(false)); });
    inp.addEventListener("cancel", () => res(null));
    inp.click();
  });
}
// code de transfert : 8 caractères, lettres majuscules et chiffres sans 0 / O / 1 / I (créé et vérifié par Supabase)
const XFER_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;
const normCode = t => String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const xferErr = err => err && (err.code === "PGRST202" || err.status === 404) ? "Les codes de transfert ne sont pas encore activés (SQL transfert.sql à exécuter dans Supabase)"
  : err && err.message === "Failed to fetch" ? "Pas de connexion : réessaie avec du réseau" : (err && err.message) || "Erreur, réessaie";
async function useTransferCode(raw) {
  const c = normCode(raw);
  if (!XFER_RE.test(c)) { toast("Un code de transfert fait 8 caractères (lettres et chiffres)"); return; }
  if (!db.auth) { toast("Connecte-toi au compte qui doit recevoir les données"); return; }
  let txt; try { txt = await rpc("use_transfer", { p_code: c }); } catch (err) { toast(xferErr(err)); return; }
  if (!txt || typeof txt !== "string") { toast("Code inconnu ou expiré (un code n'est valable qu'une heure)"); return; }
  restoreBackup(txt, "Ce code ne contient pas une sauvegarde valide");
}
// « FIITDAY1: » + données compressées en base64 : bien plus court que le texte brut
async function packBackup(str) {
  if (!window.CompressionStream) return str;
  try {
    const out = new Uint8Array(await new Response(new Blob([str]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
    let bin = ""; for (let k = 0; k < out.length; k += 0x8000) bin += String.fromCharCode.apply(null, out.subarray(k, k + 0x8000));
    return "FIITDAY1:" + btoa(bin);
  } catch (e) { return str; }
}
async function unpackBackup(txt) {
  txt = String(txt || "").trim();
  if (!txt.startsWith("FIITDAY1:")) return txt; // ancienne sauvegarde en texte brut
  const bin = atob(txt.slice(9).replace(/\s+/g, ""));
  const u = Uint8Array.from(bin, ch => ch.charCodeAt(0));
  return new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
}

/* ================= Écran : réglages ================= */
/* ================= Questions fréquentes (Réglages › Aide) ================= */
// [thème, [[id, question, réponse (HTML écrit ici, sans donnée de l'utilisateur)]]] ; #/faq/id ouvre directement une question
const FAQ = [
  ["Démarrer", [
    ["creer", "Comment créer mon premier programme ?", "Sur l'accueil, appuie sur « + Nouveau programme » et donne-lui un nom (par exemple « Push » ou « Haut du corps »). Ajoute ensuite une séance avec « + Nouvelle séance », puis ses exercices avec « + Ajouter un exercice » : cherche (« dev », « pec »…) ou filtre par muscle, coche les exercices voulus, puis choisis leur ordre dans la séance. Ils arrivent avec les répétitions et le repos conseillés. Un exercice qui n'est pas dans la liste ? Tape son nom et coche « + Créer »."],
    ["programme", "Quelle différence entre un programme et une séance ?", "Un programme regroupe plusieurs séances : par exemple le programme « Push Pull » avec « Séance 1 » et « Séance 2 », chacune avec ses exercices. Un appui prolongé sur une séance affiche la liste de ses exercices."],
    ["types", "Quels types d'exercices puis-je créer ?", "Cinq types : <b>Poids × reps</b> (kilos et répétitions), <b>Reps uniquement</b> (pompes, tractions sans charge), <b>Temps</b> (gainage, étirements : le temps est pris par le chrono), <b>Distance</b> (course, rameur, ateliers Hyrox, avec ou sans charge) et <b>Cardio</b> (une machine : durée et indicateurs comme la distance ou les calories). Le type se choisit dans la configuration de l'exercice. Exercice avec assistance (tractions ou dips à la machine à contrepoids, élastique) : note un poids négatif, par exemple −20 kg ; moins d'assistance = progrès dans Stats › Évolution."],
    ["cardio", "Comment noter une séance de cardio ?", "Sur l'accueil, touche « Séance cardio ». <b>Lancer maintenant</b> : choisis une ou plusieurs machines (tapis, vélo, elliptique, escalier, rameur…), lance le chrono, touche « Terminer » à la fin, puis note tes indicateurs (distance, vitesse, calories, étages…). <b>Ajouter une séance faite</b> : indique le jour et l'heure, choisis les machines, puis note la durée et les indicateurs. Tu peux aussi ajouter une machine dans une séance de musculation (filtre « Cardio »), par exemple 20 min de vélo à la fin de ta séance Push : elle compte dans tes stats. Il manque un indicateur ? « + Ajouter un indicateur » sous la machine : il sera proposé à chaque fois."],
    ["superset", "Comment faire un superset ou un dégressif ?", "Ajoute d'abord tes exercices, puis dans la configuration de la séance : « Enchaîner avec l'exercice suivant » relie deux exercices en superset ou biset (un 3e exercice ajouté au groupe en fait un triset), et le réglage « Dégressif » d'un exercice ajoute les baisses de charge. Dans un superset, le repos démarre seulement quand tout le tour est fini."]]],
  ["Pendant la séance", [
    ["repos", "Comment fonctionne le repos ?", "Quand tu valides une série (✓), le repos démarre tout seul avec la durée réglée pour l'exercice. Tu peux ajouter ou enlever 15 s, le passer ou le réduire. Après la dernière série d'un exercice, c'est le « Repos avant l'exercice suivant » qui démarre : il se règle dans la configuration de la séance."],
    ["alerte", "Je ne suis pas prévenu à la fin du repos, que faire ?", "Vérifie <a href=\"#/settings\">Réglages</a> › Alerte de fin de repos (Vibration, Son, ou les deux allumés ensemble) et appuie sur « Tester ». Dans l'appli Android, « Tester » fait la vraie alerte 5 secondes plus tard : verrouille ton téléphone pour l'essayer. Autorise aussi les notifications de Fiitday (le bouton est dans Réglages › Alerte de fin de repos) : le temps de repos s'affiche alors à l'écran verrouillé et sur ta montre. Sans elles, le téléphone vibre quand même à la fin du repos."],
    ["chrono", "Comment marche le chrono du gainage et des étirements ?", "Appuie sur ▶ « Chrono » : tu as 5 secondes pour te mettre en position, puis le chrono démarre. Quand tu l'arrêtes, le temps s'inscrit tout seul dans la série (il ne se modifie pas à la main). Pour la course et l'Hyrox, tu peux aussi taper ton temps : « 405 » devient 4:05."],
    ["gris", "À quoi servent les chiffres en gris ?", "Ce sont tes valeurs de la dernière fois pour cet exercice. Le bouton ✓ les reprend si tu as fait pareil ; sinon, tape simplement tes nouveaux chiffres."]]],
  ["Progrès et exercices", [
    ["progression", "Comment voir ma progression sur un exercice ?", "Dans <a href=\"#/evolution\">Stats › Évolution</a>, cherche un exercice déjà fait : tu vois sa courbe (charge, 1RM estimé, répétitions ou temps), ton record et ton historique, sur 1 mois, 3 mois, 6 mois, 1 an ou depuis le début."],
    ["poids", "Comment suivre mon poids ?", "Dans <a href=\"#/evolution/poids\">Stats › Évolution › Poids</a>. C'est facultatif : Fiitday te demande d'abord ton accord, car le poids peut renseigner sur ta santé. Note un poids par jour (en kg, avec une décimale) pour voir sa courbe ; en version gratuite, tu vois les 30 derniers jours. Ton poids est visible de toi seul et jamais partagé. « Ne plus suivre mon poids » permet de le masquer, ou de retirer ton accord : tes pesées sont alors effacées."],
    ["record", "Comment est calculé un record ?", "Pour un exercice avec poids, Fiitday estime ton 1RM (la charge que tu pourrais soulever une seule fois) avec la formule d'Epley : charge × (1 + répétitions ÷ 30). Un record est fêté quand ce 1RM dépasse ton meilleur, à partir de ta 2e séance avec cet exercice. Pour la course, le record est ton meilleur temps."],
    ["corriger", "Comment corriger ou supprimer une séance terminée ?", "Ouvre-la depuis l'accueil (Dernières séances) ou <a href=\"#/history\">Stats › Historique</a> pour corriger une valeur. Pour la supprimer, fais glisser sa ligne de droite à gauche, puis appuie sur « Supprimer »."],
    ["etirements", "Quand et comment m'étirer ?", "L'onglet <a href=\"#/exercices/etirements\">Exercices › Étirements</a> propose 23 étirements avec le mannequin 3D, et le guide « Bien s'étirer » explique quand et comment le faire. Après une séance, l'accueil te propose pendant 15 minutes des étirements adaptés aux muscles travaillés (tu peux couper ces propositions dans Réglages › Étirements après la séance)."],
    ["mannequin", "Comment utiliser le mannequin 3D ?", "Fais glisser l'image pour tourner autour du mannequin, pince pour zoomer et appuie deux fois pour revenir au cadrage de départ. Fais glisser la fiche (sous l'image) vers la gauche ou la droite pour passer à l'exercice suivant ou précédent."]]],
  ["Données et compte", [
    ["synchro", "Mes données sont-elles sur mon téléphone et sur mon ordinateur ?", "Avec Premium (et pendant l'essai) : oui, tout se synchronise automatiquement entre l'appli et fiitday.com. L'heure de la dernière synchro est dans Réglages › Compte. Sans réseau, fais ta séance normalement : elle sera envoyée au retour du réseau. En version gratuite, tes données restent sur l'appareil où tu les notes : pense à faire une sauvegarde de temps en temps."],
    ["sauvegarde", "Comment faire une sauvegarde de mes données ?", "<a href=\"#/settings\">Réglages</a> › Données › « Sauvegarde » crée un fichier à garder sur ton téléphone, ton ordinateur ou dans un cloud (Google Drive…). « Restaurer » le relit : ce qui a été supprimé depuis revient, et ce que tu as modifié depuis garde sa version la plus récente. Une sauvegarde faite avec ton compte se restaure toujours, même en version gratuite ; celle d'un autre compte est réservée aux abonnés payants."],
    ["transfert", "Comment passer mes données sur un autre compte ?", "Dans l'ancien compte : Réglages › Données › « Créer un code ». Tu obtiens un code de 8 caractères, valable 1 heure. Dans le nouveau compte : « J'ai un code », puis tape-le. Ne le donne à personne d'autre : il donne accès à toutes tes données. Le code de transfert est réservé aux abonnés payants (pas pendant l'essai)."],
    ["partage", "Comment partager une séance avec un ami ?", "Dans la configuration de la séance, appuie sur « Partager » et envoie le lien (WhatsApp, SMS…). Ton ami, connecté à son compte Fiitday, ouvre le lien ou le colle dans Accueil › Importer, puis choisit où ajouter la séance. Partager ses séances est réservé à Premium ; en recevoir est possible pour tout le monde (en version gratuite, la séance reçue prend la place d'une de tes 2 séances actives)."],
    ["mot-de-passe", "J'ai oublié mon mot de passe, que faire ?", "Sur l'écran de connexion, appuie sur « Mot de passe oublié ? » et indique l'e-mail de ton compte. Tu reçois un code par e-mail (regarde aussi dans les spams) : saisis-le avec ton nouveau mot de passe, et tu es connecté. Une fois connecté, tu peux aussi le changer dans <a href=\"#/settings\">Réglages</a> › Compte › « Changer mon mot de passe »."],
    ["supprimer-compte", "Comment supprimer mon compte ?", "Réglages › Compte › « Supprimer mon compte », puis tape SUPPRIMER pour confirmer. Ton compte et toutes tes données sont effacés définitivement : fais une sauvegarde avant si tu veux les garder."]]],
  ["Appli et montre", [
    ["montre", "Comment être prévenu sur ma montre ?", "C'est automatique dans l'appli Android : la montre vibre à la fin du repos et quand l'objectif d'un chrono est atteint, avec « Terminer » pour arrêter le chrono. Sur Galaxy Watch, dans l'appli Galaxy Wearable › Paramètres de la montre › Notifications : autorise Fiitday et choisis « Toujours afficher sur les deux » dans « Notifications du téléphone sur la montre »."],
    ["version", "Comment mettre à jour Fiitday ?", "Le site fiitday.com est toujours à jour. L'appli Android se met à jour avec Obtainium, sans perdre tes données. Ta version est écrite en bas de la page <a href=\"#/settings\">Réglages</a> (« Fiitday V1.… »)."]]]
];
// espaces insécables de la typographie française : « ? », « : », « » » ne passent jamais seuls à la ligne
const nbsp = t => t.replace(/ ([?:!;»])/g, "\u00a0$1").replace(/« /g, "«\u00a0");
// Guide : ce qu'on trouve et ce qu'on peut faire dans chaque page (sans le détail de chaque option)
const GUIDE = [
  ["Accueil", "#/home", "Ton point de départ pour t'entraîner.", [
    "Tes programmes et leurs séances : touche une séance pour la lancer ou la modifier, reste appuyé pour voir ses exercices.",
    "« + Nouveau programme » pour créer le tien, « Importer » pour récupérer une séance partagée par un ami.",
    "« Séance libre » pour t'entraîner sans programme, et « Séance cardio » pour le tapis, le vélo, le rameur…",
    "Tes dernières séances, avec un accès à tout l'historique."]],
  ["Séance en cours", "", "Ce que tu as sous les yeux pendant l'entraînement.", [
    "Pour chaque exercice : le poids et les répétitions avec les roues, ✓ pour valider une série.",
    "Le repos démarre tout seul après chaque série ; le chrono sert au gainage, à la course et au cardio.",
    "Tu peux ajouter, retirer, renommer ou enchaîner des exercices (superset) pour cette séance.",
    "« Terminer la séance » l'enregistre dans ton historique et tes stats."]],
  ["Configuration d'une séance", "", "Ce qui s'ouvre avec « Modifier » sur une séance.", [
    "La liste des exercices, leur ordre (glisse la poignée ⠿) et leurs réglages : séries, répétitions, repos, dégressif.",
    "Les supersets, bisets et trisets, et le repos avant l'exercice suivant.",
    "Dupliquer ou partager la séance, et en ajouter d'autres au programme."]],
  ["Exercices", "#/exercices", "La bibliothèque, avec le mannequin 3D.", [
    "Musculation, Cardio et Étirements : chaque fiche montre le mouvement en 3D, les muscles travaillés et les conseils.",
    "Recherche par nom, par muscle ou par matériel.",
    "« Ajouter à une séance » pour le mettre directement dans un de tes programmes.",
    "Filtre « Mes exercices » : crée, modifie ou supprime tes propres exercices, avec ce que tu veux noter (poids, reps, temps, distance ou tes indicateurs)."]],
  ["Stats", "#/progress", "Tes progrès, en quatre onglets.", [
    "Séances : ta semaine par rapport à ton objectif, le temps de sport et les séances par semaine.",
    "Évolution : la courbe de chaque exercice (charge, répétitions, durée, distance…) et tes records, et ton poids si tu choisis de le suivre.",
    "Calendrier : les jours où tu t'es entraîné.",
    "Historique : toutes tes séances terminées, à revoir ou à corriger."]],
  ["Programmes", "#/programs", "Les programmes Fiitday prêts à l'emploi.", [
    "Des programmes de musculation et de circuit training à ajouter en un appui à tes programmes."]],
  ["Réglages", "#/settings", "L'appli à ton goût, et ton compte.", [
    "Apparence (clair, sombre, couleur), alerte de fin de repos, objectif de séances par semaine.",
    "Ton compte et la synchronisation entre ton téléphone et fiitday.com.",
    "Tes données : sauvegarde, restauration et transfert vers un autre compte.",
    "L'aide : ce guide et les questions fréquentes."]]
];
function viewGuide() {
  return '<a class="back" href="#/settings">‹ Réglages</a><div class="page-head"><h1>Guide</h1></div>' +
    '<p class="muted guide-intro">Ce que tu trouves dans chaque page de Fiitday. Pour une question précise, va dans les <a href="#/faq">questions fréquentes</a>.</p>' +
    GUIDE.map(([t, href, lead, pts]) => '<section class="card guide-p"><div class="spread"><h2>' + esc(t) + "</h2>" + (href ? '<a class="link small" href="' + href + '">Ouvrir ›</a>' : "") + "</div>" +
      '<p class="muted small">' + esc(lead) + '</p><ul class="exo-tips">' + pts.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul></section>").join("");
}
// limites de la version gratuite et prix : un seul endroit, les textes (FAQ, page de présentation, écran Premium) en découlent
const TRIAL_DAYS = 30, FREE_VARIANTS = 2, FREE_OWN = 5, FREE_HIST_DAYS = 30, FREE_SWITCH_DAYS = 30, DAY = 86400000;
// Solo : 1 compte · Famille : l'acheteur + 4 personnes, chacune avec son propre compte (invitées depuis Réglages › Abonnement)
const FAMILY_SIZE = 5;
const PRICE_EUR = { solo: { month: 1.99, year: 19.9, life: 49.9, lifeAfter: 79.9 }, family: { month: 6.99, year: 69.9, life: 149.9, lifeAfter: 229.9 } };
const fmtEur = n => (Math.round(n * 100) / 100).toFixed(2).replace(".", ",") + " €";
const priceTexts = p => ({ year: fmtEur(p.year), month: fmtEur(p.month), yearMonth: fmtEur(p.year / 12), life: fmtEur(p.life), lifeAfter: fmtEur(p.lifeAfter),
  lifeVs: "moins cher que 3 ans d'abonnement annuel (" + fmtEur(p.year * 3) + ")" });
const PRICES = { solo: priceTexts(PRICE_EUR.solo), family: priceTexts(PRICE_EUR.family) };
// Premium à vie : prix de lancement jusqu'au 31 décembre 2027, puis prix normal (affiché tout seul à partir de cette date).
// Pas de prix barré : la loi demande qu'un prix barré ait vraiment été pratiqué dans les 30 jours d'avant.
const LIFE_END = new Date(2028, 0, 1).getTime(), LIFE_END_TXT = "1er janvier 2028", LIFE_LAST_TXT = "31 décembre 2027";
// questions sur l'abonnement : affichées une fois l'abonnement lancé (et dès maintenant pour le compte testeur)
const FAQ_PLAN = ["Abonnement Premium", [
  ["essai", "Comment marche l'essai gratuit ?", "À la création de ton compte, tu as <b>" + TRIAL_DAYS + " jours de Premium offerts</b>, sans carte bancaire : rien n'est prélevé. À la fin, tu passes en version gratuite, plus limitée (voir « Que permet la version gratuite ? »), sauf si tu t'abonnes. Pendant l'essai, tout Premium est ouvert, sauf le code de transfert et la restauration d'une sauvegarde faite avec un autre compte, réservés aux abonnés payants. Un seul essai par compte : supprimer son compte et le recréer avec la même adresse ne redonne pas d'essai."],
  ["gratuit", "Que permet la version gratuite ?", "Elle est limitée : 1 programme et " + FREE_VARIANTS + " séances actives (tu choisis lesquelles, et tu peux en changer une fois tous les " + FREE_SWITCH_DAYS + " jours), " + FREE_OWN + " exercices perso, l'historique des " + FREE_HIST_DAYS + " derniers jours, les stats de la semaine et la réception des séances partagées. La synchro entre tes appareils est réservée à Premium. <b>Rien n'est supprimé</b> : tes autres programmes et séances restent visibles avec un cadenas, ton historique complet et tes stats sont gardés, et tout revient dès que tu t'abonnes."],
  ["formules", "Quelles formules et quels prix ?", "<b>Solo</b> : " + PRICES.solo.month + " par mois ou " + PRICES.solo.year + " par an. <b>Famille</b> (toi + " + (FAMILY_SIZE - 1) + " proches, chacun son compte) : " + PRICES.family.month + " par mois ou " + PRICES.family.year + " par an. <b>À vie</b>, en un seul paiement : " + PRICES.solo.life + " en Solo ou " + PRICES.family.life + " en Famille jusqu'au " + LIFE_LAST_TXT + ", puis " + PRICES.solo.lifeAfter + " et " + PRICES.family.lifeAfter + ". Tous les détails sont sur la page <a href=\"#/premium\">Premium</a>."],
  ["souscrire", "Comment m'abonner ?", "Sur fiitday.com, connecté à ton compte (ordinateur, iPhone ou téléphone Android) : page <a href=\"#/premium\">Premium</a>, paiement par carte bancaire. Premium est lié à ton compte : il marche ensuite sur tous tes appareils, dans l'appli Android aussi. Le paiement par Google Play arrivera avec l'appli sur le Play Store."],
  ["resilier", "Comment résilier mon abonnement ?", "Réglages › Tes achats Premium › « Résilier mon abonnement » : tu choisis la date de fin (tout de suite, avec le remboursement de la part non utilisée, ou à la fin de la période déjà payée), tu vérifies le récapitulatif, puis « Notifier la résiliation ». Tu reçois une confirmation par e-mail. Abonné par Google Play : le bouton ouvre ton abonnement dans Google Play. Ensuite, tu passes en version gratuite, plus limitée ; tes données sont gardées."],
  ["famille", "Comment marche la formule Famille ?", "Le titulaire invite jusqu'à 4 proches depuis Réglages › Abonnement : un code ou un lien, valable 7 jours. Chacun garde son propre compte, ses programmes et son historique : personne ne voit les données des autres. Quand quelqu'un part (retiré ou de lui-même), sa place se libère 15 jours après. Si l'abonnement Famille s'arrête, les membres passent en version gratuite, plus limitée, et gardent leurs données."],
  ["rembourser", "Puis-je changer d'avis ou être remboursé ?", "Oui : pendant les 14 jours qui suivent ton achat (abonnement ou Premium à vie), Réglages › Tes achats Premium › « Renoncer au contrat ici ». Premium s'arrête et tu es remboursé intégralement, au plus tard 14 jours après. Tu peux aussi nous écrire. Le détail est dans les conditions générales de vente."]]];
const faqList = () => planState() !== "off" || isPlanTester() ? FAQ.concat([FAQ_PLAN]) : FAQ;
function viewFaq(open) {
  faqIdx = null;
  const FAQ_ = faqList(), n = FAQ_.reduce((a, c) => a + c[1].length, 0);
  return '<a class="back" href="#/settings">‹ Réglages</a><div class="page-head"><h1>Questions fréquentes</h1><span class="muted small">' + n + " questions</span></div>" +
    '<input class="f" id="faq-q" type="search" autocomplete="off" placeholder="Rechercher : repos, sauvegarde…" aria-label="Rechercher dans les questions fréquentes">' +
    FAQ_.map(([cat, qs]) => '<section class="faq-cat"><div class="section-title">' + esc(cat) + '</div><div class="faq-box">' +
      qs.map(([id, q, a]) => '<details class="faq-q" id="faq-' + id + '"' + (id === open ? " open" : "") + "><summary>" + esc(nbsp(q)) + '</summary><div class="faq-a">' + nbsp(a) + "</div></details>").join("") + "</div></section>").join("") +
    '<p class="muted faq-none" hidden>Aucune question ne correspond. Essaie un autre mot.</p>' +
    '<div class="card faq-more"><h2 class="card-h">Tu n\'as pas trouvé ta réponse ?</h2><div class="small muted" style="margin-top:4px">Écris-nous à <a class="link" href="mailto:contact@fiitday.com">contact@fiitday.com</a> : nous te répondons rapidement.</div></div>';
}
// recherche sans tenir compte des accents, des majuscules, des apostrophes (« jai » = « j'ai ») ni des petites fautes ; une seule réponse : elle s'ouvre
const FAQ_STOP = new Set("je tu il on le la les de des du un une mon ma mes ton ta tes et ou a au aux en est que qui quoi comment pour par sur dans avec ce ca se sa son ses ne pas plus faire fait".split(" "));
const faqWords = t => norm(t).replace(/['’`´]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
const faqWordsAll = t => Array.from(new Set(faqWords(t).concat(norm(t).replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean)))); // « j'ai » donne « jai », « j » et « ai »
let faqIdx = null;
// abréviations et mots collés courants
const FAQ_SYN = { mdp: ["mot", "passe"], motdepasse: ["mot", "passe"], pwd: ["mot", "passe"], password: ["mot", "passe"], appli: ["application"], synchro: ["synchronisation"], stats: ["statistiques"] };
const faqExpand = ws => ws.flatMap(w => FAQ_SYN[w] ? FAQ_SYN[w].concat(w === "appli" || w === "synchro" || w === "stats" ? [w] : []) : [w]);
$app.addEventListener("input", e => {
  if (e.target.id !== "faq-q") return;
  const all = faqExpand(faqWords(e.target.value)), key = all.filter(w => w.length > 1 && !FAQ_STOP.has(w)), words = key.length ? key : all.filter(w => w.length > 1), shown = [];
  const qs = [...document.querySelectorAll(".faq-q")];
  if (!faqIdx) faqIdx = new Map(qs.map(d => [d, { t: faqWordsAll(d.querySelector("summary").textContent), a: faqWordsAll(d.textContent) }]));
  // un mot tapé vaut plus s'il est dans la question que dans la réponse, et s'il est exact plutôt qu'avec une faute
  const hit = (w, list) => list.some(t => t.startsWith(w)) ? 2 : list.some(t => fuzzy(w, t) || (t.length >= 4 && w.startsWith(t)) || (w.length >= 5 && t.length >= 5 && w.slice(0, 4) === t.slice(0, 4))) ? 1 : 0;
  const rate = d => { const ix = faqIdx.get(d); let n = 0, pts = 0; words.forEach(w => { const v = Math.max(hit(w, ix.t) * 2, hit(w, ix.a)); if (v) { n++; pts += v; } }); return { n, pts }; };
  const sc = new Map(qs.map(d => [d, rate(d)])), bestN = Math.max(0, ...[...sc.values()].map(x => x.n));
  const bestPts = Math.max(0, ...[...sc.values()].filter(x => x.n === bestN).map(x => x.pts));
  // on garde les questions qui ont le plus de mots trouvés, et parmi elles les plus pertinentes
  qs.forEach(d => { const x = sc.get(d), ok = !words.length || (bestN > 0 && x.n === bestN && x.pts >= bestPts * 0.6); d.hidden = !ok; if (ok) shown.push(d); });
  document.querySelectorAll(".faq-cat").forEach(s => { s.hidden = !s.querySelector(".faq-q:not([hidden])"); });
  const none = document.querySelector(".faq-none"); if (none) none.hidden = shown.length > 0;
  if (words.length && shown.length === 1) shown[0].open = true;
});

/* ================= Premium : abonnement, essai et version gratuite ================= */
// Le statut (essai, Premium, gratuit) vient du serveur : tant que la date de lancement n'est pas fixée, tout le monde garde l'appli complète.
// MONETIZATION = false tant que le paiement (RevenueCat, Google Play, Stripe) n'est pas branché : le bouton « S'abonner » reste désactivé.
// Le compte testeur voit seulement le mode test (Réglages) pour essayer l'essai, la version gratuite et Premium sur son appareil.
const MONETIZATION = false;
const PLAN_TESTERS = ["8d8a867f-e766-41ca-b197-7694f5f5e1c4"];
// Premium ou gratuit : écran Premium et page de présentation du site
const PLAN_ROWS = [["Comptes", "1 (Solo) ou " + FAMILY_SIZE + " (Famille)", "1"], ["Programmes et séances", "Illimités", "1 programme, 2 séances actives (changement tous les " + FREE_SWITCH_DAYS + " jours)"], ["Exercices perso", "Illimités", "5 au plus"], ["Historique", "Complet", "30 derniers jours"],
  ["Stats", "Temps, tonnage, Évolution, calendrier, poids (tout l'historique)", "La semaine en cours, ton poids sur 30 jours"], ["Programmes Fiitday", "Prêts à l'emploi : musculation et circuit training", "Non"], ["Synchro téléphone ↔ ordinateur", "Oui", "Non"], ["Partager une séance", "Envoyer et recevoir", "Recevoir"],
  ["Sauvegarde", "Enregistrer et restaurer, code de transfert", "Enregistrer (pendant l'essai aussi)"]];
let premiumFor = "solo", premiumPick = "year", premiumConsent = false; // case à cocher avant le paiement : demande expresse que Premium commence avant la fin du délai de rétractation (Code de la consommation, L221-25)
// achat dans l'appli Android (RevenueCat) : « test » dans l'appli Fiitday Test (magasin de test, achats factices),
// « store » quand le paiement Google sera branché, « » sinon (appli Obtainium).
// Sur fiitday.com : paiement par carte (RevenueCat Web Billing + Stripe). Clé publique de test (rcb_sb_, carte factice) :
// seul le compte testeur peut acheter ; avec la clé de production (rcb_), tout le monde, une fois le lancement fait.
const RC_WEB_KEY = "rcb_sb_AJtnkAvLFuwukArFjHEwFvDNF";
const billingMode = () => {
  if (Native) { try { return (typeof Native.billing === "function" && Native.billing()) || ""; } catch (e) { return ""; } }
  if (!RC_WEB_KEY) return "";
  if (RC_WEB_KEY.startsWith("rcb_sb_")) return isPlanTester() ? "test" : "";
  return MONETIZATION ? "store" : "";
};
// identifiants des produits (les mêmes dans RevenueCat) : « famil » = Famille, « vie » = achat à vie, lus aussi par le serveur
const PRODUCTS = { solo: { year: "fiitday_solo_annuel", month: "fiitday_solo_mensuel", life: "fiitday_vie_solo" }, family: { year: "fiitday_famille_annuel", month: "fiitday_famille_mensuel", life: "fiitday_vie_famille" } };
const billingCbs = {}; let billingSeq = 0, buying = false;
window.__fiitdayBilling = (id, st, txt) => { const f = billingCbs[id]; delete billingCbs[id]; if (f) f({ st, txt: txt || "" }); };
const billingCall = (fn, ...args) => new Promise(res => { const id = "b" + (++billingSeq); billingCbs[id] = res; try { Native[fn](id, ...args); } catch (e) { delete billingCbs[id]; res({ st: "error", txt: e.message }); } });
// après un achat : le serveur reçoit le message de RevenueCat en quelques secondes ; on relit le statut jusqu'à le voir
function billingLogout() { try { if (Native && billingMode() && Native.billingLogout) Native.billingLogout(); if (rcWeb) { rcWeb.p.close(); rcWeb = null; } } catch (e) { rcWeb = null; } }
// --- paiement par carte sur le site : module RevenueCat chargé seulement au moment de payer (1 Mo), lié au compte Fiitday ---
let rcWeb = null;
function webPurchases() {
  const uid = db.auth.user.id;
  if (rcWeb && rcWeb.uid === uid) return Promise.resolve(rcWeb.p);
  return (window.Purchases ? Promise.resolve() : new Promise((res, rej) => {
    const sc = document.createElement("script"); sc.src = "purchases.js"; sc.onload = res;
    sc.onerror = () => { sc.remove(); rej(new Error("le module de paiement n'a pas pu se charger (connexion ?)")); }; document.head.appendChild(sc);
  })).then(() => {
    const P = window.Purchases.Purchases;
    if (rcWeb) { try { rcWeb.p.close(); } catch (e) { } }
    rcWeb = { uid, p: P.configure({ apiKey: RC_WEB_KEY, appUserId: uid }) };
    return rcWeb.p;
  });
}
// message d'erreur montré tel quel seulement s'il est en français et court (sinon : message général, détail dans la console)
const frTxt = t => !!t && t.length < 160 && /[àâçéèêëîïôûùüœ]|\b(le|la|les|de|du|des|une|un|est|pas|introuvable|indisponible)\b/i.test(t);
// même réponse que l'appli Android : { st: "ok" | "cancel" | "error", txt }
async function webBuy(pid) {
  try {
    const p = await webPurchases(), offs = await p.getOfferings();
    let pkg = null;
    Object.values(offs.all || {}).forEach(o => (o.availablePackages || []).forEach(k => { if (!pkg && (k.webBillingProduct || k.rcBillingProduct || k.product || {}).identifier === pid) pkg = k; }));
    if (!pkg) return { st: "error", txt: "produit introuvable : " + pid };
    await p.purchase({ rcPackage: pkg, customerEmail: db.auth.user.email || undefined, selectedLocale: "fr", defaultLocale: "fr" });
    return { st: "ok", txt: pid };
  } catch (e) {
    if (e && e.errorCode === 1) return { st: "cancel", txt: "" }; // UserCancelledError : fenêtre de paiement fermée
    return { st: "error", txt: (e && e.message) || "erreur inconnue" };
  }
}
// après un vrai achat (ou une restauration), on quitte le mode test pour que l'appli montre ce que dit le serveur
function planTestOff() { if (!planTesting()) return false; db.planTest = ""; saveNow(); render(); return true; }
async function waitPlan() {
  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 2500));
    const p = await loadPlan(true);
    if (p && (p.source === "subscription" || p.source === "lifetime")) return true;
  }
  return false;
}
const isPlanTester = () => !!(db.auth && PLAN_TESTERS.includes(db.auth.user.id));
const planTesting = () => isPlanTester() && ["trial", "free", "premium", "family", "member"].includes(db.planTest);
const trialLeft = () => Math.max(0, Math.ceil(((planTesting() ? db.planTestEnd : db.plan && Date.parse(db.plan.trial_ends)) - Date.now()) / DAY) || 0);
// « off » : pas d'abonnement (appli complète) · « trial » : essai, tout comme Premium · « free » : version gratuite · « premium » : abonné
function planState() {
  if (planTesting()) return db.planTest === "trial" && trialLeft() <= 0 ? "free" : db.planTest === "family" || db.planTest === "member" ? "premium" : db.planTest;
  // ancien mode « sans compte » (plus proposé) : une fois les ventes ouvertes, il vaut la version gratuite
  if (!db.auth) return db.mode === "local" && MONETIZATION ? "free" : "off";
  // statut donné par le serveur (my_plan) : « off » tant que la date de lancement n'est pas atteinte
  const p = db.plan;
  if (!p || !p.launched) return "off";
  let st = p.state === "premium" || p.state === "trial" || p.state === "free" ? p.state : "off";
  // hors ligne, le dernier statut connu ne vaut pas sans fin : l'essai ou l'abonnement dont la date de fin est passée s'arrête,
  // et au-delà de 14 jours sans vérification, retour à la version gratuite jusqu'à la prochaine connexion (les données ne bougent pas)
  const now = nowSafe(), life = p.source === "lifetime";
  if (st === "trial" && p.trial_ends && Date.parse(p.trial_ends) <= now) st = "free";
  if (st === "premium" && !life && p.until && Date.parse(p.until) <= now) st = "free";
  if ((st === "premium" || st === "trial") && !life && p.at && now - Date.parse(p.at) > 14 * DAY) st = "free";
  return st;
}
// heure « sûre » : jamais avant la dernière heure donnée par le serveur (un téléphone remis à une date passée ne rouvre ni le
// changement de séances actives ni l'historique de la version gratuite)
function nowSafe() {
  const n = Date.now(), p = db.plan;
  const srv = p && p.at && p.at_ms ? Date.parse(p.at) + Math.max(0, n - p.at_ms) : 0;
  return Math.max(n, srv || 0);
}
// statut du compte calculé par le serveur (essai, abonnement, achat à vie, Premium offert, famille) ; gardé sur l'appareil pour le hors-ligne
let planLoading = null;
function loadPlan(force) {
  if (!db.auth) return Promise.resolve(null);
  if (!force && db.plan && Date.now() - (db.plan.at_ms || 0) < 10 * 60000) return Promise.resolve(db.plan);
  if (planLoading) return planLoading;
  planLoading = (async () => {
    const base0 = db;
    try {
      const p = await rpc("my_plan");
      if (db !== base0) return null; // déconnecté pendant l'attente
      if (p && p.state && p.state !== "none") {
        const was = planState(), before = was + "|" + JSON.stringify(db.plan && db.plan.source);
        db.plan = Object.assign(p, { at_ms: Date.now() });
        // retour en version gratuite après l'essai ou Premium : le premier changement de séances actives est libre
        if ((was === "premium" || was === "trial") && planState() === "free" && !planTesting()) { const fa = settings().freeActive; if (fa && fa.at) setSetting("freeActive", Object.assign({}, fa, { at: 0 })); }
        saveNow(); if (planState() + "|" + JSON.stringify(p.source) !== before) render();
      }
    } catch (e) { /* hors ligne : le dernier statut connu reste valable, et le serveur vérifie de toute façon */ }
    finally { planLoading = null; }
    return db.plan;
  })();
  return planLoading;
}
const isFree = () => planState() === "free";
// code de transfert et sauvegarde d'un AUTRE compte : abonnés payants seulement, même pendant l'essai (sinon un nouveau compte par
// mois avec un nouvel essai, et tout transféré) ; une sauvegarde faite avec son propre compte se restaure toujours
const dataLocked = () => { const s = planState(); return s === "free" || s === "trial"; };
const LOCK_XFER = "Le code de transfert et la restauration d'une sauvegarde faite avec un autre compte sont réservés aux abonnés payants, même pendant l'essai. Une sauvegarde faite avec ce compte se restaure toujours, et faire une sauvegarde (bouton « Sauvegarde ») reste possible pour tout le monde.";
const ownCount = () => ownNames().length;
async function premiumGate(text) {
  const trial = planState() === "trial"; // pendant l'essai, on ne vante pas ce que l'essai donne déjà
  if (await ask({ title: trial ? "Réservé aux abonnés" : "Réservé à Premium", text: text + (trial ? "" : "\n\nAvec Premium : programmes, séances et exercices illimités, les programmes Fiitday prêts à l'emploi, tout l'historique, toutes les stats et la synchro entre tes appareils."), ok: "Voir Premium", cancel: "Plus tard" })) go("premium");
}
// version gratuite : 1 programme actif et 2 séances actives (choisies librement) ; les autres restent visibles avec un cadenas
let faCache = { key: "" };
function freeActive() {
  const ts = templates(), fa = settings().freeActive || {}, key = dataRev + "|" + JSON.stringify(fa);
  if (faCache.key === key) return faCache.val;
  let val = { t: null, v: [] };
  if (ts.length) {
    const cnt = {}, tc = {};
    finished().forEach(w => { cnt[w.templateId + "|" + w.variantId] = (cnt[w.templateId + "|" + w.variantId] || 0) + 1; tc[w.templateId] = (tc[w.templateId] || 0) + 1; });
    const t = ts.find(x => x.id === fa.t) || ts.slice().sort((a, b) => (tc[b.id] || 0) - (tc[a.id] || 0))[0]; // par défaut : le programme le plus utilisé
    const ids = t.variants.map(v => v.id), chosen = fa.t === t.id && Array.isArray(fa.v) && fa.v.length > 0, v = (chosen ? fa.v : []).filter(id => ids.includes(id)).slice(0, FREE_VARIANTS);
    // séances choisies : une place libérée (séance supprimée) ne se remplit pas toute seule avec une séance verrouillée ;
    // un programme de 2 séances au plus les a toutes actives ; sans choix encore fait, les plus utilisées
    if (!chosen || t.variants.length <= FREE_VARIANTS) t.variants.slice().sort((a, b) => (cnt[t.id + "|" + b.id] || 0) - (cnt[t.id + "|" + a.id] || 0)).forEach(x => { if (v.length < FREE_VARIANTS && !v.includes(x.id)) v.push(x.id); });
    val = { t: t.id, v };
  }
  faCache = { key, val }; return val;
}
const progLocked = tid => isFree() && freeActive().t !== tid;
const varLocked = (tid, vid) => isFree() && !(freeActive().t === tid && freeActive().v.includes(vid));
const LOCK = '<svg class="lock-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>';
// changer de programme ou de séances actifs : une fois tous les 30 jours (le premier changement après l'essai ou
// après Premium est libre), sinon il suffirait d'avoir plusieurs programmes et de passer de l'un à l'autre
const freeNextSwitch = () => { const a = Number((settings().freeActive || {}).at) || 0; return a ? a + FREE_SWITCH_DAYS * DAY : 0; };
const freeCanSwitch = () => nowSafe() >= freeNextSwitch();
const freeSwitchTxt = () => freeCanSwitch() ? "Tu peux changer tes séances actives maintenant ; ensuite, une fois tous les " + FREE_SWITCH_DAYS + " jours."
  : "Tu changes tes séances actives une fois tous les " + FREE_SWITCH_DAYS + " jours : prochain changement possible le " + ctrDate(freeNextSwitch()) + ".";
// séance verrouillée touchée : changer ses séances actives (si le délai est passé), voir ses exercices, ou Premium
async function lockedChoice(tid, vid) {
  const t = getItem(tid), v = t && t.variants.find(x => x.id === vid); if (!v) return;
  const can = freeCanSwitch(), opts = [];
  if (can) opts.push(["pick", "Changer mes séances actives", "Choisis ton programme et tes 2 séances ; prochain changement possible " + FREE_SWITCH_DAYS + " jours après"]);
  opts.push(["peek", "Voir ses exercices", ""], ["premium", "Passer à Premium", "Toutes tes séances, sans limite"]);
  const c = await choose("« " + vLabel(v.name) + " » est verrouillée", opts, can ? "" : freeSwitchTxt());
  if (!c) return;
  if (c === "peek") { peekVariant(tid, vid); return; }
  if (c === "premium") { go("premium"); return; }
  changeActive(tid, vid);
}
// choisir en une fois le programme actif et ses séances actives (2 au plus), puis confirmer avec la date du prochain changement
function changeActive(tid, vid) {
  if (!isFree()) return;
  if (!freeCanSwitch()) { toast("Prochain changement possible le " + ctrDate(freeNextSwitch())); return; }
  const fa = freeActive(), ts = templates(); if (!ts.length) return;
  let pt = tid || fa.t, sel = vid ? [vid] : pt === fa.t ? fa.v.slice() : [];
  const need = () => Math.min(FREE_VARIANTS, ((getItem(pt) || {}).variants || []).length);
  const row = (t, v) => '<label class="pk-row"><input type="checkbox" data-pa-t="' + t.id + '"' + (v ? ' data-pa-v="' + v.id + '"' : "") + (t.id === pt && (!v || sel.includes(v.id)) ? " checked" : "") + "><span><b>" +
    (v ? esc(vLabel(v.name)) + '</b><span class="muted small">' + v.exercises.length + " exo" + (v.exercises.length > 1 ? "s" : "") : "Ce programme</b><span class=\"muted small\">Pas encore de séance : tu pourras en créer 2") + "</span></span></label>";
  const d = document.createElement("div"); d.className = "modal sheet";
  d.innerHTML = '<div class="modal-box pk" role="dialog" aria-modal="true" aria-label="Tes séances actives"><h3>Tes séances actives</h3>' +
    '<p class="small muted" style="margin:0">Version gratuite : 1 programme et 2 séances actives. Après ce choix, tu pourras en changer de nouveau dans ' + FREE_SWITCH_DAYS + " jours.</p>" +
    '<div class="pk-list"></div><p class="small pa-hint" role="status" style="margin:0"></p>' +
    '<div class="modal-btns"><button class="btn" data-r="">Annuler</button><button class="btn primary" data-r="ok">Valider</button></div></div>';
  const paint = () => {
    const box = d.querySelector(".pk-list"), top = box.scrollTop;
    box.innerHTML = ts.map(t => '<div class="pk-h">' + esc(t.name) + "</div>" + (t.variants.length ? t.variants.map(v => row(t, v)).join("") : row(t, null))).join("");
    box.scrollTop = top;
    const left = need() - sel.length, ok = left === 0;
    d.querySelector('[data-r="ok"]').disabled = !ok;
    d.querySelector(".pa-hint").textContent = ok ? "" : "Choisis encore " + left + " séance" + (left > 1 ? "s" : "") + " dans « " + getItem(pt).name + " »";
  };
  document.body.appendChild(d); paint();
  d.addEventListener("change", e => {
    const i = e.target; if (!i.dataset || !i.dataset.paT) return;
    const t = i.dataset.paT, v = i.dataset.paV;
    if (t !== pt) { pt = t; sel = v ? [v] : []; }
    else if (v && i.checked) { sel.push(v); if (sel.length > need()) sel.shift(); }
    else if (v) sel = sel.filter(x => x !== v);
    paint();
  });
  d.addEventListener("click", async e => {
    if (e.target === d) { d.remove(); return; }
    const b = e.target.closest("[data-r]"); if (!b || b.disabled) return;
    d.remove();
    if (b.dataset.r !== "ok") return;
    if (pt === fa.t && sel.length === fa.v.length && sel.every(x => fa.v.includes(x))) { toast("Ce sont déjà tes séances actives"); return; }
    const t = getItem(pt), names = sel.map(id => "« " + vLabel(t.variants.find(x => x.id === id).name) + " »");
    const ok = await ask({ title: "Activer ces séances ?", text: "Programme « " + t.name + " »" + (names.length ? " : " + names.join(" et ") : "") + ".\nLes autres restent gardées, avec un cadenas. Prochain changement possible le " + ctrDate(Date.now() + FREE_SWITCH_DAYS * DAY) + ".", ok: "Activer" });
    if (!ok) return;
    setSetting("freeActive", { t: pt, v: sel.slice(), at: nowSafe() });
    toast(names.length > 1 ? names.join(" et ") + " sont maintenant actives" : names.length ? names[0] + " est maintenant active" : "« " + t.name + " » est maintenant ton programme actif");
  });
}
function planBanner() {
  const s = planState();
  if (s === "trial") { const d = trialLeft(); return '<a class="card plan-banner trial" href="#/premium"><span><b>Essai Premium</b> · ' + d + " jour" + (d > 1 ? "s" : "") + " restant" + (d > 1 ? "s" : "") + '</span><span class="plan-go">Passer à Premium ›</span></a>'; }
  if (s === "free") return '<a class="card plan-banner" href="#/premium"><span><b>Version gratuite</b> · 1 programme, 2 séances actives</span><span class="plan-go">Passer à Premium ›</span></a>';
  return "";
}
const planCard = text => '<div class="card plan-lock">' + LOCK + '<div><b>Réservé à Premium</b><div class="small muted">' + text + '</div><a class="btn sm primary" href="#/premium">Voir Premium</a></div></div>';
function planStatus() {
  const s = planState(), d = trialLeft(), p = (!planTesting() && db.plan) || {}, until = p.until ? fmtDateLong(Date.parse(p.until)) : "";
  if (s === "premium" && !isMember() && !isFamily() && p.source) {
    if (p.source === "family-member") return "Membre de la famille de " + ((famSrv && famSrv.owner_name) || "ton proche") + " : Premium partagé, sans rien payer.";
    if (p.source === "gift") return "Premium " + (p.kind === "family" ? "Famille " : "") + "offert" + (until ? " jusqu'au " + until : " à vie") + ". Profite bien !";
    if (p.source === "lifetime") return "Premium à vie" + (p.kind === "family" ? " (Famille)" : "") + ". Merci de soutenir Fiitday !";
    if (p.source === "subscription" && p.renews === false) return "Abonnement résilié : Premium jusqu'au " + until + ", puis version gratuite, plus limitée (tes données sont gardées).";
    if (p.source === "subscription") return "Abonné Premium " + (p.kind === "family" ? "Famille" : "Solo") + (until ? " · prochain renouvellement le " + until : "") + ". Merci de soutenir Fiitday !";
  }
  if (s === "off" && p.would === "premium") return "L'abonnement n'est pas encore ouvert : tu as toute l'appli." + (p.source === "family-member" ? " Tu fais déjà partie de la famille de " + ((famSrv && famSrv.owner_name) || "ton proche") + "." : p.source === "gift" ? " Premium " + (p.kind === "family" ? "Famille " : "") + "t'est offert" + (until ? " jusqu'au " + until : " à vie") + "."
    : p.source === "subscription" ? " Achat de test reçu : abonnement Premium " + (p.kind === "family" ? "Famille" : "Solo") + (p.renews === false ? " résilié, Premium" : "") + (until ? " jusqu'au " + until + " à " + new Date(p.until).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "") + (p.renews === false ? ", puis fin." : ".")
    : p.source === "lifetime" ? " Achat de test reçu : Premium à vie" + (p.kind === "family" ? " (Famille)" : "") + "." : "");
  return s === "trial" ? "Essai Premium : encore " + d + " jour" + (d > 1 ? "s" : "") + ". À la fin, tu passes en version gratuite, plus limitée (tes données sont gardées)."
    : s === "free" ? "Version gratuite. Toutes tes données sont gardées : tout se débloque dès que tu t'abonnes."
    : s === "premium" && isMember() ? "Membre de la famille de " + ((db.planTestJoined || {}).owner || "ton proche") + " : Premium partagé, sans rien payer."
    : s === "premium" && isFamily() ? "Abonné Premium Famille : tu partages Premium avec jusqu'à " + (FAMILY_SIZE - 1) + " proches."
    : s === "premium" ? "Abonné Premium. Merci de soutenir Fiitday !" : "L'abonnement n'est pas encore ouvert : tu as toute l'appli.";
}
// formule choisie sur l'écran Premium : prix du bouton et conditions affichées juste en dessous (obligatoires avant le paiement)
const isNativeApp = () => !!Native;
const pickPrice = () => { const pr = PRICES[premiumFor]; return premiumPick === "month" ? pr.month + " / mois" : premiumPick === "life" ? (Date.now() < LIFE_END ? pr.life : pr.lifeAfter) + " en une fois" : pr.year + " / an"; };
const pickLabel = () => (premiumPick === "life" ? "Acheter Premium à vie · " : "S'abonner · ") + pickPrice();
// accord exprès avant le paiement (L221-25) : Premium commence tout de suite ; la rétractation reste possible 14 jours.
// Premium est un « service numérique » (créer, stocker, synchroniser ses données) : l'exception du 13° de L221-28,
// réservée aux contenus numériques, ne s'applique pas, donc pas de renonciation au droit de rétractation, même à vie.
// Fiitday choisit de rembourser intégralement dans les 14 jours, abonnement comme achat à vie (plus simple et plus favorable).
const consentText = () => premiumPick === "life"
  ? "Je demande que Premium à vie commence tout de suite. Je garde 14 jours pour me rétracter, avec un remboursement intégral."
  : "Je demande que Premium commence tout de suite. Je garde 14 jours pour me rétracter, avec un remboursement intégral.";
function pickTerms() {
  const store = billingMode() === "test" ? "Achat de test, sans paiement réel" : isNativeApp() ? "Paiement par Google Play" : "Paiement sécurisé par carte bancaire";
  return premiumPick === "life" ? store + ", en une seule fois, sans renouvellement. Premium " + (premiumFor === "family" ? "Famille " : "") + "à vie sur ton compte. Tu as 14 jours pour te rétracter, remboursement intégral."
    : store + ". Renouvellement automatique " + (premiumPick === "month" ? "chaque mois" : "chaque année") + " au même prix, sauf résiliation avant la date de renouvellement. Résiliable à tout moment" + (isNativeApp() ? " dans Google Play" : " dans Réglages › Tes achats Premium") + ". Tu as 14 jours pour te rétracter.";
}
// déjà Premium : d'où il vient, et comment le gérer
function premiumOwned() {
  const p = (!planTesting() && db.plan) || {};
  if (p.source === "subscription" && p.store === "PLAY_STORE") return '<a class="btn block" href="' + PLAY_SUBS + '" target="_blank" rel="noopener">Gérer mon abonnement dans Google Play</a>';
  if (p.source === "subscription") return '<button class="btn block" data-act="planmanage">Gérer mon abonnement</button>';
  return "";
}
// achat possible ici ? Les ventes sont ouvertes par le serveur (date de lancement) ; il faut aussi une version de l'appli qui sait
// encaisser (MONETIZATION), un moyen de paiement ici, et des CGV publiées (garde-fou : jamais de vente sans elles). L'achat de test passe toujours.
const salesSrv = () => !!(db.plan && (db.plan.can_buy || db.plan.launched));
function buyState(s) {
  if (s === "premium") return "owned";
  if (billingMode() === "test") return "ok";
  if (!salesSrv()) return "soon";
  if (!MONETIZATION) return "update"; // version de l'appli trop ancienne pour encaisser
  if (!billingMode()) return Native ? "web" : "soon"; // appli Android sans paiement : on s'abonne sur fiitday.com
  if (!LEGAL.cgv) return "soon";
  return "ok";
}
const SITE_PREMIUM = "https://fiitday.com/#/premium";
// sous le bouton d'achat : CGV acceptées en payant, vendeur, garanties, rétractation et médiateur (obligatoires avant le paiement)
const buyLegal = () => '<p class="small muted plan-legal">En payant, tu acceptes les ' + (LEGAL.cgv ? '<a href="' + LEGAL.cgv + '" target="_blank" rel="noopener">conditions générales de vente</a>' : "conditions générales de vente") +
  '. Vendeur : voir les <a href="' + LEGAL.legal + '" target="_blank" rel="noopener">mentions légales</a>. Garanties légales, droit de rétractation et médiateur de la consommation : dans les CGV.</p>';
function viewPremium() {
  const s = planState(), prev = (history.state && history.state.prev) || "#/settings";
  const rows = PLAN_ROWS, bs = buyState(s);
  const live = bs === "ok";
  return '<a class="back" href="' + esc(prev) + '">‹ Retour</a><div class="page-head"><h1>Fiitday Premium</h1></div>' +
    '<div class="card"><div class="small">' + esc(planStatus()) + "</div>" +
    (s !== "premium" && !Native && billingMode() === "test" && ((!planTesting() && db.plan) || {}).source === "subscription" ? '<button class="btn sm" style="margin-top:8px" data-act="planmanage">Gérer mon abonnement (test)</button>' : "") + "</div>" + contractsCard() +
    (billingMode() === "test" ? (Native ? '<div class="card plan-testapp"><h2 class="card-h">Appli de test</h2><div class="small muted">Achats factices du magasin de test RevenueCat : aucun paiement. Seul le compte administrateur reçoit Premium.</div></div>'
      : '<div class="card plan-testapp"><h2 class="card-h">Paiement de test</h2><div class="small muted">Visible seulement par toi. Carte de test Stripe : 4242 4242 4242 4242, une date future, n\'importe quel code : aucun paiement réel. Seul le compte administrateur reçoit Premium.</div></div>') : "") +
    '<div class="seg plan-for" role="group" aria-label="Formule">' + [["solo", "Solo"], ["family", "Famille"]].map(([k, l]) => '<button class="' + (premiumFor === k ? "on" : "") + '" aria-pressed="' + (premiumFor === k) + '" data-act="planfor" data-val="' + k + '">' + l + "</button>").join("") + "</div>" +
    '<p class="small muted plan-for-txt">' + (premiumFor === "family" ? "Pour " + FAMILY_SIZE + " personnes : toi + 4 proches. Chacun a son propre compte, ses programmes et son historique ; personne ne voit les données des autres." : "Pour toi seul, sur tous tes appareils.") + "</p>" +
    '<div class="plans" role="radiogroup" aria-label="Durée">' +
    '<button type="button" role="radio" aria-checked="' + (premiumPick === "year") + '" data-act="planpick" data-val="year" class="card plan-opt best' + (premiumPick === "year" ? " picked" : "") + '"><span class="tag">2 mois offerts</span><b>Annuel</b><div class="plan-price num">' + PRICES[premiumFor].year + ' <small>/ an</small></div><div class="small muted">soit ' + PRICES[premiumFor].yearMonth + " par mois</div></button>" +
    '<button type="button" role="radio" aria-checked="' + (premiumPick === "month") + '" data-act="planpick" data-val="month" class="card plan-opt' + (premiumPick === "month" ? " picked" : "") + '"><b>Mensuel</b><div class="plan-price num">' + PRICES[premiumFor].month + ' <small>/ mois</small></div><div class="small muted">sans engagement</div></button>' +
    (pr => Date.now() < LIFE_END
      ? '<button type="button" role="radio" aria-checked="' + (premiumPick === "life") + '" data-act="planpick" data-val="life" class="card plan-opt life' + (premiumPick === "life" ? " picked" : "") + '"><span class="tag">Offre de lancement</span><b>À vie</b><div class="plan-price num">' + pr.life + ' <small>en une fois</small></div><div class="small">Prix de lancement, puis ' + pr.lifeAfter + " à partir du " + LIFE_END_TXT + '.</div><div class="small muted">Sans abonnement, ' + pr.lifeVs + ".</div></button>"
      : '<button type="button" role="radio" aria-checked="' + (premiumPick === "life") + '" data-act="planpick" data-val="life" class="card plan-opt life' + (premiumPick === "life" ? " picked" : "") + '"><b>À vie</b><div class="plan-price num">' + pr.lifeAfter + ' <small>en une fois</small></div><div class="small muted">Sans abonnement : un seul paiement.</div></button>')(PRICES[premiumFor]) + "</div>" +
    (s === "premium" ? premiumOwned() : (live ? '<label class="plan-consent"><input type="checkbox" data-act="planconsent"' + (premiumConsent ? " checked" : "") + "><span>" + esc(consentText()) + "</span></label>" : "") +
      (bs === "web" ? '<a class="btn primary block big" href="' + SITE_PREMIUM + '" target="_blank" rel="noopener">S\'abonner sur fiitday.com</a><p class="small muted plan-terms">Ouvre fiitday.com connecté à ce compte : le paiement se fait par carte bancaire, et Premium marche aussi dans cette appli.</p>'
        : bs === "update" ? '<button class="btn primary block big" disabled>Mets à jour Fiitday pour t\'abonner</button><p class="small muted plan-terms">Cette version ne sait pas encore encaisser. Mets à jour l\'appli, ou abonne-toi sur <a href="' + SITE_PREMIUM + '" target="_blank" rel="noopener">fiitday.com</a> connecté à ce compte.</p>'
        : '<button class="btn primary block big" ' + (live && !buying ? 'data-act="planbuy"' : "disabled") + ">" + (buying ? "Achat en cours…" : live ? pickLabel() : "Paiement bientôt disponible") + "</button>" +
          (live ? '<p class="small muted plan-terms">' + pickTerms() + "</p>" + buyLegal() : '<p class="small muted plan-terms">Les abonnements ne sont pas encore ouverts : les prix ci-dessus sont ceux prévus.</p>'))) +
    (billingMode() && Native ? '<button class="link small" style="margin-top:8px" data-act="planrestore">Restaurer mes achats</button>' : "") +
    (planTesting() && s !== "premium" ? '<button class="link small" style="margin-top:8px" data-act="plantest" data-val="premium">Simuler l\'abonnement (mode test)</button>' : "") +
    '<p class="small muted" style="margin:10px 2px 0">Essai gratuit de 30 jours à la création du compte. Résiliable à tout moment ; à la fin, tu gardes toutes tes données.' +
    (premiumFor === "family" ? " Formule Famille : tu invites tes proches depuis Réglages › Abonnement ; une personne retirée ne peut être remplacée qu\'après 15 jours. Déjà abonné en Solo ? Résilie-le avant de rejoindre une Famille, pour ne pas payer deux fois." : "") + "</p>" +
    '<div class="section-title">Premium ou gratuit</div><div class="card plan-table"><table><thead><tr><th></th><th>Premium</th><th>Gratuit</th></tr></thead><tbody>' +
    rows.map(r => "<tr><th>" + esc(r[0]) + "</th><td>" + esc(r[1]) + "</td><td>" + esc(r[2]) + "</td></tr>").join("") + "</tbody></table></div>";
}
// formule Famille : le titulaire invite jusqu'à 4 personnes (code ou lien) ; chacune garde son propre compte.
// Une place libérée en retirant quelqu'un ne se réutilise qu'après 15 jours (pas de « place tournante » partagée entre amis).
// En mode test, tout reste sur cet appareil (invitations simulées) ; au lancement, le serveur gérera les membres.
const isFamily = () => planTesting() && db.planTest === "family";
const isMember = () => planTesting() && db.planTest === "member";
// invité : « J'ai une invitation Famille » (code de 8 caractères ou lien fiitday.com/#/famille/CODE)
function memberBox() {
  const j = db.planTestJoined || {};
  return '<div class="fam-list" style="margin-top:10px"><div class="fam-row"><span class="fam-av" aria-hidden="true">' + esc((j.owner || "?").charAt(0).toUpperCase()) + '</span><div class="fam-t"><b>Famille de ' + esc(j.owner || "ton proche") + '</b><div class="small muted">Membre depuis le ' + esc(fmtDate(j.at || Date.now())) + " · tes données restent à toi</div></div></div></div>" +
    '<button class="btn sm danger fam-join" data-act="famleave">Quitter la famille</button>';
}
async function famJoin(pre) {
  if (!planTesting()) {
    const raw = pre || await ask({ title: "J'ai une invitation Famille", text: "Tape le code de 8 caractères reçu, ou colle le lien d'invitation.", input: "", code: true, ok: "Continuer" });
    if (raw) famJoinSrv(raw); return;
  }
  if (isFamily()) { toast("Tu es déjà titulaire d'un abonnement Famille"); return; }
  const raw = pre || await ask({ title: "J'ai une invitation Famille", text: "Tape le code de 8 caractères reçu, ou colle le lien d'invitation.", input: "", code: true, ok: "Rejoindre" });
  if (!raw) return;
  const c = normCode(String(raw).replace(/^.*\/famille\//i, ""));
  if (!XFER_RE.test(c)) { toast("Code d'invitation non valide : 8 lettres et chiffres"); return; }
  const own = famData().members.find(m => m.code === c);
  const owner = own ? "Yohan (ta propre invitation)" : "Léa (exemple)";
  if (db.planTest === "premium" && !await ask({ title: "Tu as déjà Premium Solo", text: "En rejoignant cette famille, tu n'as plus besoin de ton abonnement Solo : pense à le résilier pour ne pas payer deux fois.", ok: "Rejoindre quand même" })) return;
  if (!await ask({ title: "Rejoindre la famille de " + owner + " ?", text: "Premium est débloqué pour toi tant que l'abonnement Famille est actif. Ton compte, tes programmes et ton historique restent à toi : personne d'autre ne les voit.", ok: "Rejoindre" })) return;
  db.planTestJoined = { owner, at: Date.now(), prev: db.planTest }; db.planTest = "member"; saveNow(); render();
  toast("Tu as rejoint la famille de " + owner + " : Premium débloqué");
}
const FAM_WAIT_DAYS = 15, FAM_WAIT = FAM_WAIT_DAYS * DAY;
const famData = () => { if (!db.planTestFam) db.planTestFam = { members: [], removed: [] }; return db.planTestFam; };
const famWaits = () => famData().removed.filter(t => t + FAM_WAIT > Date.now()).sort((a, b) => a - b);
const famFree = () => FAMILY_SIZE - 1 - famData().members.length - famWaits().length;
const famCode = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
const famLink = c => "https://fiitday.com/#/famille/" + c;
function familyBox() {
  const f = famData(), av = n => '<span class="fam-av" aria-hidden="true">' + esc((n || "?").trim().charAt(0).toUpperCase()) + "</span>";
  let h = '<div class="section-title">Ta famille · ' + (f.members.length + 1) + " / " + FAMILY_SIZE + '</div><div class="fam-list">' +
    '<div class="fam-row">' + av(firstName() || "Toi") + '<div class="fam-t"><b>' + esc(firstName() || "Toi") + ' (toi)</b><div class="small muted">Titulaire de l\'abonnement</div></div></div>';
  f.members.forEach(m => {
    h += '<div class="fam-row">' + av(m.name) + '<div class="fam-t"><b>' + esc(m.name) + "</b>" +
      (m.status === "member" ? '<div class="small muted">Membre depuis le ' + esc(fmtDate(m.at)) + "</div></div>" + '<button class="btn sm danger" data-act="famremove" data-id="' + m.id + '">Retirer</button>'
        : '<div class="small muted">Invitation envoyée · code ' + esc(m.code) + '</div><div class="row" style="margin-top:6px;flex-wrap:wrap"><button class="btn sm" data-act="famshare" data-id="' + m.id + '">Renvoyer</button><button class="btn sm" data-act="famcancel" data-id="' + m.id + '">Annuler</button><button class="link small" data-act="famaccept" data-id="' + m.id + '">Simuler l\'acceptation (mode test)</button></div></div>') + "</div>";
  });
  famWaits().forEach(t => { h += '<div class="fam-row wait">' + LOCK + '<div class="fam-t"><b>Place libre le ' + esc(fmtDate(t + FAM_WAIT)) + '</b><div class="small muted">Une personne a été retirée : sa place se libère ' + FAM_WAIT_DAYS + ' jours après.</div><button class="link small" data-act="famskip">Avancer de ' + FAM_WAIT_DAYS + ' jours (mode test)</button></div></div>'; });
  for (let k = famFree(); k > 0; k--) h += '<button class="fam-row add" data-act="faminvite"><span class="fam-av add" aria-hidden="true">+</span><span class="fam-t"><b>Inviter quelqu\'un</b><span class="small muted">Un proche ou un ami, avec son propre compte Fiitday</span></span></button>';
  return h + '</div><div class="small muted" style="margin-top:8px">Chacun garde son compte et ses données : tu ne vois pas les séances des autres, ils ne voient pas les tiennes.</div>';
}
async function famShareCode(m) {
  const text = "Rejoins mon abonnement Fiitday Premium Famille : " + famLink(m.code) + "\nOu dans l'appli : Réglages › Abonnement › « J'ai une invitation », code " + m.code + ".";
  const copy = await ask({ title: "Invitation pour " + m.name, html: '<div class="xfer-code" aria-label="Code ' + esc(m.code.split("").join(" ")) + '">' + esc(m.code) + "</div>",
    text: "Envoie-lui ce code ou le lien. Elle l'ouvre avec son compte Fiitday (ou en crée un) et rejoint ta famille.", ok: "Copier l'invitation", cancel: "Fermer" });
  if (copy) { try { await navigator.clipboard.writeText(text); toast("Invitation copiée : envoie-la à " + m.name); } catch (e) { toast("Code d'invitation : " + m.code); } }
}
/* ----- Famille sur le serveur (vraies invitations) ; le mode test « Abonné Famille » reste une simulation sur l'appareil ----- */
let famSrv = null, famLoading = null;
const famLocal = () => planTesting() && (db.planTest === "family" || db.planTest === "member");
const famShow = () => !famLocal() && !!db.auth && !!db.plan && (!!db.plan.can_family || !!db.plan.family_role);
function loadFam(force) {
  if (!db.auth) return Promise.resolve(null);
  if (!force && famSrv && Date.now() - famSrv.at_ms < 60000) return Promise.resolve(famSrv);
  if (famLoading) return famLoading;
  famLoading = (async () => {
    try { const r = await rpc("family_status"); famSrv = Object.assign(r || {}, { at_ms: Date.now() }); if (r && r.plan && r.plan.state) { db.plan = Object.assign(r.plan, { at_ms: Date.now() }); saveNow(); } }
    catch (e) { famSrv = famSrv || { err: e.message === "Failed to fetch" ? "Pas de connexion internet." : e.message, at_ms: Date.now() }; }
    finally { famLoading = null; }
    if (route().name === "settings") render();
    return famSrv;
  })();
  return famLoading;
}
const famErr = e => e && e.message === "Failed to fetch" ? "Pas de connexion internet : rien n'a changé" : (e && e.message) || "Ça n'a pas marché, réessaie";

// suppression du compte : ce qui sera perdu (statut lu sur le serveur, sinon le dernier connu). Supprimer le compte
// n'arrête pas un abonnement : il se résilie dans Google Play (ou sur fiitday.com), d'où « stop » pour proposer de le faire d'abord.
const PLAY_SUBS = "https://play.google.com/store/account/subscriptions?package=com.fiitday.app";

/* ================= Résilier / renoncer au contrat (Code de la consommation, L215-1-1 et L221-21) ================= */
// Réglages › Abonnement et écran Premium, carte « Tes achats Premium » : « Résilier mon abonnement » (formulaire, date de fin,
// récapitulatif, « Notifier la résiliation ») et, pendant 14 jours après un achat, « Renoncer au contrat ici » (récapitulatif,
// « Confirmer la rétractation »). La fonction Edge « contrat » vérifie la demande, arrête l'abonnement chez RevenueCat
// et envoie la confirmation par e-mail. Un abonnement Google Play se résilie dans Google Play (le bouton l'ouvre).
let contracts = null, contractsAt = 0, contractsBusy = false, ctr = null;
async function loadContracts(force) {
  if (!db.auth || contractsBusy) return;
  if (!force && contractsAt && Date.now() - contractsAt < 60000) return;
  contractsBusy = true;
  try { const r = await rpc("my_contracts"); contracts = r && r.ok ? r : (contracts && contracts.ok ? contracts : { ok: false }); }
  catch (e) { if (!contracts || !contracts.ok) contracts = { ok: false, err: e.message === "Failed to fetch" ? "pas de connexion internet" : "tes achats n'ont pas pu être chargés" }; }
  contractsAt = Date.now(); contractsBusy = false;
  if (["settings", "premium", "resilier", "retractation"].includes(route().name)) render();
}
const ctrClock = () => contracts && contracts.now ? Date.parse(contracts.now) + (Date.now() - contractsAt) : Date.now();
const STORE_TXT = { PLAY_STORE: "Google Play", RC_BILLING: "carte bancaire sur fiitday.com", TEST_STORE: "magasin de test" };
const ctrEur = v => (+v || 0).toFixed(2).replace(".", ",") + "\u00a0€";
const ctrDf = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const ctrDate = t => ctrDf.format(new Date(t)); // avec l'année : « 20 novembre 2027 »
const ctrWhen = t => ctrDate(t) + " à " + new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const ctrLastDay = t => ctrDate(Date.parse(t) - 60000); // échéance à minuit (heure de Paris) → dernier jour inclus
function ctrItems() {
  if (!contracts || !contracts.ok) return [];
  const out = (contracts.subs || []).map(x => ({ type: "sub", store: x.store, product: x.product, label: x.label, until: x.until, renews: x.renews, retract: x.retract_until }));
  // achats à vie : chacun à part (Solo et Famille ont chacun leur date et leur délai de rétractation) ; ancien serveur : un seul
  const lifes = Array.isArray(contracts.lifes) ? contracts.lifes : contracts.life ? [contracts.life] : [];
  lifes.forEach(l => out.push({ type: "life", store: l.store, product: l.product, label: l.kind === "family" ? "Premium Famille à vie" : "Premium Solo à vie", at: l.at, retract: l.retract_until }));
  return out;
}
const ctrKey = i => i.store + "/" + i.product;
const ctrHref = (page, i) => "#/" + page + "/" + encodeURIComponent(i.store) + "/" + encodeURIComponent(i.product);
const canRetract = i => !!i.retract && ctrClock() < Date.parse(i.retract);
const playSubUrl = i => PLAY_SUBS + "&sku=" + encodeURIComponent(i.product);
function contractsCard() {
  if (!db.auth) return "";
  if (!contractsAt || Date.now() - contractsAt > 60000) setTimeout(() => loadContracts(), 0);
  if (!contracts) return "";
  const items = ctrItems(), reqs = ((contracts && contracts.requests) || []).slice(0, 3);
  // rien en cours : la carte reste visible dès que la vente est possible (accès permanent à la résiliation)
  if (!items.length && !reqs.length) return MONETIZATION || billingMode() ? '<div class="card ctr-card"><h2 class="card-h">Tes achats Premium</h2><div class="small muted" style="margin-top:4px">Aucun abonnement ni achat en cours. Les boutons « Résilier mon abonnement » et « Renoncer au contrat ici » apparaissent ici dès que tu as un abonnement, ou un achat de moins de 14 jours.</div>' +
    '<a class="btn sm" style="margin-top:10px" href="#/resilier">Résilier un abonnement</a></div>' : "";
  return '<div class="card ctr-card"><h2 class="card-h">Tes achats Premium</h2>' +
    items.map(i => '<div class="ctr-item"><div class="ctr-txt"><b>' + esc(i.label) + '</b><div class="small muted">' + esc(STORE_TXT[i.store] || "") +
      (i.type === "sub" ? " · " + (i.renews ? "se renouvelle le " : "résilié, Premium jusqu'au ") + esc(ctrDate(Date.parse(i.until))) : i.at ? " · acheté le " + esc(ctrDate(Date.parse(i.at))) : "") + "</div>" +
      (canRetract(i) ? '<div class="small muted">Rétractation possible jusqu\'au ' + esc(ctrLastDay(i.retract)) + " inclus</div>" : "") + '</div><div class="ctr-btns">' +
      (i.type === "sub" ? (i.store === "PLAY_STORE" ? '<a class="btn sm" href="' + esc(playSubUrl(i)) + '" target="_blank" rel="noopener">Résilier mon abonnement</a>' : '<a class="btn sm" href="' + ctrHref("resilier", i) + '">Résilier mon abonnement</a>') : "") +
      (canRetract(i) ? '<a class="btn sm" href="' + ctrHref("retractation", i) + '">Renoncer au contrat ici</a>' : "") + "</div></div>").join("") +
    (reqs.length ? '<div class="ctr-hist small muted">' + reqs.map(r => esc((r.kind === "resiliation" ? "Résiliation notifiée le " : "Rétractation envoyée le ") + ctrDate(Date.parse(r.at)) + " · " + r.label +
      (r.kind === "resiliation" ? ", fin le " + ctrDate(Date.parse(r.end_at)) : ", remboursement intégral"))).join("<br>") + "</div>" : "") +
    '<div class="small muted ctr-note">Résilier ou te rétracter est gratuit et sans motif ; tu reçois une confirmation par e-mail.</div></div>';
}
function ctrGrab() {
  if (!ctr) return;
  const n = document.querySelector('[data-ctr="name"]'), m = document.querySelector('[data-ctr="email"]');
  if (n) ctr.name = n.value; if (m) ctr.email = m.value;
}
function viewContract(kind) {
  const r = route(), res = kind === "resiliation";
  const head = '<a class="back" href="#/settings">‹ Réglages</a><div class="page-head"><h1>' + (res ? "Résilier votre contrat" : "Renoncer au contrat") + "</h1></div>";
  if (!ctr || ctr.kind !== kind) ctr = { kind, step: "form", name: firstName(), email: (db.auth && db.auth.user.email) || "", key: "", wish: "", err: "", busy: false, res: null }; // date de fin : aucune pré-cochée, le client choisit
  if (ctr.step === "done" && ctr.res) {
    const d = ctr.res;
    return head + '<div class="card ctr-done"><h2 class="card-h">' + (res ? "Résiliation enregistrée" : "Rétractation envoyée") + '</h2><p>Le ' + esc(ctrWhen(d.at)) + ".</p>" +
      (res ? "<p>Ton abonnement " + esc(d.label) + " prend fin le <b>" + esc(ctrWhen(d.end_at)) + "</b>. Plus rien ne sera prélevé ; ensuite, ton compte passe en version gratuite, plus limitée, et tu gardes toutes tes données.</p>" +
          (+d.refund > 0 ? "<p>La part non utilisée, <b>" + esc(ctrEur(d.refund)) + "</b>, te sera remboursée avec ton moyen de paiement au plus tard 14 jours après aujourd'hui.</p>" : "")
        : "<p>" + esc(d.label) + " s'arrête maintenant et ton compte passe en version gratuite, plus limitée ; tes données sont gardées. Tu es remboursé intégralement, avec le même moyen de paiement, au plus tard 14 jours après aujourd'hui.</p>") +
      "<p>" + (d.mail_sent ? "Une confirmation t'a été envoyée par e-mail à <b>" + esc(ctr.email) + "</b>." : "L'e-mail de confirmation n'a pas pu partir pour l'instant : garde cet écran (par exemple en capture d'écran), il fait foi. Nous t'écrirons à " + esc(ctr.email) + ".") + "</p>" +
      '<a class="btn" href="#/settings">Retour aux réglages</a></div>';
  }
  if (!db.auth) return head + '<div class="card empty">Tu utilises Fiitday sans compte : il n\'y a aucun achat à ' + (res ? "résilier" : "annuler") + '. <a class="link" href="#/settings">Retour aux réglages</a></div>';
  if (!contracts || (!contracts.ok && !contracts.err && contractsBusy)) { loadContracts(); return head + '<div class="card empty">Chargement de tes achats…</div>'; }
  if (!contracts.ok) return head + '<div class="card"><p class="msg err" style="margin:0">' + esc(contracts.err || "Tes achats n'ont pas pu être chargés") + '</p><button class="btn sm" style="margin-top:10px" data-act="ctrreload">Réessayer</button></div>';
  const items = ctrItems().filter(i => res ? i.type === "sub" : canRetract(i));
  if (!items.length) return head + '<div class="card">' + (res ? "Tu n'as aucun abonnement en cours à résilier." : "Aucun achat de moins de 14 jours : il n'y a rien à rétracter.") + "</div>";
  const want = r.args[0] && r.args[1] ? r.args[0] + "/" + r.args[1] : "";
  if (!ctr.key || !items.some(i => ctrKey(i) === ctr.key)) ctr.key = items.some(i => ctrKey(i) === want) ? want : ctrKey(items[0]);
  const it = items.find(i => ctrKey(i) === ctr.key);
  if (res && it.renews === false) ctr.wish = "maintenant";
  ctr.need = !!(res && it && it.store !== "PLAY_STORE"); // date de fin à choisir (pas pour Google Play, résilié chez Google)
  const msg = '<p class="msg' + (ctr.err ? " err" : "") + '" role="status">' + esc(ctr.err) + "</p>";
  if (ctr.step === "recap") {
    const rows = [["Nom", ctr.name], ["E-mail", ctr.email], ["Contrat", it.label + " · " + (STORE_TXT[it.store] || it.store)]];
    if (res) rows.push(["Date de fin", ctr.wish === "fin" ? "le " + ctrDate(Date.parse(it.until)) + ", à la fin de la période déjà payée" : "dès maintenant, avec le remboursement de la part non utilisée"]);
    else rows.push(["Déclaration", "Je me rétracte de mon contrat " + it.label + "."], ["Remboursement", "intégral"]);
    return head + '<div class="card ctr-recap"><h2 class="card-h">Vérifie ta demande</h2><dl class="ctr-dl">' + rows.map(([k, v]) => "<dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd>").join("") + "</dl>" +
      '<div class="row duo"><button class="btn" data-act="ctredit"' + (ctr.busy ? " disabled" : "") + '>Modifier</button><button class="btn primary" data-act="ctrsend"' + (ctr.busy ? " disabled" : "") + ">" +
      (ctr.busy ? "Envoi…" : res ? "Notifier la résiliation" : "Confirmer la rétractation") + "</button></div>" + msg + "</div>";
  }
  const play = res && it.store === "PLAY_STORE";
  return head + '<p class="muted ctr-intro">' + (res ? "Gratuit et sans motif. Vérifie ou remplis ces informations, puis vérifie le récapitulatif avant d'envoyer ta résiliation."
      : "Pendant les 14 jours qui suivent ton achat, tu peux te rétracter sans motif ni frais : Premium s'arrête et tu es remboursé intégralement.") + "</p>" +
    '<div class="card ctr-form">' +
    '<label class="fl">Nom et prénom<input class="f" data-ctr="name" autocomplete="name" maxlength="120" value="' + esc(ctr.name) + '"></label>' +
    '<label class="fl">E-mail pour recevoir la confirmation<input class="f" type="email" data-ctr="email" autocomplete="email" maxlength="200" value="' + esc(ctr.email) + '"></label>' +
    '<div class="fl">Contrat concerné<div class="ctr-opts">' + items.map(i => '<label class="ctr-opt"><input type="radio" name="ctrkey" data-act="ctrkey" value="' + esc(ctrKey(i)) + '"' + (ctrKey(i) === ctr.key ? " checked" : "") + "><span><b>" + esc(i.label) + '</b><span class="small muted">' +
      esc((STORE_TXT[i.store] || i.store) + (i.type === "sub" ? " · " + (i.renews ? "se renouvelle le " : "Premium jusqu'au ") + ctrDate(Date.parse(i.until)) : "")) + "</span></span></label>").join("") + "</div></div>" +
    (res && !play ? '<div class="fl">Date de fin souhaitée<div class="ctr-opts">' +
      '<label class="ctr-opt"><input type="radio" name="ctrwish" data-act="ctrwish" value="maintenant"' + (ctr.wish === "maintenant" ? " checked" : "") + '><span><b>Dès maintenant</b><span class="small muted">Premium s\'arrête aujourd\'hui et la part non utilisée t\'est remboursée</span></span></label>' +
      (it.renews !== false ? '<label class="ctr-opt"><input type="radio" name="ctrwish" data-act="ctrwish" value="fin"' + (ctr.wish === "fin" ? " checked" : "") + '><span><b>À la fin de la période déjà payée</b><span class="small muted">le ' + esc(ctrDate(Date.parse(it.until))) + " : tu gardes Premium jusque-là, rien n'est remboursé</span></span></label>" : "") +
      '</div></div>' : "") +
    (play ? '<p class="small" style="margin:4px 0 10px">Cet abonnement a été payé par Google Play : il se résilie dans Google Play, qui t\'envoie la confirmation.</p><a class="btn primary block" href="' + esc(playSubUrl(it)) + '" target="_blank" rel="noopener">Résilier dans Google Play</a>'
      : '<button class="btn primary block" data-act="ctrnext">Continuer</button>') + msg + "</div>";
}
async function contractCall(body) {
  try {
    await ensureToken();
    const call = () => fetch(SUPABASE_URL + "/functions/v1/contrat", { method: "POST", body: JSON.stringify(body), headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + db.auth.access_token, "Content-Type": "application/json" } });
    let r = await call(); if (r.status === 401) { await ensureToken(true); r = await call(); }
    const j = await r.json().catch(() => null);
    return j || { ok: false, reason: "Réponse illisible du serveur (" + r.status + ")" };
  } catch (e) { return { ok: false, reason: e.message === "Failed to fetch" ? "Pas de connexion internet : réessaie dans un instant" : e.message }; }
}
async function deleteWarnings() {
  let fam = null;
  try { fam = await rpc("family_status"); } catch (e) { }
  const p = (fam && fam.plan) || db.plan || {}, w = [], until = p.until ? fmtDateLong(Date.parse(p.until)) : "";
  let stop = null;
  if (p.source === "subscription" && p.renews !== false) {
    stop = p.store === "PLAY_STORE" ? "play" : "web";
    w.push(stop === "play" ? "Ton abonnement Premium est toujours actif : supprimer ton compte n'arrête pas les paiements Google Play. Résilie-le d'abord dans Google Play (Abonnements)." : "Ton abonnement Premium par carte sera résilié tout de suite (plus aucun prélèvement), avec le remboursement de la part non utilisée et un e-mail de confirmation.");
  } else if (p.source === "subscription") w.push("Il te reste du Premium jusqu'au " + until + " : il sera perdu.");
  if (p.source === "lifetime") w.push("Ton Premium à vie" + (p.kind === "family" ? " (Famille)" : "") + " est lié à ce compte : il sera perdu.");
  if (p.source === "gift") w.push("Ton Premium offert sera perdu.");
  const mem = fam && fam.role === "owner" && Array.isArray(fam.members) ? fam.members : [];
  if (mem.length) {
    const names = mem.map(m => m.name).filter(Boolean);
    w.push((mem.length > 1 ? "Les " + mem.length + " membres" : "Le membre") + " de ta famille" + (names.length ? " (" + names.join(", ") + ")" : "") + (mem.length > 1 ? " perdront" : " perdra") + " Premium.");
  }
  if (!fam && !db.plan && MONETIZATION) w.push("Si tu as un abonnement, résilie-le d'abord : supprimer ton compte n'arrête pas les paiements.");
  return { w, stop };
}
// ouvre un lien hors de l'appli (le navigateur, ou Google Play sur Android)
function openOut(url) { const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove(); }
// suppression côté serveur : la fonction « delete-account » efface aussi le client chez RevenueCat (RGPD) avant le compte ;
// si elle échoue (panne, réseau), suppression directe du compte comme avant (le serveur vérifie toujours qui la demande)
async function deleteAccountSrv() {
  await ensureToken();
  const call = () => fetch(SUPABASE_URL + "/functions/v1/delete-account", { method: "POST", body: "{}",
    headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + db.auth.access_token, "Content-Type": "application/json" } });
  let r = null;
  try { r = await call(); if (r.status === 401) { await ensureToken(true); r = await call(); } } catch (e) { r = null; }
  if (r && r.ok) return;
  if (r && r.status >= 400 && r.status < 500) { let m = ""; try { m = (await r.json()).error || ""; } catch (e) { } throw Object.assign(new Error(m || "refus"), { status: r.status, srv: m }); } // refus motivé (ex. abonnement impossible à arrêter)
  // fonction injoignable : suppression directe (le serveur refuse s'il reste un abonnement par carte à arrêter)
  await rest("POST", "rpc/delete_my_account", {}, { Prefer: "return=minimal" });
}
function srvFamilyBox() {
  const f = famSrv || {}, members = f.members || [], invites = f.invites || [], waits = (f.waits || []).map(t => Date.parse(t)), active = !!(db.plan && db.plan.can_family);
  const free = f.role === "owner" ? f.free : FAMILY_SIZE - 1, av = n => '<span class="fam-av" aria-hidden="true">' + esc((n || "?").trim().charAt(0).toUpperCase()) + "</span>";
  let h = (active ? "" : '<p class="msg err" style="margin:10px 0 0">Ton abonnement Famille n\'est plus actif : tes proches n\'ont plus Premium. Réabonne-toi pour le leur rendre.</p>') +
    (f.blocked ? '<p class="msg err" style="margin:10px 0 0">Les invitations de ta famille sont suspendues. Écris à contact@fiitday.com si tu penses que c\'est une erreur.</p>' : "") +
    '<div class="section-title">Ta famille · ' + (members.length + 1) + " / " + FAMILY_SIZE + '</div><div class="fam-list">' +
    '<div class="fam-row">' + av(firstName() || "Toi") + '<div class="fam-t"><b>' + esc(firstName() || "Toi") + ' (toi)</b><div class="small muted">Titulaire de l\'abonnement</div></div></div>';
  members.forEach(m => { h += '<div class="fam-row">' + av(m.name) + '<div class="fam-t"><b>' + esc(m.name) + '</b><div class="small muted">Membre depuis le ' + esc(fmtDate(Date.parse(m.joined_at))) + '</div></div><button class="btn sm danger" data-act="famsrvremove" data-id="' + esc(m.id) + '" data-name="' + esc(m.name) + '">Retirer</button></div>'; });
  invites.forEach(i => { h += '<div class="fam-row">' + av(i.label || "?") + '<div class="fam-t"><b>' + esc(i.label || "Invitation") + '</b><div class="small muted">Invitation envoyée · code ' + esc(i.code) + " · valable jusqu'au " + esc(fmtDate(Date.parse(i.expires_at))) + "</div>" +
    '<div class="row" style="margin-top:6px;flex-wrap:wrap"><button class="btn sm" data-act="famsrvshare" data-code="' + esc(i.code) + '" data-name="' + esc(i.label || "") + '">Renvoyer</button><button class="btn sm" data-act="famsrvcancel" data-code="' + esc(i.code) + '">Annuler</button></div></div></div>'; });
  waits.forEach(t => { h += '<div class="fam-row wait">' + LOCK + '<div class="fam-t"><b>Place libre le ' + esc(fmtDate(t)) + '</b><div class="small muted">Une personne est partie : sa place se libère ' + FAM_WAIT_DAYS + " jours après.</div></div></div>"; });
  if (active && !f.blocked) for (let k = free; k > 0; k--) h += '<button class="fam-row add" data-act="famsrvinvite"><span class="fam-av add" aria-hidden="true">+</span><span class="fam-t"><b>Inviter quelqu\'un</b><span class="small muted">Un proche ou un ami, avec son propre compte Fiitday · invitation valable 7 jours</span></span></button>';
  return h + '</div><div class="small muted" style="margin-top:8px">Chacun garde son compte et ses données : tu ne vois pas les séances des autres, ils ne voient pas les tiennes.</div>';
}
function srvMemberBox() {
  const f = famSrv || {};
  return (f.owner_active === false ? '<p class="msg err" style="margin:10px 0 0">L\'abonnement Famille de ' + esc(f.owner_name || "ton proche") + " n'est plus actif : Premium partagé est en pause. Tes données restent à toi.</p>" : "") +
    '<div class="fam-list" style="margin-top:10px"><div class="fam-row"><span class="fam-av" aria-hidden="true">' + esc((f.owner_name || "?").charAt(0).toUpperCase()) + '</span><div class="fam-t"><b>Famille de ' + esc(f.owner_name || "ton proche") + '</b><div class="small muted">Membre depuis le ' + esc(fmtDate(Date.parse(f.joined_at) || Date.now())) + "</div></div></div></div>" +
    '<button class="btn sm danger fam-join" data-act="famsrvleave">Quitter la famille</button>';
}
async function famShareSrv(code, name) {
  const text = "Rejoins mon abonnement Fiitday Premium Famille : " + famLink(code) + "\nOu dans l'appli : Réglages › Abonnement › « J'ai une invitation Famille », code " + code + " (valable 7 jours).";
  const copy = await ask({ title: "Invitation" + (name ? " pour " + name : ""), html: '<div class="xfer-code" aria-label="Code ' + esc(code.split("").join(" ")) + '">' + esc(code) + "</div>",
    text: "Envoie-lui ce code ou le lien : la personne l'ouvre avec son compte Fiitday (ou en crée un) et rejoint ta famille. L'invitation est valable 7 jours.", ok: "Copier l'invitation", cancel: "Fermer" });
  if (copy) { try { await navigator.clipboard.writeText(text); toast("Invitation copiée : envoie-la" + (name ? " à " + name : "")); } catch (e) { toast("Code d'invitation : " + code); } }
}
async function famJoinSrv(raw) {
  if (!db.auth) { toast("Connecte-toi pour rejoindre une famille"); return; }
  const c = normCode(String(raw).replace(/^.*\/famille\//i, ""));
  if (!XFER_RE.test(c)) { toast("Code d'invitation non valide : 8 lettres et chiffres"); return; }
  const p = db.plan || {};
  if (p.source === "subscription" && p.kind === "solo" && p.renews !== false && !await ask({ title: "Tu as déjà Premium Solo", text: "En rejoignant une famille, tu n'as plus besoin de ton abonnement Solo : pense à le résilier pour ne pas payer deux fois.", ok: "Rejoindre quand même" })) return;
  if (!await ask({ title: "Rejoindre cette famille ?", text: "Premium est débloqué pour toi tant que l'abonnement Famille est actif. Ton compte, tes programmes et ton historique restent à toi : personne d'autre ne les voit.", ok: "Rejoindre" })) return;
  let r; try { r = await rpc("family_join", { p_code: c }); } catch (e) { toast(famErr(e)); return; }
  await Promise.all([loadPlan(true), loadFam(true)]);
  toast("Tu as rejoint la famille de " + ((r && r.owner_name) || "ton proche") + (planState() === "premium" ? " : Premium débloqué" : ""));
  render();
}
// Réglages : carte Abonnement (une fois lancé) et mode test (compte testeur seulement)
function planSettings() {
  let h = "";
  const s = planState();
  const fsh = famShow(); if (fsh && !famSrv) setTimeout(loadFam, 0);
  if (fsh && famSrv && !famSrv.err) h += '<div class="card"><h2 class="card-h">Abonnement</h2><div class="small muted" style="margin-top:4px">' + esc(planStatus()) + "</div>" + (famSrv.role === "member" ? srvMemberBox() : srvFamilyBox()) +
    (famSrv.role === "member" ? "" : '<a class="btn sm" style="margin-top:8px" href="#/premium">Voir Premium</a>') + "</div>";
  else if (fsh) h += '<div class="card"><h2 class="card-h">Abonnement</h2><div class="small muted" style="margin-top:4px">' + esc(famSrv && famSrv.err ? "Ta famille n'a pas pu être chargée : " + famSrv.err : "Chargement de ta famille…") + "</div></div>";
  else if (s !== "off") h += '<div class="card"><h2 class="card-h">Abonnement</h2><div class="small muted" style="margin-top:4px">' + esc(planStatus()) + "</div>" + (isFamily() || isMember() ? (isFamily() ? familyBox() : memberBox()) + '<a class="btn sm' + (s === "premium" ? "" : " primary") + '" style="margin-top:8px" href="#/premium">' + (s === "premium" ? "Voir Premium" : "Passer à Premium") + "</a>"
    : '<div class="row duo"><a class="btn sm' + (s === "premium" ? "" : " primary") + '" href="#/premium">' + (s === "premium" ? "Voir Premium" : "Passer à Premium") + '</a><button class="btn sm" data-act="famjoin">J\'ai une invitation Famille</button></div>') + "</div>";
  if (s === "free") { const fa = freeActive(), t = getItem(fa.t);
    if (t) { const more = templates().length > 1 || t.variants.length > FREE_VARIANTS;
      h += '<div class="card"><h2 class="card-h">Séances actives</h2><div class="small muted" style="margin-top:4px">Programme « ' + esc(t.name) + " »" + (fa.v.length ? " : " + fa.v.map(id => { const v = t.variants.find(x => x.id === id); return v ? esc(vLabel(v.name)) : ""; }).filter(Boolean).join(", ") : "") + "." +
        (more ? "<br>" + esc(freeSwitchTxt()) : "") + "</div>" + (more && freeCanSwitch() ? '<button class="btn sm" style="margin-top:8px" data-act="freepick">Changer mes séances actives</button>' : "") + "</div>"; } }
  h += contractsCard();
  if (isAdmin()) h += '<div class="card"><div class="spread"><b>Administration</b><span class="tag adm-tag">Visible seulement par toi</span></div><div class="small muted" style="margin-top:4px">Inscrits, utilisateurs actifs, séances, résumé de la semaine.</div><a class="btn sm primary" style="margin-top:8px" href="#/admin">Ouvrir le tableau de bord</a></div>';
  if (isPlanTester()) {
    const cur = planTesting() ? db.planTest : "";
    h += '<div class="card test-card"><div class="spread"><b>Mode test</b><span class="tag">Visible seulement par toi</span></div>' +
      '<div class="small muted" style="margin-top:4px">Pour voir l\'appli comme un utilisateur, sur cet appareil. Les autres comptes ne voient rien : pour eux, l\'appli reste complète. Tes données ne changent pas.</div>' +
      '<div class="seg seg-wrap" role="group" style="margin-top:10px">' + [["", "Désactivé"], ["trial", "Essai en cours"], ["free", "Essai terminé"], ["premium", "Abonné"], ["family", "Abonné Famille"]].map(o =>
        '<button class="' + (cur === o[0] ? "on" : "") + '" aria-pressed="' + (cur === o[0]) + '" data-act="plantest" data-val="' + o[0] + '">' + o[1] + "</button>").join("") + "</div>" +
      (cur === "trial" ? '<div class="row" style="margin-top:10px;flex-wrap:wrap;align-items:center"><span class="small">' + (trialLeft() ? "Encore " + trialLeft() + " jour" + (trialLeft() > 1 ? "s" : "") + " d'essai" : "Essai terminé") + '</span><button class="btn sm" data-act="plantestskip">Avancer d\'une semaine</button></div>' : "") +
      (s === "free" ? '<div class="small muted" style="margin-top:8px">En vrai, la synchro s\'arrête en version gratuite. En mode test, tes données continuent de se synchroniser.</div>' +
        (freeCanSwitch() ? "" : '<button class="btn sm" style="margin-top:8px" data-act="freereset">Permettre de changer les séances actives tout de suite</button>') : "") + "</div>";
  }
  return h;
}

// alerte de fin de repos : Vibration et Son s'activent chacun de leur côté (les deux ensemble possibles), Aucune les coupe
function alertSeg(a) {
  const vib = a === "vibration" || a === "les deux", son = a === "son" || a === "les deux", none = !vib && !son;
  const b = (k, l, on) => '<button class="' + (on ? "on" : "") + '" aria-pressed="' + on + '" data-act="alertt" data-val="' + k + '">' + l + "</button>";
  return '<div class="seg" role="group" aria-label="Alerte de fin de repos">' + b("vibration", "Vibration", vib) + b("son", "Son", son) + b("aucune", "Aucune", none) + "</div>";
}
/* ================= Double authentification (Administration) et mot de passe ================= */
// appels au service de connexion Supabase avec la session en cours
async function authApi(method, path, body) {
  await ensureToken();
  const go = () => fetch(SUPABASE_URL + "/auth/v1/" + path, { method, body: body ? JSON.stringify(body) : undefined,
    headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + db.auth.access_token, "Content-Type": "application/json" } });
  let r = await go();
  if (r.status === 401) { await ensureToken(true); r = await go(); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.msg || j.message || j.error_description || j.error || ("Erreur " + r.status)); e.status = r.status; e.code = j.error_code || j.code; throw e; }
  return j;
}
// niveau de la session : « aal2 » une fois le code à 6 chiffres validé
function jwtClaims() {
  try { const p = db.auth.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); return JSON.parse(decodeURIComponent(escape(atob(p + "===".slice((p.length + 3) % 4))))); }
  catch (e) { return {}; }
}
const isAal2 = () => {
  if (!db.auth) return false;
  const c = jwtClaims(), t = (Array.isArray(c.amr) ? c.amr : []).filter(a => a && a.method === "totp").map(a => +a.timestamp || 0);
  return c.aal === "aal2" && (!t.length || Date.now() / 1000 - Math.max(...t) < 12 * 3600); // code validé il y a moins de 12 h
};
let mfa = { factors: null, enroll: null, err: "", busy: false };
async function mfaLoad() {
  try { const u = await authApi("GET", "user"); mfa.factors = (u.factors || []).filter(f => f.factor_type === "totp"); }
  catch (e) { mfa.err = e.message === "Failed to fetch" ? "Pas de connexion internet." : e.message; mfa.factors = []; }
  if (route().name === "admin") render();
}
function mfaMessage(e) {
  const m = String(e.message || "");
  if (/invalid|incorrect|expired/i.test(m) && /code|totp|challenge/i.test(m)) return "Code incorrect ou expiré. Vérifie que l'heure du téléphone est automatique, puis tape le nouveau code.";
  if (/disabled|not enabled/i.test(m)) return "La double authentification n'est pas activée dans Supabase (Authentication › Multi-Factor).";
  if (m === "Failed to fetch") return "Pas de connexion internet.";
  return m;
}
function mfaBox() {
  if (mfa.factors === null) { if (!mfa.busy) { mfa.busy = true; mfaLoad().finally(() => { mfa.busy = false; }); } return '<div class="card empty">Vérification de la sécurité…</div>'; }
  const ok = mfa.factors.find(f => f.status === "verified"), codeIn = '<label class="fl" style="margin-top:10px">Code à 6 chiffres<input class="f code" id="mfa-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" placeholder="123456"></label>';
  const err = mfa.err ? '<p class="msg err" style="margin:8px 0 0">' + esc(mfa.err) + "</p>" : "";
  if (ok && !mfa.enroll) return '<div class="card mfa-card">' + LOCK + '<div><b>Double authentification</b><div class="small muted">Ouvre ton appli d\'authentification (Google Authenticator, Microsoft Authenticator…) et tape le code affiché pour Fiitday.</div>' + codeIn +
    '<button class="btn primary" style="margin-top:10px" data-act="mfaverify">Valider</button>' + err + "</div></div>";
  if (mfa.enroll) return '<div class="card mfa-card">' + LOCK + '<div><b>Activer la double authentification</b><ol class="small mfa-steps"><li>Installe une appli d\'authentification sur ton téléphone : Google Authenticator ou Microsoft Authenticator (gratuites).</li><li>Dans l\'appli, « Ajouter un compte » puis scanne ce code :</li></ol>' +
    '<div class="mfa-qr"><img src="' + esc(mfa.enroll.qr) + '" alt="QR code à scanner avec ton appli d\'authentification" width="180" height="180"></div>' +
    '<div class="small muted">Pas de scan possible ? Tape cette clé dans l\'appli :</div><div class="mfa-secret num">' + esc(mfa.enroll.secret.replace(/(.{4})/g, "$1 ").trim()) + "</div>" +
    '<ol class="small mfa-steps" start="3"><li>Tape ici le code à 6 chiffres que l\'appli affiche.</li></ol>' + codeIn +
    '<div class="row" style="margin-top:10px;flex-wrap:wrap"><button class="btn primary" data-act="mfaverify">Activer</button><button class="btn" data-act="mfacancel">Annuler</button></div>' + err + "</div></div>";
  return '<div class="card mfa-card">' + LOCK + '<div><b>Protège l\'Administration</b><div class="small muted">Pour ouvrir le tableau de bord, il faudra ton mot de passe <b>et</b> un code à 6 chiffres qui change toutes les 30 secondes, affiché par une appli sur ton téléphone. Même avec ton mot de passe, personne d\'autre ne peut entrer.</div>' +
    '<button class="btn primary" style="margin-top:10px" data-act="mfaenroll">Activer la double authentification</button>' + err + "</div></div>";
}
// le QR code arrive en « data:image/svg+xml;utf-8,<svg…> » non encodé : un « # » dans le SVG le casserait, on le ré-encode
function qrSrc(q) {
  const m = String(q).match(/^data:image\/svg\+xml;(?:utf-?8|charset=utf-?8),(.*)$/is);
  if (!m) return q;
  let svg = m[1]; try { if (/^%3C/i.test(svg)) svg = decodeURIComponent(svg); } catch (e) { }
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
async function mfaEnroll() {
  mfa.err = "";
  try {
    for (const f of (mfa.factors || []).filter(f => f.status !== "verified")) { try { await authApi("DELETE", "factors/" + f.id); } catch (e) { } } // essai précédent non terminé
    const j = await authApi("POST", "factors", { factor_type: "totp", friendly_name: "Fiitday " + new Date().toISOString().slice(0, 16), issuer: "Fiitday" });
    mfa.enroll = { id: j.id, qr: qrSrc((j.totp || {}).qr_code || ""), secret: (j.totp || {}).secret || "" };
  } catch (e) { mfa.err = mfaMessage(e); }
  render();
}
async function mfaVerify() {
  const inp = document.getElementById("mfa-code"), code = inp ? inp.value.replace(/\D/g, "") : "";
  if (code.length !== 6) { mfa.err = "Tape les 6 chiffres du code."; render(); return; }
  const f = mfa.enroll ? { id: mfa.enroll.id } : (mfa.factors || []).find(x => x.status === "verified"); if (!f) return;
  mfa.err = "";
  try {
    const ch = await authApi("POST", "factors/" + f.id + "/challenge", {});
    const j = await authApi("POST", "factors/" + f.id + "/verify", { challenge_id: ch.id, code });
    if (j && j.access_token && j.user) setSession(j); // la session passe au niveau aal2
    const first = !!mfa.enroll;
    mfa = { factors: null, enroll: null, err: "", busy: false }; adminKpi = null; adminErr = ""; ledger = null; ledgerErr = ""; ledgerAuto = null; ledgerAutoTried = false; adminSubs = null; adminSubsErr = ""; adminCtr = null; ctrCheck = null;
    toast(first ? "Double authentification activée" : "Code validé"); render();
  } catch (e) { mfa.err = mfaMessage(e); render(); }
}
// Réglages › Compte : changer le mot de passe (ancien mot de passe vérifié, nouveau de 12 caractères au moins)
function pwStrength(p) {
  let s = 0; if (p.length >= 12) s++; if (p.length >= 16) s++; if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++; if (/\d/.test(p)) s++; if (/[^A-Za-z0-9]/.test(p)) s++;
  return s <= 2 ? ["Faible", "weak"] : s <= 3 ? ["Moyen", "mid"] : ["Très solide", "strong"];
}
function askPassword() {
  return new Promise(res => {
    const d = document.createElement("div"); d.className = "modal";
    d.innerHTML = '<div class="modal-box" role="dialog" aria-modal="true" aria-label="Changer mon mot de passe"><h3>Changer mon mot de passe</h3><form class="stack pw-form" autocomplete="on">' +
      '<input type="email" name="username" autocomplete="username" value="' + esc(db.auth.user.email) + '" readonly hidden tabindex="-1" aria-hidden="true">' +
      '<label class="fl">Mot de passe actuel<input class="f" type="password" id="pw-cur" autocomplete="current-password"></label>' +
      '<label class="fl">Nouveau mot de passe<input class="f" type="password" id="pw-new" autocomplete="new-password"></label>' +
      '<div class="small pw-meter" id="pw-meter">12 caractères au moins. Le plus sûr : une phrase de 4 ou 5 mots avec un chiffre et un symbole, ou un mot de passe créé par un gestionnaire.</div>' +
      '<label class="fl">Confirme le nouveau mot de passe<input class="f" type="password" id="pw-new2" autocomplete="new-password"></label>' +
      '<label class="pw-show small"><input type="checkbox" id="pw-show"> Afficher les mots de passe</label>' +
      '</form><p class="msg err" data-m></p><div class="modal-btns"><button class="btn" data-r="0">Annuler</button><button class="btn primary" data-r="1">Changer</button></div></div>';
    document.body.appendChild(d);
    const $i = id => d.querySelector("#" + id), m = d.querySelector("[data-m]");
    d.querySelector("form").addEventListener("submit", e => { e.preventDefault(); d.querySelector('[data-r="1"]').click(); });
    $i("pw-cur").focus();
    $i("pw-new").addEventListener("input", e => { const v = e.target.value, st = pwStrength(v); $i("pw-meter").innerHTML = v ? 'Solidité : <b class="pw-' + st[1] + '">' + st[0] + "</b> · " + v.length + " caractères" : "12 caractères au moins."; });
    $i("pw-show").addEventListener("change", e => { ["pw-cur", "pw-new", "pw-new2"].forEach(id => { $i(id).type = e.target.checked ? "text" : "password"; }); });
    d.addEventListener("click", e => {
      if (e.target === d) { d.remove(); res(null); return; }
      const b = e.target.closest("[data-r]"); if (!b) return;
      if (b.dataset.r !== "1") { d.remove(); res(null); return; }
      const cur = $i("pw-cur").value, nw = $i("pw-new").value, nw2 = $i("pw-new2").value;
      if (!cur) { m.textContent = "Tape ton mot de passe actuel."; return; }
      if (nw.length < PW_MIN) { m.textContent = "Le nouveau mot de passe doit faire " + PW_MIN + " caractères au moins."; return; }
      if (nw !== nw2) { m.textContent = "Les deux nouveaux mots de passe ne sont pas identiques."; return; }
      if (nw === cur) { m.textContent = "Choisis un mot de passe différent de l'actuel."; return; }
      if (pwStrength(nw)[1] === "weak") { m.textContent = "Trop facile à deviner : allonge-le ou mélange majuscules, chiffres et symboles."; return; }
      d.remove(); res({ cur, nw });
    });
  });
}
async function changePassword() {
  if (!db.auth) return;
  const p = await askPassword(); if (!p) return;
  try { await authReq("token?grant_type=password", { email: db.auth.user.email, password: p.cur }); } // vérifie l'ancien mot de passe (session non utilisée)
  catch (e) { toast(e.status === 400 ? "Mot de passe actuel incorrect" : authMessage(e)); return; }
  const put = body => authApi("PUT", "user", body);
  try { await put({ password: p.nw }); }
  catch (e) {
    const m = String(e.message || "") + " " + (e.code || "");
    if (/reauthenticat/i.test(m)) { // option « changement sécurisé » de Supabase : code reçu par e-mail
      try { await authApi("GET", "reauthenticate"); } catch (er) { toast(authMessage(er)); return; }
      const nonce = await ask({ title: "Code de sécurité", text: "Pour confirmer, tape le code reçu par e-mail.", input: "", code: true, ok: "Confirmer" });
      if (!nonce) return;
      try { await put({ password: p.nw, nonce: nonce.trim() }); } catch (er) { toast(authMessage(er)); return; }
    } else if (/aal2|mfa/i.test(m)) {
      try { if (!await askMfaCode()) return; await put({ password: p.nw }); } catch (er) { toast(mfaMessage(er)); return; }
    }
    else if (/same/i.test(m)) { toast("Choisis un mot de passe différent de l'actuel"); return; }
    else { toast(authMessage(e)); return; }
  }
  toast("Mot de passe changé");
}

/* ================= Administration (ton compte seulement) ================= */
// Deux pages : Tableau de bord (chiffres de la fonction Supabase admin_kpis : des totaux, aucune donnée personnelle)
// et Registre des recettes (table revenue_ledger, lue et modifiée seulement par ton compte avec le code à 6 chiffres).
// Le serveur refuse tout autre compte ; ici l'écran n'est même pas proposé aux autres.
const isAdmin = () => isPlanTester();
let adminKpi = null, adminErr = "", adminBusy = false, adminPeriod = 8;
const admDenied = r => r && r.denied ? (r.mfa ? "mfa" : "Accès refusé : réservé à l'administrateur.") : "";
const admErrText = (e, what) => /MFA/.test(e.message) ? "mfa" : e.code === "42501" ? "Accès refusé : réservé à l'administrateur." : e.message === "Failed to fetch" ? "Pas de connexion internet." : what + " (" + e.message + ").";
async function loadAdmin(manual) {
  if (adminBusy || !isAdmin()) return;
  adminBusy = true; adminErr = ""; if (manual) render();
  let ok = false;
  try {
    const r = await rpc("admin_kpis");
    const den = admDenied(r);
    if (den) { adminKpi = null; adminErr = den; } // refus noté côté serveur
    else { adminKpi = r; ok = true; if (!ledger && !ledgerBusy) setTimeout(loadLedger, 0); if (!adminSubs && !adminSubsBusy) setTimeout(loadAdminSubs, 0); } // cartes « Recettes » et « Abonnements »
  }
  catch (e) { adminErr = admErrText(e, "Les chiffres n'ont pas pu être chargés"); }
  finally {
    adminBusy = false;
    if (route().name === "admin") render();
    if (manual) toast(ok ? "Chiffres à jour · " + fmtTimeSec(Date.now()) : adminErr === "mfa" ? "Code à 6 chiffres demandé" : "Mise à jour impossible");
  }
}
const fmtTimeSec = t => DF({ hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(t);
const admTabs = cur => '<div class="seg adm-tabs" role="tablist">' + [["", "Tableau de bord"], ["abonnements", "Abonnements"], ["recettes", "Registre des recettes"]].map(([k, l]) =>
  '<a role="tab" href="#/admin' + (k ? "/" + k : "") + '" class="' + (cur === k ? "on" : "") + '" aria-selected="' + (cur === k) + '">' + l + "</a>").join("") + "</div>";

// ----- courbes du tableau de bord : valeur par semaine, survol ou toucher pour lire chaque semaine -----
const admSeries = {};
function admLine(key, label, weeks, field, note) {
  const pts = weeks.map(w => ({ t: Date.parse(w.w + "T12:00:00"), v: +w[field] || 0 }));
  const last = pts[pts.length - 1] || { v: 0, t: Date.now() }, prev = pts[pts.length - 2], first = pts[0];
  const W = 400, H = 170, L = 34, R = 12, T = 16, B = 24, pw = W - L - R, ph = H - T - B;
  const mx = Math.max(1, ...pts.map(p => p.v)), step = Math.max(1, niceStep(mx / 3)), y1 = Math.max(step, Math.ceil(mx / step) * step);
  const X = k => L + (pts.length > 1 ? (k / (pts.length - 1)) * pw : pw / 2), Y = v => T + (1 - v / y1) * ph;
  pts.forEach((p, k) => { p.x = X(k); p.y = Y(p.v); });
  admSeries[key] = { pts, field, def: "" };
  let svg = '<svg class="chart adm-svg" data-k="' + key + '" viewBox="0 0 ' + W + " " + H + '" role="img" tabindex="0" aria-label="' + esc(label + " : " + last.v + " cette semaine") + '">' +
    '<defs><linearGradient id="admG-' + key + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0"></stop><stop offset="1"></stop></linearGradient></defs>';
  for (let v = 0; v <= y1 + step / 1000; v += step) { const y = Y(v).toFixed(1); svg += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '"></line><text x="' + (L - 8) + '" y="' + (+y + 4) + '" text-anchor="end">' + fmtNum(v) + "</text>"; }
  const dfx = pts.length > 20 ? DF({ month: "short" }) : DF({ day: "2-digit", month: "2-digit" });
  const xl = pts.length > 2 ? [0, Math.round((pts.length - 1) / 2), pts.length - 1] : pts.map((p, k) => k);
  xl.forEach((k, n) => { const a = n === 0 && xl.length > 1 ? "start" : n === xl.length - 1 && xl.length > 1 ? "end" : "middle"; svg += '<text x="' + pts[k].x.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + a + '">' + esc(dfx.format(pts[k].t)) + "</text>"; });
  if (pts.length > 1) {
    const line = pts.map((p, k) => (k ? "L" : "M") + p.x.toFixed(1) + "," + p.y.toFixed(1)).join("");
    svg += '<path class="area" style="fill:url(#admG-' + key + ')" d="' + line + "L" + pts[pts.length - 1].x.toFixed(1) + "," + (T + ph) + "L" + pts[0].x.toFixed(1) + "," + (T + ph) + 'Z"></path><path class="line" d="' + line + '"></path>';
  }
  pts.forEach((p, k) => { if (pts.length <= 26 || k === pts.length - 1) svg += '<circle class="dot' + (k === pts.length - 1 ? " last" : "") + '" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + (k === pts.length - 1 ? 5 : 3.2) + '"></circle>'; });
  svg += '<line class="xhair" x1="0" x2="0" y1="' + T + '" y2="' + (T + ph) + '" visibility="hidden"></line><circle class="focus" r="6" cx="0" cy="0" visibility="hidden"></circle></svg>';
  const d = prev ? last.v - prev.v : 0, span = first && last !== first ? last.v - first.v : 0;
  const diff = '<span class="adm-diff ' + (d > 0 ? "up" : d < 0 ? "down" : "") + '">' + (d > 0 ? "+" + d : d < 0 ? "−" + -d : "=") + "</span>";
  admSeries[key].def = '<b class="num">' + fmtNum(last.v) + "</b> " + diff + '<span class="d muted small">cette semaine · ' + (span >= 0 ? "+" : "−") + Math.abs(span) + " sur la période</span>";
  return '<div class="card adm-chart"><div class="adm-ch-head"><div class="muted small adm-ch-t">' + esc(label) + "</div>" + (note ? '<div class="muted small">' + esc(note) + "</div>" : "") + "</div>" +
    '<div class="adm-read" data-k="' + key + '">' + admSeries[key].def + "</div>" + svg + "</div>";
}
function admPick(svg, clientX) {
  const s = admSeries[svg.dataset.k]; if (!s || !s.pts.length) return;
  const r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal, x = (clientX - r.left) * (vb.width / r.width);
  let k = 0; s.pts.forEach((p, n) => { if (Math.abs(p.x - x) < Math.abs(s.pts[k].x - x)) k = n; });
  const p = s.pts[k], xh = svg.querySelector(".xhair"), f = svg.querySelector(".focus");
  xh.setAttribute("x1", p.x); xh.setAttribute("x2", p.x); xh.setAttribute("visibility", "visible");
  f.setAttribute("cx", p.x); f.setAttribute("cy", p.y); f.setAttribute("visibility", "visible");
  const out = document.querySelector('.adm-read[data-k="' + svg.dataset.k + '"]'); if (!out) return;
  out.innerHTML = '<b class="num">' + fmtNum(p.v) + '</b><span class="d muted small">semaine du ' + esc(fmtDateLong(p.t)) + "</span>";
}
document.addEventListener("pointermove", e => { const svg = e.target.closest && e.target.closest(".adm-svg"); if (svg) admPick(svg, e.clientX); });
document.addEventListener("pointerdown", e => { const svg = e.target.closest && e.target.closest(".adm-svg"); if (svg) admPick(svg, e.clientX); });
document.addEventListener("pointerout", e => {
  const svg = e.target.closest && e.target.closest(".adm-svg"); if (!svg || svg.contains(e.relatedTarget)) return;
  svg.querySelectorAll(".xhair, .focus").forEach(x => x.setAttribute("visibility", "hidden"));
  const s = admSeries[svg.dataset.k], out = document.querySelector('.adm-read[data-k="' + svg.dataset.k + '"]'); if (s && out) out.innerHTML = s.def;
});

// bloc Sécurité : alertes (rouge / orange) puis les chiffres surveillés
function secAlerts(s) {
  const a = [], pl = (n, w) => n + " " + w + (n > 1 ? "s" : "");
  if (s.other7 > 0) a.push(["red", pl(s.other7, "tentative") + " d'ouvrir l'Administration depuis " + ((s.otherUsers7 || 1) > 1 ? s.otherUsers7 + " autres comptes" : "1 autre compte") + " cette semaine."]);
  if (s.mfaFail24 >= 3) a.push(["red", pl(s.mfaFail24, "code") + " à 6 chiffres faux ou abandonnés sur ton compte en 24 h. Si ce n'est pas toi, change ton mot de passe."]);
  if (s.factors > 1) a.push(["orange", "Ton compte a " + s.factors + " appareils de double authentification : vérifie qu'ils sont tous à toi."]);
  else if (s.factorNew7 > 0) a.push(["orange", "Une double authentification a été ajoutée à ton compte cette semaine. Si ce n'est pas toi, change ton mot de passe."]);
  if (s.devices7 > 3) a.push(["orange", "Ton compte s'est connecté depuis " + s.devices7 + " appareils ou navigateurs différents cette semaine."]);
  if (s.recovery24 >= 5) a.push(["orange", s.recovery24 + " demandes de réinitialisation de mot de passe en 24 h."]);
  if (s.signups24 >= 30) a.push(["orange", s.signups24 + " inscriptions en 24 h : pic inhabituel (robots ?)."]);
  if (s.xferFail24 >= 20) a.push(["orange", s.xferFail24 + " codes de transfert faux en 24 h : quelqu'un essaie peut-être de deviner un code."]);
  return a;
}
function secBlock(s) {
  if (!s) return "";
  const al = secAlerts(s), worst = al.some(x => x[0] === "red") ? "red" : al.length ? "orange" : "ok";
  const row = (l, v) => '<div class="sec-row"><span>' + l + '</span><b class="num">' + v + "</b></div>";
  const when = t => t ? esc(fmtDate(Date.parse(t))) + " à " + esc(fmtTime(Date.parse(t))) : "—";
  return '<div class="section-title">Sécurité</div><div class="card sec-card sec-' + worst + '">' +
    (al.length ? '<b class="sec-head">' + (worst === "red" ? "À vérifier tout de suite" : "À surveiller") + '</b><ul class="sec-alerts">' + al.map(x => '<li class="' + x[0] + '">' + esc(x[1]) + "</li>").join("") + "</ul>"
      : '<b class="sec-head">Rien d\'anormal</b>') +
    '<div class="sec-rows">' +
    row("Accès à l'Administration refusés (24 h)", s.denied24) +
    row("… depuis un autre compte (7 jours)", s.other7) +
    row("Codes à 6 chiffres faux ou abandonnés (7 jours)", s.mfaFail7) +
    row("Appareils de double authentification", s.factors) +
    row("Nouvelles connexions de ton compte (7 jours)", s.sessions7 + " · " + s.devices7 + " appareil" + (s.devices7 > 1 ? "s" : "")) +
    row("Ta dernière connexion", when(s.lastLogin)) +
    row("Mots de passe oubliés demandés (24 h)", s.recovery24) +
    row("Inscriptions (24 h)", s.signups24) +
    row("Codes de transfert faux (24 h)", s.xferFail24) +
    row("Comptes bloqués", s.banned) + "</div>" +
    '<div class="small muted" style="margin-top:8px">Les essais de mot de passe ratés ne sont pas comptés ici : Supabase freine automatiquement les essais répétés. Refus gardés 12 mois.</div></div>';
}
// barre du haut : Actualiser (avec son état) et l'heure exacte des chiffres
function admBar(atIso, busy, what) {
  const at = Date.parse(atIso || "") || 0;
  return '<div class="adm-bar"><button class="btn sm' + (busy ? " busy" : "") + '" data-act="adminload"' + (busy ? " disabled" : "") + '><span class="adm-spin" aria-hidden="true"></span>' + (busy ? "Actualisation…" : "Actualiser") + "</button>" +
    '<span class="muted small" role="status">' + (busy ? "Lecture des " + what + " sur le serveur…" : at ? what.charAt(0).toUpperCase() + what.slice(1) + " du " + esc(fmtDateLong(at)) + " à " + esc(fmtTimeSec(at)) : "") + "</span></div>";
}
function viewAdmin() {
  const back = '<a class="back" href="#/settings">‹ Réglages</a>';
  if (!isAdmin()) return back + '<div class="card empty">Cette page n\'existe pas.</div>';
  const tab = ["recettes", "abonnements"].includes(route().args[0]) ? route().args[0] : "";
  const head = back + '<div class="page-head adm-head"><div><h1>Administration</h1><div class="muted small">Visible seulement par toi · ' + (tab === "recettes" ? "registre de ta micro-entreprise" : tab ? "Premium offert, familles à surveiller, signalements" : "des totaux, aucune donnée personnelle") + "</div></div>" + admTabs(tab) + "</div>";
  if (!isAal2() || adminErr === "mfa" || ledgerErr === "mfa" || adminSubsErr === "mfa") { adminKpi = null; ledger = null; adminSubs = null; return head + mfaBox(); } // double authentification d'abord
  return head + (tab === "recettes" ? viewLedger() : tab ? viewAdminSubs() : viewAdminDash());
}
function viewAdminDash() {
  if (!adminKpi && !adminErr) { if (!adminBusy) setTimeout(loadAdmin, 0); return '<div class="card empty">Chargement des chiffres…</div>'; }
  if (!adminKpi) return '<div class="card"><p class="msg err" style="margin:0">' + esc(adminErr) + '</p><button class="btn sm" style="margin-top:10px" data-act="adminload">Réessayer</button></div>';
  const k = adminKpi, all = Array.isArray(k.weeks) ? k.weeks : [], wk = all.slice(-adminPeriod), cur = all[all.length - 1] || { n: 0, u: 0, i: 0 }, prev = all[all.length - 2] || { n: 0, u: 0, i: 0 };
  const pct = (a, b) => b ? Math.round(100 * a / b) + " %" : "—";
  // écart avec la semaine d'avant (bad : une hausse est une mauvaise nouvelle, comme pour les résiliations)
  const diff = (a, b, f, bad) => { const d = Math.round((a - b) * 100) / 100, v = f ? f(Math.abs(d)) : Math.abs(d), g = bad ? -d : d; return '<span class="adm-diff ' + (g > 0 ? "up" : g < 0 ? "down" : "") + '">' + (d > 0 ? "+" + v : d < 0 ? "−" + v : "=") + "</span>"; };
  const tile = (label, v, sub) => '<div class="card stat"><div class="muted small">' + label + '</div><div class="v num">' + v + "</div>" + (sub ? '<div class="muted small">' + sub + "</div>" : "") + "</div>";
  const per = '<div class="seg adm-per" role="group" aria-label="Période des courbes">' + [[8, "8 semaines"], [26, "6 mois"], [52, "12 mois"]].map(([n, l]) => '<button class="' + (adminPeriod === n ? "on" : "") + '" aria-pressed="' + (adminPeriod === n) + '" data-act="admper" data-v="' + n + '">' + l + "</button>").join("") + "</div>";
  const yr = ledger && ledger.rows ? ledger.rows.filter(r => r.paid_on.slice(0, 4) === String(new Date().getFullYear())).reduce((s, r) => s + +r.net, 0) : null;
  return admBar(k.at, adminBusy, "chiffres") +
    '<div class="adm-grid"><div class="adm-main">' +
    '<div class="section-title">Utilisateurs</div><div class="stats adm-tiles">' +
    tile("Comptes inscrits", k.users, "+" + k.users7 + " en 7 jours · +" + k.users30 + " en 30 jours") +
    tile("Actifs sur 7 jours", k.active7, pct(k.active7, k.users) + " des inscrits") +
    tile("Actifs sur 30 jours", k.active30, pct(k.active30, k.users) + " des inscrits") +
    tile("Séances terminées", k.workouts, k.workouts7 + " en 7 jours") + "</div>" +
    '<div class="spread adm-ev-h"><div class="section-title" style="margin:0">Évolution</div>' + per + "</div>" +
    '<div class="adm-charts">' +
    admLine("t", "Comptes inscrits (total)", wk, "t", "à la fin de chaque semaine") + admLine("i", "Inscriptions par semaine", wk, "i") +
    admLine("u", "Utilisateurs actifs par semaine", wk, "u", "au moins une séance terminée") + admLine("n", "Séances terminées par semaine", wk, "n") + "</div>" +
    '<div class="small muted adm-hint">Passe la souris ou le doigt sur une courbe pour lire chaque semaine.</div>' +
    "</div><div class=\"adm-side\">" +
    '<div class="section-title">Résumé de la semaine</div><div class="card adm-week">' +
    "<div><b class=\"num\">" + cur.i + "</b> inscription" + (cur.i > 1 ? "s" : "") + " " + diff(cur.i, prev.i) + "</div>" +
    "<div><b class=\"num\">" + cur.n + "</b> séance" + (cur.n > 1 ? "s" : "") + " terminée" + (cur.n > 1 ? "s" : "") + " " + diff(cur.n, prev.n) + "</div>" +
    "<div><b class=\"num\">" + cur.u + "</b> utilisateur" + (cur.u > 1 ? "s" : "") + " actif" + (cur.u > 1 ? "s" : "") + " " + diff(cur.u, prev.u) + "</div>" +
    // abonnement (journal anonyme des achats) : rien avant la date de lancement
    (w => !w ? "" : !w.launched ? '<div class="muted small">Essais, nouveaux abonnés, résiliations et ventes s\'afficheront ici dès le lancement.</div>' :
      '<div><b class="num">' + w.trials[0] + "</b> essai" + (w.trials[0] > 1 ? "s" : "") + " commencé" + (w.trials[0] > 1 ? "s" : "") + " " + diff(w.trials[0], w.trials[1]) + ' <span class="muted small">· ' + w.trialsNow + " en cours</span></div>" +
      '<div><b class="num">' + w.subs[0] + "</b> " + (w.subs[0] > 1 ? "nouveaux abonnés" : "nouvel abonné") + " " + diff(w.subs[0], w.subs[1]) + "</div>" +
      (w.life[0] || w.life[1] ? '<div><b class="num">' + w.life[0] + "</b> achat" + (w.life[0] > 1 ? "s" : "") + " à vie " + diff(w.life[0], w.life[1]) + "</div>" : "") +
      '<div><b class="num">' + w.cancels[0] + "</b> résiliation" + (w.cancels[0] > 1 ? "s" : "") + " " + diff(w.cancels[0], w.cancels[1], null, true) + "</div>" +
      '<div><b class="num">' + esc(eur(w.sales[0])) + "</b> de ventes " + diff(+w.sales[0], +w.sales[1], eur) + (w.other ? ' <span class="muted small">+ ' + w.other + " vente" + (w.other > 1 ? "s" : "") + " dans une autre monnaie</span>" : "") + "</div>")(adminSubs && adminSubs.week) +
    '<div class="muted small">Depuis lundi, comparé à la semaine dernière.' + (adminSubs && adminSubs.week && adminSubs.week.launched ? " Ventes : prix payés par les clients, avant la commission des stores ; les achats de test ne comptent pas." : "") + "</div></div>" +
    secBlock(k.sec) +
    '<div class="section-title">Partage et transferts</div><div class="stats adm-two">' +
    tile("Séances partagées", k.shares, k.shares30 + " en 30 jours") + tile("Codes de transfert", k.transfers30, "créés en 30 jours") + "</div>" +
    '<div class="section-title">Recettes</div><a class="card adm-link" href="#/admin/recettes"><div><div class="muted small">Registre des recettes</div><div class="v num">' + (yr == null ? "Ouvrir" : esc(eur(yr))) + "</div>" +
    '<div class="muted small">' + (yr == null ? "Tes encaissements, totaux et PDF" : "encaissé en " + new Date().getFullYear()) + "</div></div><span aria-hidden=\"true\">›</span></a>" +
    (sc => '<div class="section-title">Abonnements</div><a class="card adm-link" href="#/admin/abonnements"><div><div class="muted small">' + (sc ? (adminSubs.launch_at ? "Abonnement lancé" : "Pas encore lancé") : "Premium offert, familles") + '</div><div class="v num">' +
      (sc ? (sc.subscribers || 0) + " abonné" + ((sc.subscribers || 0) > 1 ? "s" : "") : "Ouvrir") + '</div><div class="muted small">' +
      (sc ? (sc.gifts || 0) + " Premium offert · " + (sc.families || 0) + " famille" + ((sc.families || 0) > 1 ? "s" : "") + ((adminSubs.families || []).length ? " · " + adminSubs.families.length + " à surveiller" : "") : "Offrir Premium, surveiller les familles") + "</div></div><span aria-hidden=\"true\">›</span></a>")(adminSubs && adminSubs.counts) +
    "</div></div>";
}

/* ---------- Abonnements : Premium offert, familles à surveiller ---------- */
let adminSubs = null, adminSubsErr = "", adminSubsBusy = false, giftForm = { kind: "solo", days: "30" };
let adminCtr = null, ctrCheck = null, ctrCheckBusy = false; // résiliations et rétractations (Administration › Abonnements)
function adminCtrCard() {
  const a = adminCtr; if (!a) return "";
  const reqs = a.requests || [], todo = r => !r.done_at && /À faire/.test(r.auto || "");
  const late = r => todo(r) && r.deadline && Date.parse(r.deadline) - Date.now() < 3 * DAY; // remboursement à faire dans moins de 3 jours (ou en retard)
  const warns = (a.conf_fail ? '<p class="msg err" style="margin:8px 0 0">' + a.conf_fail + " confirmation" + (a.conf_fail > 1 ? "s" : "") + " de commande pas encore envoyée" + (a.conf_fail > 1 ? "s" : "") + " (nouvel essai chaque jour ; vérifie Brevo et les CGV).</p>" : "") +
    (a.rc_pending ? '<p class="small muted" style="margin:8px 0 0">' + a.rc_pending + " client" + (a.rc_pending > 1 ? "s" : "") + " RevenueCat de comptes supprimés encore à effacer (nouvel essai automatique chaque jour).</p>" : "");
  return '<div class="section-title">Résiliations et rétractations</div><div class="card adm-ctr">' + warns + '<div class="spread"><span class="small muted">' + reqs.filter(todo).length + " à traiter · " +
    (a.reminders || 0) + " rappel" + ((a.reminders || 0) > 1 ? "s" : "") + ' avant renouvellement envoyé' + ((a.reminders || 0) > 1 ? "s" : "") + ' en 30 jours</span><button class="btn sm" data-act="ctrcheck"' + (ctrCheckBusy ? " disabled" : "") + ">" + (ctrCheckBusy ? "Vérification…" : "Vérifier RevenueCat et Brevo") + "</button></div>" +
    (ctrCheck ? '<div class="small adm-ctr-check">RevenueCat : ' + esc(ctrCheck.revenuecat) + "<br>Brevo (e-mails) : " + esc(ctrCheck.brevo) + "<br>Rappels quotidiens : " + esc(ctrCheck.cron) + "</div>" : "") +
    (reqs.length ? '<ul class="adm-ctr-list">' + reqs.map(r => '<li class="' + (todo(r) ? "todo" : "") + '"><div><b>' + (r.kind === "resiliation" ? "Résiliation" : "Rétractation") + " · " + esc(r.label) + '</b></div><div class="small muted">' +
      esc(ctrWhen(r.at) + " · " + r.name + " · " + r.email + " · " + (STORE_TXT[r.store] || r.store)) + '</div><div class="small">' +
      esc((r.kind === "resiliation" ? (r.wish === "maintenant" ? "Fin immédiate" : "Fin le " + ctrDate(Date.parse(r.end_at))) : "Fin immédiate") + (+r.refund > 0 ? " · remboursement " + (r.refund_all ? "intégral, " : "") + ctrEur(r.refund) : "")) + '</div><div class="small muted">' +
      esc(r.auto || "") + (r.mail ? " · E-mail " + esc(r.mail) : "") + "</div>" +
      (todo(r) && r.deadline ? '<div class="small' + (late(r) ? " msg err" : "") + '" style="margin:2px 0 0">À faire au plus tard le ' + esc(ctrDate(Date.parse(r.deadline))) + " (14 jours après la demande)</div>" : "") +
      (r.repeat >= 2 ? '<div class="small msg err" style="margin:2px 0 0">⚠ ' + r.repeat + " rétractations pour ce compte ou cette adresse e-mail : abus possible (achats et remboursements à répétition)</div>" : "") +
      (todo(r) ? '<button class="btn sm" style="margin-top:6px" data-act="ctrdone" data-id="' + esc(r.id) + '">C\'est fait</button>' : r.done_at ? '<div class="small ok-txt">Traité le ' + esc(ctrDate(Date.parse(r.done_at))) + "</div>" : "") + "</li>").join("") + "</ul>"
      : '<p class="small muted" style="margin:8px 0 0">Aucune demande pour l\'instant.</p>') + "</div>";
}
async function loadAdminSubs(manual) {
  if (adminSubsBusy || !isAdmin()) return;
  adminSubsBusy = true; adminSubsErr = ""; if (manual) render();
  let ok = false;
  try {
    const r = await rpc("admin_subs"); const den = admDenied(r); if (den) { adminSubs = null; adminSubsErr = den; } else { adminSubs = r; ok = true; }
    // résiliations et rétractations : sans effet sur le reste si la fonction n'existe pas encore
    if (ok) { try { const c = await rpc("admin_contracts"); if (!admDenied(c)) adminCtr = c; } catch (e) { } }
  }
  catch (e) { adminSubsErr = admErrText(e, "Les abonnements n'ont pas pu être chargés"); }
  finally { adminSubsBusy = false; if (route().name === "admin") render(); if (manual) toast(ok ? "Abonnements à jour · " + fmtTimeSec(Date.now()) : "Mise à jour impossible"); }
}
const GIFT_DAYS = [["30", "1 mois"], ["90", "3 mois"], ["365", "1 an"], ["", "À vie"]];
function viewAdminSubs() {
  if (!adminSubs && !adminSubsErr) { if (!adminSubsBusy) setTimeout(loadAdminSubs, 0); return '<div class="card empty">Chargement des abonnements…</div>'; }
  if (!adminSubs) return '<div class="card"><p class="msg err" style="margin:0">' + esc(adminSubsErr) + '</p><button class="btn sm" style="margin-top:10px" data-act="adminload">Réessayer</button></div>';
  const a = adminSubs, c = a.counts || {}, launch = Date.parse(a.launch_at || "");
  const tile = (label, v, sub) => '<div class="card stat"><div class="muted small">' + label + '</div><div class="v num">' + v + "</div>" + (sub ? '<div class="muted small">' + sub + "</div>" : "") + "</div>";
  const seg = (k, opts) => '<div class="seg adm-per" role="group">' + opts.map(([v, l]) => '<button type="button" class="' + (giftForm[k] === v ? "on" : "") + '" aria-pressed="' + (giftForm[k] === v) + '" data-act="giftopt" data-k="' + k + '" data-v="' + v + '">' + l + "</button>").join("") + "</div>";
  const gifts = a.gifts || [], fams = a.families || [];
  return admBar(a.at, adminSubsBusy, "données des abonnements") +
    '<div class="card adm-launch' + (launch ? " on" : "") + '"><b>' + (launch ? "Abonnement lancé le " + esc(fmtDateLong(launch)) : "Abonnement pas encore lancé") + '</b><div class="small muted">' +
    (launch ? "Essai de 30 jours pour les nouveaux comptes, version gratuite ensuite, synchro réservée à Premium." : "Tant que la date de lancement n'est pas fixée, tout le monde a l'appli complète et la synchro reste ouverte. Premium offert et familles marchent déjà : ils compteront au lancement.") + "</div></div>" +
    '<div class="stats adm-tiles">' + tile("Abonnés payants", c.subscribers || 0, (c.cancelled || 0) + " résilié" + ((c.cancelled || 0) > 1 ? "s" : "") + " (Premium jusqu'à la fin de leur période)") + tile("Premium à vie", c.lifetime || 0, "achats uniques") +
    tile("Premium offert", c.gifts || 0, "en cours") + tile("Familles", c.families || 0, (c.members || 0) + " membre" + ((c.members || 0) > 1 ? "s" : "") + " invité" + ((c.members || 0) > 1 ? "s" : "")) + "</div>" +
    '<div class="adm-grid"><div class="adm-main">' + adminCtrCard() + '<div class="section-title">Offrir Premium</div><div class="card adm-gift">' +
    '<label class="fl">E-mail du compte Fiitday<input class="f" type="email" data-gf="email" autocomplete="off" placeholder="prenom@exemple.fr" value="' + esc(giftForm.email || "") + '"></label>' +
    '<div class="fl" style="margin-top:10px">Formule' + seg("kind", [["solo", "Solo"], ["family", "Famille (5 personnes)"]]) + "</div>" +
    '<div class="fl" style="margin-top:10px">Durée' + seg("days", GIFT_DAYS) + "</div>" +
    '<label class="fl" style="margin-top:10px">Note pour toi (facultatif)<input class="f" data-gf="note" maxlength="200" placeholder="Ex. premier testeur, partenaire…" value="' + esc(giftForm.note || "") + '"></label>' +
    '<button class="btn primary" style="margin-top:12px" data-act="giftsend">Offrir Premium</button>' +
    '<p class="small muted" style="margin:8px 0 0">La personne doit déjà avoir un compte. Offrir à nouveau à la même adresse remplace le cadeau précédent. Pour tester la Famille pour de vrai, offre-toi « Famille » sur ton propre compte.</p></div>' +
    '<div class="section-title">Premium offert en cours</div>' +
    (gifts.length ? '<div class="card adm-reg"><table class="adm-table" style="display:table"><thead><tr><th>Compte</th><th>Formule</th><th>Jusqu\'au</th><th>Note</th><th><span class="sr">Actions</span></th></tr></thead><tbody>' +
      gifts.map(g => "<tr><td>" + esc(g.email) + "</td><td>" + (g.kind === "family" ? "Famille" : "Solo") + '</td><td class="nowrap">' + (g.until ? esc(fmtDate(Date.parse(g.until))) : "À vie") + '</td><td class="small">' + esc(g.note || "—") + '</td><td><button class="link del" data-act="giftdel" data-id="' + esc(g.user_id) + '" data-email="' + esc(g.email) + '">Retirer</button></td></tr>').join("") + "</tbody></table></div>"
      : '<div class="card empty">Aucun Premium offert pour l\'instant.</div>') +
    '</div><div class="adm-side"><div class="section-title">Familles à surveiller</div>' +
    (fams.length ? fams.map(x => '<div class="card adm-fam' + (x.blocked ? " blocked" : "") + '"><div class="spread"><b>' + esc(x.owner) + "</b>" + (x.blocked ? '<span class="tag">invitations bloquées</span>' : "") + "</div>" +
      '<div class="small muted">' + x.members + " membre" + (x.members > 1 ? "s" : "") + " · " + x.pending + " invitation" + (x.pending > 1 ? "s" : "") + " en attente</div>" +
      ((x.flags || []).length ? '<ul class="small adm-flags">' + x.flags.map(t => "<li>" + esc(t) + "</li>").join("") + "</ul>" : "") + (x.note ? '<div class="small muted">Note : ' + esc(x.note) + "</div>" : "") +
      '<button class="btn sm' + (x.blocked ? "" : " danger") + '" style="margin-top:8px" data-act="famblock" data-id="' + esc(x.id) + '" data-v="' + (x.blocked ? "0" : "1") + '">' + (x.blocked ? "Débloquer les invitations" : "Bloquer les invitations") + "</button></div>").join("")
      : '<div class="card empty">Aucune famille à surveiller.</div>') +
    '<div class="card adm-legal"><h2 class="card-h">Règles de surveillance</h2><ul class="small muted"><li>Plus de 3 départs (retraits ou départs volontaires) en 60 jours</li><li>Plus de 8 personnes différentes en 6 mois</li><li>3 invitations ou plus jamais acceptées en 6 mois</li><li>Un membre qui a rejoint 3 familles ou plus en 6 mois</li></ul>' +
    '<div class="small muted" style="margin-top:6px">Calculées à chaque ouverture de cette page. Bloquer les invitations n\'enlève personne : les membres gardent Premium, mais plus personne ne peut rejoindre. Journal effacé après 12 mois.</div></div>' + adminReportCard() + '</div></div>';
}

// Administration › Signalements : une séance partagée signalée (par son code), son retrait et l'e-mail des raisons à son
// auteur (règlement européen sur les services numériques, art. 16 et 17 ; CGU art. 5 et 6). Examen par toi, sans automatisme.
let shareRep = { code: "", res: null, busy: false, err: "" };
function reasonsMail(r) {
  const d = r.data || {}, title = (d.prog || "Programme") + " · " + (d.name || "Séance");
  const sub = "Fiitday : ta séance partagée « " + title + " » a été retirée";
  const body = "Bonjour,\n\nTa séance partagée « " + title + " » (code " + r.code + "), partagée le " + fmtDateLong(Date.parse(r.created_at)) + ", a été retirée de Fiitday le " + fmtDateLong(Date.now()) + ".\n\n" +
    "Ce qui a été constaté : [à compléter : le passage concerné]\n" +
    "Règle appliquée : [la loi enfreinte, ou l'article 4 des conditions d'utilisation de Fiitday : " + LEGAL.cgu + "]\n" +
    "Origine : [un signalement reçu / constaté par l'éditeur]. La décision a été prise par une personne, sans outil automatique.\n" +
    "Conséquence : le lien de partage ne fonctionne plus pour personne. Ton compte et tes autres données ne sont pas touchés.\n\n" +
    "Tu peux contester cette décision en répondant à cet e-mail : elle sera réexaminée. Tu peux aussi saisir le juge compétent.\n\nL'équipe Fiitday";
  return "mailto:" + encodeURIComponent(r.author_email || "") + "?subject=" + encodeURIComponent(sub) + "&body=" + encodeURIComponent(body);
}
function adminReportCard() {
  const r = shareRep.res, d = (r && r.data) || {}, exs = Array.isArray(d.ex) ? d.ex : [];
  return '<div class="section-title">Signalements</div><div class="card adm-report">' +
    '<label class="fl">Code ou lien de la séance signalée<input class="f" data-sr="code" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="80" placeholder="ex. K7p2X9qM ou fiitday.com/#/s/…" value="' + esc(shareRep.code) + '"></label>' +
    '<button class="btn sm" style="margin-top:8px" data-act="shrlook"' + (shareRep.busy ? " disabled" : "") + ">" + (shareRep.busy ? "Recherche…" : "Voir la séance") + "</button>" +
    (shareRep.err ? '<p class="small msg err" style="margin:8px 0 0">' + esc(shareRep.err) + "</p>" : "") +
    (r && !r.found ? '<p class="small muted" style="margin:8px 0 0">Aucune séance partagée avec ce code : déjà retirée, effacée au bout de 7 jours ou supprimée avec le compte de son auteur.</p>' : "") +
    (r && r.found ? '<div class="adm-rep-res"><div class="spread"><b>' + esc((d.prog || "Programme") + " · " + (d.name || "Séance")) + "</b>" + (r.removed ? '<span class="tag">retirée</span>' : "") + "</div>" +
      '<div class="small muted">Partagée le ' + esc(fmtDate(Date.parse(r.created_at))) + " par " + esc(r.author_email || "un compte supprimé") + " · " + (r.author_shares || 0) + " partage" + ((r.author_shares || 0) > 1 ? "s" : "") + " pour ce compte</div>" +
      '<ul class="small adm-rep-ex">' + exs.slice(0, 60).map(x => "<li>" + esc(String((x && x.n) || "Exercice")) + (x && x.no ? " : <i>" + esc(String(x.no)) + "</i>" : "") + "</li>").join("") + "</ul>" +
      '<div class="row duo">' + (r.removed ? "" : '<button class="btn sm danger" data-act="shrremove">Retirer ce partage</button>') +
      (r.author_email ? '<a class="btn sm" href="' + esc(reasonsMail(r)) + '">Prévenir l\'auteur</a>' : "") + "</div></div>" : "") +
    '<p class="small muted" style="margin:10px 0 0">Après un signalement reçu sur ' + "contact@fiitday.com" + ' : réponds pour accuser réception, regarde la séance ici, puis décide. Si tu la retires, envoie à l\'auteur la décision et ses raisons (« Prévenir l\'auteur », à compléter) et réponds à la personne qui a signalé. Garde ces e-mails.</p></div>';
}

/* ---------- Registre des recettes ---------- */
// Livre des recettes d'une micro-entreprise : chaque encaissement, dans l'ordre des dates, avec le client, la nature,
// le montant, le mode de paiement et la pièce justificative. Numérotation par année (2026-001…). Toute modification
// ou suppression est gardée dans un journal côté serveur.
let ledger = null, ledgerErr = "", ledgerBusy = false, ledgerYear = null;
// registre automatique : la fonction « ledger-stripe » lit Stripe et prépare une ligne par mois, à valider ici
let ledgerAuto = null, ledgerAutoBusy = false, ledgerAutoTried = false;
const EUR = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const eur = v => EUR.format(+v || 0);
const MOIS_C = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const MOIS = MONTHS;
const LEDGER_STORES = ["Google Play", "App Store"];
const LEDGER_METHODS = ["Virement bancaire", "Carte bancaire", "PayPal", "Chèque", "Espèces", "Autre"];
const isoDay = ymd;
const dayFr = s => s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4);
const ledgerInfo = () => Object.assign({ name: "", siret: "", addr: "", vat: "" }, settings().ledgerInfo || {});
async function loadLedger(manual) {
  if (ledgerBusy || !isAdmin()) return;
  ledgerBusy = true; ledgerErr = ""; if (manual) render();
  let ok = false;
  try { const r = await rpc("admin_ledger"); const den = admDenied(r); if (den) { ledger = null; ledgerErr = den; } else { ledger = r; ok = true; loadLedgerAuto(); } }
  catch (e) { ledgerErr = admErrText(e, "Le registre n'a pas pu être chargé"); }
  finally { ledgerBusy = false; if (route().name === "admin") render(); if (manual) toast(ok ? "Registre à jour · " + fmtTimeSec(Date.now()) : "Mise à jour impossible"); }
}
async function loadLedgerAuto() {
  try {
    const r = await rpc("admin_ledger_auto"); if (!r || r.denied) return;
    ledgerAuto = r; if (route().name === "admin") render();
    // lecture de Stripe toute seule à l'ouverture du registre, au plus une fois toutes les 6 heures
    const sy = r.sync; if (!ledgerAutoTried && (!sy || Date.now() - Date.parse(sy.at) > 6 * 3600e3)) { ledgerAutoTried = true; syncStripe(false); }
  } catch (e) { }
}
async function syncStripe(manual) {
  if (ledgerAutoBusy || !db.auth) return;
  ledgerAutoBusy = true; if (route().name === "admin") render();
  let res = null;
  try {
    await ensureToken();
    const call = () => fetch(SUPABASE_URL + "/functions/v1/ledger-stripe", { method: "POST", body: "{}", headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + db.auth.access_token, "Content-Type": "application/json" } });
    let r = await call(); if (r.status === 401) { await ensureToken(true); r = await call(); }
    res = await r.json().catch(() => null);
  } catch (e) { res = { ok: false, reason: e.message === "Failed to fetch" ? "pas de connexion internet" : e.message }; }
  ledgerAutoBusy = false;
  await loadLedgerAuto();
  if (manual) toast(res && res.ok ? "Stripe lu · " + fmtTimeSec(Date.now()) : "Lecture de Stripe impossible" + (res && res.reason && res.reason !== "no_key" ? " : " + res.reason : ""));
  if (route().name === "admin") render();
}
const draftNet = d => { const g = Math.max(+d.gross - +d.refunds, 0); return g - Math.min(+d.fees, g); };
const monthName = p => { const m = +p.slice(5, 7) - 1; return MOIS[m].charAt(0).toUpperCase() + MOIS[m].slice(1) + " " + p.slice(0, 4); };
function ledgerAutoCard() {
  const a = ledgerAuto; if (!a) return "";
  const sy = a.sync, drafts = a.drafts || [];
  const when = t => fmtDateLong(Date.parse(t)) + " à " + new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const nextM = p => { const y = +p.slice(0, 4), m = +p.slice(5, 7); return "1er " + MOIS[m % 12] + " " + (m === 12 ? y + 1 : y); };
  let h = '<div class="card adm-auto"><div class="spread"><b>Paiements par carte (Stripe)</b><button class="btn sm" data-act="ledgersync"' + (ledgerAutoBusy ? " disabled" : "") + ">" + (ledgerAutoBusy ? "Lecture…" : "Relire Stripe") + "</button></div>";
  if (!sy) h += '<p class="small muted">Stripe n\'a pas encore été lu.</p>';
  else if (!sy.ok) h += '<p class="small msg err">' + esc(sy.message || "Lecture impossible") + "</p>";
  else h += '<p class="small muted">Lu le ' + esc(when(sy.at)) + (sy.livemode ? "." : " · <b>mode test</b> : paiements d'essai, montrés pour exemple, ils ne vont pas dans le registre.") + "</p>";
  if (sy && sy.ok && !drafts.length) h += '<p class="small muted">Rien à ajouter au registre pour l\'instant.</p>';
  h += drafts.map(d => '<div class="adm-draft"><div class="spread"><b>' + esc(monthName(d.period)) + "</b>" + (d.livemode ? "" : '<span class="tag">Test</span>') + "</div>" +
    '<div class="small">' + d.n + " paiement" + (d.n > 1 ? "s" : "") + " · payé " + esc(eur(d.gross)) + (+d.refunds ? " · remboursé " + esc(eur(d.refunds)) : "") + " · frais Stripe " + esc(eur(d.fees)) + " · encaissé <b>" + esc(eur(draftNet(d))) + "</b></div>" +
    (d.note ? '<div class="small muted">' + esc(d.note) + "</div>" : "") +
    (!d.livemode ? "" : !d.closed ? '<div class="small muted">Mois en cours : à ajouter au registre à partir du ' + esc(nextM(d.period)) + ".</div>"
      : '<div class="row" style="margin-top:8px;flex-wrap:wrap"><button class="btn sm primary" data-act="ledgerok" data-id="' + esc(d.id) + '">Ajouter au registre</button><button class="btn sm" data-act="ledgerskip" data-id="' + esc(d.id) + '">Ignorer</button></div>') + "</div>").join("");
  return h + "</div>";
}
// recettes d'une année, numérotées dans l'ordre chronologique
function ledgerYearRows(y) {
  return (ledger && ledger.rows || []).filter(r => r.paid_on.slice(0, 4) === String(y)).map((r, k) => Object.assign({}, r, { num: y + "-" + String(k + 1).padStart(3, "0") }));
}
function ledgerMonths(rows) {
  const m = Array.from({ length: 12 }, () => ({ n: 0, gross: 0, fees: 0, net: 0 }));
  rows.forEach(r => { const x = m[+r.paid_on.slice(5, 7) - 1]; x.n++; x.gross += +r.gross; x.fees += +r.fees; x.net += +r.net; });
  return m;
}
const sumRows = rows => rows.reduce((s, r) => ({ n: s.n + (r.n != null ? r.n : 1), gross: s.gross + +r.gross, fees: s.fees + +r.fees, net: s.net + +r.net }), { n: 0, gross: 0, fees: 0, net: 0 });
function viewLedger() {
  if (!ledger && !ledgerErr) { if (!ledgerBusy) setTimeout(loadLedger, 0); return '<div class="card empty">Chargement du registre…</div>'; }
  if (!ledger) return '<div class="card"><p class="msg err" style="margin:0">' + esc(ledgerErr) + '</p><button class="btn sm" style="margin-top:10px" data-act="adminload">Réessayer</button></div>';
  const now = new Date(), thisY = now.getFullYear(), years = [...new Set([thisY].concat((ledger.rows || []).map(r => +r.paid_on.slice(0, 4))))].sort((a, b) => b - a);
  const y = years.includes(ledgerYear) ? ledgerYear : thisY, rows = ledgerYearRows(y), months = ledgerMonths(rows), tot = sumRows(rows);
  const isCur = y === thisY, mo = now.getMonth(), q = Math.floor(mo / 3), qTot = sumRows(months.slice(q * 3, q * 3 + 3));
  const info = ledgerInfo();
  const tile = (label, v, sub) => '<div class="card stat"><div class="muted small">' + label + '</div><div class="v num">' + v + "</div>" + (sub ? '<div class="muted small">' + sub + "</div>" : "") + "</div>";
  const yearSeg = '<div class="seg adm-years" role="group" aria-label="Année">' + years.map(v => '<button class="' + (v === y ? "on" : "") + '" aria-pressed="' + (v === y) + '" data-act="ledgeryear" data-v="' + v + '">' + v + "</button>").join("") + "</div>";
  let h = admBar(ledger.at, ledgerBusy, "données du registre") +
    '<div class="adm-ltools">' + yearSeg + '<div class="adm-lbtns"><button class="btn sm" data-act="ledgerinfo">Infos du registre</button><button class="btn sm" data-act="ledgerpdf"' + (rows.length ? "" : " disabled") + '>Exporter en PDF</button><button class="btn sm primary" data-act="ledgernew">+ Nouvelle recette</button></div></div>';
  h += '<div class="stats adm-tiles">' +
    tile("Encaissé en " + y, esc(eur(tot.net)), tot.n + " recette" + (tot.n > 1 ? "s" : "")) +
    (isCur ? tile("Ce mois-ci", esc(eur(months[mo].net)), MOIS[mo] + " " + y) + tile("Trimestre en cours", esc(eur(qTot.net)), "T" + (q + 1) + " · " + MOIS_C[q * 3] + " – " + MOIS_C[q * 3 + 2])
      : tile("Meilleur mois", esc(eur(Math.max(...months.map(m => m.net)))), MOIS[months.reduce((b, m, k) => m.net > months[b].net ? k : b, 0)]) + tile("Moyenne par mois", esc(eur(tot.net / 12)), "sur 12 mois")) +
    tile("Commissions des stores", esc(eur(tot.fees)), tot.gross ? Math.round(100 * tot.fees / tot.gross) + " % du brut" : "—") + "</div>";
  // registre (tableau sur ordinateur, cartes sur téléphone)
  const act = r => '<span class="adm-racts"><button class="link" data-act="ledgeredit" data-id="' + r.id + '">Modifier</button><button class="link del" data-act="ledgerdel" data-id="' + r.id + '">Supprimer</button></span>';
  const edited = r => +r.edits ? ' <span class="tag" title="Modifiée ' + r.edits + ' fois, l\'historique est gardé dans le journal">modifiée</span>' : "";
  let reg;
  if (!rows.length) reg = '<div class="card adm-empty"><h2 class="card-h">Aucune recette en ' + y + '</h2><p class="muted small">Note ici chaque somme encaissée : un versement de Google Play ou de l\'App Store (ils te paient chaque mois, commission déduite), ou toute autre vente. Garde la pièce justificative (relevé de paiement, facture) et sa référence.</p><button class="btn primary sm" data-act="ledgernew">+ Ajouter la première recette</button></div>';
  else {
    reg = '<div class="card adm-reg"><table class="adm-table"><thead><tr><th>N°</th><th>Date</th><th>Client / payeur</th><th>Nature</th><th>Mode</th><th>Pièce</th><th class="r">Brut</th><th class="r">Commission</th><th class="r">Encaissé</th><th><span class="sr">Actions</span></th></tr></thead><tbody>' +
      rows.map(r => '<tr><td class="num nowrap">' + r.num + '</td><td class="num nowrap">' + dayFr(r.paid_on) + "</td><td>" + esc(r.payer) + "</td><td>" + esc(r.nature) + edited(r) + (r.note ? '<div class="muted small">' + esc(r.note) + "</div>" : "") + "</td><td>" + esc(r.method) + '</td><td class="small nowrap">' + esc(r.ref || "—") +
        '</td><td class="r num nowrap">' + esc(eur(r.gross)) + '</td><td class="r num nowrap">' + (+r.fees ? "−" + esc(eur(r.fees)) : "—") + '</td><td class="r num nowrap"><b>' + esc(eur(r.net)) + "</b></td><td>" + act(r) + "</td></tr>").join("") +
      '</tbody><tfoot><tr><td colspan="6">Total ' + y + '</td><td class="r num nowrap">' + esc(eur(tot.gross)) + '</td><td class="r num nowrap">' + (tot.fees ? "−" + esc(eur(tot.fees)) : "—") + '</td><td class="r num nowrap">' + esc(eur(tot.net)) + "</td><td></td></tr></tfoot></table>" +
      '<div class="adm-cards">' + rows.slice().reverse().map(r => '<div class="adm-rc"><div class="spread"><b class="num">' + esc(eur(r.net)) + '</b><span class="muted small num">' + r.num + " · " + dayFr(r.paid_on) + "</span></div>" +
        "<div>" + esc(r.payer) + " · " + esc(r.nature) + edited(r) + "</div>" + '<div class="muted small">' + esc(r.method) + (r.ref ? " · pièce " + esc(r.ref) : "") + (+r.fees ? " · brut " + esc(eur(r.gross)) + ", commission " + esc(eur(r.fees)) : "") + "</div>" + (r.note ? '<div class="muted small">' + esc(r.note) + "</div>" : "") + act(r) + "</div>").join("") + "</div></div>";
  }
  // totaux par mois et par trimestre + graphique
  const W = 360, H = 130, T = 18, bw = W / 12, mx = Math.max(1, ...months.map(m => m.net));
  let svg = '<svg class="chart" viewBox="0 0 ' + W + " " + (H + 22) + '" role="img" aria-label="Encaissé par mois en ' + y + '"><line class="base" x1="0" x2="' + W + '" y1="' + H + '" y2="' + H + '"></line>';
  months.forEach((m, k) => { const v = m.net, yy = H - (v / mx) * (H - T), x = k * bw + bw * 0.2, w = bw * 0.6;
    svg += "<g><title>" + esc(MOIS[k] + " " + y + " : " + eur(v)) + "</title>";
    if (v > 0) { const r = Math.min(3, (H - yy) / 2); svg += '<path class="bar' + (isCur && k === mo ? "" : " dim") + '" d="M' + x + "," + H + "V" + (yy + r) + "Q" + x + "," + yy + " " + (x + r) + "," + yy + "H" + (x + w - r) + "Q" + (x + w) + "," + yy + " " + (x + w) + "," + (yy + r) + "V" + H + 'Z"></path>'; }
    svg += '<text x="' + (k * bw + bw / 2) + '" y="' + (H + 15) + '" text-anchor="middle">' + MOIS[k].charAt(0).toUpperCase() + "</text></g>"; });
  svg += "</svg>";
  const mrow = (l, m, cls) => '<tr class="' + (cls || "") + '"><td>' + l + '</td><td class="r num">' + (m.n || "—") + '</td><td class="r num nowrap">' + (m.gross ? esc(eur(m.gross)) : "—") + '</td><td class="r num nowrap">' + (m.fees ? "−" + esc(eur(m.fees)) : "—") + '</td><td class="r num nowrap">' + (m.net ? esc(eur(m.net)) : "—") + "</td></tr>";
  let mt = '<table class="adm-table adm-mt"><thead><tr><th>Mois</th><th class="r">Nb</th><th class="r">Brut</th><th class="r">Commissions</th><th class="r">Encaissé</th></tr></thead><tbody>';
  for (let qq = 0; qq < 4; qq++) { for (let k = qq * 3; k < qq * 3 + 3; k++) mt += mrow(MOIS[k].charAt(0).toUpperCase() + MOIS[k].slice(1), months[k]); mt += mrow("T" + (qq + 1) + " · " + MOIS_C[qq * 3] + " – " + MOIS_C[qq * 3 + 2], sumRows(months.slice(qq * 3, qq * 3 + 3)), "q"); }
  mt += "</tbody><tfoot>" + mrow("Année " + y, tot) + "</tfoot></table>";
  const side = '<div class="adm-syn-a"><div class="card"><div class="muted small" style="font-weight:600;margin-bottom:8px">Encaissé par mois</div>' + svg + "</div>" +
    '<div class="card adm-legal"><h2 class="card-h">À savoir</h2><ul class="small muted"><li>Chaque recette est notée à la date où l\'argent arrive sur ton compte, dans l\'ordre des dates.</li>' +
    "<li>Garde les pièces justificatives (relevés de paiement Google / Apple, factures) : registre et pièces se conservent 10 ans.</li>" +
    "<li>Pour Google Play et l'App Store, le registre garde le brut, la commission et le net encaissé : vérifie avec ton comptable ou l'URSSAF lequel déclarer.</li>" +
    "<li>TVA : " + (info.vat === "franchise" ? "franchise en base, la mention « TVA non applicable, art. 293 B du CGI » figure sur le PDF." : "régime pas encore choisi (Infos du registre).") + "</li>" +
    "<li>Chaque modification ou suppression est gardée dans un journal" + (+ledger.deleted ? " (" + ledger.deleted + " suppression" + (ledger.deleted > 1 ? "s" : "") + " notée" + (ledger.deleted > 1 ? "s" : "") + ")" : "") + ".</li></ul></div></div>" +
    '<div class="card adm-syn-b"><div class="muted small" style="font-weight:600;margin-bottom:6px">Totaux par mois et par trimestre</div>' + mt + "</div>";
  return h + ledgerAutoCard() + '<div class="section-title">Registre ' + y + "</div>" + reg + '<div class="section-title">Synthèse ' + y + '</div><div class="adm-syn">' + side + "</div>";
}
// fenêtre de saisie d'une recette
const parseAmt = s => { const t = String(s == null ? "" : s).replace(/[\s  €]/g, "").replace(",", "."); return /^\d{1,7}(\.\d{1,2})?$/.test(t) ? Math.round(+t * 100) / 100 : NaN; };
const amtStr = v => v == null || v === "" ? "" : String(Math.round(+v * 100) / 100).replace(".", ",");
function askLedger(cur) {
  return new Promise(res => {
    const prevMonth = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return MOIS[d.getMonth()] + " " + d.getFullYear(); })();
    const v = cur ? { paid_on: cur.paid_on, payer: cur.payer, nature: cur.nature, method: cur.method, ref: cur.ref || "", gross: amtStr(cur.gross), fees: +cur.fees ? amtStr(cur.fees) : "", note: cur.note || "" }
      : { paid_on: isoDay(Date.now()), payer: "Google Play", nature: "Ventes d'abonnements Fiitday (" + prevMonth + ")", method: "Virement bancaire", ref: "", gross: "", fees: "", note: "" };
    let who = LEDGER_STORES.includes(v.payer) ? v.payer : "autre";
    const d = document.createElement("div"); d.className = "modal sheet";
    const netTxt = () => { const g = parseAmt(v.gross), f = v.fees === "" ? 0 : parseAmt(v.fees); return isNaN(g) || isNaN(f) ? "—" : eur(g - f); };
    const draw = () => {
      d.innerHTML = '<div class="modal-box own-box adm-form" role="dialog" aria-modal="true" aria-label="' + (cur ? "Modifier la recette" : "Nouvelle recette") + '"><h3>' + (cur ? "Modifier la recette " + esc(cur.num || "") : "Nouvelle recette") + "</h3>" +
        '<label class="fl">Date d\'encaissement<input class="f" type="date" data-f="paid_on" max="' + isoDay(Date.now() + 86400000) + '" value="' + esc(v.paid_on) + '"></label>' +
        '<div class="fl" style="margin-top:10px">Client / payeur<div class="seg adm-who" role="group">' + LEDGER_STORES.concat(["autre"]).map(p => '<button type="button" data-who="' + p + '" class="' + (who === p ? "on" : "") + '" aria-pressed="' + (who === p) + '">' + (p === "autre" ? "Autre" : p) + "</button>").join("") + "</div>" +
        (who === "autre" ? '<input class="f" data-f="payer" maxlength="120" placeholder="Nom du client" value="' + esc(LEDGER_STORES.includes(v.payer) ? "" : v.payer) + '">' : "") + "</div>" +
        '<label class="fl" style="margin-top:10px">Nature de la recette<input class="f" data-f="nature" maxlength="200" value="' + esc(v.nature) + '"></label>' +
        '<div class="adm-frow"><label class="fl">Mode de paiement<select class="f" data-f="method">' + LEDGER_METHODS.map(m => "<option" + (m === v.method ? " selected" : "") + ">" + m + "</option>").join("") + "</select></label>" +
        '<label class="fl">Pièce justificative<input class="f" data-f="ref" maxlength="80" placeholder="N° du relevé ou de la facture" value="' + esc(v.ref) + '"></label></div>' +
        '<div class="adm-frow"><label class="fl">Montant brut (€)<input class="f num" data-f="gross" inputmode="decimal" placeholder="0,00" value="' + esc(v.gross) + '"></label>' +
        '<label class="fl">Commission du store (€)<input class="f num" data-f="fees" inputmode="decimal" placeholder="0,00" value="' + esc(v.fees) + '"></label></div>' +
        '<div class="adm-net"><span class="muted small">Encaissé (net)</span><b class="num" data-net>' + esc(netTxt()) + "</b></div>" +
        '<label class="fl">Note (facultatif)<input class="f" data-f="note" maxlength="500" value="' + esc(v.note) + '"></label>' +
        '<p class="msg err" data-m></p><div class="modal-btns"><button class="btn" data-r="0">Annuler</button><button class="btn primary" data-r="1">' + (cur ? "Enregistrer" : "Ajouter au registre") + "</button></div></div>";
    };
    draw(); document.body.appendChild(d);
    d.addEventListener("input", e => { const f = e.target.dataset && e.target.dataset.f; if (!f) return; v[f] = e.target.value; if (f === "gross" || f === "fees") d.querySelector("[data-net]").textContent = netTxt(); });
    d.addEventListener("change", e => { const f = e.target.dataset && e.target.dataset.f; if (f) v[f] = e.target.value; });
    d.addEventListener("click", e => {
      if (e.target === d) { d.remove(); res(null); return; }
      const w = e.target.closest("[data-who]");
      if (w) { who = w.dataset.who; if (who !== "autre") { v.payer = who; if (!v.nature) v.nature = "Ventes d'abonnements Fiitday (" + prevMonth + ")"; } else if (LEDGER_STORES.includes(v.payer)) v.payer = ""; draw(); if (who === "autre") d.querySelector('[data-f="payer"]').focus(); return; }
      const b = e.target.closest("[data-r]"); if (!b) return;
      if (b.dataset.r !== "1") { d.remove(); res(null); return; }
      const m = d.querySelector("[data-m]"), g = parseAmt(v.gross), f = v.fees === "" ? 0 : parseAmt(v.fees);
      const payer = (who === "autre" ? v.payer : who).replace(/\s+/g, " ").trim(), nature = v.nature.replace(/\s+/g, " ").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v.paid_on || "")) { m.textContent = "Indique la date à laquelle l'argent est arrivé."; return; }
      if (v.paid_on > isoDay(Date.now() + 86400000)) { m.textContent = "La date ne peut pas être dans le futur."; return; }
      if (!payer) { m.textContent = "Indique qui t'a payé."; return; }
      if (!nature) { m.textContent = "Décris la recette (ex. ventes d'abonnements d'octobre)."; return; }
      if (isNaN(g) || g <= 0) { m.textContent = "Montant brut invalide (ex. 125,40)."; return; }
      if (isNaN(f) || f > g) { m.textContent = "La commission doit être un montant inférieur au brut."; return; }
      d.remove(); res({ id: cur ? cur.id : null, paid_on: v.paid_on, payer, nature, method: v.method, ref: v.ref.trim(), gross: g.toFixed(2), fees: f.toFixed(2), note: v.note.trim() });
    });
  });
}
function askLedgerInfo() {
  return new Promise(res => {
    const v = ledgerInfo(), d = document.createElement("div"); d.className = "modal sheet";
    const draw = () => {
      d.innerHTML = '<div class="modal-box own-box adm-form" role="dialog" aria-modal="true" aria-label="Infos du registre"><h3>Infos du registre</h3><p class="small muted" style="margin:0 0 10px">Elles apparaissent en tête du PDF. Tout est facultatif.</p>' +
        '<label class="fl">Nom ou dénomination<input class="f" data-f="name" maxlength="120" placeholder="Prénom Nom (EI) ou nom commercial" value="' + esc(v.name) + '"></label>' +
        '<label class="fl" style="margin-top:10px">SIRET<input class="f num" data-f="siret" inputmode="numeric" maxlength="17" placeholder="14 chiffres" value="' + esc(v.siret) + '"></label>' +
        '<label class="fl" style="margin-top:10px">Adresse<input class="f" data-f="addr" maxlength="200" value="' + esc(v.addr) + '"></label>' +
        '<div class="fl" style="margin-top:10px">TVA<div class="stack" style="gap:8px">' +
        [["", "Pas encore défini", "Aucune mention de TVA sur le PDF"], ["franchise", "Franchise en base", "« TVA non applicable, art. 293 B du CGI » sur le PDF"]].map(([k, l, s]) => '<button type="button" class="btn block choice' + (v.vat === k ? " on" : "") + '" data-vat="' + k + '" aria-pressed="' + (v.vat === k) + '"><b>' + l + '</b><span class="small muted">' + s + "</span></button>").join("") + "</div></div>" +
        '<p class="msg err" data-m></p><div class="modal-btns"><button class="btn" data-r="0">Annuler</button><button class="btn primary" data-r="1">Enregistrer</button></div></div>';
    };
    draw(); document.body.appendChild(d);
    d.addEventListener("input", e => { const f = e.target.dataset && e.target.dataset.f; if (f) v[f] = e.target.value; });
    d.addEventListener("click", e => {
      if (e.target === d) { d.remove(); res(null); return; }
      const t = e.target.closest("[data-vat]"); if (t) { v.vat = t.dataset.vat; draw(); return; }
      const b = e.target.closest("[data-r]"); if (!b) return;
      if (b.dataset.r !== "1") { d.remove(); res(null); return; }
      const siret = v.siret.replace(/\s/g, "");
      if (siret && !/^\d{14}$/.test(siret)) { d.querySelector("[data-m]").textContent = "Le SIRET compte 14 chiffres."; return; }
      d.remove(); res({ name: v.name.trim(), siret, addr: v.addr.trim(), vat: v.vat });
    });
  });
}
async function ledgerSave(entry) {
  try {
    const r = await rpc("admin_ledger_save", { entry });
    const den = admDenied(r); if (den) { ledgerErr = den; render(); return false; }
    toast(entry.id ? "Recette modifiée" : "Recette ajoutée au registre"); ledgerYear = +entry.paid_on.slice(0, 4);
  } catch (e) { toast(e.message === "Failed to fetch" ? "Pas de connexion internet : rien n'a été enregistré" : "Enregistrement impossible : " + e.message); return false; }
  await loadLedger(); return true;
}

/* ---------- PDF du registre (A4 paysage, police Helvetica, sans bibliothèque) ---------- */
const HELV = [[278,278,355,556,556,889,667,222,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,222,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,278,556,278,222,556,333,1000,556,556,333,1000,667,333,1000,278,611,278,278,222,222,333,333,350,556,1000,333,1000,500,333,944,278,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500],
  [278,333,474,556,556,889,722,278,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,278,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,278,556,278,278,556,500,1000,556,556,333,1000,667,333,1000,278,611,278,278,278,278,500,500,350,556,1000,333,1000,556,333,944,278,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556]];
const WIN = { "€": 128, "‚": 130, "„": 132, "…": 133, "‘": 145, "’": 146, "“": 147, "”": 148, "•": 149, "–": 150, "—": 151, "™": 153, "œ": 156, "Œ": 140, "−": 45, " ": 32, " ": 32, " ": 32 };
const winChar = ch => { const c = ch.charCodeAt(0); if (WIN[ch] != null) return WIN[ch]; if (c >= 32 && c < 127) return c; if (c >= 160 && c < 256) return c; return 63; };
function pdfDoc() {
  const PW = 841.89, PH = 595.28, pages = []; let ops = null;
  const tw = (s, size, bold) => { let w = 0; for (const ch of String(s)) { const c = winChar(ch); w += (HELV[bold ? 1 : 0][c - 32] || 556); } return w * size / 1000; };
  const lit = s => { let o = ""; for (const ch of String(s)) { const c = winChar(ch); o += c === 40 || c === 41 || c === 92 ? "\\" + String.fromCharCode(c) : String.fromCharCode(c); } return "(" + o + ")"; };
  const col = c => c.map(x => (x / 255).toFixed(3)).join(" ");
  const fit = (s, w, size, bold) => { s = String(s); if (tw(s, size, bold) <= w) return s; while (s.length > 1 && tw(s + "…", size, bold) > w) s = s.slice(0, -1); return s.replace(/\s+$/, "") + "…"; };
  return {
    PW, PH, tw, fit,
    page() { ops = []; pages.push(ops); },
    text(x, y, s, o) { o = o || {}; const size = o.size || 9, bold = !!o.bold; let tx = x; if (o.align === "right") tx = x - tw(s, size, bold); else if (o.align === "center") tx = x - tw(s, size, bold) / 2;
      ops.push("BT /" + (bold ? "F2" : "F1") + " " + size + " Tf " + col(o.color || [22, 19, 31]) + " rg " + tx.toFixed(2) + " " + (PH - y).toFixed(2) + " Td " + lit(s) + " Tj ET"); },
    rect(x, y, w, h, c) { ops.push(col(c) + " rg " + x.toFixed(2) + " " + (PH - y - h).toFixed(2) + " " + w.toFixed(2) + " " + h.toFixed(2) + " re f"); },
    line(x1, y1, x2, y2, c, w) { ops.push(col(c || [200, 196, 210]) + " RG " + (w || 0.6) + " w " + x1.toFixed(2) + " " + (PH - y1).toFixed(2) + " m " + x2.toFixed(2) + " " + (PH - y2).toFixed(2) + " l S"); },
    count: () => pages.length,
    each(fn) { pages.forEach((p, k) => { ops = p; fn(k); }); },
    bytes(title) {
      const objs = [], add = s => { objs.push(s); return objs.length; };
      const cat = add(""), pg = add(""), f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"), f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
      const kids = pages.map(p => { const body = p.join("\n"), c = add("<< /Length " + body.length + " >>\nstream\n" + body + "\nendstream"); return add("<< /Type /Page /Parent " + pg + " 0 R /MediaBox [0 0 " + PW + " " + PH + "] /Resources << /Font << /F1 " + f1 + " 0 R /F2 " + f2 + " 0 R >> >> /Contents " + c + " 0 R >>"); });
      objs[cat - 1] = "<< /Type /Catalog /Pages " + pg + " 0 R >>";
      objs[pg - 1] = "<< /Type /Pages /Kids [" + kids.map(k => k + " 0 R").join(" ") + "] /Count " + kids.length + " >>";
      const info = add("<< /Title " + lit(title) + " /Producer (Fiitday) /CreationDate (D:" + new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14) + ") >>");
      let out = "%PDF-1.4\n%âãÏÓ\n"; const off = [];
      objs.forEach((o, k) => { off.push(out.length); out += (k + 1) + " 0 obj\n" + o + "\nendobj\n"; });
      const xref = out.length;
      out += "xref\n0 " + (objs.length + 1) + "\n0000000000 65535 f \n" + off.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("") +
        "trailer\n<< /Size " + (objs.length + 1) + " /Root " + cat + " 0 R /Info " + info + " 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
      const b = new Uint8Array(out.length); for (let k = 0; k < out.length; k++) b[k] = out.charCodeAt(k) & 255; return b;
    }
  };
}
function ledgerPdf(year) {
  const rows = ledgerYearRows(year), months = ledgerMonths(rows), tot = sumRows(rows), info = ledgerInfo(), P = pdfDoc(), M = 36, now = Date.now();
  const MUT = [93, 88, 107], ACC = [200, 30, 100], INK = [22, 19, 31], WHITE = [255, 255, 255], ZEB = [246, 244, 249], SUB = [236, 232, 244];
  const C = [["N°", 54], ["Date", 58], ["Client / payeur", 104], ["Nature de la recette", 192], ["Mode de paiement", 84], ["Pièce justificative", 92], ["Brut", 60, 1], ["Commission", 68, 1], ["Encaissé", 60, 1]];
  const X = []; let right = M; C.forEach(c => { X.push(right); right += c[1]; });
  const FOOT = P.PH - 40; let y = 0;
  const money = v => eur(v), neg = v => +v ? "−" + eur(v) : "—";
  const header = () => {
    P.page();
    P.rect(0, 0, P.PW, 6, ACC);
    P.text(M, 42, "Registre des recettes " + year, { size: 18, bold: true });
    const who = [info.name, info.siret ? "SIRET " + info.siret.replace(/(\d{3})(\d{3})(\d{3})(\d{5})/, "$1 $2 $3 $4") : "", info.addr].filter(Boolean).join("  ·  ");
    P.text(M, 58, who || "Micro-entreprise", { size: 9.5, color: MUT });
    P.text(P.PW - M, 42, "Édité le " + dayFr(isoDay(now)) + " à " + fmtTime(now), { size: 9, color: MUT, align: "right" });
    P.text(P.PW - M, 58, "Montants en euros · encaissements dans l'ordre des dates", { size: 9, color: MUT, align: "right" });
    y = 76;
  };
  const head = (cols, xs, w) => { P.rect(M, y, w, 20, INK); cols.forEach((c, k) => P.text(c[2] ? xs[k] + c[1] - 6 : xs[k] + 6, y + 13.5, c[0], { size: 8.5, bold: true, color: WHITE, align: c[2] ? "right" : "left" })); y += 20; };
  const ensure = h => { if (y + h > FOOT - 8) { header(); head(C, X, right - M); } };
  const cellsRow = (vals, h, o) => vals.forEach((v, k) => { const c = C[k]; if (v == null) return; P.text(c[2] ? X[k] + c[1] - 6 : X[k] + 6, y + h / 2 + 3.2, c[2] || o.nofit ? v : P.fit(v, c[1] - 12, o.size || 8.5, o.bold || k === 8), { size: o.size || 8.5, bold: o.bold || (k === 8 && !o.light), color: o.color, align: c[2] ? "right" : "left" }); });
  header();
  // synthèse de l'année
  const bw = (right - M - 30) / 4;
  [["Total encaissé " + year, money(tot.net)], ["Montant brut", money(tot.gross)], ["Commissions des stores", neg(tot.fees)], ["Nombre de recettes", String(tot.n)]].forEach(([l, v], k) => {
    const x = M + k * (bw + 10); P.rect(x, y, bw, 42, ZEB); P.text(x + 10, y + 15, l, { size: 8.5, color: MUT }); P.text(x + 10, y + 33, v, { size: 13, bold: true }); });
  y += 56;
  head(C, X, right - M);
  if (!rows.length) { P.text(M + 6, y + 16, "Aucune recette enregistrée pour " + year + ".", { size: 9.5, color: MUT }); y += 26; }
  for (let m = 0; m < 12; m++) {
    const rs = rows.filter(r => +r.paid_on.slice(5, 7) === m + 1); if (!rs.length) continue;
    rs.forEach((r, k) => {
      ensure(18); if (k % 2) P.rect(M, y, right - M, 18, ZEB);
      cellsRow([r.num, dayFr(r.paid_on), r.payer, r.nature + (r.note ? " — " + r.note : ""), r.method, r.ref || "—", money(r.gross), neg(r.fees), money(r.net)], 18, {});
      y += 18;
    });
    ensure(18); const s = sumRows(rs);
    P.rect(M, y, right - M, 18, SUB);
    P.text(X[0] + 6, y + 12.2, "Total " + MOIS[m] + " " + year + " · " + s.n + " recette" + (s.n > 1 ? "s" : ""), { size: 8.5, bold: true });
    cellsRow([null, null, null, null, null, null, money(s.gross), neg(s.fees), money(s.net)], 18, { bold: true });
    y += 24;
  }
  ensure(24);
  P.rect(M, y, right - M, 22, INK);
  P.text(X[0] + 6, y + 14.5, "TOTAL DE L'ANNÉE " + year, { size: 9, bold: true, color: WHITE });
  cellsRow([null, null, null, null, null, null, money(tot.gross), neg(tot.fees), money(tot.net)], 22, { bold: true, color: WHITE, size: 9 });
  y += 36;
  // récapitulatif par mois et par trimestre (sur une page à part s'il ne tient pas)
  const RC = [["Période", 210], ["Recettes", 80, 1], ["Brut", 120, 1], ["Commissions", 120, 1], ["Encaissé", 120, 1]], RX = []; let rr = M; RC.forEach(c => { RX.push(rr); rr += c[1]; });
  if (y + 24 + 20 + 16 * 16 + 20 > FOOT - 8) header();
  P.text(M, y + 6, "Récapitulatif par mois et par trimestre", { size: 12, bold: true }); y += 16;
  head(RC, RX, rr - M);
  const rrow = (l, s, bg, bold, color, h) => { h = h || 16; if (bg) P.rect(M, y, rr - M, h, bg);
    [l, s.n ? String(s.n) : "—", s.gross ? money(s.gross) : "—", neg(s.fees), s.net ? money(s.net) : "—"].forEach((v, k) => P.text(RC[k][2] ? RX[k] + RC[k][1] - 6 : RX[k] + 6, y + h / 2 + 3, v, { size: 8.5, bold, color, align: RC[k][2] ? "right" : "left" })); y += h; };
  for (let q = 0; q < 4; q++) {
    for (let k = q * 3; k < q * 3 + 3; k++) rrow(MOIS[k].charAt(0).toUpperCase() + MOIS[k].slice(1) + " " + year, months[k], k % 2 ? ZEB : null, false);
    rrow("Trimestre " + (q + 1) + " (" + MOIS_C[q * 3] + " – " + MOIS_C[q * 3 + 2] + ")", sumRows(months.slice(q * 3, q * 3 + 3)), SUB, true);
  }
  rrow("Année " + year, tot, INK, true, WHITE, 20);
  // pied de chaque page : mentions et « Page x / n »
  const n = P.count(), vat = info.vat === "franchise" ? "TVA non applicable, art. 293 B du CGI.  " : "";
  P.each((k) => {
    P.line(M, FOOT, P.PW - M, FOOT, [214, 209, 224], 0.6);
    P.text(M, FOOT + 14, vat + "Registre tenu avec Fiitday · à conserver 10 ans avec les pièces justificatives.", { size: 8, color: MUT });
    P.text(P.PW - M, FOOT + 14, "Page " + (k + 1) + " / " + n, { size: 8, color: MUT, align: "right" });
  });
  return P.bytes("Registre des recettes " + year);
}
// fichier : sur le téléphone, choix de l'emplacement ; sur le site, téléchargement
function saveBytes(name, mime, bytes) {
  const B = window.AndroidBridge;
  if (B && typeof B.saveBytes === "function") return new Promise(res => {
    let bin = ""; for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
    fileCb = st => res(st); B.saveBytes(name, mime, btoa(bin));
  });
  if (B && typeof B.saveFile === "function") return Promise.resolve("old-app");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([bytes], { type: mime })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return Promise.resolve("download");
}

function viewSettings() {
  const s = settings();
  const sv = k => s[k] || (k === "watch" ? "non" : k === "stretchTips" ? "oui" : "");
  const seg = (k, opts) => '<div class="seg" role="group">' + opts.map(o => '<button class="' + (sv(k) === o[0] ? "on" : "") + '" aria-pressed="' + (sv(k) === o[0]) + '" data-act="set" data-k="' + k + '" data-val="' + o[0] + '">' + o[1] + "</button>").join("") + "</div>";
  // même numéro sur le téléphone et sur le web : 1.<nombre de modifications du code>
  const num_ = (Native && Native.version && Native.version()) || window.APP_VERSION || "";
  const ver = "Fiitday " + (num_ && num_ !== "1.0-dev" ? "V" + num_ : "(version de développement)");
  const fr = dataLocked(), lk = fr ? " locked-btn" : "", li = fr ? LOCK : "";
  const frNote = fr ? '<div class="small lock-note">' + LOCK + 'Le code de transfert et la restauration d\'une sauvegarde d\'un autre compte sont réservés aux abonnés Premium' + (planState() === "trial" ? ", pendant l\'essai aussi" : "") + '. Ta propre sauvegarde se restaure toujours. <a class="link" href="#/premium">Voir Premium</a></div>' : "";
  return '<div class="page-head"><h1>Réglages</h1></div><div class="stack set-stack">' + planSettings() +
    '<div class="card"><h2 class="card-h">Apparence</h2><div style="margin-top:10px">' + seg("theme", [["auto", "Auto"], ["clair", "Clair"], ["sombre", "Sombre"]]) + "</div>" +
    '<div class="small muted" style="margin-top:12px">Couleur</div><div class="swatches" role="group" aria-label="Couleur de l\'appli">' + ACCENTS.map(([k, l, c]) => { const on = (ACCENTS.some(x => x[0] === s.accent) ? s.accent : "rose") === k;
      return '<button class="swatch' + (on ? " on" : "") + '" aria-pressed="' + on + '" data-act="set" data-k="accent" data-val="' + k + '"><i style="background:linear-gradient(135deg,' + c + ')"></i>' + l + "</button>"; }).join("") + "</div></div>" +
    '<div class="card"><h2 class="card-h">Alerte de fin de repos</h2><div class="alert-row">' + alertSeg(sv("alert")) + '<button class="btn sm" data-act="testalert">Tester</button></div>' + notifCard() + "</div>" +
    '<div class="card"><h2 class="card-h">Étirements après la séance</h2><div class="small muted" style="margin-top:4px">À la fin d\'une séance, l\'accueil propose pendant 15 minutes des étirements adaptés aux muscles travaillés.</div><div style="margin-top:10px">' + seg("stretchTips", [["oui", "Activés"], ["non", "Désactivés"]]) + "</div></div>" +
    '<div class="card"><h2 class="card-h">Objectif de séances par semaine</h2><div style="margin-top:10px">' + seg("goal", [["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"], ["7", "7"]]) + "</div></div>" +
    '<div class="card"><h2 class="card-h">Données</h2><div class="small muted" style="margin-top:4px">Tes programmes, séances et réglages.</div>' +
    '<div class="data-sec"><div class="data-t">Sauvegarde</div><div class="small muted">Un fichier à garder sur ton téléphone, ton ordinateur ou dans un cloud (Google Drive…).</div>' +
    '<div class="row" style="margin-top:8px;flex-wrap:wrap"><button class="btn sm" data-act="filesave">Sauvegarde</button><button class="btn sm" data-act="fileopen">Restaurer</button></div></div>' +
    '<div class="data-sec"><div class="data-t">Transfert vers un autre compte</div><div class="small muted">Un code de 8 caractères, valable 1 heure, à taper dans l\'autre compte.</div>' +
    '<div class="row" style="margin-top:8px;flex-wrap:wrap"><button class="btn sm' + lk + '" data-act="xfercreate">' + li + 'Créer un code</button><button class="btn sm' + lk + '" data-act="xferuse">' + li + 'J\'ai un code</button></div></div>' + frNote +
    '<div class="row" style="margin-top:6px;flex-wrap:wrap;gap:4px 14px"><a class="link small" style="padding:0;display:inline-flex;align-items:center" href="#/faq/sauvegarde">Comment ça marche ?</a></div></div>' +
    '<div class="card"><h2 class="card-h">Compte</h2><div style="margin-top:8px">' +
    (db.auth ? '<label class="fl" style="margin-bottom:8px">Prénom<input class="f" data-setname maxlength="40" autocomplete="given-name" value="' + esc(firstName()) + '" placeholder="Ton prénom"></label>' +
      '<div class="small">Connecté : ' + esc(db.auth.user.email) + "</div><div class=\"sync-row\">" + syncBadge() + '<button class="link small" data-act="syncnow">Synchroniser maintenant</button></div><div class="small msg err" data-sync-error>' + esc(syncMsg()) + "</div>" +
      '<button class="btn sm pw-btn" data-act="pwchange">Changer mon mot de passe</button><div class="row duo"><button class="btn sm" data-act="logout">Se déconnecter</button><button class="btn sm danger" data-act="delaccount">Supprimer mon compte</button></div>'
      : '<div class="small muted">Sans compte : tes données restent sur cet appareil.</div><button class="btn sm primary" style="margin-top:8px" data-act="tologin">Se connecter / créer un compte</button>') +
    "</div></div>" +
    '<div class="card"><h2 class="card-h">Aide</h2><div class="small muted" style="margin-top:4px">Le tour de l\'appli page par page, et les réponses aux questions les plus fréquentes.</div><div class="row duo"><a class="btn sm" href="#/guide">Guide</a><a class="btn sm" href="#/faq">Questions fréquentes</a></div></div>' +
    '<div class="card"><h2 class="card-h">Informations légales</h2><div class="row duo">' +
    '<a class="btn sm" href="' + LEGAL.privacy + '" target="_blank" rel="noopener">Politique de confidentialité</a>' +
    '<a class="btn sm" href="' + LEGAL.legal + '" target="_blank" rel="noopener">Mentions légales</a></div>' +
    '<div class="row duo"><a class="btn sm" href="' + LEGAL.cgu + '" target="_blank" rel="noopener">Conditions d\'utilisation</a>' +
    (LEGAL.cgv ? '<a class="btn sm" href="' + LEGAL.cgv + '" target="_blank" rel="noopener">Conditions générales de vente</a>' : "") + "</div>" +
    '<div class="small muted" style="margin-top:10px">Une question, un souci ? <a class="link" href="mailto:contact@fiitday.com">contact@fiitday.com</a></div></div>' +
    '<div class="credit"><div class="credit-msg">L\'équipe Fiitday te souhaite de belles séances</div><div class="appver"><img src="icon-192.png" alt="" width="24" height="24">' + esc(ver) + "</div></div></div>";
}

/* ================= Minuteurs ================= */
// titre du chrono : étirement, gainage ou course (distance)
function chronoKind(w, c) { const ex = w && w.exercises[c.i], lb = ex && exLib(ex); return c.cardio || (ex && ex.type === "cardio") ? "Cardio" : lb && lb.cat === "etirement" ? "Étirement" : c.dist || (ex && ex.type === "dist") ? "Chrono" : "Gainage"; }
function tick() {
  const now = Date.now(), L = db.live || {};
  document.querySelectorAll('[data-tick="elapsed"]').forEach(el => { const w = getItem(el.dataset.id); if (w) el.textContent = fmtDur(shownDur(w), "down"); });
  // repos
  if (L.restEnd && now >= L.restEnd && !L.restAlerted) {
    // déjà signalé par la notification Android (appli en arrière-plan) : pas de deuxième alerte en revenant
    let nativeAlerted = false;
    try { nativeAlerted = !!(Native && Native.restAlertedAt && Number(Native.restAlertedAt()) === L.restEnd); } catch (e) { }
    L.restAlerted = true; L.restEnd = null; L.restMin = false; save();
    if (!nativeAlerted) { signal(watchOn()); restDone(); } // option montre : la notification d'Android vibre (téléphone et montre)
  }
  syncNativeChrono(); syncNativeRest(); // le chrono d'abord : un repos qui suit un chrono ne doit pas être coupé
  const pop = document.querySelector("[data-restpop]"), pill = document.querySelector("[data-restpill]");
  if (pop) {
    const on = !!L.restEnd;
    pop.hidden = !on || !!L.restMin;
    if (pill) pill.hidden = !on || !L.restMin;
    if (on) {
      const left = fmtDur(L.restEnd - now, "up");
      pop.querySelector("[data-rptime]").textContent = left;
      const lab = pop.querySelector(".rp-label"); if (lab) lab.textContent = L.restLabel || "Repos";
      pop.querySelector("[data-rpbar]").style.width = Math.max(0, Math.min(100, 100 * (L.restEnd - now) / (L.restTotal || 1))) + "%";
      if (pill) pill.textContent = "Repos " + left + " · Agrandir";
    }
  }
  // chrono (gainage)
  const c = L.chrono;
  const cpop = document.querySelector("[data-chronopop]"), cpill = document.querySelector("[data-chronopill]");
  if (c) {
    const el = document.querySelector('[data-tick="chrono"]');
    const ms = now - c.start, prep = ms < 0, left = Math.ceil(-ms / 1000);
    // décompte de préparation : bip à 3, 2, 1 puis au départ
    if (prep && left !== c.count) { c.count = left; if (left <= 3) prepBeep(false); }
    if (!prep && !c.go) { c.go = true; save(); prepBeep(true); }
    if (el) el.textContent = prep ? "Prêt · " + left : fmtDur(ms, "down");
    if (!c.alerted && c.target && ms >= c.target * 1000) {
      c.alerted = true; save();
      let nativeDone = false; // objectif déjà signalé par Android (appli en arrière-plan)
      try { nativeDone = !!(Native && Native.restAlertedAt && Number(Native.restAlertedAt()) === c.start + c.target * 1000); } catch (e) { }
      if (!nativeDone) signal(watchOn());
    }
    const w = currentWorkout(), here = w && w.id === c.wid;
    if (cpop) {
      cpop.hidden = !here || !!c.min;
      if (here) {
        const ex = w.exercises[c.i];
        cpop.querySelector("[data-cpname]").textContent = ex && ex.type === "cardio" ? ex.name : ex && norm(ex.name) !== "gainage" ? ex.name + " · série " + (c.s + 1) : "Série " + (c.s + 1);
        const lab = cpop.querySelector(".rp-label"), kind = chronoKind(w, c); if (lab.textContent !== kind) lab.textContent = kind;
        cpop.querySelector("[data-cptime]").textContent = prep ? String(left) : fmtDur(ms, "down");
        cpop.querySelector("[data-cpbar]").style.width = (c.target && !prep ? Math.min(100, 100 * ms / (c.target * 1000)) : 0) + "%";
        cpop.querySelector("[data-cpgoal]").textContent = prep ? "Mets-toi en position…" : c.target ? (c.alerted ? "Objectif atteint !" + (c.cardio ? " Continue ou touche Terminer" : "") : "Objectif " + fmtHold(c.target)) : c.dist ? "Distance : " + fmtNum(c.dist) + " m · touche Terminer à l'arrivée" : c.cardio ? "Touche Terminer à la fin, puis note tes indicateurs" : "";
        cpop.querySelector(".gain-box").classList.toggle("prep", prep);
        cpop.querySelector(".gain-box").classList.toggle("reached", !!c.alerted);
      }
    }
    if (cpill) { cpill.hidden = !here || !c.min; cpill.textContent = (prep ? "Départ dans " + left : (here ? chronoKind(w, c) : c.dist ? "Chrono" : "Gainage") + " " + fmtDur(ms, "down")) + " · Agrandir"; }
  } else {
    if (cpop) cpop.hidden = true;
    if (cpill) cpill.hidden = true;
  }
}
// 4 fois par seconde seulement pendant une séance, un repos ou un chrono (batterie) ; chaque affichage appelle aussi tick()
const tickNeeded = () => { const L = db.live || {}; return !!(L.restEnd || L.chrono || activeWorkout() || document.querySelector("[data-tick]")); };
setInterval(() => { if (tickNeeded()) tick(); }, 250);
// en plus : un rafraîchissement pile au changement de seconde (repos qui descend, chrono qui monte), sans attendre le prochain quart de seconde
let edgeTimer = null;
function armEdge() {
  clearTimeout(edgeTimer); edgeTimer = null;
  const L = db.live || {}, now = Date.now();
  let wait = null;
  if (L.restEnd && L.restEnd > now) wait = (L.restEnd - now) % 1000 || 1000;
  if (L.chrono) { const ms = now - L.chrono.start, w2 = ms < 0 ? (-ms) % 1000 || 1000 : 1000 - (ms % 1000); wait = wait == null ? w2 : Math.min(wait, w2); }
  if (wait != null) edgeTimer = setTimeout(() => { tick(); armEdge(); }, wait + 2);
}
setInterval(() => { const L = db.live || {}; if (!edgeTimer && (L.restEnd || L.chrono)) armEdge(); }, 1000);
// fin du repos : l'appli clignote (sombre / clair, 1 fois par seconde) pendant 5 s avec un message au centre
function restDone() {
  document.querySelectorAll(".restpop.done").forEach(x => x.remove());
  const d = document.createElement("div"); d.className = "restpop done"; d.setAttribute("role", "alert");
  d.innerHTML = '<div class="rp-box"><div class="rp-end">Pause terminée<span class="rp-end2">C\'est reparti 💪</span></div></div>';
  document.body.appendChild(d);
  const close = () => { d.remove(); clearInterval(flashTimer); flashTimer = null; applyTheme(); };
  d.addEventListener("click", close);
  setTimeout(() => { if (d.isConnected) d.remove(); }, 5000);
  clearInterval(flashTimer);
  // pas de clignotement si l'alerte est sur « Aucune » ou si le téléphone demande de réduire les animations : le message reste
  if (settings().alert === "aucune" || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
  const root = document.documentElement; let n = 0;
  flashTimer = setInterval(() => {
    n++; root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    if (n >= 10) { clearInterval(flashTimer); flashTimer = null; applyTheme(); }
  }, 500);
}

/* ================= Actions ================= */
$app.addEventListener("submit", e => {
  const f = e.target.closest("[data-form]"); if (!f) return;
  e.preventDefault();
  if (f.dataset.form === "login") onLogin(f, (e.submitter && e.submitter.value) || loginMode);
  if (f.dataset.form === "verify") onVerify(f);
  if (f.dataset.form === "reset1") onReset1(f);
  if (f.dataset.form === "reset2") onReset2(f);
  if (f.dataset.form === "reset3") onReset3(f);
});

$app.addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  if (Date.now() - lastDragEnd < 400 || e.target.closest("[data-drag]")) return;
  const a = b.dataset.act, i = +b.dataset.i, s = +b.dataset.s;
  const w = currentWorkout();
  switch (a) {
    case "reload": location.hash = "#/home"; location.reload(); break;
    case "histmore": histLimit += 100; render(); break;
    case "swipedel": {
      const x = getItem(b.dataset.id); if (!x) return;
      if (!await ask({ title: "Supprimer cette séance ?", text: x.templateName + " · " + vLabel(x.variantName) + " du " + fmtDate(x.startedAt) + "\nElle disparaîtra de l'historique et des stats.", ok: "Supprimer", danger: true })) { swClose(swOpen); return; }
      remove(x.id); swOpen = null; toast("Séance supprimée"); render();
    } break;
    case "stretchgo": { const ids = String(b.dataset.seq || "").split(",").filter(x => /^[a-z0-9-]{1,60}$/.test(x)); if (ids.length) { exoReturn = location.hash || "#/home"; stretchSeq = ids; go("exercices/" + ids[0]); } break; }
    case "stretchtips": exoReturn = location.hash || "#/home"; stretchSeq = null; break;
    case "stretchok": try { localStorage.setItem("fiitday-stretch-ok", b.dataset.id); } catch (err) { } render(); break;
    case "backuplater": lsSet("fiitday-backup-later", Date.now()); render(); break;
    case "recapok": try { localStorage.setItem("fiitday-recap-ok", b.dataset.id); } catch (err) { } render(); break;
    case "evometric": evo.m[b.dataset.k] = b.dataset.v; render(); break;
    case "evoper": evo.per = b.dataset.v; render(); break;
    case "wok": case "wno": case "wshow": case "wper": case "wsave": case "wdel": case "woff": await weightAction(a, b); break;
    case "exoview": exoReturn = location.hash; go("exercices/" + b.dataset.id + (b.dataset.arg === "cardio" ? "/cardio" : "")); break;
    case "cardiohome": cardioStart(); break;
    case "freestart": freeStart(); break;
    case "addcardio": if (w) { const exs = await cardioPick("Ajouter une machine"); if (!exs) return; w.exercises.push(...exs); if (w.manual) syncManual(w); put("workout", w); render(); } break;
    case "cvdur": if (w && w.exercises[i] && w.exercises[i].sets[s]) {
      const e = w.exercises[i], set = e.sets[s], c = db.live.chrono;
      if (c && c.wid === w.id && c.i === i && c.s === s) { toast("Le chrono tourne : touche « Terminer » d'abord"); return; }
      const val = await pickDuration("Durée · " + e.name, num(set.sec) != null ? set.sec : (num(e.target) || 0) * 60); if (val == null) return;
      set.sec = val > 0 ? String(val) : ""; if (w.manual) syncManual(w);
      put("workout", w); render();
    } break;
    case "cvclock": if (w && w.exercises[i] && w.exercises[i].sets[s]) { // indicateur en temps (temps aux 500 m) : mêmes roues que la durée
      const e = w.exercises[i], set = e.sets[s], k = b.dataset.k, d = cvDef(k); if (!d) return;
      const lp = lastPerf(w, e), pv = lp && lp.e.sets[s] && lp.e.sets[s].cv ? num(lp.e.sets[s].cv[k]) : null, cur = set.cv ? num(set.cv[k]) : null, v0 = Math.round(cur != null ? cur : pv != null ? pv : 120);
      const r = await pickWheels(d.n + " · " + e.name, [{ name: "Minutes", vals: Array.from({ length: 21 }, (_, x) => x), fmt: x => x + " min", value: Math.min(20, Math.floor(v0 / 60)) }, { name: "Secondes", vals: Array.from({ length: 60 }, (_, x) => x), fmt: x => pad(x) + " s", value: v0 % 60 }]);
      if (!r) return; const val = r[0] * 60 + r[1];
      set.cv = Object.assign({}, set.cv); if (val > 0) set.cv[k] = String(val); else delete set.cv[k];
      put("workout", w); render();
    } break;
    case "setpick": if (w && w.exercises[i] && w.exercises[i].sets[s]) {
      const e = w.exercises[i], set = e.sets[s], d = b.dataset.d != null && b.dataset.d !== "" ? +b.dataset.d : null;
      if (d != null) { set.drops = set.drops || []; set.drops[d] = set.drops[d] || { kg: "", reps: "" }; }
      const tgt = d == null ? set : set.drops[d];
      const lp = lastPerf(w, e); let src = lp && lp.e.sets[s]; if (src && d != null) src = src.drops && src.drops[d];
      // valeurs de départ des roues : cette série, la dernière fois, les séries d'avant ; une baisse part de la charge de la série moins 20 %
      const earlier = e.sets.slice(0, s).reverse(), lastSets = lp ? lp.e.sets.slice().reverse() : [];
      const cands = d == null ? [tgt, src].concat(earlier, lastSets) : [tgt, src, d ? set.drops[d - 1] : null];
      const first = f => { for (const o of cands) { const x = o && num(o[f]); if (x != null && (f === "kg" ? x !== 0 : x > 0)) return x; } return null; };
      let k0 = first("kg"), r0 = first("reps");
      if (d != null) { const base = [set].concat(earlier).find(o => num(o.kg)); if (k0 == null && base) k0 = num(base.kg) > 0 ? num(base.kg) * 0.8 : num(base.kg) - 10; /* avec assistance, une baisse = plus d'assistance */ const rb = [set].concat(earlier).find(o => num(o.reps) > 0); if (r0 == null && rb) r0 = num(rb.reps); }
      // la case touchée seulement : les kilos (roues des kilos) ou les répétitions (roue des répétitions)
      const f = b.dataset.f === "kg" ? "kg" : "reps", withKg = f === "kg", withReps = f === "reps";
      const r = await pickSet((withKg ? "Kilos" : "Répétitions") + " · " + e.name + " · série " + (s + 1) + (d != null ? " · baisse " + (d + 1) : ""), withKg ? (k0 != null ? k0 : 20) : null,
        withReps ? (r0 != null ? r0 : num(String(e.target || "").split("-")[0]) || 10) : null);
      if (!r) return;
      if (r.kg != null) tgt.kg = String(r.kg); // 0 kg reste noté « 0 »
      if (r.reps != null) tgt.reps = r.reps > 0 ? String(r.reps) : "";
      put("workout", w); render();
    } break;
    case "cvnum": if (w && w.exercises[i] && w.exercises[i].sets[s]) {
      const e = w.exercises[i], set = e.sets[s], k = b.dataset.k, d = cvDef(k); if (!d) return;
      const lp = lastPerf(w, e), pv = lp && lp.e.sets[s] && lp.e.sets[s].cv ? num(lp.e.sets[s].cv[k]) : null, cur = set.cv ? num(set.cv[k]) : null;
      const val = await pickNumber(d.n + " · " + e.name, cur != null ? cur : pv, CV_W[k] || [2000, 10, 0], d.u); if (val == null) return;
      set.cv = Object.assign({}, set.cv); if (val > 0) set.cv[k] = String(val); else delete set.cv[k];
      put("workout", w); render();
    } break;
    case "cvdist": if (w && w.exercises[i] && w.exercises[i].sets[s]) {
      const e = w.exercises[i], set = e.sets[s], k = b.dataset.k, d = cvDef(k); if (!d) return;
      const lp = lastPerf(w, e), pv = lp && lp.e.sets[s] && lp.e.sets[s].cv ? num(lp.e.sets[s].cv[k]) : null, cur = set.cv ? num(set.cv[k]) : null;
      const val = await pickDistance(d.n + " · " + e.name, cur != null ? cur : pv != null ? pv : 0, d.u); if (val == null) return;
      set.cv = Object.assign({}, set.cv); if (val > 0) set.cv[k] = String(val); else delete set.cv[k];
      put("workout", w); render();
    } break;
    case "distclock": if (w && w.exercises[i] && w.exercises[i].sets[s]) {
      const e = w.exercises[i], set = e.sets[s], c = db.live.chrono;
      if (c && c.wid === w.id && c.i === i && c.s === s) { toast("Le chrono tourne : touche « Terminer » d'abord"); return; }
      const lp = lastPerf(w, e), src = lp && lp.e.sets[s];
      const val = await pickDuration("Temps · " + e.name + " · série " + (s + 1), num(set.sec) != null ? set.sec : src && num(src.sec) != null ? src.sec : 0); if (val == null) return;
      set.sec = val > 0 ? String(val) : ""; put("workout", w); render();
    } break;
    case "wlink": if (w && w.exercises[i] && w.exercises[i + 1]) {
      const e = w.exercises[i], n = w.exercises[i + 1];
      let gid = e.groupId, kind = e.groupKind;
      if (!gid) { kind = await choose("Enchaîner « " + e.name + " » et « " + n.name + " »", ADD_CHOICES.filter(c => c[0] === "superset" || c[0] === "biset")); if (!kind) return; gid = "g-" + uid(); }
      const mem = (e.groupId ? w.exercises.filter(x => x.groupId === gid) : [e]).concat([n]);
      if (mem.length >= 3) kind = "triset";
      const rounds = Math.max(...mem.map(x => x.sets.length)), rest = num(mem[0].rest) || 0;
      const rn = num(n.restNext) || 0; // le repos avant l'exercice suivant : celui du dernier exercice du groupe
      mem.forEach(x => { x.groupId = gid; x.groupKind = kind; x.rest = rest; x.restNext = rn; while (x.sets.length < rounds) x.sets.push(blankSet(0)); });
      put("workout", w); render(); toast((GROUP_LABEL[kind] || "Enchaînement") + " pour cette séance");
    } break;
    case "wungroup": if (w && w.exercises[i] && w.exercises[i].groupId) {
      const gid = w.exercises[i].groupId; w.exercises.forEach(x => { if (x.groupId === gid) { x.groupId = null; x.groupKind = null; } });
      put("workout", w); render();
    } break;
    case "wdelex": if (w && w.exercises[i]) {
      const e = w.exercises[i], noted = e.sets.some(x => x.done || setHasData(x, e.type));
      if (!await ask({ title: "Retirer « " + e.name + " » ?", text: "Il est retiré de cette séance seulement" + (noted ? ", avec les séries déjà notées." : ".") + (getItem(w.templateId) ? " Ton programme ne change pas." : ""), ok: "Retirer", danger: true })) return;
      const c = db.live.chrono;
      if (c && c.wid === w.id) { if (c.i === i) db.live.chrono = null; else if (c.i > i) c.i--; }
      const gid = e.groupId; w.exercises.splice(i, 1);
      if (gid) { const rest = w.exercises.filter(x => x.groupId === gid); if (rest.length < 2) rest.forEach(x => { x.groupId = null; x.groupKind = null; }); else if (rest.length === 2 && rest[0].groupKind === "triset") rest.forEach(x => { x.groupKind = "superset"; }); }
      if (w.manual) syncManual(w);
      put("workout", w); save(); render();
    } break;
    case "cvadd": if (w && w.exercises[i]) {
      const e = w.exercises[i], key = cardioKey(e), list = cardioCustom(key), hid = cardioHidden(key);
      const back = cardioDefs(e).filter(d => hid.includes(d.k) || (d.k === "fc" && !hrOk() && !hasHr(e))); // indicateurs retirés (ou pas encore activés) : on peut les ajouter
      if (back.length) {
        const c = await choose("Ajouter un indicateur", back.map(d => ["k:" + d.k, d.n, d.k === "fc" && !hrOk() ? "Facultatif : demande ton accord" : d.u && d.u !== "niveau" ? d.u : ""]).concat([["new", "+ Créer un indicateur", "Nom et unité de ton choix"]])); if (!c) return;
        if (c !== "new") {
          const k = c.slice(2);
          if (k === "fc" && !hrOk()) {
            // accord exprès, séparé et retirable : la fréquence cardiaque peut être une donnée de santé (art. 9 du RGPD)
            if (!await ask({ title: "Noter ta fréquence cardiaque ?", text: "C'est facultatif. Ta fréquence cardiaque peut renseigner sur ta santé : si tu la notes, elle est enregistrée avec tes séances (et synchronisée entre tes appareils avec Premium), visible de toi seul, jamais partagée ni utilisée pour autre chose, et supprimée avec ton compte. Tu peux retirer ton accord quand tu veux (« × » sur l'indicateur, puis « Retirer mon accord ») : tes valeurs déjà notées sont alors effacées.", ok: "J'accepte de la noter", cancel: "Non merci" })) return;
            setSetting("hrOk", new Date().toISOString());
          }
          setCardioHidden(key, hid.filter(x => x !== k)); render(); return;
        }
      }
      if (list.length >= CARDIO_MAX_OWN) { toast(CARDIO_MAX_OWN + " indicateurs perso au plus par machine"); return; }
      const r = await askIndicator(e.name); if (!r) return;
      if (cardioDefs(e).some(d => norm(d.n) === norm(r.n) && norm(d.u) === norm(r.u))) { toast("Cet indicateur existe déjà pour « " + e.name + " »"); return; }
      const st = settings(), cc = Object.assign({}, st.cardioCustom); cc[key] = list.concat([{ k: "c" + uid(), n: r.n, u: r.u }]); st.cardioCustom = cc; put("settings", st);
      render();
    } break;
    case "cvdel": if (w && w.exercises[i]) { // retiré de la carte (pour cette machine) ; il reste dans « + Ajouter un indicateur » et ses valeurs restent dans tes séances
      const e = w.exercises[i], key = cardioKey(e), d = cardioDefs(e).find(x => x.k === b.dataset.k); if (!d) return;
      // fréquence cardiaque : « × » retire l'accord et efface les valeurs déjà notées, dans toutes les séances
      const n = d.k === "fc" ? hrCount(all("workout")) : 0;
      if (d.k === "fc" && (hrOk() || n)) {
        // deux choix : masquer pour cette machine (accord et valeurs gardés), ou retirer l'accord et effacer les valeurs
        const vals = n > 1 ? "les " + n + " valeurs déjà notées sont effacées" : "la valeur déjà notée est effacée";
        const c = await choose("Fréquence cardiaque", [
          ["hide", "Masquer seulement", "Pour « " + e.name + " » ; " + (hrOk() ? "ton accord et tes valeurs sont gardés" : "tes valeurs sont gardées") + ". Tu peux la réafficher avec « + Ajouter un indicateur »."],
          ["erase", n > 1 ? "Retirer mon accord et effacer mes " + n + " valeurs" : n ? "Retirer mon accord et effacer ma valeur" : "Retirer mon accord",
            "Elle n'est plus proposée" + (n ? ", et " + vals + " de toutes tes séances (aussi sur tes autres appareils, à la prochaine synchronisation)" : "") + ". Tu pourras redonner ton accord plus tard."]
        ], "Que veux-tu faire ?");
        if (!c) return;
        if (c === "hide") {
          const hid = cardioHidden(key); if (!hid.includes(d.k)) setCardioHidden(key, hid.concat([d.k]));
          toast("Fréquence cardiaque masquée pour « " + e.name + " »"); render(); return;
        }
        eraseHr();
        const hid = cardioHidden(key); if (!hid.includes(d.k)) setCardioHidden(key, hid.concat([d.k]));
        const st = settings(); st.hrOk = null; st.hrGoneAt = new Date().toISOString(); put("settings", st);
        toast(n ? "Accord retiré : " + (n > 1 ? n + " valeurs effacées" : "1 valeur effacée") + " de tes séances" : "Accord retiré : la fréquence cardiaque ne sera plus proposée");
        render(); return;
      }
      const hid = cardioHidden(key); if (!hid.includes(d.k)) setCardioHidden(key, hid.concat([d.k]));
      render();
    } break;
    case "sesspick": if (w) {
      const e = w.exercises[i]; if (!e) return;
      const sf = b.dataset.sf, isT = sf === "target", isN = sf === "next";
      const members = sf === "grest" || (isN && e.groupId) ? w.exercises.filter(x => x.groupId && x.groupId === e.groupId) : [e];
      const val = await pickSeconds(isT ? "Objectif de gainage" : isN ? "Repos avant l'exercice suivant · " + (e.groupId ? (GROUP_LABEL[e.groupKind] || "Enchaînement") : e.name) : sf === "grest" ? "Repos après chaque tour" : "Temps de repos",
        isT ? e.target : isN ? (restNextVal(members) || num(w.restBetween) || 0) : e.rest, isT ? 5 : 0, isT ? 600 : 1200);
      if (val == null) return;
      const t = getItem(w.templateId), v = t && t.variants.find(x => x.id === w.variantId);
      const inTpl = v && members.some(x => v.exercises.some(y => y.id === x.exId));
      let scope = "today";
      if (inTpl) { scope = await choose("Ce changement est pour…", [["today", "Seulement aujourd'hui", "Pour cette séance uniquement"], ["always", "Toutes les séances", "Enregistré aussi dans « " + w.templateName + " · " + vLabel(w.variantName) + " »"]]); if (!scope) return; }
      const setF = x => { if (isT) x.target = String(val); else if (isN) x.restNext = val; else x.rest = val; };
      members.forEach(setF);
      put("workout", w);
      if (scope === "always") {
        members.forEach(x => { const te = v.exercises.find(y => y.id === x.exId); if (te) { setF(te); if (isN && te.groupId) v.exercises.forEach(y => { if (y.groupId === te.groupId) y.restNext = val; }); } });
        put("template", t);
      }
      render(); toast((isT ? "Objectif : " : isN ? "Avant l'exercice suivant : " : "Repos : ") + (val ? fmtSecs(val) : "aucun") + (scope === "always" ? " · pour toutes les séances" : " · aujourd'hui"));
    } break;
    /* connexion */
    case "loginmode": { const em = $app.querySelector('input[name="email"]'); if (em) loginEmail = em.value; const fn = $app.querySelector('input[name="firstname"]'); if (fn) loginName = fn.value; loginMode = b.dataset.m === "up" ? "up" : "in"; render(); const f = $app.querySelector(loginEmail ? 'input[name="password"]' : 'input[name="email"]'); if (f) f.focus(); } break;
    case "tologin": db.mode = null; saveNow(); render(); break;
    case "changemail": db.verify = null; saveNow(); render(); break;
    case "forgot": { const em = $app.querySelector('input[name="email"]'); resetEmail = em ? em.value.trim() : ""; resetStep = "email"; render(); } break;
    case "resetback": resetStep = null; render(); break;
    case "resetresend": try { await authReq("recover", { email: resetEmail }); toast("Nouveau code envoyé"); } catch (err) { toast(authMessage(err)); } break;
    case "resend": {
      const msg = $app.querySelector("[data-msg]");
      try { await authReq("resend", { type: "signup", email: db.verify }); msg.className = "msg"; msg.textContent = "Nouveau code envoyé à " + db.verify + "."; }
      catch (err) { msg.className = "msg err"; msg.textContent = authMessage(err); }
    } break;
    case "logout": {
      const local = isFree(); // version gratuite (mode test « essai terminé » compris) : pas de synchro, les données ne sont que sur cet appareil
      if (!await ask({ title: "Se déconnecter ?", text: local ? "En version gratuite, tes données ne sont enregistrées que sur cet appareil. Elles y restent gardées et reviendront quand tu te reconnecteras ici (pas sur un autre appareil)." : "Tes données restent enregistrées dans ton compte. Elles seront effacées de cet appareil.", ok: "Se déconnecter", danger: true })) return;
      flushPending(); await syncIdle();
      if (!local) { await sync(); await syncIdle(); }
      if (!db.auth) return;
      const uid = db.auth.user.id;
      if (local) { if (keepAside(uid, true) < 0 && !await ask({ title: "Stockage plein", text: "Tes données n'ont pas pu être gardées sur cet appareil : elles seront perdues. Annule et fais d'abord une sauvegarde (Réglages › Données).", ok: "Se déconnecter quand même", danger: true })) return; }
      else {
        const left = Object.values(db.items).filter(x => x.dirty).length;
        if (left) {
          const c = await choose("Modifications pas encore envoyées", [["keep", "Les garder sur cet appareil", "Elles partiront sur ton compte à ta prochaine connexion ici"], ["erase", "Les effacer", "Elles seront perdues"]],
            (left > 1 ? left + " modifications n'ont" : "Une modification n'a") + " pas encore pu être envoyée" + (left > 1 ? "s" : "") + " (pas de réseau ?).");
          if (!c) return;
          if (c === "keep" && keepAside(uid, false) < 0 && !await ask({ title: "Stockage plein", text: "Les modifications n'ont pas pu être gardées : elles seront perdues.", ok: "Se déconnecter quand même", danger: true })) return;
        }
      }
      billingLogout(); db = emptyDb(); dataRev++; saveNow(); restart("#/home"); break;
    }
    case "delaccount": {
      const pre = await deleteWarnings();
      if (pre.stop) {
        const play = pre.stop === "play";
        const c = await choose("Ton abonnement est toujours actif", [["manage", play ? "Résilier dans Google Play" : "Résilier mon abonnement", play ? "Supprimer ton compte n'arrête pas les paiements Google Play : résilie d'abord" : "Choisis la date de fin, avec le remboursement de la part non utilisée si tu arrêtes tout de suite"],
          ["go", "Supprimer quand même", play ? "Les paiements Google Play continueront tant que tu n'auras pas résilié" : "Ton abonnement par carte sera résilié tout de suite : plus aucun prélèvement, la part non utilisée t'est remboursée"]]);
        if (!c) return;
        if (c === "manage") { if (play) openOut(PLAY_SUBS); else go("resilier"); return; }
      }
      const conf = await ask({ title: "Supprimer ton compte ?", text: "Ton compte et toutes tes données (programmes, séances, historique, séances partagées) seront définitivement effacés : tout de suite sur le serveur et sur cet appareil, et sur tes autres appareils dès leur prochaine ouverture avec Internet. Cette action est irréversible." + (pre.w.length ? "\n\n" + pre.w.map(x => "• " + x).join("\n") : "") + "\n\nTape SUPPRIMER pour confirmer.", input: "", ok: "Supprimer définitivement", danger: true });
      if (conf == null) return;
      if (conf.trim().toUpperCase() !== "SUPPRIMER") { toast("Suppression annulée : tape SUPPRIMER pour confirmer"); return; }
      try {
        await deleteAccountSrv();
      } catch (err) {
        toast(err.srv && frTxt(err.srv) ? err.srv : /abonnement/i.test(err.message || "") ? "Ton abonnement par carte n'a pas pu être arrêté : résilie-le d'abord (Réglages › Tes achats Premium), puis supprime ton compte." : err.status === 404 ? "Suppression indisponible pour le moment. Écris-nous à contact@fiitday.com." : (err.message === "Failed to fetch" ? "Pas de connexion internet" : "La suppression a échoué, réessaie"));
        return;
      }
      const gone = db.auth && db.auth.user.id;
      await syncIdle();
      billingLogout(); db = emptyDb(); dataRev++; saveNow();
      try { if (gone) localStorage.removeItem(asideKey(gone)); } catch (e) { }
      try { sessionStorage.setItem("fiitday-msg", "Ton compte a été supprimé"); } catch (e) { }
      restart("#/home");
    } break;
    case "syncnow": flushPending(); await sync(); if (syncState.status === "ok") toast("Synchronisé"); break;

    /* accueil */
    case "start": startWorkout(b.dataset.t, b.dataset.v); break;

    /* séance */
    case "done": if (w) markDone(w, i, s); break;
    case "wdrop": if (w && (w.exercises[i] || b.dataset.g)) {
      let wi = i;
      if (b.dataset.g) { // dans un enchaînement : sur quel exercice ?
        const g = b.dataset.g.split(",").map(Number).filter(k => w.exercises[k]);
        const k0 = w.exercises.findIndex(x => x === w.exercises[g[0]]), grp = w.exercises.filter(x => x.groupId && x.groupId === w.exercises[g[0]].groupId);
        const letter = k => LETTERS[Math.max(0, grp.indexOf(w.exercises[k]))];
        if (g.length > 1) { const c = await choose("Dégressif sur quel exercice ?", g.map(k => { const d = dropsOf(w.exercises[k]); return [String(k), letter(k) + ". " + w.exercises[k].name, d ? "Dégressif : " + d + " baisse" + (d > 1 ? "s" : "") : "Pas de dégressif"]; })); if (!c) return; wi = +c; }
        else wi = g[0];
        if (k0 < 0) return;
      }
      const e = w.exercises[wi], cur = dropsOf(e), last = e.dropScope === "last";
      const opts = cur ? [["more", "Ajouter une baisse", (cur + 1) + " baisses " + (last ? "sur la dernière série" : "après chaque série")], ["off", "Retirer le dégressif", "Les baisses déjà validées restent notées"]].filter(o => o[0] !== "more" || cur < 3)
        : [["all", "Sur chaque série", "Une baisse de charge juste après chaque série"], ["last", "Sur la dernière série", "Une baisse seulement après la dernière série"]];
      const c = await choose(cur ? "Dégressif · " + cur + " baisse" + (cur > 1 ? "s" : "") + (last ? " sur la dernière série" : " après chaque série") : "Ajouter un dégressif", opts); if (!c) return;
      const n = c === "off" ? 0 : c === "more" ? cur + 1 : 1, scope = c === "all" || c === "last" ? c : (last ? "last" : "all");
      const t = getItem(w.templateId), te = !w.endedAt && t ? tplExercise(w, e.exId) : null;
      let where = "today";
      if (te) { where = await choose("Ce changement est pour…", [["today", "Seulement aujourd'hui", "Pour cette séance uniquement"], ["always", "Toutes les séances", "Enregistré aussi dans « " + w.templateName + " · " + vLabel(w.variantName) + " »"]]); if (!where) return; }
      applyDrops(e, n, scope); put("workout", w);
      if (where === "always") { te.drops = n; te.dropScope = scope; put("template", t); }
      render(); toast(n ? "Dégressif : " + n + " baisse" + (n > 1 ? "s" : "") + (scope === "last" ? " sur la dernière série" : " après chaque série") : "Dégressif retiré");
    } break;
    case "addset": if (w) {
      b.dataset.g.split(",").map(Number).forEach(k => {
        const ex = w.exercises[k];
        if (ex.dropScope === "last" && dropsOf(ex)) {
          // la nouvelle série devient la dernière : elle reçoit les baisses, l'ancienne les perd si elles sont vides
          const prev = ex.sets[ex.sets.length - 1];
          if (prev && !prev.done && !(prev.drops || []).some(d => setHasData(d, ex.type))) prev.drops = [];
        }
        ex.sets.push(blankSet(dropsOf(ex)));
      });
      put("workout", w); render();
    } break;
    case "delset": if (w) {
      b.dataset.g.split(",").map(Number).forEach(k => {
        const ex = w.exercises[k]; if (ex.sets.length <= 1) return;
        ex.sets.pop();
        const last = ex.sets[ex.sets.length - 1];
        if (ex.dropScope === "last" && dropsOf(ex) && !(last.drops || []).length) last.drops = blankSet(dropsOf(ex)).drops;
      });
      put("workout", w); render();
    } break;
    case "rename": if (w) {
      const ex = w.exercises[i];
      const n = await askRename(ex.name);
      if (!n || n === ex.name) return;
      const t = getItem(w.templateId), te = tplExercise(w, ex.exId), sw = isSwitch(ex, n);
      applyName(ex, n, sw, false);
      if (t && te) { applyName(te, n, sw, true); if (sw) { te.id = "e-" + uid(); ex.exId = te.id; } put("template", t); }
      else if (sw) ex.exId = "e-" + uid();
      put("workout", w); render();
    } break;
    case "cfgrename": {
      const { t, v } = currentProgram(); if (!v) return;
      const ex = v.exercises[+b.dataset.e]; if (!ex) return;
      const n = await askRename(ex.name);
      if (!n || n === ex.name) return;
      const sw = isSwitch(ex, n); applyName(ex, n, sw, true); if (sw) ex.id = "e-" + uid();
      put("template", t); render();
    } break;
    case "addex": case "sessstretch": if (w) {
      const etir = a === "sessstretch", what = etir ? "étirement" : "exercice";
      const picks = await pickExercises(etir ? "etir" : "muscu", etir ? "Ajouter des étirements" : "Ajouter des exercices"); if (!picks) return;
      const conv = await picksToSession(picks); if (!conv) return;
      const { tes, wnew } = conv;
      const c = db.live.chrono, chronoEx = c && c.wid === w.id ? w.exercises[c.i] : null;
      const out = await orderNew(w.exercises, wnew, what); if (!out) return;
      const add = getItem(w.templateId) && await ask({ title: tes.length > 1 ? "Les ajouter au programme ?" : "L'ajouter au programme ?", text: (tes.length > 1 ? "Les ajouter" : "L'ajouter") + " aussi à « " + w.templateName + " · " + vLabel(w.variantName) + " », au même endroit, pour les prochaines fois ?", ok: "Oui", cancel: "Juste aujourd'hui" });
      w.exercises = out;
      if (chronoEx && db.live.chrono) db.live.chrono.i = out.indexOf(chronoEx); // le chrono en cours suit son exercice
      if (add) {
        const t = getItem(w.templateId), v = t && t.variants.find(x => x.id === w.variantId);
        if (v) {
          // chaque nouvel exercice va juste après l'exercice qui le précède dans la séance (après tout son groupe)
          let at = -1;
          out.forEach(we => {
            const k = wnew.indexOf(we);
            if (k >= 0) { v.exercises.splice(at + 1, 0, tes[k]); at++; return; }
            const ti = v.exercises.findIndex(x => x.id === we.exId); if (ti < 0) return;
            at = ti; const g = v.exercises[ti].groupId; if (g) while (v.exercises[at + 1] && v.exercises[at + 1].groupId === g) at++;
          });
          put("template", t);
        }
      }
      put("workout", w); save(); render();
    } break;
    case "chronostop": if (w) { stopChrono(w); save(); render(); } break;
    case "chronocancel": db.live.chrono = null; save(); render(); break;
    case "chronomin": if (db.live.chrono) { db.live.chrono.min = true; save(); tick(); } break;
    case "chronomax": if (db.live.chrono) { db.live.chrono.min = false; save(); tick(); } break;
    case "chrono": if (w) {
      const c = db.live.chrono;
      if (c && c.wid === w.id && c.i === i && c.s === s) {
        stopChrono(w);
      } else {
        // 5 s de préparation avant que le chrono de gainage ne démarre (pas pour le repos)
        const cx = w.exercises[i], isD = cx.type === "dist", isC = cx.type === "cardio";
        db.live.chrono = { wid: w.id, i, s, start: Date.now() + CHRONO_PREP * 1000, target: isC ? Math.round((num(cx.target) || 0) * 60) : isD ? 0 : num(cx.target), dist: isD ? num(cx.target) : 0, cardio: isC || undefined, alerted: false, count: CHRONO_PREP + 1, go: false };
        db.live.restEnd = null; setTimeout(armEdge, 0);
      }
      save(); render();
    } break;
    case "skiprest": db.live.restEnd = null; db.live.restMin = false; save(); tick(); break;
    case "restadd": if (db.live.restEnd) { const d = +b.dataset.v * 1000; db.live.restEnd = Math.max(Date.now() + 1000, db.live.restEnd + d); db.live.restTotal = Math.max(1000, (db.live.restTotal || 0) + d); save(); tick(); } break;
    case "restmin": db.live.restMin = true; save(); tick(); break;
    case "restmax": db.live.restMin = false; save(); tick(); break;
    case "finish": if (w) {
      flushPending();
      // exercices sans aucune série validée : on le signale (terminer trop tôt par erreur)
      const empty = w.exercises.filter(e => !e.sets.some(st => st.done)).map(e => e.name);
      const warn = empty.length ? (empty.length === 1 ? "« " + empty[0] + " » n'a aucune série validée. " : empty.length + " exercices n'ont aucune série validée : " + empty.slice(0, 3).join(", ") + (empty.length > 3 ? " et " + (empty.length - 3) + " autre" + (empty.length > 4 ? "s" : "") : "") + ". ") : "";
      if (!await ask({ title: "Terminer la séance ?", text: warn + "Elle sera enregistrée dans ton historique.", ok: "Terminer" })) return;
      finishWorkout(getItem(w.id));
    } break;
    case "cancel": if (w) {
      if (!await ask({ title: "Annuler la séance ?", text: "Elle ne sera pas enregistrée.", ok: "Annuler la séance", cancel: "Continuer" })) return;
      remove(w.id); db.live = {}; save(); go("home");
    } break;
    case "delworkout": if (w) {
      if (!await ask({ title: "Supprimer cette séance ?", text: "Elle disparaîtra de l'historique.", ok: "Supprimer", danger: true })) return;
      remove(w.id);
      if (route().name === "history") { if (route().args[0]) window.__navPane("#/history"); else render(); }
      // page de la séance : on revient à la page d'où l'on venait (la séance supprimée ne reste pas derrière le bouton Retour)
      else if ((history.state || {}).prev) history.back(); else window.__navReplace("#/history");
    } break;

    /* programmes */
    case "newtpl": {
      if (isFree() && templates().length >= 1) { premiumGate("En version gratuite, tu as 1 programme."); return; }
      const n = await ask({ title: "Nouveau programme", input: "", ok: "Créer" });
      if (!n) return;
      const t = { id: "tpl-" + uid(), name: n.slice(0, 60), order: templates().length, variants: [] }; // aucune séance par défaut : l'utilisateur ajoute la première avec « + Nouvelle séance »
      put("template", t); go("program/" + t.id);
    } break;
    case "picksec": {
      const { t, v } = currentProgram(); if (!v) return;
      const ex = v.exercises[+b.dataset.e]; if (!ex) return;
      if (b.dataset.sf === "next") {
        const val = await pickSeconds("Repos avant l'exercice suivant", restNextOf(ex, v), 0, 1200);
        if (val == null) return;
        v.exercises.forEach(x => { if (x === ex || (ex.groupId && x.groupId === ex.groupId)) x.restNext = val; });
        put("template", t); render(); return;
      }
      if (b.dataset.sf === "sets" || b.dataset.sf === "gsets") {
        const g = b.dataset.sf === "gsets", r = await pickWheels(g ? "Tours" : "Séries · " + ex.name, [{ vals: rng(20).map(x => x + 1), fmt: x => x + (g ? " tour" : " série") + (x > 1 ? "s" : ""), value: Math.min(20, Math.max(1, num(ex.sets) || 1)) }]);
        if (!r) return;
        v.exercises.forEach(x => { if (x === ex || (g && ex.groupId && x.groupId === ex.groupId)) x.sets = r[0]; });
        put("template", t); render(); return;
      }
      if (b.dataset.sf === "reps") { // une cible (12) ou une fourchette (8 à 10)
        const m = String(ex.target || "").match(/^(\d+)(?:\s*-\s*(\d+))?$/), lo = m ? +m[1] : 8, hi = m ? (m[2] ? +m[2] : 0) : 10;
        const r = await pickWheels("Reps cible · " + ex.name, [{ label: "De", vals: rng(50).map(x => x + 1), fmt: String, value: Math.min(50, Math.max(1, lo)) }, { label: "À", vals: rng(51), fmt: x => (x ? "à " + x : "—"), value: Math.min(50, hi) }]);
        if (!r) return;
        ex.target = r[1] > r[0] ? r[0] + "-" + r[1] : String(r[0]); put("template", t); render(); return;
      }
      if (b.dataset.sf === "dtarget") {
        const val = await pickDistance("Distance · " + ex.name, num(ex.target) || 1000, "m"); if (val == null) return;
        if (val > 0) ex.target = String(val); put("template", t); render(); return;
      }
      if (b.dataset.sf === "ctarget") {
        const r = await pickWheels("Durée cible · " + ex.name, [{ vals: Array.from({ length: 181 }, (_, k) => k), fmt: x => (x ? x + " min" : "Aucune"), value: Math.min(180, Math.round(num(ex.target) || 0)) }]);
        if (!r) return; ex.target = r[0] ? String(r[0]) : ""; put("template", t); render(); return;
      }
      const sf = b.dataset.sf, isTarget = sf === "target";
      const val = await pickSeconds(isTarget ? "Temps cible" : sf === "grest" ? "Repos" : "Temps de repos", isTarget ? ex.target : ex.rest, isTarget ? 5 : 0, isTarget ? 600 : 1200);
      if (val == null) return;
      if (isTarget) ex.target = String(val);
      else if (sf === "rest") ex.rest = val;
      else v.exercises.forEach(x => { if (x.groupId && x.groupId === ex.groupId) x.rest = val; });
      put("template", t); render();
    } break;
    case "fold": { const k = b.dataset.k; if (folded.has(k)) folded.delete(k); else folded.add(k); render(); } break;
    case "foldall": { const { v } = currentProgram(); if (!v) return; blocks(v.exercises).forEach(x => { const k = "t:" + (x.groupId || x.items[0].e.id); if (b.dataset.v === "1") folded.add(k); else folded.delete(k); }); render(); } break;
    case "statm": statsMetric = ["n", "time", "ton"].includes(b.dataset.v) ? b.dataset.v : "n"; render(); break;
    case "tab": { const { t } = currentProgram(); if (t) go("program/" + t.id + "/" + b.dataset.v); } break;
    case "homeaddvar": { const t = getItem(b.dataset.t); if (!t) return; if (isFree() && (progLocked(t.id) || t.variants.length >= FREE_VARIANTS)) { premiumGate("En version gratuite, un programme a 2 séances actives au plus."); return; } const v = { id: "v" + uid(), name: "Séance " + (t.variants.length + 1), exercises: [] }; t.variants.push(v); put("template", t); go("program/" + t.id + "/" + v.id); } break;
    case "proglevel": progLevel = PRESETS[b.dataset.val] ? b.dataset.val : "debutant"; render(); break;
    case "presetadd": { const ps = presetByKey(b.dataset.k); if (ps) addPresets([ps], (PRESETS[progLevel] || PRESETS.debutant).label + " · " + ps.name); } break;
    case "presetall": { const lv = PRESETS[progLevel] || PRESETS.debutant, cat = b.dataset.cat === "circuit" ? "circuit" : "muscu"; addPresets(lv[cat], lv.label + " · " + (cat === "circuit" ? "Circuit training" : "Musculation")); } break;
    case "addvar": { const { t } = currentProgram(); if (!t) return; if (isFree() && (progLocked(t.id) || t.variants.length >= FREE_VARIANTS)) { premiumGate("En version gratuite, un programme a 2 séances actives au plus."); return; } const v = { id: "v" + uid(), name: "Séance " + (t.variants.length + 1), exercises: [] }; t.variants.push(v); put("template", t); go("program/" + t.id + "/" + v.id); } break;
    case "dupvar": {
      const { t, v } = currentProgram(); if (!v) return;
      const dest = await choose("Dupliquer « " + vLabel(v.name) + " » dans…", templates().map(x => [x.id, x.name + (x.id === t.id ? " (ce programme)" : ""), x.variants.length + " séance" + (x.variants.length > 1 ? "s" : "")]));
      if (!dest) return;
      const to = getItem(dest); if (!to) return;
      if (isFree() && (progLocked(to.id) || to.variants.length >= FREE_VARIANTS)) { premiumGate("En version gratuite, un programme a 2 séances actives au plus."); return; }
      const gmap = {};
      const copy = v.exercises.map(e => { const c = Object.assign({}, e, { id: "e-" + uid() }); if (e.groupId) c.groupId = gmap[e.groupId] = gmap[e.groupId] || "g-" + uid(); return c; });
      let name = vLabel(v.name);
      if (to.variants.some(x => vLabel(x.name) === name)) name += " (copie)";
      const c = { id: "v" + uid(), name, exercises: copy };
      to.variants.push(c); put("template", to);
      toast("Séance dupliquée dans « " + to.name + " »"); go("program/" + to.id + "/" + c.id);
    } break;
    case "delvar": { const { t, v } = currentProgram(); if (!v) return; if (!await ask({ title: "Supprimer « " + vLabel(v.name) + " » ?", text: "L'historique des séances déjà faites est conservé.", ok: "Supprimer", danger: true })) return; t.variants = t.variants.filter(x => x !== v); put("template", t); go("program/" + t.id); } break;
    case "addtplex": case "addstretch": {
      const { t, v } = currentProgram(); if (!v) return;
      const etir = a === "addstretch", what = etir ? "étirement" : "exercice";
      const picks = await pickExercises(etir ? "etir" : "muscu", etir ? "Ajouter des étirements" : "Ajouter des exercices"); if (!picks) return;
      const out = await orderNew(v.exercises, picks.map(libExercise), what); if (!out) return;
      v.exercises = out; cleanGroups(v); put("template", t); render();
      toast(picks.length > 1 ? picks.length + " " + what + "s ajoutés" : (etir ? "Étirement ajouté" : "Exercice ajouté"));
    } break;
    case "addmember": {
      const { t, v } = currentProgram(); if (!v) return;
      const f = v.exercises[+b.dataset.e]; if (!f || !f.groupId) return;
      const names = await askNames("Ajouter au " + (GROUP_LABEL[f.groupKind] || "groupe").toLowerCase(), 1); if (!names) return;
      if (isFree() && !libFor(names[0]) && !knownNames().some(n => norm(n) === norm(names[0])) && ownCount() >= FREE_OWN) { premiumGate("En version gratuite, tu peux créer " + FREE_OWN + " exercices perso. Choisis un exercice de la liste, ou un de tes exercices."); return; }
      const last = v.exercises.reduce((m, e, k) => e.groupId === f.groupId ? k : m, -1);
      v.exercises.splice(last + 1, 0, Object.assign(newExercise(), { name: names[0], groupId: f.groupId, groupKind: f.groupKind, sets: f.sets, rest: f.rest }));
      cleanGroups(v); put("template", t); render();
    } break;
    case "link": {
      const { t, v } = currentProgram(); if (!v) return;
      const bl = blocks(v.exercises), bi = +b.dataset.b; if (!bl[bi] || !bl[bi + 1]) return;
      const kind = await choose("Enchaîner les deux exercices", ADD_CHOICES.filter(c => c[0] === "superset" || c[0] === "biset")); if (!kind) return;
      const a1 = bl[bi].items[0].e, a2 = bl[bi + 1].items[0].e, gid = "g-" + uid();
      const rn = a2.restNext; // repos avant l'exercice suivant : celui du 2e exercice (le dernier du groupe)
      [a1, a2].forEach(e => { e.groupId = gid; e.groupKind = kind; e.sets = a1.sets; e.rest = a1.rest; if (rn != null) e.restNext = rn; else delete e.restNext; });
      put("template", t); render();
    } break;
    case "ungroup": {
      const { t, v } = currentProgram(); if (!v) return;
      const f = v.exercises[+b.dataset.e]; if (!f || !f.groupId) return;
      const gid = f.groupId; v.exercises.forEach(e => { if (e.groupId === gid) { delete e.groupId; delete e.groupKind; } });
      put("template", t); render();
    } break;
    case "delgroup": {
      const { t, v } = currentProgram(); if (!v) return;
      const f = v.exercises[+b.dataset.e]; if (!f || !f.groupId) return;
      if (!await ask({ title: "Supprimer ce " + (GROUP_LABEL[f.groupKind] || "groupe").toLowerCase() + " ?", text: "Tous ses exercices seront retirés de la séance.", ok: "Supprimer", danger: true })) return;
      const gid = f.groupId; v.exercises = v.exercises.filter(e => e.groupId !== gid);
      put("template", t); render();
    } break;
    case "delex": { const { t, v } = currentProgram(); if (!v) return; const ex = v.exercises[+b.dataset.e]; if (!await ask({ title: (ex.groupId ? "Retirer" : "Supprimer") + " « " + ex.name + " » ?", ok: ex.groupId ? "Retirer" : "Supprimer", danger: true })) return; v.exercises.splice(+b.dataset.e, 1); cleanGroups(v); put("template", t); render(); } break;
    case "sharevar": { const { t, v } = currentProgram(); if (!v) return; if (isFree()) { premiumGate("En version gratuite, tu peux recevoir des séances, mais pas partager les tiennes."); return; } shareVariant(t, v); } break;
    case "freepick": changeActive(b.dataset.t, b.dataset.v); break;
    case "freereset": if (planTesting()) { setSetting("freeActive", Object.assign({}, settings().freeActive || {}, { at: 0 })); toast("Mode test : changement de séances actives possible tout de suite"); } break;
    case "plantest": {
      if (!isPlanTester()) return;
      const val = b.dataset.val || "";
      db.planTest = val; if (val === "trial") db.planTestEnd = Date.now() + TRIAL_DAYS * DAY; saveNow(); render(); sync();
      toast(val === "trial" ? "Mode test : essai en cours (30 jours)" : val === "free" ? "Mode test : essai terminé, version gratuite" : val === "premium" ? "Mode test : abonné Premium" : val === "family" ? "Mode test : abonné Premium Famille" : "Mode test désactivé");
    } break;
    case "plantestskip": if (planTesting()) { db.planTestEnd = (db.planTestEnd || Date.now()) - 7 * DAY; saveNow(); render(); toast(trialLeft() ? "Encore " + trialLeft() + " jour" + (trialLeft() > 1 ? "s" : "") + " d'essai" : "Essai terminé : version gratuite"); } break;
    case "planbuy": {
      if (buyState(planState()) !== "ok") { toast("Le paiement arrive bientôt"); break; }
      if (!db.auth) { toast("Connecte-toi d'abord : l'achat est lié à ton compte"); break; }
      if (buying) break;
      if (!premiumConsent) { toast("Coche la case au-dessus du bouton pour continuer"); const cb = document.querySelector('[data-act="planconsent"]'); if (cb) { cb.focus(); cb.closest(".plan-consent").classList.add("need"); } break; }
      const pid = PRODUCTS[premiumFor][premiumPick];
      // la demande cochée est gardée sur le serveur (preuve, et rappel dans l'e-mail de confirmation de la commande)
      try { const c = await rpc("record_purchase_consent", { p_product: pid, p_text: consentText() }); if (c && c.ok === false) throw new Error("refus"); }
      catch (e) { toast("Connexion au serveur impossible : réessaie dans un instant"); break; }
      if (isPlanTester() && billingMode() === "test") { try { await rpc("open_test_purchases"); } catch (e) { } } // achats de test acceptés 2 h par le serveur
      buying = true; render();
      const r = Native ? await billingCall("billingBuy", db.auth.user.id, pid, premiumPick !== "life") : await webBuy(pid);
      buying = false; render();
      if (r.st === "cancel") { toast("Achat annulé"); break; }
      if (r.st !== "ok") { if (r.txt) console.warn("achat :", r.txt); toast("L'achat n'a pas abouti" + (frTxt(r.txt) ? " : " + r.txt : ". Réessaie dans un instant ; si cela continue, écris-nous à contact@fiitday.com.")); break; }
      premiumConsent = false; // un autre achat demandera un nouvel accord
      const offTest = planTestOff(); // le mode test (simulation) cacherait le vrai achat
      toast(offTest ? (billingMode() === "test" ? "Achat de test réussi · " : "Merci ! ") + "Mode test désactivé pour afficher ton achat" : billingMode() === "test" ? "Achat de test réussi, Premium arrive…" : "Merci ! Premium arrive…");
      toast(await waitPlan() ? "Premium est activé sur ton compte" : "Achat enregistré : Premium s'affichera d'ici quelques minutes");
      render();
    } break;
    case "planrestore": {
      if (!billingMode() || !Native || !db.auth) { toast("Connecte-toi d'abord"); break; }
      const r = await billingCall("billingRestore", db.auth.user.id);
      if (r.st !== "ok") { toast("Restauration impossible" + (r.txt ? " : " + r.txt : "")); break; }
      toast(r.txt ? (planTestOff() ? "Achats retrouvés · Mode test désactivé pour les afficher" : "Achats retrouvés, mise à jour…") : "Aucun achat trouvé sur ce compte Google");
      if (r.txt) { await waitPlan(); render(); }
    } break;
    case "adminload": if (route().args[0] === "recettes") { ledgerErr = ""; loadLedger(true); } else if (route().args[0] === "abonnements") { adminSubsErr = ""; loadAdminSubs(true); } else { adminErr = ""; loadAdmin(true); } break;
    case "giftopt": { document.querySelectorAll("[data-gf]").forEach(x => { giftForm[x.dataset.gf] = x.value; }); giftForm[b.dataset.k] = b.dataset.v; render(); } break;
    case "giftsend": {
      document.querySelectorAll("[data-gf]").forEach(x => { giftForm[x.dataset.gf] = x.value; });
      const em = String(giftForm.email || "").trim(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { toast("Indique l'e-mail du compte"); return; }
      const dl = (GIFT_DAYS.find(x => x[0] === giftForm.days) || GIFT_DAYS[0])[1];
      if (!await ask({ title: "Offrir Premium " + (giftForm.kind === "family" ? "Famille" : "Solo") + " ?", text: "À " + em + ", " + (giftForm.days ? "pendant " + dl : "à vie") + ".", ok: "Offrir" })) return;
      try { const r = await rpc("admin_gift", { p_email: em, p_kind: giftForm.kind, p_days: giftForm.days ? +giftForm.days : null, p_note: giftForm.note || "" }); const den = admDenied(r); if (den) { adminSubsErr = den; render(); return; } }
      catch (err) { toast(famErr(err)); return; }
      giftForm = { kind: giftForm.kind, days: giftForm.days }; toast("Premium offert à " + em); loadAdminSubs(); if (db.auth && em.toLowerCase() === String(db.auth.user.email || "").toLowerCase()) { loadPlan(true); famSrv = null; }
    } break;
    case "giftdel": {
      if (!await ask({ title: "Retirer le Premium offert ?", text: b.dataset.email + " repasse à son statut normal (essai, abonnement ou version gratuite), sans rien perdre de ses données.", ok: "Retirer", danger: true })) return;
      try { const r = await rpc("admin_gift_remove", { p_user: b.dataset.id }); const den = admDenied(r); if (den) { adminSubsErr = den; render(); return; } } catch (err) { toast(famErr(err)); return; }
      toast("Premium offert retiré"); loadAdminSubs();
    } break;
    case "famblock": {
      const blk = b.dataset.v === "1";
      const note = blk ? await ask({ title: "Bloquer les invitations ?", text: "Les membres actuels gardent Premium, mais plus personne ne peut rejoindre cette famille, et les invitations en attente sont annulées. Note pour toi (facultatif) :", input: "", ok: "Bloquer", danger: true })
        : (await ask({ title: "Débloquer les invitations ?", text: "La famille pourra de nouveau inviter des proches.", ok: "Débloquer" }) ? "" : null);
      if (note == null) return;
      try { const r = await rpc("admin_family_block", { p_family: b.dataset.id, p_block: blk, p_note: note }); const den = admDenied(r); if (den) { adminSubsErr = den; render(); return; } } catch (err) { toast(famErr(err)); return; }
      toast(blk ? "Invitations bloquées" : "Invitations débloquées"); loadAdminSubs();
    } break;
    case "admper": adminPeriod = +b.dataset.v || 8; render(); break;
    case "shrlook": {
      const inp = document.querySelector('[data-sr="code"]'), raw = inp ? inp.value.trim() : "";
      const m = raw.match(/(?:#\/s\/)?([A-Za-z0-9]{6,12})\s*$/);
      shareRep = { code: raw, res: null, busy: false, err: "" };
      if (!m) { shareRep.err = "Colle le code de la séance (6 à 12 lettres et chiffres) ou son lien."; render(); break; }
      shareRep.busy = true; render();
      try { const r = await rpc("admin_share", { p_code: m[1] }); const den = admDenied(r); if (den) { if (den === "mfa") adminSubsErr = "mfa"; else shareRep.err = den; } else shareRep.res = r || { found: false }; }
      catch (err) { const t = admErrText(err, "La séance n'a pas pu être chargée"); if (t === "mfa") adminSubsErr = "mfa"; else shareRep.err = t; }
      finally { shareRep.busy = false; render(); }
    } break;
    case "shrremove": {
      const r = shareRep.res; if (!r || !r.found || r.removed) break;
      if (!await ask({ title: "Retirer ce partage ?", text: "Le lien de cette séance ne fonctionnera plus pour personne (ceux qui l'ont déjà importée la gardent). Ensuite, préviens l'auteur avec les raisons de la décision.", ok: "Retirer", danger: true })) break;
      try { const x = await rpc("admin_share_remove", { p_code: r.code }); const den = admDenied(x); if (den) { if (den === "mfa") adminSubsErr = "mfa"; else toast(den); render(); break; } }
      catch (err) { toast(admErrText(err, "Le partage n'a pas pu être retiré")); break; }
      r.removed = true; toast("Partage retiré : pense à prévenir l'auteur"); render();
    } break;
    case "ledgeryear": ledgerYear = +b.dataset.v; render(); break;
    case "ledgernew": { const e = await askLedger(null); if (e) ledgerSave(e); } break;
    case "ledgeredit": { const cur = ledger && ledgerYearRows(+(ledger.rows.find(r => r.id === b.dataset.id) || { paid_on: "0000" }).paid_on.slice(0, 4)).find(r => r.id === b.dataset.id); if (!cur) return;
      const e = await askLedger(cur); if (e) ledgerSave(e); } break;
    case "ledgersync": syncStripe(true); break;
    case "ledgerok": case "ledgerskip": {
      const d = ledgerAuto && (ledgerAuto.drafts || []).find(x => x.id === b.dataset.id); if (!d) return;
      const ok = a === "ledgerok";
      if (!await ask(ok ? { title: "Ajouter " + monthName(d.period).toLowerCase() + " au registre ?", text: eur(draftNet(d)) + " encaissés (" + d.n + " paiement" + (d.n > 1 ? "s" : "") + " par carte). La ligne prend la date du dernier jour du mois, avec le relevé Stripe comme pièce justificative.", ok: "Ajouter" }
        : { title: "Ignorer " + monthName(d.period).toLowerCase() + " ?", text: "Cette ligne ne sera plus proposée. Tu pourras toujours ajouter la recette à la main.", ok: "Ignorer" })) return;
      try {
        const r = await rpc(ok ? "admin_ledger_draft_validate" : "admin_ledger_draft_dismiss", { p_id: d.id }); const den = admDenied(r); if (den) { ledgerErr = den; render(); return; }
        if (!r.ok) { toast(r.reason || "Impossible"); return; }
        toast(ok ? "Ajouté au registre" : "Ligne ignorée");
      } catch (err) { toast("Impossible : " + err.message); return; }
      await loadLedger();
    } break;
    case "ledgerdel": {
      const cur = ledger && ledgerYearRows(+(ledger.rows.find(r => r.id === b.dataset.id) || { paid_on: "0000" }).paid_on.slice(0, 4)).find(r => r.id === b.dataset.id); if (!cur) return;
      const okDel = await fancyAsk({ title: "Supprimer la recette " + cur.num + " ?", html: '<p class="muted">' + esc(dayFr(cur.paid_on) + " · " + cur.payer + " · " + eur(cur.net)) + "</p><p class=\"small muted\">Elle sort du registre et les numéros suivants se décalent. Une copie reste dans le journal des modifications. Pour corriger un montant, préfère « Modifier ».</p>", ok: "Supprimer", danger: true });
      if (!okDel) return;
      try { const r = await rpc("admin_ledger_delete", { entry_id: cur.id }); const den = admDenied(r); if (den) { ledgerErr = den; render(); return; } toast("Recette supprimée"); }
      catch (err) { toast(err.message === "Failed to fetch" ? "Pas de connexion internet : rien n'a été supprimé" : "Suppression impossible : " + err.message); return; }
      loadLedger();
    } break;
    case "ledgerinfo": { const v = await askLedgerInfo(); if (v) { setSetting("ledgerInfo", v); toast("Infos du registre enregistrées"); } } break;
    case "ledgerpdf": {
      const yy = ledgerYear || new Date().getFullYear(), st = await saveBytes("registre-des-recettes-" + yy + ".pdf", "application/pdf", ledgerPdf(yy));
      toast(st === "ok" ? "PDF enregistré" : st === "download" ? "PDF téléchargé" : st === "old-app" ? "Mets à jour l'appli pour enregistrer le PDF (ou utilise fiitday.com)" : st === "cancel" ? "Enregistrement annulé" : "Le PDF n'a pas pu être enregistré");
    } break;
    case "mfaenroll": mfaEnroll(); break;
    case "mfaverify": mfaVerify(); break;
    case "mfacancel": { const id = mfa.enroll && mfa.enroll.id; mfa.enroll = null; mfa.err = ""; render(); if (id) authApi("DELETE", "factors/" + id).catch(() => { }); } break;
    case "pwchange": changePassword(); break;
    case "faminvite": {
      if (!isFamily() || famFree() <= 0) return;
      const n = await ask({ title: "Inviter quelqu'un", text: "Son prénom, pour t'y retrouver dans la liste.", input: "", ok: "Créer l'invitation" });
      if (!n) return;
      const m = { id: "m" + uid(), name: n.slice(0, 30), code: famCode(), status: "invited", at: Date.now() };
      famData().members.push(m); saveNow(); render(); famShareCode(m);
    } break;
    case "famshare": { const m = isFamily() && famData().members.find(x => x.id === b.dataset.id); if (m) famShareCode(m); } break;
    case "famaccept": { const m = isFamily() && famData().members.find(x => x.id === b.dataset.id); if (!m) return; m.status = "member"; m.at = Date.now(); saveNow(); render(); toast(m.name + " a rejoint ta famille : Premium débloqué pour elle"); } break;
    case "famcancel": { const f = famData(), m = isFamily() && f.members.find(x => x.id === b.dataset.id); if (!m) return; f.members = f.members.filter(x => x !== m); saveNow(); render(); toast("Invitation annulée : la place est libre"); } break;
    case "famremove": {
      const f = famData(), m = isFamily() && f.members.find(x => x.id === b.dataset.id); if (!m) return;
      if (!await ask({ title: "Retirer " + m.name + " ?", text: m.name + " repasse en version gratuite, sans rien perdre de ses données. Sa place ne pourra être donnée à quelqu'un d'autre que dans " + FAM_WAIT_DAYS + " jours.", ok: "Retirer", danger: true })) return;
      f.members = f.members.filter(x => x !== m); f.removed.push(Date.now()); saveNow(); render(); toast(m.name + " a été retiré(e) de ta famille");
    } break;
    case "famjoin": famJoin(); break;
    case "famsrvinvite": {
      const n = await ask({ title: "Inviter quelqu'un", text: "Son prénom, pour t'y retrouver dans la liste (facultatif).", input: "", ok: "Créer l'invitation" });
      if (n == null) return;
      let r; try { r = await rpc("family_invite", { p_label: String(n).slice(0, 40) }); } catch (err) { toast(famErr(err)); return; }
      await loadFam(true); famShareSrv(r.code, String(n).trim());
    } break;
    case "famsrvshare": famShareSrv(b.dataset.code, b.dataset.name); break;
    case "famsrvcancel": {
      if (!await ask({ title: "Annuler l'invitation ?", text: "Le code ne marchera plus et la place redevient libre tout de suite.", ok: "Annuler l'invitation", cancel: "Garder" })) return;
      try { await rpc("family_cancel", { p_code: b.dataset.code }); } catch (err) { toast(famErr(err)); return; }
      await loadFam(true); toast("Invitation annulée : la place est libre");
    } break;
    case "famsrvremove": {
      const nm = b.dataset.name || "ce membre";
      if (!await ask({ title: "Retirer " + nm + " ?", text: nm + " n'a plus Premium partagé, sans rien perdre de ses données. Sa place ne pourra être donnée à quelqu'un d'autre que dans " + FAM_WAIT_DAYS + " jours.", ok: "Retirer", danger: true })) return;
      try { await rpc("family_remove", { p_user: b.dataset.id }); } catch (err) { toast(famErr(err)); return; }
      await loadFam(true); toast(nm + " a été retiré(e) de ta famille");
    } break;
    case "famsrvleave": {
      if (!await ask({ title: "Quitter la famille ?", text: "Tu perds Premium partagé, mais tu gardes toutes tes données. Ta place restera bloquée " + FAM_WAIT_DAYS + " jours pour la famille.", ok: "Quitter", danger: true })) return;
      try { await rpc("family_leave"); } catch (err) { toast(famErr(err)); return; }
      await Promise.all([loadPlan(true), loadFam(true)]); toast("Tu as quitté la famille"); render();
    } break;
    case "famleave": {
      if (!isMember()) return;
      if (!await ask({ title: "Quitter la famille ?", text: "Tu perds Premium partagé, mais tu gardes toutes tes données. Tu pourras t'abonner seul, ou être invité dans une autre famille.", ok: "Quitter", danger: true })) return;
      const prev = (db.planTestJoined || {}).prev; db.planTest = prev && prev !== "member" ? prev : "free"; db.planTestJoined = null; saveNow(); render(); toast("Tu as quitté la famille");
    } break;
    case "famskip": if (isFamily()) { const f = famData(); f.removed = f.removed.map(t => t - FAM_WAIT); saveNow(); render(); toast(FAM_WAIT_DAYS + " jours plus tard : la place est libre"); } break;
    case "planfor": premiumFor = b.dataset.val === "family" ? "family" : "solo"; render(); break;
    case "planpick": { const pk = ["year", "month", "life"].includes(b.dataset.val) ? b.dataset.val : "year"; if ((pk === "life") !== (premiumPick === "life")) premiumConsent = false; premiumPick = pk; render(); } break; // le texte de l'accord change entre abonnement et achat à vie
    case "planconsent": premiumConsent = !!b.checked; break;
    case "ctrkey": ctrGrab(); if (ctr) { ctr.key = b.value; ctr.err = ""; ctr.wish = ""; } render(); break;
    case "ctrwish": ctrGrab(); if (ctr) { ctr.wish = b.value === "maintenant" ? "maintenant" : "fin"; ctr.err = ""; } render(); break;
    case "ctrnext": {
      ctrGrab(); if (!ctr) break;
      ctr.name = ctr.name.trim(); ctr.email = ctr.email.trim();
      if (ctr.name.length < 2) { ctr.err = "Indique ton nom et ton prénom."; render(); break; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ctr.email)) { ctr.err = "Indique une adresse e-mail valide pour recevoir la confirmation."; render(); break; }
      if (ctr.kind === "resiliation" && ctr.need && !ctr.wish) { ctr.err = "Choisis la date de fin de ton abonnement."; render(); break; }
      ctr.err = ""; ctr.step = "recap"; render(); window.scrollTo(0, 0);
    } break;
    case "ctredit": if (ctr) { ctr.step = "form"; ctr.err = ""; } render(); break;
    case "ctrsend": {
      if (!ctr || ctr.busy) break;
      const [store, product] = ctr.key.split("/");
      ctr.busy = true; ctr.err = ""; render();
      const j = await contractCall({ action: ctr.kind === "resiliation" ? "resilier" : "retracter", store, product, wish: ctr.wish, name: ctr.name, email: ctr.email });
      if (!ctr) break;
      ctr.busy = false;
      if (j && j.ok) { ctr.step = "done"; ctr.res = j; loadContracts(true); loadPlan(true); }
      else ctr.err = (j && j.reason) || "La demande n'a pas pu être envoyée. Réessaie, ou écris à contact@fiitday.com.";
      render(); window.scrollTo(0, 0);
    } break;
    case "ctrreload": contracts = null; contractsAt = 0; render(); loadContracts(true); break;
    case "ctrcheck": {
      if (ctrCheckBusy) break;
      ctrCheckBusy = true; render();
      const j = await contractCall({ action: "verifier" });
      ctrCheckBusy = false; ctrCheck = j && j.ok ? j : { revenuecat: (j && j.reason) || "vérification impossible", brevo: "—", cron: "—" }; render();
    } break;
    case "ctrdone": {
      if (!await ask({ title: "Demande traitée ?", text: "Le remboursement ou l'arrêt de l'abonnement a bien été fait (Stripe, RevenueCat ou Play Console) ?", ok: "Oui, c'est fait" })) break;
      try { const r = await rpc("admin_contract_done", { p_id: b.dataset.id }); const den = admDenied(r); if (den) { toast(den); break; } } catch (e) { toast("Impossible pour l'instant"); break; }
      toast("Demande marquée comme traitée"); loadAdminSubs();
    } break;
    case "lplogin": loginMode = b.dataset.m === "up" ? "up" : "in"; location.hash = "#/connexion"; window.scrollTo(0, 0); break;
    case "lpgo": { const t = document.getElementById(b.dataset.to); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); } break;
    case "planmanage": { // abonnement payé par carte : page de gestion de RevenueCat (résilier, changer de carte, factures)
      if (Native || !billingMode() || !db.auth) { toast("Gère ton abonnement sur fiitday.com, connecté à ton compte"); break; }
      try { const ci = await (await webPurchases()).getCustomerInfo(); if (ci && ci.managementURL) openOut(ci.managementURL); else toast("Aucun abonnement par carte trouvé sur ce compte"); }
      catch (err) { toast("Page de gestion indisponible : " + ((err && err.message) || "réessaie plus tard")); }
    } break;
    case "importvar": { const code = await ask({ title: "Importer une séance", text: "Colle le lien de la séance qu'on t'a envoyé.", input: "", ok: "Continuer" }); if (!code) return;
      if (dataLocked() && XFER_RE.test(normCode(code)) && code.trim().length <= 12) { premiumGate(LOCK_XFER); return; } // une sauvegarde collée : vérifiée par restoreBackup (compte d'origine)
      if (/^\s*FIITDAY\d:/.test(code)) { if (await ask({ title: "C'est une sauvegarde", text: "Ce texte est une sauvegarde complète (programmes, séances, réglages), pas un lien de séance. La restaurer dans ce compte ?", ok: "Restaurer" })) restoreBackup(code); return; }
      if (XFER_RE.test(normCode(code)) && code.trim().length <= 12) { if (await ask({ title: "C'est un code de transfert", text: "Ce code sert à récupérer toutes les données d'un autre compte (programmes, séances, réglages). Les récupérer dans ce compte ?", ok: "Récupérer" })) useTransferCode(code); return; }
      importShared(code); } break;
    case "launchvar": flushPending(); startWorkout(b.dataset.t, b.dataset.v, true); break;
    case "deltpl": { const { t } = currentProgram(); if (!t) return; if (!await ask({ title: "Supprimer « " + t.name + " » ?", text: "Ses séances et exercices seront supprimés. L'historique des séances déjà faites est conservé.", ok: "Supprimer", danger: true })) return; remove(t.id); go("home"); } break;

    /* réglages */
    case "set": setSetting(b.dataset.k, b.dataset.val); break;
    case "alertt": {
      const a = settings().alert; let vib = a === "vibration" || a === "les deux", son = a === "son" || a === "les deux";
      if (b.dataset.val === "aucune") vib = son = false; else if (b.dataset.val === "vibration") vib = !vib; else son = !son;
      setSetting("alert", vib && son ? "les deux" : vib ? "vibration" : son ? "son" : "aucune");
    } break;
    case "notifon": if (Native && typeof Native.enableNotifications === "function") Native.enableNotifications(); break;
    case "testalert": {
      b.classList.remove("lit"); void b.offsetWidth; b.classList.add("lit"); setTimeout(() => b.classList.remove("lit"), 1300);
      audio();
      const a = settings().alert;
      if (a === "aucune") { toast("Alerte désactivée"); break; }
      // appli Android : la vraie alerte de fin de repos (notification, montre, ou vibration du téléphone sans notifications), dans 5 s
      if (Native && typeof Native.testAlert === "function") { Native.testAlert(a); toast("Alerte de test dans 5 secondes : tu peux verrouiller ton téléphone"); break; }
      signal();
      if ((a === "vibration" || a === "les deux") && !Native && !navigator.vibrate) toast("Sur ce téléphone, un site web ne peut pas faire vibrer (c'est le cas sur iPhone) : seul le son fonctionne.");
    } break;
    case "filesave": {
      const r = await saveFile(backupName(), await backupText());
      if (r === "ok" || r === "download") { lsSet("fiitday-backup-at", Date.now()); if (route().name === "home") render(); }
      if (r === "ok") toast("Sauvegarde enregistrée");
      else if (r === "download") toast("Sauvegarde enregistrée dans tes téléchargements (" + backupName() + ")");
      else if (r === "error") toast("La sauvegarde n'a pas pu être enregistrée");
    } break;
    case "fileopen": {
      // une sauvegarde de CE compte se restaure toujours (version gratuite et essai compris) ; celle d'un autre compte : abonnés seulement
      if (!db.auth) { toast("Connecte-toi à ton compte pour restaurer une sauvegarde"); return; }
      const txt = await openFile();
      if (txt === false) toast("Ce fichier n'a pas pu être lu");
      else if (txt != null) restoreBackup(txt, "Ce fichier n'est pas une sauvegarde Fiitday");
    } break;
    case "xfercreate": {
      if (dataLocked()) { premiumGate(LOCK_XFER); return; }
      if (!db.auth) { toast("Connecte-toi à ton compte pour créer un code"); return; }
      const txt = await backupText();
      let row; try { row = await rpc("create_transfer", { p_payload: txt }); } catch (err) { toast(xferErr(err)); return; }
      row = Array.isArray(row) ? row[0] : row;
      if (!row || !XFER_RE.test(row.transfer_code || "")) { toast("Impossible de créer un code, réessaie"); return; }
      const copy = await ask({ title: "Code de transfert", html: '<div class="xfer-code" aria-label="Code ' + esc(row.transfer_code.split("").join(" ")) + '">' + esc(row.transfer_code) + "</div>",
        text: "Valable jusqu'à " + fmtTime(Date.parse(row.valid_until)) + " (1 heure).\nDans l'autre compte : Réglages › Données › « J'ai un code ».\nCe code donne accès à toutes tes données : ne le partage pas.", ok: "Copier le code", cancel: "Fermer" });
      if (copy) { try { await navigator.clipboard.writeText(row.transfer_code); toast("Code copié"); } catch (err) { toast("Note le code : " + row.transfer_code); } }
    } break;
    case "xferuse": {
      if (dataLocked()) { premiumGate(LOCK_XFER); return; }
      if (!db.auth) { toast("Connecte-toi au compte qui doit recevoir les données"); return; }
      const c = await ask({ title: "J'ai un code", text: "Tape le code de 8 caractères créé dans l'autre compte (Réglages › Données › Créer un code). Il n'est valable qu'une heure.", input: "", code: true, ok: "Récupérer" });
      if (c) useTransferCode(c);
    } break;
  }
});
// sauvegarde (fichier, code de transfert, texte) : on montre d'abord ce qu'elle contient et ce qui va changer.
// Les réglages personnels du compte (prénom, accord, séances actives de la version gratuite, première visite) ne sont jamais
// repris d'une sauvegarde ; les exercices et machines perso sont ajoutés à ceux du compte.
const SETTINGS_OWN = ["firstName", "consentAt", "consentVersion", "freeActive", "welcomeAt", "hrOk", "hrGoneAt", "weightOk", "weightGoneAt"]; // accords (fréquence cardiaque, poids) et leur retrait : jamais repris d'une sauvegarde
async function restoreBackup(txt, badMsg) {
  let j;
  try { j = JSON.parse(await unpackBackup(txt)); if (!j || j.app !== "muscuapp" || !Array.isArray(j.items) || (j.v != null && !(j.v >= 1 && j.v <= 2))) throw new Error(); }
  catch (err) { toast(badMsg || "Ce texte n'est pas une sauvegarde valide"); return; }
  if (!db.auth) { toast("Connecte-toi à ton compte pour restaurer une sauvegarde"); return; }
  if (dataLocked() && j.owner !== db.auth.user.id) { premiumGate(LOCK_XFER); return; }
  const take = [], back = []; let bad = 0, same = 0;
  for (const it of j.items) {
    if (it && it.kind === "workout" && it.data) it.data = fatWorkout(it.data);
    if (!it || !KINDS[it.kind] || it.deleted || !validItem(it) || typeof it.updated_at !== "number" || JSON.stringify(it.data).length > 190000) { bad++; continue; }
    const cur = db.items[it.id];
    if (cur && !cur.deleted && it.updated_at <= cur.updated_at) { same++; continue; }
    take.push(it); if (cur && cur.deleted) back.push(it);
  }
  if (!take.length) { toast("Rien à restaurer : tout ce qui est dans la sauvegarde est déjà dans l'appli" + (bad ? " (" + bad + " élément" + (bad > 1 ? "s" : "") + " illisible" + (bad > 1 ? "s" : "") + " ignoré" + (bad > 1 ? "s" : "") + ")" : "")); return; }
  const nb = k => take.filter(x => x.kind === k).length, pl = (n, a, b) => n + " " + (n > 1 ? b : a);
  const lines = [];
  if (j.at) lines.push("Sauvegarde du " + new Date(j.at).toLocaleDateString("fr-FR") + " à " + fmtTime(j.at) + ".");
  if (nb("template")) lines.push("• " + pl(nb("template"), "programme ajouté ou remplacé par sa version de la sauvegarde", "programmes ajoutés ou remplacés par leur version de la sauvegarde"));
  if (nb("workout")) lines.push("• " + pl(nb("workout"), "séance ajoutée à l'historique ou remplacée", "séances ajoutées à l'historique ou remplacées"));
  if (nb("weight")) lines.push("• " + pl(nb("weight"), "pesée ajoutée ou remplacée", "pesées ajoutées ou remplacées"));
  if (nb("settings")) lines.push("• Réglages de la sauvegarde (thème, alertes, objectif…) ; tes exercices perso sont gardés et complétés");
  if (back.length) lines.push("• Dont " + pl(back.length, "élément supprimé depuis qui reviendra", "éléments supprimés depuis qui reviendront"));
  if (same) lines.push("• " + pl(same, "élément déjà à jour dans l'appli : gardé tel quel", "éléments déjà à jour dans l'appli : gardés tels quels"));
  if (bad) lines.push("• " + pl(bad, "élément illisible ignoré", "éléments illisibles ignorés"));
  if (!await ask({ title: "Restaurer cette sauvegarde ?", text: lines.join("\n"), ok: "Restaurer" })) return;
  // fréquence cardiaque dans la sauvegarde sans accord en cours : la garder demande ton accord, sinon elle est effacée
  const hrN = hrOk() ? 0 : hrCount(take.filter(x => x.kind === "workout").map(x => x.data));
  if (hrN) {
    const keep = await ask({ title: "Fréquence cardiaque dans la sauvegarde", text: "Cette sauvegarde contient " + (hrN > 1 ? hrN + " valeurs" : "1 valeur") + " de fréquence cardiaque. Elle peut renseigner sur ta santé : elle n'est gardée qu'avec ton accord, visible de toi seul, jamais partagée, et effacée si tu retires ton accord (« × » sur l'indicateur).",
      ok: hrN > 1 ? "J'accepte de les garder" : "J'accepte de la garder", cancel: hrN > 1 ? "Les effacer" : "L'effacer" });
    if (keep) { const st = settings(); st.hrOk = new Date().toISOString(); put("settings", st); }
    else take.forEach(x => { if (x.kind === "workout") stripHr(x.data); });
  }
  // poids dans la sauvegarde sans accord en cours : le garder demande ton accord, sinon les pesées ne sont pas reprises
  const wN = weightOk() ? 0 : take.filter(x => x.kind === "weight").length;
  if (wN) {
    const keep = await ask({ title: "Poids dans la sauvegarde", text: "Cette sauvegarde contient " + (wN > 1 ? wN + " pesées" : "1 pesée") + ". Ton poids peut renseigner sur ta santé : il n'est gardé qu'avec ton accord, visible de toi seul, jamais partagé, et effacé si tu retires ton accord (« Ne plus suivre mon poids »).",
      ok: wN > 1 ? "J'accepte de les garder" : "J'accepte de la garder", cancel: wN > 1 ? "Les effacer" : "L'effacer" });
    if (keep) { const st = settings(); st.weightOk = new Date().toISOString(); st.weightHidden = false; put("settings", st); }
    else for (let k = take.length - 1; k >= 0; k--) if (take[k].kind === "weight") take.splice(k, 1);
  }
  for (const it of take) {
    const cur = db.items[it.id];
    let data = it.data;
    if (it.kind === "settings") {
      const mine = cur && !cur.deleted ? cur.data : {};
      data = Object.assign({}, data);
      SETTINGS_OWN.forEach(k => { if (k in mine) data[k] = mine[k]; else delete data[k]; });
      // exercices perso (par nom) et indicateurs perso des machines cardio : ceux du compte sont gardés, ceux de la sauvegarde ajoutés
      const ownM = Array.isArray(mine.ownEx) ? mine.ownEx.filter(x => x && x.n) : [], ownB = Array.isArray(data.ownEx) ? data.ownEx.filter(x => x && x.n) : [];
      const names = new Set(ownM.map(x => norm(x.n)));
      data.ownEx = ownM.concat(ownB.filter(x => !names.has(norm(x.n))));
      data.ownGone = (Array.isArray(mine.ownGone) ? mine.ownGone : []).filter(k => !data.ownEx.some(x => norm(x.n) === k));
      const cc = Object.assign({}, isObj(data.cardioCustom) ? data.cardioCustom : {});
      if (isObj(mine.cardioCustom)) for (const k of Object.keys(mine.cardioCustom)) {
        const b = Array.isArray(cc[k]) ? cc[k] : [], l = Array.isArray(mine.cardioCustom[k]) ? mine.cardioCustom[k] : [];
        cc[k] = l.concat(b.filter(x => x && !l.some(y => y && y.k === x.k)));
      }
      data.cardioCustom = cc;
      data.id = it.id;
    }
    db.items[it.id] = { id: it.id, kind: it.kind, data, updated_at: Math.max(it.updated_at, (cur && cur.updated_at + 1) || 0), deleted: false, dirty: true };
  }
  dataRev++; localFixed = false; saveNow(); scheduleSync(); render();
  toast(pl(take.length, "élément restauré", "éléments restaurés"));
}

/* Saisie au clavier : enregistre sans redessiner l'écran (on garde le focus) */
$app.addEventListener("input", e => {
  const el = e.target;
  if (el.dataset.f) {
    const w = currentWorkout(); if (!w) return;
    const ex = w.exercises[+el.dataset.i]; if (!ex) return;
    if (el.dataset.f === "note") {
      // la note reste dans cette séance ; pendant la séance en cours, elle est aussi gardée pour la prochaine fois (programme)
      ex.note = el.value; putLater("workout", w);
      if (!w.endedAt) { const t = getItem(w.templateId), te = tplExercise(w, ex.exId); if (t && te) { te.note = el.value; putLater("template", t); } }
      return;
    }
    const set = ex.sets[+el.dataset.s]; if (!set) return;
    let tgt = set;
    if ("d" in el.dataset) { set.drops = set.drops || []; tgt = set.drops[+el.dataset.d] = set.drops[+el.dataset.d] || { kg: "", reps: "" }; }
    if (el.dataset.f === "clock") { const clean = el.value.replace(/[^\d:]/g, ""); if (clean !== el.value) el.value = clean; const sec = parseClock(clean); tgt.sec = sec == null ? "" : String(sec); if (w.manual) syncManual(w); putLater("workout", w); return; }
    if (el.dataset.f === "cv") { // indicateur de cardio : nombre, ou temps « m:ss » enregistré en secondes
      const k = el.dataset.k; if (!/^[a-z0-9]{1,17}$/.test(k || "")) return;
      set.cv = Object.assign({}, set.cv);
      if (el.dataset.clock) { const clean = el.value.replace(/[^\d:]/g, ""); if (clean !== el.value) el.value = clean; const sec = parseClock(clean); if (sec == null) delete set.cv[k]; else set.cv[k] = String(sec); }
      else { const v = el.value.replace(/[^\d.,]/g, "").slice(0, 9); if (v !== el.value) el.value = v; if (v) set.cv[k] = v; else delete set.cv[k]; }
      putLater("workout", w); return;
    }
    tgt[el.dataset.f] = el.value.replace(/[^\d.,]/g, "");
    if (el.value !== tgt[el.dataset.f]) el.value = tgt[el.dataset.f];
    putLater("workout", w);
    return;
  }
  if (el.dataset.p) {
    const { t, v } = currentProgram(); if (!t) return;
    const p = el.dataset.p;
    if (p === "tname") { t.name = el.value; putLater("template", t); return; }
    if (p === "vname") { v.name = el.value; putLater("template", t); const tab = $app.querySelector("[data-vtab]"); if (tab) tab.textContent = el.value; return; }
    const ex = v.exercises[+el.dataset.e]; if (!ex) return;
    if (p === "type" || p === "drops" || p === "gkind" || p === "dscope") return; // géré par « change »
    if (p === "gsets" || p === "grest") {
      const val = num(el.value) == null ? "" : Math.max(0, Math.round(num(el.value)));
      v.exercises.forEach(e => { if (e.groupId && e.groupId === ex.groupId) e[p === "gsets" ? "sets" : "rest"] = val; });
      putLater("template", t); return;
    }
    if (p === "name") {
      const ti = $app.querySelector('[data-title="' + el.dataset.e + '"]'); if (ti) ti.textContent = el.value;
      const cur = exLib(ex); if (cur && !ex.lib) ex.lib = cur.id; // l'identité est fixée avant le premier changement de nom
      const lk = $app.querySelector('[data-exolink="' + el.dataset.e + '"]'), lib = libFor(el.value) || exLib(ex);
      if (lk) { lk.hidden = !lib; lk.innerHTML = lib ? '<button type="button" class="chip-mini" data-act="exoview" data-id="' + lib.id + '">' + ICON.play + "Voir le mouvement</button>" : ""; }
    }
    ex[p] = (p === "sets" || p === "rest") ? (num(el.value) == null ? "" : Math.max(0, Math.round(num(el.value)))) : el.value;
    putLater("template", t);
  }
});
$app.addEventListener("change", e => {
  const el = e.target;
  if (el.matches && el.matches("input[data-setname]")) {
    if (/@/.test(el.value)) { toast("Tape ton prénom, pas ton e-mail"); return; }
    const st = settings(); st.firstName = el.value.trim().slice(0, 40); put("settings", st); toast("Prénom enregistré"); return;
  }
  if (el.dataset.p === "type") {
    const { t, v } = currentProgram(); if (!t) return;
    const ex = v.exercises[+el.dataset.e], was = ex.type; ex.type = el.value;
    if (ex.type === "cardio") Object.assign(ex, { machine: ex.machine || cardioMachineOf(ex.name), target: "", sets: 1, rest: 0, drops: 0 });
    else if (was === "cardio") Object.assign(ex, { sets: 3, rest: ex.type === "time" ? 60 : 90 });
    if (ex.type === "time" && !/^\d+$/.test(String(ex.target))) ex.target = "45";
    if (ex.type === "dist" && !(num(ex.target) >= 10)) ex.target = "1000";
    if ((ex.type === "reps" || ex.type === "rep") && !/^\d+(-\d+)?$/.test(String(ex.target))) ex.target = "8-10";
    if (ex.type !== "reps") ex.drops = 0;
    put("template", t); render();
  } else if (el.dataset.p === "name") { // nom choisi : celui d'un autre exercice de la liste change d'exercice, un nom perso le garde
    const { t, v } = currentProgram(); if (!t) return;
    const ex = v.exercises[+el.dataset.e]; if (!ex) return;
    const before = exLib(ex); renameEx(ex, el.value); ex.name = el.value; put("template", t);
    if (exLib(ex) !== before) render();
  } else if (el.dataset.p === "load") {
    const { t, v } = currentProgram(); if (!t) return;
    const ex = v.exercises[+el.dataset.e]; if (!ex) return;
    ex.load = el.value === "1"; put("template", t); render();
  } else if (el.dataset.p === "drops" || el.dataset.p === "gkind" || el.dataset.p === "dscope") {
    const { t, v } = currentProgram(); if (!t) return;
    const ex = v.exercises[+el.dataset.e]; if (!ex) return;
    if (el.dataset.p === "drops") ex.drops = +el.value;
    else if (el.dataset.p === "dscope") ex.dropScope = el.value === "last" ? "last" : "all";
    else v.exercises.forEach(e => { if (e.groupId && e.groupId === ex.groupId) e.groupKind = el.value; });
    put("template", t); render();
  } else if (el.dataset.p || el.dataset.f) {
    if (el.dataset.f === "clock" || el.dataset.clock) { const sec = parseClock(el.value); if (sec != null) el.value = fmtClock(sec); } // « 405 » s'affiche « 4:05 »
    flushPending(); // enregistre tout de suite quand on quitte un champ (sans redessiner l'écran)
  }
});
// Entrée dans un champ de série : passe au champ suivant
$app.addEventListener("keydown", e => {
  if (e.key !== "Enter" || !e.target.dataset.f || e.target.tagName !== "INPUT") return;
  e.preventDefault();
  const ins = Array.from($app.querySelectorAll("input[data-f]"));
  const n = ins[ins.indexOf(e.target) + 1];
  if (n) n.focus(); else e.target.blur();
});

/* ================= Accueil : appui prolongé sur une séance = aperçu de ses exercices ================= */
function tplLine(e) {
  if (e.type === "cardio") return "Cardio" + (num(e.target) ? " · " + fmtNum(num(e.target)) + " min" : "");
  const n = Math.max(1, num(e.sets) || 1), tg = e.type === "dist" ? fmtNum(num(e.target) || 0) + " m" : e.type === "time" ? fmtHold(e.target) || "—" : (e.target || "—") + " reps";
  return n + " × " + tg + (e.type === "reps" && dropsOf(e) ? " · dégressif" : "") + " · repos " + fmtRest(e.rest);
}
const pvRows = v => blocks(v.exercises).map(b => b.groupId
  ? '<li class="pv-group"><span class="pv-tag">' + esc(GROUP_LABEL[b.kind] || "Groupe") + "</span>" + b.items.map((x, k) => '<div class="pv-ex"><b>' + LETTERS[k] + ". " + esc(x.e.name) + '</b><span class="muted small">' + esc(tplLine(x.e)) + "</span></div>").join("") + "</li>"
  : '<li><div class="pv-ex"><b>' + esc(b.items[0].e.name) + '</b><span class="muted small">' + esc(tplLine(b.items[0].e)) + "</span></div></li>").join("");
// version gratuite : séance (ou programme) verrouillée, consultable seulement
function viewLockedProgram(t, v) {
  let h = '<a class="back" href="#/home">‹ Accueil</a><h1 class="locked-h">' + LOCK + esc(t.name) + "</h1>";
  if (t.variants.length > 1) h += '<div class="tabs">' + t.variants.map(x => '<button class="' + (v && x.id === v.id ? "on" : "") + '" data-act="tab" data-v="' + x.id + '">' + (varLocked(t.id, x.id) ? LOCK : "") + "<span>" + esc(vLabel(x.name)) + "</span></button>").join("") + "</div>";
  h += '<div class="card plan-lock">' + LOCK + "<div><b>" + (v ? "« " + esc(vLabel(v.name)) + " » est verrouillée" : "Ce programme est verrouillé") + '</b><div class="small muted">En version gratuite, 1 programme et 2 séances sont actifs. Tu peux consulter ' + (v ? "celle-ci" : "ce programme") + ", mais pas la lancer ni la modifier ; rien n'est supprimé. " + esc(freeSwitchTxt()) + "</div>" +
    '<div class="row" style="margin-top:8px;flex-wrap:wrap">' + (freeCanSwitch() ? '<button class="btn sm" data-act="freepick" data-t="' + t.id + '"' + (v ? ' data-v="' + v.id + '"' : "") + ">Changer mes séances actives</button>" : "") + '<a class="btn sm primary" href="#/premium">Voir Premium</a></div></div></div>';
  if (v) h += '<div class="section-title">Exercices (' + v.exercises.length + ")</div>" + (v.exercises.length ? '<div class="card"><ol class="pv-list">' + pvRows(v) + "</ol></div>" : '<div class="card empty">Pas encore d\'exercice dans cette séance.</div>');
  return h;
}
function peekVariant(tid, vid) {
  const t = getItem(tid), v = t && t.variants.find(x => x.id === vid); if (!v) return;
  const rows = pvRows(v);
  const d = document.createElement("div"); d.className = "modal sheet";
  d.innerHTML = '<div class="modal-box pv" role="dialog" aria-modal="true" aria-label="' + esc(t.name + " · " + vLabel(v.name)) + '"><h3>' + esc(vLabel(v.name)) + '</h3><p class="muted small" style="margin:0">' + esc(t.name) + " · " + v.exercises.length + " exercice" + (v.exercises.length > 1 ? "s" : "") + "</p>" +
    (rows ? '<ol class="pv-list">' + rows + "</ol>" : '<p class="muted">Pas encore d\'exercice dans cette séance.</p>') +
    '<div class="modal-btns"><button class="btn" data-r="edit">Modifier</button><button class="btn primary" data-r="go">C\'est parti</button></div></div>';
  document.body.appendChild(d);
  d.addEventListener("click", e => {
    if (e.target === d) { d.remove(); return; }
    const b = e.target.closest("[data-r]"); if (!b) return;
    d.remove();
    if (b.dataset.r === "edit") go("program/" + tid + "/" + vid); else startWorkout(tid, vid, true);
  });
}
let peekTimer = null, peekStart = null, peekDone = false;
document.addEventListener("pointerdown", e => {
  const b = e.target.closest && e.target.closest('.variant[data-act="start"]'); if (!b || e.button) return;
  peekDone = false; peekStart = { x: e.clientX, y: e.clientY };
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => { peekDone = true; peekTimer = null; try { if (Native && Native.vibrate) Native.vibrate("[30]"); else if (navigator.vibrate) navigator.vibrate(30); } catch (err) { } peekVariant(b.dataset.t, b.dataset.v); }, 450);
});
const peekCancel = () => { clearTimeout(peekTimer); peekTimer = null; };
document.addEventListener("pointermove", e => { if (peekTimer && peekStart && Math.hypot(e.clientX - peekStart.x, e.clientY - peekStart.y) > 10) peekCancel(); });
["pointerup", "pointercancel", "scroll"].forEach(ev => document.addEventListener(ev, peekCancel, true));
// après un appui prolongé, le toucher ne lance pas la séance (et pas de menu du navigateur)
document.addEventListener("click", e => { if (peekDone && e.target.closest && e.target.closest('.variant[data-act="start"]')) { e.stopPropagation(); e.preventDefault(); peekDone = false; } }, true);
document.addEventListener("contextmenu", e => { if (e.target.closest && e.target.closest('.variant[data-act="start"]')) e.preventDefault(); });

/* ================= Erreurs inattendues ================= */
// une action qui échoue sans raison prévue affiche un message au lieu de sembler ne rien faire (le détail reste dans la console)
let lastOops = 0;
function oops(err) {
  const m = String((err && (err.message || err)) || "");
  if (/Failed to fetch|NetworkError|AbortError|Load failed|cadre d'un autre site/i.test(m)) return; // réseau : déjà signalé ailleurs
  console.error("Erreur inattendue :", err);
  if (Date.now() - lastOops < 8000) return;
  lastOops = Date.now();
  toast("Un problème est survenu : réessaie. Si cela continue, écris-nous à contact@fiitday.com.");
}
window.addEventListener("unhandledrejection", e => oops(e.reason));
window.addEventListener("error", e => { if (e.error instanceof Error && (!e.filename || e.filename.indexOf(location.origin) === 0)) oops(e.error); });

/* ================= Démarrage ================= */
applyTheme();
render();
if (history.state && history.state.k) applyScroll(scrollPos[history.state.k] || 0); // page rechargée : même position
else history.replaceState({ k: navKey(), prev: "" }, "");
if (db.auth) sync();
recoveryFromLink();
// message laissé avant un rechargement (compte supprimé…) ; données illisibles retrouvées au démarrage
try { const m = sessionStorage.getItem("fiitday-msg"); if (m) { sessionStorage.removeItem("fiitday-msg"); setTimeout(() => toast(m), 400); } } catch (e) { }
if (!db.auth && db.checkGone) setTimeout(() => accountGoneCheck(db.checkGone), 1500);
// version gratuite sur le site : on demande au navigateur de ne pas effacer les données de lui-même (elles ne sont que sur l'appareil)
if (!Native && navigator.storage && navigator.storage.persist) setTimeout(() => { if (db.auth && isFree()) navigator.storage.persisted().then(p => { if (!p) navigator.storage.persist(); }).catch(() => { }); }, 4000);
if (unreadable) setTimeout(() => ask({ title: "Données illisibles", text: "Les données enregistrées sur cet appareil n'ont pas pu être lues (écriture interrompue ?). Une copie a été mise de côté sur l'appareil, rien n'est effacé.\n\nReconnecte-toi : avec Premium ou pendant l'essai, tes données reviennent avec la synchro. Sinon, écris-nous à contact@fiitday.com : nous t'aiderons à les récupérer.", ok: "Compris", cancel: false }), 600);
setTimeout(() => { window.__fiitdayPending(); window.__fiitdayFileReady(); }, 300);
setTimeout(staleWorkout, 1500);
if ("serviceWorker" in navigator && location.protocol === "https:" && !Native && !window.claude) {
  navigator.serviceWorker.register("sw.js").catch(() => { });
}
