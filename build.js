// Construit dist/ (version web, publiée sur GitHub Pages) et copie la même page dans l'appli Android.
const fs = require("fs");
const path = require("path");
const src = f => fs.readFileSync(path.join(__dirname, "src", f), "utf8");
const VERSION = new Date().toISOString().slice(0, 16).replace("T", " ");
const CACHE = Date.now().toString(36);
const FONT = fs.readFileSync(path.join(__dirname, "src", "fonts", "space-grotesk.woff2")).toString("base64"); // police libre (OFL), embarquée pour marcher hors ligne
const crypto = require("crypto");
const sha = t => "'sha256-" + crypto.createHash("sha256").update(t, "utf8").digest("base64") + "'";
const SUPABASE = "https://krszgabjpswqjtypalsn.supabase.co";

// Les deux scripts de la page ; leur empreinte est inscrite dans la politique de sécurité (CSP) :
// le navigateur refuse tout autre script, même si un texte malveillant arrivait à s'insérer dans la page.
// index léger de la bibliothèque d'exercices (nom, muscles, matériel…) pour la recherche intelligente,
// lu dans src/exercices.js sans charger la 3D : [id, nom, muscles principaux, matériel, temps ?, reps, repos]
const exoSrc = src("exercices.js");
const MUS = {}, MUSG = {}, musBlock = exoSrc.slice(exoSrc.indexOf("export const MUSCLES"), exoSrc.indexOf("const GROUPS"));
for (const m of musBlock.matchAll(/(\w+): \["([^"]+)", "(\w+)"\]/g)) { MUS[m[1]] = m[2]; MUSG[m[1]] = m[3]; }
const EXO_INDEX = [];
for (const m0 of exoSrc.matchAll(/\{ id: "([a-z0-9-]+)", n: "([^"]+)",(.*?) p: \[([^\]]*)\], s: \[[^\]]*\],([^\n]*)/g)) {
  const head = m0[3], gear = (head.match(/gear: "([^"]+)"/) || [])[1] || "", m = [m0[0], m0[1], m0[2], gear, m0[4]];
  const prim = m[4].match(/\w+/g) || [], rest = m0[5] + " " + head;
  const reps = (rest.match(/reps: "([^"]+)"/) || [])[1] || "", rst = +((rest.match(/rest: (\d+)/) || [])[1] || 90);
  const dist = +((rest.match(/dist: (\d+)/) || [])[1] || 0), cat = (rest.match(/cat: "(\w+)"/) || [])[1] || "";
  const al = ((rest.match(/al: \[([^\]]*)\]/) || [])[1] || "").match(/"[^"]+"/g) || [];
  const hold = +((rest.match(/hold: (\d+)/) || [])[1] || 0), zone = (rest.match(/zone: "(\w+)"/) || [])[1] || "";
  EXO_INDEX.push([m[1], m[2], prim.map(k => MUS[k] || k).join(", "), m[3], /time: true/.test(rest) ? 1 : dist ? 2 : 0, reps, rst, dist, /load: true/.test(rest) ? 1 : 0, cat, al.map(x => x.slice(1, -1)), hold, zone, /side: (true|"one")/.test(rest) ? 1 : 0,
    (rest.match(/\bg: "(\w+)"/) || [])[1] || MUSG[prim[0]] || ""]); // groupe de la page Exercices (pectoraux, dos, bras, cardio, hyrox…)
}
if (EXO_INDEX.length < 50) throw new Error("Index des exercices incomplet (" + EXO_INDEX.length + ") : vérifier le format de src/exercices.js");
// chaque exercice de la bibliothèque doit être dans l'index (sinon il manquerait à la recherche, sans autre signe)
const exoCount = (exoSrc.match(/\{ id: "[a-z0-9-]+", n: "/g) || []).length;
if (exoCount !== EXO_INDEX.length) throw new Error("Index des exercices : " + EXO_INDEX.length + " lus sur " + exoCount + " (format inattendu dans src/exercices.js)");
const bootJs = `window.APP_BUILD = ${JSON.stringify(VERSION)}; window.APP_VERSION = ${JSON.stringify(process.env.VERSION_NAME || "")}; window.EXO_INDEX = ${JSON.stringify(EXO_INDEX).replace(/</g, "\\u003c")};`;
const appJs = "\n" + src("app.js") + "\n";
// le code est collé dans des balises <script> : « </script » ou « <!-- » couperait la page en deux
if (/<\/script|<!--/i.test(appJs + bootJs)) throw new Error("app.js contient « </script » ou « <!-- » : écrire « <\\/script » à la place");
if (!src("app.js").includes(SUPABASE)) throw new Error("Adresse Supabase différente dans app.js : mettre à jour SUPABASE dans build.js");
// paiement par carte sur fiitday.com : module RevenueCat (purchases.js, servi par le site) qui charge le formulaire de carte de Stripe
const STRIPE_JS = "https://js.stripe.com https://*.js.stripe.com", RC_ASSETS = "https://da08ctfrofx1b.cloudfront.net"; // icône et police de la page de paiement RevenueCat
const CSP = [
  "default-src 'self'",
  "script-src 'self' " + sha(bootJs) + " " + sha(appJs) + " " + STRIPE_JS, // 'self' : onglet Exercices (exercices.js + three.js) et paiement (purchases.js), chargés à la demande
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://*.stripe.com " + RC_ASSETS,
  "font-src 'self' data: " + RC_ASSETS,
  "connect-src 'self' " + SUPABASE + " https://api.revenuecat.com https://e.revenue.cat https://api.stripe.com https://*.stripe.com",
  "frame-src 'self' " + STRIPE_JS + " https://hooks.stripe.com", // formulaire de carte et 3D Secure : cadres de Stripe
  "manifest-src 'self'",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join("; ");
// appli Android : pas de paiement par carte, donc aucun cadre ni script de Stripe (le pont Android n'est jamais exposé à une page tierce)
const CSP_APP = CSP.replace(" " + STRIPE_JS, "").replace(/frame-src [^;]+/, "frame-src 'none'");
if (CSP_APP === CSP || !/frame-src 'none'/.test(CSP_APP)) throw new Error("CSP de l'appli Android non construite");
const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src data:; base-uri 'none'; form-action 'none'";

const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>Fiitday · Ton carnet de musculation</title>
<meta name="description" content="Fiitday, ton carnet de musculation : programmes prêts ou sur mesure, séances guidées, chrono de repos, plus de 100 exercices en 3D et le suivi de tes progrès, sur téléphone et ordinateur.">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Fiitday">
<meta property="og:title" content="Fiitday · Ton carnet de musculation">
<meta property="og:description" content="Programmes, séances guidées, chrono de repos, exercices en 3D et suivi de tes progrès. Essai gratuit.">
<meta property="og:image" content="https://fiitday.com/icon-512.png">
<meta property="og:locale" content="fr_FR">
<meta name="theme-color" content="#F4F2F8">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<style>
@font-face { font-family: "Space Grotesk"; src: url(data:font/woff2;base64,${FONT}) format("woff2"); font-weight: 300 700; font-display: swap; }
${src("style.css")}
</style>
</head>
<body>
<div id="app"></div>
<script>${bootJs}</script>
<script>${appJs}</script>
</body>
</html>
`;

// tout est d'abord écrit dans un dossier temporaire : une erreur en cours de route ne laisse jamais un dist/ à moitié neuf
const distFinal = path.join(__dirname, "dist"), dist = path.join(__dirname, "dist.tmp");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, "index.html"), html);
// logo 6 « Haltère épuré » (src/icons/logo.svg) : icônes du site, de l'écran d'accueil (Android, iPhone) et de l'appli
for (const f of ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"]) fs.copyFileSync(path.join(__dirname, "src", "icons", f), path.join(dist, f));
// onglet Exercices : module chargé à la demande + three.js (affichage 3D, licence MIT)
for (const f of ["exercices.js", "three.module.min.js"]) fs.copyFileSync(path.join(__dirname, "src", f), path.join(dist, f));
// page de présentation (site web seulement, visiteur non connecté) : captures de l'appli, en clair et en sombre
fs.mkdirSync(path.join(dist, "presentation"), { recursive: true });
for (const f of fs.readdirSync(path.join(__dirname, "src", "landing")).filter(f => f.endsWith(".webp"))) fs.copyFileSync(path.join(__dirname, "src", "landing", f), path.join(dist, "presentation", f));
// paiement par carte (site web seulement, pas dans l'appli Android) : SDK RevenueCat purchases-js 1.73.2 (licence MIT), chargé au moment de payer
fs.copyFileSync(path.join(__dirname, "src", "vendor", "purchases-js.umd.js"), path.join(dist, "purchases.js"));
fs.writeFileSync(path.join(dist, "manifest.webmanifest"), JSON.stringify({
  name: "Fiitday", short_name: "Fiitday", description: "Suivi de mes séances de musculation",
  start_url: "./", scope: "./", display: "standalone", lang: "fr",
  background_color: "#08080D", theme_color: "#08080D",
  icons: [
    { src: "icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
}, null, 2));
fs.writeFileSync(path.join(dist, "sw.js"), `// Cache hors ligne de la version web
const CACHE = "muscu-${CACHE}";
const FILES = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "exercices.js", "three.module.min.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
// copie hors ligne (même adresse, ou la page de l'appli pour une navigation)
const fromCache = req => caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === "navigate" ? caches.match("index.html") : undefined));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  // réseau d'abord (pour recevoir les mises à jour) ; seules les vraies réponses (200) sont gardées pour le hors ligne
  const net = fetch(e.request).then(r => {
    if (r.ok && r.status === 200 && r.type === "basic") { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}); }
    return r;
  });
  // réseau très faible (salle en sous-sol) : au bout de 3 s, la copie hors ligne s'affiche (le réseau met quand même le cache à jour)
  const slow = new Promise(res => setTimeout(res, 3000)).then(() => fromCache(e.request)).then(r => r || net);
  e.respondWith(Promise.race([net.catch(() => fromCache(e.request).then(r => r || Response.error())), slow]));
});
`);
fs.writeFileSync(path.join(dist, ".nojekyll"), "");

// Pages légales (confidentialité, mentions légales, suppression de compte), servies sur fiitday.com
const CONTACT = "contact@fiitday.com"; // adresse de contact affichée sur les pages légales
const pageCss = `
:root{--bg:#F4F2F8;--card:#FFFFFF;--line:#E4E0EC;--ink:#16131F;--muted:#5D586B;--accent:#C81E64;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#08080D;--card:#12121C;--line:#26243B;--ink:#F3F1FA;--muted:#A9A5BB;--accent:#FF5C9E;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:720px;margin:0 auto;padding:28px max(16px,env(safe-area-inset-right,0px)) 64px max(16px,env(safe-area-inset-left,0px))}
header{display:flex;align-items:center;gap:10px;margin-bottom:24px}header img{width:36px;height:36px;border-radius:10px}
header a{font-family:"Space Grotesk",ui-sans-serif,sans-serif;font-weight:700;font-size:20px;color:var(--ink);text-decoration:none}
h1,h2{font-family:"Space Grotesk",ui-sans-serif,sans-serif;line-height:1.2;text-wrap:balance}h1{font-size:32px;margin:0 0 4px}h2{font-size:20px;margin:28px 0 8px}
.meta{color:var(--muted);font-size:14px;margin:0 0 20px}a{color:var(--accent)}li{margin:4px 0}
footer{margin-top:40px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:14px;display:flex;gap:16px;flex-wrap:wrap}
.encadre{border:2px solid var(--accent);border-radius:12px;padding:2px 16px;margin:16px 0;background:var(--card)}p.encadre{padding:12px 16px}
.loi{font-size:14px;color:var(--muted);border-left:3px solid var(--line);padding-left:14px}`;
// typographie française : espace insécable avant « ; : ! ? » et à l'intérieur des guillemets (dans le texte, jamais dans les balises)
const frSpaces = h => (">" + h + "<").replace(/>([^<]+)</g, (m, t) => ">" + t.replace(/ ([?:!;»])/g, "\u00a0$1").replace(/« /g, "«\u00a0") + "<").slice(1, -1);
for (const f of fs.readdirSync(path.join(__dirname, "src", "pages")).filter(f => f.endsWith(".html"))) {
  const body = frSpaces(src("pages/" + f).replace(/\{\{CONTACT\}\}/g, CONTACT));
  const title = (body.match(/<!-- title: (.+?) -->/) || [, "Fiitday"])[1];
  fs.writeFileSync(path.join(dist, f), `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">
<title>${title} · Fiitday</title>
<link rel="icon" href="icon-192.png">
<style>
@font-face { font-family: "Space Grotesk"; src: url(data:font/woff2;base64,${FONT}) format("woff2"); font-weight: 300 700; font-display: swap; }
${pageCss}
</style>
</head>
<body><div class="wrap">
<header><img src="icon-192.png" alt=""><a href="./">Fiitday</a></header>
<main>
${body}
</main>
<footer><a href="confidentialite.html">Confidentialité</a><a href="mentions-legales.html">Mentions légales</a><a href="suppression-compte.html">Supprimer son compte</a><a href="./">Ouvrir l'appli</a></footer>
</div></body>
</html>
`);
}

// dist/ remplacé d'un coup
fs.rmSync(distFinal, { recursive: true, force: true });
fs.renameSync(dist, distFinal);

// Appli Android : la même page, embarquée dans l'APK (avec sa propre politique de sécurité : aucun cadre)
const www = path.join(__dirname, "android", "app", "src", "main", "assets", "www");
fs.mkdirSync(www, { recursive: true });
fs.writeFileSync(path.join(www, "index.html"), html.replace(CSP, CSP_APP));
for (const f of ["icon-192.png", "icon-512.png", "exercices.js", "three.module.min.js"]) fs.copyFileSync(path.join(distFinal, f), path.join(www, f));
console.log("Construit :", VERSION, "—", (html.length / 1024).toFixed(0), "Ko");
