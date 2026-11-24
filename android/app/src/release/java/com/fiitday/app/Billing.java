package com.fiitday.app;

import android.app.Activity;
import android.content.Context;

/**
 * Appli publiée : pas encore d'achat dans l'appli (le paiement Google sera branché avec le Play Store).
 * La version qui achète vraiment est dans src/debug (appli « Fiitday Test », magasin de test RevenueCat).
 */
final class Billing {
    interface Result { void done(String status, String text); }

    private Billing() { }

    static void setup(Context c) { }

    static String mode() { return ""; }

    static void buy(Activity a, String uid, String productId, boolean subscription, Result r) { r.done("error", "Achat indisponible"); }

    static void restore(String uid, Result r) { r.done("error", "Achat indisponible"); }

    static void logout() { }
}
