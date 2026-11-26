package com.fiitday.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.media.AudioAttributes;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;

import java.lang.ref.WeakReference;


/**
 * Minuteurs dans les notifications : repos (compte à rebours) et chrono (gainage, étirement, course).
 * - une notification permanente affiche le temps qui défile ; sur Android 16 et plus, elle demande à être une
 *   « Live Update » (en haut de l'écran verrouillé, pastille dans la barre d'état ; sur les montres qui le permettent) ;
 * - option « montre » : l'alerte de fin (fin du repos, objectif du chrono) part aussi quand Fiitday est à l'écran
 *   et vibre elle-même, pour que la montre la reçoive et vibre (rien n'est envoyé à la montre au départ) ;
 * - à la fin du repos ou à l'objectif du chrono, si l'appli n'est pas à l'écran, le service sonne et/ou vibre ; si la
 *   notification ne peut pas vibrer (notifications refusées, canal coupé, « Ne pas déranger »), le service vibre lui-même ;
 * - un verrou de réveil partiel, limité à la durée du repos, garde le compte à rebours à l'heure écran éteint.
 * Service de premier plan de type « usage particulier » (specialUse) : sans limite de durée (un repos peut durer 20 min ;
 * le type « courte durée » était arrêté par Android au bout de 3 minutes, sans alerte).
 */
public class RestTimerService extends Service {
    static final int ONGOING_ID = 10;
    static final int ALERT_ID = 11;
    static final int WATCH_ID = 13;
    private static final String CH_ONGOING = "repos_en_cours";
    private static final String CH_END = "repos_fin";
    private static final String CH_WATCH_OLD = "montre_depart"; // V1.40 : notification de départ, retirée
    private static final String CH_END_WATCH = "montre_fin";
    static final String ACT_SKIP = "com.fiitday.app.SKIP_REST";
    static final String ACT_STOP = "com.fiitday.app.STOP_CHRONO";
    private static final long[] PATTERN = new long[]{0, 350, 150, 350};
    /** heure de fin (ms) du dernier repos ou objectif signalé par une notification : l'appli ne re-sonne pas en revenant */
    static volatile long alertedEnd = 0;
    /** minuteur en cours dans le service : « rest », « chrono » ou null (mis à jour dès la demande, avant le démarrage) */
    static volatile String current = null;

    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    /** service en marche (fil principal seulement) : un nouveau minuteur lui est passé directement, sans redémarrer le service
     *  (Android interdit souvent de démarrer un service de premier plan quand l'appli est en arrière-plan, après « Terminer » sur la montre) */
    private static WeakReference<RestTimerService> running = new WeakReference<>(null);
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable fire = this::onEnd;
    private final Runnable stopper = this::finish;
    private boolean stopping = false;
    private PowerManager.WakeLock wake;
    private String kind = "rest";
    private long end = 0;    // repos : heure de fin ; chrono : heure de l'objectif (0 = pas d'objectif)
    private long start = 0;  // chrono : heure de départ (après les 5 s de préparation)
    private String mode = "vibration", title = "", text = "";
    private boolean watch = false, reached = false;

    static void start(Context c, long end, String mode) { startRest(c, end, mode, "", false); }

    static void startRest(Context c, long end, String mode, String title, boolean watch) {
        current = "rest";
        launch(c, new Intent(c, RestTimerService.class).putExtra("kind", "rest").putExtra("end", end)
                .putExtra("mode", mode).putExtra("title", title).putExtra("watch", watch));
    }

    static void startChrono(Context c, long start, long targetSec, String mode, String title, String text, boolean watch) {
        current = "chrono";
        launch(c, new Intent(c, RestTimerService.class).putExtra("kind", "chrono").putExtra("start", start)
                .putExtra("end", targetSec > 0 ? start + targetSec * 1000 : 0).putExtra("mode", mode)
                .putExtra("title", title).putExtra("text", text).putExtra("watch", watch));
    }

    private static void launch(Context c, Intent i) {
        final Context app = c.getApplicationContext();
        MAIN.post(() -> {
            RestTimerService s = running.get();
            if (s != null && !s.stopping) { s.apply(i, false); return; }
            try {
                if (Build.VERSION.SDK_INT >= 26) app.startForegroundService(i);
                else app.startService(i);
            } catch (Exception e) {
                // Android a refusé de démarrer le minuteur (appli en arrière-plan) : l'appli prévient
                current = null;
                MainActivity.toPage("window.__fiitdayTimerFail&&window.__fiitdayTimerFail()");
            }
        });
    }

