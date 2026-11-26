package com.fiitday.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.app.NotificationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.ref.WeakReference;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;

/**
 * Coque Android de Fiitday : affiche l'appli web embarquée (assets/www)
 * et lui donne accès à la vibration et au maintien de l'écran allumé.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private WebView web;
    /** l'appli est-elle à l'écran ? (sinon le minuteur de repos prévient par une notification) */
    static volatile boolean visible = false;
    /** sauvegarde en fichier : le téléphone demande où l'enregistrer, puis quel fichier relire */
    private static final int REQ_SAVE = 41, REQ_OPEN = 42;
    private static final long MAX_FILE = 20L * 1024 * 1024;
    /** contenu à enregistrer, gardé dans un fichier de l'appli pendant que le sélecteur est ouvert : si Android ferme l'appli
     *  entre-temps (manque de mémoire), il est relu au retour au lieu de laisser un fichier de sauvegarde vide */
    private static final String SAVE_FILE = "a-enregistrer.bin", OPEN_FILE = "fichier-lu.txt";
    /** appli ouverte (pour lui transmettre les boutons « Passer » / « Terminer » des notifications) */
    private static WeakReference<MainActivity> currentActivity = new WeakReference<>(null);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        currentActivity = new WeakReference<>(this);
        Billing.setup(this); // achats : seulement dans l'appli de test pour l'instant
        makeWeb();
        // toujours charger la page (même après une fermeture par Android) : l'appli relit tout dans son stockage ;
        // on revient à la même page de l'appli si on la connaît
        String url = savedInstanceState != null ? savedInstanceState.getString("url") : null;
        if (url == null || !url.startsWith("https://" + HOST + "/")) url = "https://" + HOST + "/index.html";
        web.loadUrl(url);
    }

    /** crée l'affichage de l'appli (au démarrage, et après un plantage du moteur d'affichage) */
    private void makeWeb() {
        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                String path = u.getPath();
                if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
                try {
                    InputStream in = getAssets().open("www" + path);
                    return new WebResourceResponse(mime(path), "utf-8", in);
                } catch (IOException e) {
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                            new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) {
                }
                return true;
            }

            /** le moteur d'affichage s'est arrêté (manque de mémoire, vues 3D…) : on recrée la page au lieu de fermer l'appli */
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (view != web) return true;
                try { ((ViewGroup) view.getParent()).removeView(view); } catch (Exception ignored) { }
                try { view.destroy(); } catch (Exception ignored) { }
                web = null;
                if (isFinishing() || isDestroyed()) return true;
                makeWeb();
                web.loadUrl("https://" + HOST + "/index.html");
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
    }

    private static String mime(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "application/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".json") || path.endsWith(".webmanifest")) return "application/json";
        if (path.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    /** Fonctions appelées depuis le JavaScript (window.AndroidBridge). */
    private class Bridge {
        @JavascriptInterface
        public void vibrate(String patternJson) {
            try {
                JSONArray a = new JSONArray(patternJson);
                long[] p = new long[a.length() + 1];
                p[0] = 0;
                for (int i = 0; i < a.length(); i++) p[i + 1] = a.getLong(i);
                Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (v == null || !v.hasVibrator()) return;
                if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createWaveform(p, -1));
                else v.vibrate(p, -1);
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void keepScreenOn(final boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        @JavascriptInterface
        public void startRestTimer(String at, String mode) {
            long end;
            try { end = Long.parseLong(at); } catch (Exception e) { return; }
            RestTimerService.start(MainActivity.this, end, mode);
        }

        @JavascriptInterface
        public void stopRestTimer() { RestTimerService.stop(MainActivity.this, "rest"); }

        /** repos avec titre et option montre */
        @JavascriptInterface
        public void startRest(String at, String mode, String title, boolean watch) {
            long end;
            try { end = Long.parseLong(at); } catch (Exception e) { return; }
            RestTimerService.startRest(MainActivity.this, end, mode, title, watch);
        }

        /** chrono (gainage, étirement, course) : départ, objectif en secondes (0 = aucun) */
        @JavascriptInterface
        public void startChrono(String startAt, String targetSec, String mode, String title, String text, boolean watch) {
            long st, tg;
            try { st = Long.parseLong(startAt); tg = Long.parseLong(targetSec); } catch (Exception e) { return; }
            RestTimerService.startChrono(MainActivity.this, st, tg, mode, title, text, watch);
        }

        @JavascriptInterface
        public void stopChrono() { RestTimerService.stop(MainActivity.this, "chrono"); }

        @JavascriptInterface
        public void testWatch() { new Handler(Looper.getMainLooper()).postDelayed(() -> RestTimerService.testWatch(MainActivity.this), 5000); } // 5 s pour verrouiller le téléphone

        /** bouton appuyé dans une notification (ou sur la montre) en attente : {"act":"chronostop","at":…} ou "" */
        @JavascriptInterface
        public String takeAction() {
            SharedPreferences p = getSharedPreferences("fiitday", MODE_PRIVATE);
            String act = p.getString("action", "");
            long at = p.getLong("action_at", 0);
            p.edit().remove("action").remove("action_at").apply();
            if (act == null || act.isEmpty()) return "";
            return "{\"act\":" + JSONObject.quote(act) + ",\"at\":" + at + "}";
        }

        @JavascriptInterface
        public String restAlertedAt() { return String.valueOf(RestTimerService.alertedEnd); }

        @JavascriptInterface
        public void askNotifications() {
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                getSharedPreferences("fiitday", MODE_PRIVATE).edit().putBoolean("notif_asked", true).apply();
                runOnUiThread(() -> requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 2));
            }
        }

        /** notifications de Fiitday autorisées ? « 1 » oui, « 0 » non */
        @JavascriptInterface
        public String notificationsOn() { return RestTimerService.notificationsOn(MainActivity.this) ? "1" : "0"; }

        /** autoriser les notifications : la question d'Android si elle peut encore être posée, sinon les réglages de Fiitday */
        @JavascriptInterface
        public void enableNotifications() {
            runOnUiThread(() -> {
                boolean asked = getSharedPreferences("fiitday", MODE_PRIVATE).getBoolean("notif_asked", false);
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED
                        && (!asked || shouldShowRequestPermissionRationale("android.permission.POST_NOTIFICATIONS"))) {
                    getSharedPreferences("fiitday", MODE_PRIVATE).edit().putBoolean("notif_asked", true).apply();
                    requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 2);
                    return;
                }
                Intent i;
                if (Build.VERSION.SDK_INT >= 26) i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                else i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
                try { startActivity(i); } catch (Exception e) {
                    try { startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))); } catch (Exception ignored) { }
                }
            });
        }

        /** Réglages › Alerte de fin de repos › Tester : la vraie alerte de fin de repos dans 5 s */
        @JavascriptInterface
        public void testAlert(String mode) { RestTimerService.testAlert(MainActivity.this, mode); }

        /** résultat d'un enregistrement ou d'une lecture de fichier en attente (page rechargée entre-temps) : {"kind","status","text"} ou "" */
        @JavascriptInterface
        public String takeFile() { return takeFileResult(); }

        @JavascriptInterface
        public void share(final String text) {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_TEXT, text);
                try { startActivity(Intent.createChooser(i, "Partager la séance")); } catch (Exception ignored) { }
            });
        }

        /** Réglages › Données › Enregistrer une sauvegarde : choix de l'emplacement (Téléchargements, Drive…) */
        @JavascriptInterface
        public void saveFile(final String name, final String content) {
            final byte[] bytes = content == null ? new byte[0] : content.getBytes(StandardCharsets.UTF_8);
            runOnUiThread(() -> pickSave(name, "text/plain", bytes));
        }

        /** Administration › Registre des recettes › PDF : même choix de l'emplacement, contenu binaire en base64 */
        @JavascriptInterface
        public void saveBytes(final String name, final String mime, final String base64) {
            runOnUiThread(() -> {
                byte[] bytes;
                try { bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT); }
                catch (Exception e) { fileResult("save", "error", null); return; }
                pickSave(name, mime == null || mime.isEmpty() ? "application/octet-stream" : mime, bytes);
            });
        }

        /** Réglages › Données › Restaurer une sauvegarde : choix du fichier, relu ici puis donné à l'appli */
        @JavascriptInterface
        public void openFile() {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try { startActivityForResult(i, REQ_OPEN); }
                catch (Exception e) { fileResult("open", "error", null); }
            });
        }

        @JavascriptInterface
        public String version() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
            catch (Exception e) { return ""; }
        }

        /* achats (RevenueCat) : actifs seulement dans l'appli « Fiitday Test » pour l'instant, voir Billing */
        @JavascriptInterface
        public String billing() { return Billing.mode(); }

        @JavascriptInterface
        public void billingBuy(final String cb, final String uid, final String productId, final boolean subscription) {
            runOnUiThread(() -> Billing.buy(MainActivity.this, uid, productId, subscription, (st, txt) -> billingResult(cb, st, txt)));
        }

        @JavascriptInterface
        public void billingRestore(final String cb, final String uid) {
            runOnUiThread(() -> Billing.restore(uid, (st, txt) -> billingResult(cb, st, txt)));
        }

        @JavascriptInterface
        public void billingLogout() { runOnUiThread(Billing::logout); }
    }

    /** renvoie le résultat d'un achat à l'appli web : window.__fiitdayBilling(id, "ok" | "cancel" | "error", texte) */
    private void billingResult(String cb, String status, String text) {
        if (web == null) return;
        final String js = "window.__fiitdayBilling&&window.__fiitdayBilling(" + JSONObject.quote(cb) + "," + JSONObject.quote(status) + "," + JSONObject.quote(text == null ? "" : text) + ")";
        web.post(() -> { if (web != null) web.evaluateJavascript(js, null); });
    }

    /** exécute un petit bout de JavaScript dans l'appli ouverte (s'il y en a une) */
    static void toPage(final String js) {
        final MainActivity a = currentActivity.get();
        if (a == null) return;
        a.runOnUiThread(() -> { if (a.web != null) a.web.evaluateJavascript(js, null); });
    }

    /** enregistrement : le contenu est d'abord écrit dans un fichier de l'appli, puis le téléphone demande où l'enregistrer */
    private void pickSave(String name, String mime, byte[] bytes) {
        File f = new File(getCacheDir(), SAVE_FILE);
        try (OutputStream out = new FileOutputStream(f)) { out.write(bytes); }
        catch (Exception e) { fileResult("save", "error", null); return; }
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(mime);
        i.putExtra(Intent.EXTRA_TITLE, name);
        try { startActivityForResult(i, REQ_SAVE); }
        catch (Exception e) { f.delete(); fileResult("save", "error", null); }
    }

    /** bouton « Passer » / « Terminer » : gardé jusqu'à ce que l'appli le prenne, et l'appli ouverte est prévenue tout de suite */
    static void deliverAction(Context c, String act, long at) {
        c.getSharedPreferences("fiitday", MODE_PRIVATE).edit().putString("action", act).putLong("action_at", at).apply();
        final MainActivity a = currentActivity.get();
        if (a == null) return;
        a.runOnUiThread(() -> { if (a.web != null) a.web.evaluateJavascript("window.__fiitdayPending&&window.__fiitdayPending()", null); });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_SAVE && requestCode != REQ_OPEN) return;
        Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
        if (requestCode == REQ_SAVE) {
            File f = new File(getCacheDir(), SAVE_FILE);
            byte[] bin = f.exists() ? readFile(f) : null;
            f.delete();
            if (uri == null) { fileResult("save", "cancel", null); return; }
            if (bin == null) { fileResult("save", "error", null); return; }
            fileResult("save", writeBytes(uri, bin) ? "ok" : "error", null);
        } else {
            if (uri == null) { fileResult("open", "cancel", null); return; }
            String text = readText(uri);
            fileResult("open", text != null ? "ok" : "error", text);
        }
    }

    private static byte[] readFile(File f) {
        try (InputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] b = new byte[8192];
            int n;
            while ((n = in.read(b)) > 0) buf.write(b, 0, n);
            return buf.toByteArray();
        } catch (Exception e) { return null; }
    }

    private boolean writeBytes(Uri uri, byte[] bytes) {
        for (String mode : new String[]{"wt", "w"}) { // certains services (Drive…) refusent « wt »
            try (OutputStream out = getContentResolver().openOutputStream(uri, mode)) {
                if (out == null) continue;
                out.write(bytes);
                out.flush();
                return true;
            } catch (Exception ignored) {
            }
        }
        return false;
    }

    private String readText(Uri uri) {
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            if (in == null) return null;
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] b = new byte[8192];
            long total = 0;
            int n;
            while ((n = in.read(b)) > 0) {
                total += n;
                if (total > MAX_FILE) return null;
                buf.write(b, 0, n);
            }
            return new String(buf.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * résultat d'un enregistrement ou d'une lecture de fichier : gardé (le texte lu dans un fichier de l'appli) jusqu'à ce que
     * l'appli le prenne (Native.takeFile), même si la page a été rechargée entre-temps ; l'appli ouverte est prévenue tout de suite
     */
    private void fileResult(String kind, String status, String text) {
        File t = new File(getCacheDir(), OPEN_FILE);
        if (text != null) {
            try (OutputStream out = new FileOutputStream(t)) { out.write(text.getBytes(StandardCharsets.UTF_8)); }
            catch (Exception e) { status = "error"; t.delete(); }
        } else t.delete();
        getSharedPreferences("fiitday", MODE_PRIVATE).edit().putString("file_kind", kind).putString("file_status", status)
                .putLong("file_at", System.currentTimeMillis()).apply();
        if (web != null) web.post(() -> { if (web != null) web.evaluateJavascript("window.__fiitdayFileReady&&window.__fiitdayFileReady()", null); });
    }

    private String takeFileResult() {
        SharedPreferences p = getSharedPreferences("fiitday", MODE_PRIVATE);
        String kind = p.getString("file_kind", ""), status = p.getString("file_status", "");
        long at = p.getLong("file_at", 0);
        p.edit().remove("file_kind").remove("file_status").remove("file_at").apply();
        File t = new File(getCacheDir(), OPEN_FILE);
        String text = null;
        if (t.exists()) { byte[] b = readFile(t); t.delete(); if (b != null) text = new String(b, StandardCharsets.UTF_8); }
        if (kind == null || kind.isEmpty() || System.currentTimeMillis() - at > 30 * 60 * 1000L) return "";
        try {
            JSONObject o = new JSONObject();
            o.put("kind", kind); o.put("status", status);
            if (text != null) o.put("text", text);
            return o.toString();
        } catch (Exception e) { return ""; }
    }

    @Override
    protected void onResume() {
        super.onResume();
        visible = true;
        if (web != null) { web.resumeTimers(); web.onResume(); }
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(RestTimerService.ALERT_ID); // de retour dans l'appli : l'alerte de fin n'est plus utile
    }

    @Override
    protected void onPause() {
        visible = false;
        // en arrière-plan, la page s'arrête (minuteurs, animations) : les alertes de repos et de chrono sont faites par Android
        if (web != null) { web.onPause(); web.pauseTimers(); }
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null && web.getUrl() != null) outState.putString("url", web.getUrl());
    }

    @Override
    protected void onDestroy() {
        if (currentActivity.get() == this) currentActivity.clear();
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
