package com.fiitday.app;

import android.app.Activity;
import android.content.Context;

import com.revenuecat.purchases.CustomerInfo;
import com.revenuecat.purchases.LogLevel;
import com.revenuecat.purchases.ProductType;
import com.revenuecat.purchases.PurchaseParams;
import com.revenuecat.purchases.Purchases;
import com.revenuecat.purchases.PurchasesConfiguration;
import com.revenuecat.purchases.PurchasesError;
import com.revenuecat.purchases.interfaces.GetStoreProductsCallback;
import com.revenuecat.purchases.interfaces.LogInCallback;
import com.revenuecat.purchases.interfaces.PurchaseCallback;
import com.revenuecat.purchases.interfaces.ReceiveCustomerInfoCallback;
import com.revenuecat.purchases.models.StoreProduct;
import com.revenuecat.purchases.models.StoreTransaction;

import java.util.Collections;
import java.util.List;

/**
 * Achats avec RevenueCat, dans l'appli « Fiitday Test » seulement (variante debug) :
 * clé du magasin de test RevenueCat (achats factices, aucun paiement). L'appli publiée (release) a sa propre
 * version de cette classe, qui ne fait rien tant que le paiement Google n'est pas branché.
 * Chaque achat est lié au compte Fiitday (identifiant Supabase) : le serveur reçoit ensuite le message de RevenueCat.
 */
final class Billing {
    interface Result { void done(String status, String text); }

    private static boolean ready = false;

    private Billing() { }

    static void setup(Context c) {
        String key = BuildConfig.RC_KEY;
        if (key == null || key.isEmpty()) return;
        try {
            Purchases.setLogLevel(LogLevel.DEBUG);
            if (!Purchases.isConfigured()) {
                Purchases.configure(new PurchasesConfiguration.Builder(c.getApplicationContext(), key)
                        .automaticDeviceIdentifierCollectionEnabled(false) // pas d'identifiant publicitaire
                        .showInAppMessagesAutomatically(false)
                        .build());
            }
            ready = true;
        } catch (Throwable t) {
            ready = false;
        }
    }

    /** « test » (magasin de test), « store » (vrai paiement) ou « » (pas d'achat possible) */
    static String mode() {
        if (!ready) return "";
        return BuildConfig.RC_KEY.startsWith("test_") ? "test" : "store";
    }

    private static String msg(PurchasesError e) {
        return e == null ? "" : e.getMessage();
    }

    static void buy(final Activity a, String uid, final String productId, final boolean subscription, final Result r) {
        if (!ready) { r.done("error", "Achat indisponible"); return; }
        final Purchases p = Purchases.getSharedInstance();
        p.logIn(uid, new LogInCallback() {
            @Override public void onReceived(CustomerInfo info, boolean created) {
                p.getProducts(Collections.singletonList(productId), subscription ? ProductType.SUBS : ProductType.INAPP, new GetStoreProductsCallback() {
                    @Override public void onReceived(List<StoreProduct> list) {
                        if (list == null || list.isEmpty()) { r.done("error", "Produit introuvable : " + productId); return; }
                        p.purchase(new PurchaseParams.Builder(a, list.get(0)).build(), new PurchaseCallback() {
                            @Override public void onCompleted(StoreTransaction t, CustomerInfo ci) { r.done("ok", productId); }
                            @Override public void onError(PurchasesError e, boolean cancelled) { r.done(cancelled ? "cancel" : "error", msg(e)); }
                        });
                    }
                    @Override public void onError(PurchasesError e) { r.done("error", msg(e)); }
                });
            }
            @Override public void onError(PurchasesError e) { r.done("error", msg(e)); }
        });
    }

    /** « ok » avec la liste des produits achetés (vide si aucun) */
    static void restore(String uid, final Result r) {
        if (!ready) { r.done("error", "Achat indisponible"); return; }
        final Purchases p = Purchases.getSharedInstance();
        p.logIn(uid, new LogInCallback() {
            @Override public void onReceived(CustomerInfo info, boolean created) {
                p.restorePurchases(new ReceiveCustomerInfoCallback() {
                    @Override public void onReceived(CustomerInfo ci) { r.done("ok", android.text.TextUtils.join(",", ci.getAllPurchasedProductIds())); }
                    @Override public void onError(PurchasesError e) { r.done("error", msg(e)); }
                });
            }
            @Override public void onError(PurchasesError e) { r.done("error", msg(e)); }
        });
    }

    static void logout() {
        if (!ready) return;
        try {
            Purchases.getSharedInstance().logOut(new ReceiveCustomerInfoCallback() {
                @Override public void onReceived(CustomerInfo ci) { }
                @Override public void onError(PurchasesError e) { } // déjà anonyme : rien à faire
            });
        } catch (Throwable ignored) {
        }
    }
}