    /**
     * arrête le minuteur s'il est de ce genre (null : quel qu'il soit) — un chrono qui vient de démarrer n'est pas coupé par la fin d'un repos.
     * Le service attend 3 s avant de s'arrêter : le repos qui suit un chrono arrêté le reprend sans le redémarrer.
     */
    static void stop(Context c, String onlyKind) {
        if (onlyKind != null && current != null && !onlyKind.equals(current)) return;
        current = null;
        final Context app = c.getApplicationContext();
        MAIN.post(() -> {
            RestTimerService s = running.get();
            if (s != null && !s.stopping) { s.idle(); return; }
            try { app.stopService(new Intent(app, RestTimerService.class)); } catch (Exception ignored) { }
            NotificationManager nm = (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) { nm.cancel(ONGOING_ID); nm.cancel(WATCH_ID); }
        });
    }

    static void stop(Context c) { stop(c, null); }

    /** « Passer » le repos dans la notification : arrêt tout de suite (la notification disparaît) */
    static void stopNow(Context c) {
        current = null;
        final Context app = c.getApplicationContext();
        MAIN.post(() -> {
            RestTimerService s = running.get();
            if (s != null && !s.stopping) { s.handler.removeCallbacks(s.fire); s.finish(); return; }
            try { app.stopService(new Intent(app, RestTimerService.class)); } catch (Exception ignored) { }
            NotificationManager nm = (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) { nm.cancel(ONGOING_ID); nm.cancel(WATCH_ID); }
        });
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = new WeakReference<>(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }
        stopping = false;
        running = new WeakReference<>(this);
        if (!apply(intent, true)) { finish(); }
        return START_NOT_STICKY;
    }

    /** nouveau minuteur (au démarrage du service, ou passé au service déjà en marche) */
    private boolean apply(Intent intent, boolean first) {
        String k = intent.getStringExtra("kind");
        kind = "chrono".equals(k) ? "chrono" : "rest";
        end = intent.getLongExtra("end", 0);
        start = intent.getLongExtra("start", 0);
        String m = intent.getStringExtra("mode");
        mode = m == null ? "vibration" : m;
        title = str(intent.getStringExtra("title"));
        text = str(intent.getStringExtra("text"));
        watch = intent.getBooleanExtra("watch", false);
        reached = false;
        current = kind;
        handler.removeCallbacks(fire);
        handler.removeCallbacks(stopper); // un nouveau minuteur annule l'arrêt prévu (après le son précédent, ou après un chrono arrêté)
        if (first) {
            try {
                if (Build.VERSION.SDK_INT >= 34) startForeground(ONGOING_ID, ongoing(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
                else startForeground(ONGOING_ID, ongoing());
            } catch (Exception e) {
                current = null;
                MainActivity.toPage("window.__fiitdayTimerFail&&window.__fiitdayTimerFail()");
                return false;
            }
        } else {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) { try { nm.notify(ONGOING_ID, ongoing()); } catch (SecurityException ignored) { } }
        }
        cancelWatchCard();
        if (end > 0) {
            long d = end - System.currentTimeMillis();
            if (d <= 0) onEnd();
            else { awake(d + 15000); handler.postDelayed(fire, d); }
        } else release();
        return true;
    }

    /** verrou de réveil partiel : le compte à rebours continue écran éteint (il se libère seul après la durée donnée) */
    private void awake(long ms) {
        try {
            if (wake == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm == null) return;
                wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "fiitday:minuteur");
                wake.setReferenceCounted(false);
            }
            wake.acquire(Math.max(1000, Math.min(ms, 30 * 60 * 1000L)));
        } catch (Exception ignored) { }
    }

    private void release() {
        try { if (wake != null && wake.isHeld()) wake.release(); } catch (Exception ignored) { }
    }

    /** minuteur arrêté : le service attend 3 s un éventuel minuteur suivant, puis s'arrête */
    private void idle() {
        current = null;
        handler.removeCallbacks(fire);
        release();
        handler.removeCallbacks(stopper);
        handler.postDelayed(stopper, 3000);
    }

    private void finish() {
        stopping = true;
        release();
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) { nm.cancel(ONGOING_ID); nm.cancel(WATCH_ID); }
        stopSelf();
    }

    private static String str(String s) { return s == null ? "" : s; }

    private boolean isChrono() { return "chrono".equals(kind); }

    private void onEnd() {
        release();
        boolean visible = MainActivity.visible;
        // avec l'option montre, l'alerte part aussi quand Fiitday est à l'écran (la montre doit vibrer) ; le son reste joué par l'appli
        boolean notify = !"aucune".equals(mode) && (watch || !visible);
        boolean played = false;
        if (notify) {
            played = alert(!visible);
            if (!visible) alertedEnd = end;
        }
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (isChrono()) {
            // objectif atteint : le chrono continue jusqu'à « Terminer »
            reached = true;
            if (nm != null) { try { nm.notify(ONGOING_ID, ongoing()); } catch (SecurityException ignored) { } }
            return;
        }
        if (nm != null) nm.cancel(WATCH_ID);
        current = null;
        stopping = true; // plus au premier plan : un nouveau minuteur redémarrera le service
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        // le son joue encore quelques secondes : le service s'arrête juste après
        if (played) handler.postDelayed(stopper, 4000);
        else stopSelf();
    }

    private static PendingIntent openApp(Context c) {
        Intent open = new Intent(c, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private PendingIntent openApp() { return openApp(this); }

    /** bouton « Passer » (repos) ou « Terminer » (chrono), aussi affiché sur la montre */
    private static Notification.Action action(Context c, boolean chrono) {
        String act = chrono ? ACT_STOP : ACT_SKIP;
        Intent i = new Intent(c, ActionReceiver.class).setAction(act);
        PendingIntent pi = PendingIntent.getBroadcast(c, chrono ? 2 : 1, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Action.Builder(Icon.createWithResource(c, R.drawable.ic_stat), chrono ? "Terminer" : "Passer", pi).build();
    }

    private Notification.Action action() { return action(this, isChrono()); }

    private Notification.Builder builder(String channel) {
        return Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, channel) : new Notification.Builder(this);
    }

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        // anciens canaux (le son y dépendait des réglages de notification du téléphone)
        for (String old : new String[]{"repos_deux", "repos_son", "repos_vib"}) { try { nm.deleteNotificationChannel(old); } catch (Exception ignored) { } }
        if (nm.getNotificationChannel(CH_ONGOING) == null) {
            NotificationChannel nc = new NotificationChannel(CH_ONGOING, "Minuteur en cours", NotificationManager.IMPORTANCE_LOW);
            nc.setSound(null, null);
            nc.enableVibration(false);
            nm.createNotificationChannel(nc);
        }
        if (nm.getNotificationChannel(CH_END) == null) {
            NotificationChannel nc = new NotificationChannel(CH_END, "Fin du repos", NotificationManager.IMPORTANCE_HIGH);
            nc.setSound(null, null);
            nc.enableVibration(false);
            nm.createNotificationChannel(nc);
        }
        try { nm.deleteNotificationChannel(CH_WATCH_OLD); } catch (Exception ignored) { }
        if (nm.getNotificationChannel(CH_END_WATCH) == null) {
            NotificationChannel nc = new NotificationChannel(CH_END_WATCH, "Montre : fin du repos ou objectif atteint", NotificationManager.IMPORTANCE_HIGH);
            nc.setSound(null, null);
            nc.enableVibration(true);
            nc.setVibrationPattern(PATTERN);
            nm.createNotificationChannel(nc);
        }
    }

    /** temps « m:ss » */
    private static String clock(long ms) {
        long s = Math.max(0, Math.round(ms / 1000.0));
        return (s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
    }

    /** notification permanente : le temps défile (compte à rebours du repos, chrono qui monte) */
    private Notification ongoing() {
        channels(this);
        boolean chrono = isChrono();
        String t = chrono ? (title.isEmpty() ? "Chrono" : title) : (title.isEmpty() || "Repos".equals(title) ? "Repos en cours" : title);
        String x = chrono ? (reached ? "Objectif atteint 💪 · Terminer quand tu veux" : (text.isEmpty() ? "Appuie sur Terminer à la fin" : text))
                : "Fiitday te prévient à la fin du repos.";
        Notification.Builder b = builder(CH_ONGOING)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(t)
                .setContentText(x)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(openApp())
                .setWhen(chrono ? start : end)
                .setShowWhen(true)
                .setUsesChronometer(true)
                .setCategory(Notification.CATEGORY_STOPWATCH)
                .addAction(action());
        if (Build.VERSION.SDK_INT >= 24) b.setChronometerCountDown(!chrono);
        if (Build.VERSION.SDK_INT >= 26 && !chrono) b.setTimeoutAfter(Math.max(1000, end - System.currentTimeMillis() + 2000));
        // Android 16 et plus : demande à devenir une « Live Update » (Notification.EXTRA_REQUEST_PROMOTED_ONGOING)
        Bundle ex = new Bundle();
        ex.putBoolean("android.requestPromotedOngoing", true);
        b.addExtras(ex);
        return b.build();
    }

    /** la notification de départ envoyée à la montre (V1.40) n'existe plus : on enlève celle qui resterait affichée */
    private void cancelWatchCard() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(WATCH_ID);
    }

    /**
     * Fin du repos ou objectif du chrono : notification « Pause terminée » / « Objectif atteint ».
     * Le son passe par le flux « alarme » : il se fait entendre même écran verrouillé (le son d'une notification peut y être coupé).
     * Avec l'option montre, la notification vibre elle-même (la montre vibre aussi) : le service ne vibre pas en plus, sauf si la
     * notification ne peut pas vibrer (notifications refusées, canal coupé, « Ne pas déranger ») : le téléphone vibre alors lui-même.
     * @param local vrai si l'appli n'est pas à l'écran : le service joue alors le son (sinon c'est l'appli)
     * @return vrai si un son a été lancé (le service doit rester actif le temps qu'il joue)
     */
    private boolean alert(boolean local) {
        return endAlert(this, handler, mode, watch, local, isChrono(), title, end, start);
    }

    /**
     * La notification pourra-t-elle vibrer (et arriver sur la montre) ? Non si les notifications de Fiitday sont refusées,
     * si ce canal est coupé ou sans vibration, ou en « Ne pas déranger ».
     */
    static boolean notifWorks(Context c, String channel) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return false;
        if (Build.VERSION.SDK_INT >= 24 && !nm.areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= 26) {
            channels(c);
            NotificationChannel ch = nm.getNotificationChannel(channel);
            if (ch == null || ch.getImportance() == NotificationManager.IMPORTANCE_NONE || !ch.shouldVibrate()) return false;
        }
        if (Build.VERSION.SDK_INT >= 23 && nm.getCurrentInterruptionFilter() > NotificationManager.INTERRUPTION_FILTER_ALL) return false;
        return true;
    }

    /** les notifications de Fiitday sont-elles autorisées (affichage à l'écran verrouillé et sur la montre) ? */
    static boolean notificationsOn(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return false;
        if (Build.VERSION.SDK_INT >= 24 && !nm.areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= 26) {
            channels(c);
            NotificationChannel ch = nm.getNotificationChannel(CH_END_WATCH);
            if (ch != null && ch.getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
        }
        return true;
    }

    /** Réglages › Alerte de fin de repos › Tester (appli Android) : la vraie alerte de fin de repos, 5 s plus tard (le temps de verrouiller) */
    static void testAlert(Context c, String mode) {
        final Context app = c.getApplicationContext();
        MAIN.postDelayed(() -> endAlert(app, MAIN, mode == null ? "vibration" : mode, true, true, false, "", 0, 0), 5000);
    }

    private static boolean endAlert(Context c, Handler h, String mode, boolean watch, boolean local, boolean chrono, String title, long end, long start) {
        boolean wantVib = mode.equals("vibration") || mode.equals("les deux");
        boolean sound = local && (mode.equals("son") || mode.equals("les deux"));
        // avec l'option montre, c'est la notification qui vibre (téléphone et montre) ; si elle ne le peut pas, le téléphone vibre lui-même
        boolean vib = wantVib && (watch ? !notifWorks(c, CH_END_WATCH) : local);
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) { if (vib) vibrate(c); return false; }
        channels(c);
        String ch = watch ? CH_END_WATCH : CH_END;
        Notification.Builder b = (Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, ch) : new Notification.Builder(c))
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(chrono ? "Objectif atteint 💪" : "Pause terminée")
                .setContentText(chrono ? (title.isEmpty() ? "Tu peux arrêter le chrono" : title + (end > start ? " · " + clock(end - start) + " tenu" : "")) : "C'est reparti 💪")
                .setAutoCancel(true)
                .setContentIntent(openApp(c))
                .setCategory(Notification.CATEGORY_REMINDER);
        if (chrono) b.addAction(action(c, true));
        if (Build.VERSION.SDK_INT < 26) {
            b.setPriority(Notification.PRIORITY_HIGH);
            if (watch) b.setVibrate(PATTERN);
        }
        try { nm.notify(ALERT_ID, b.build()); } catch (SecurityException ignored) { }
        if (vib) vibrate(c);
        if (!sound) return false;
        try {
            Uri u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            if (u == null) u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            final Ringtone r = RingtoneManager.getRingtone(c, u);
            if (r == null) return false;
            r.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            r.play();
            h.postDelayed(() -> { try { r.stop(); } catch (Exception ignored) { } }, 3500);
            return true;
        } catch (Exception e) { return false; }
    }

    private static void vibrate(Context c) {
        try {
            Vibrator v = (Vibrator) c.getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createWaveform(PATTERN, -1),
                        new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
                else v.vibrate(PATTERN, -1);
            }
        } catch (Exception ignored) { }
    }

    /** Réglages › Montre connectée › Tester : une notification qui doit arriver (et vibrer) sur la montre */
    static void testWatch(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        channels(c);
        Intent open = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        Notification.Builder b = (Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CH_END_WATCH) : new Notification.Builder(c))
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle("Test de la montre")
                .setContentText("Si tu lis ceci sur ta montre, tout est prêt 👍")
                .setAutoCancel(true)
                .setContentIntent(PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        if (Build.VERSION.SDK_INT < 26) { b.setPriority(Notification.PRIORITY_HIGH); b.setVibrate(PATTERN); }
        try { nm.notify(ALERT_ID, b.build()); } catch (SecurityException ignored) { }
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(fire);
        handler.removeCallbacks(stopper);
        release();
        if (running.get() == this) running.clear();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
