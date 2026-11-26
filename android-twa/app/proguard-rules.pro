# Play's policy check reads the bundled Play Billing Library version from the
# APK. This app never calls BillingClient - in-app purchases use the Digital
# Goods API, which Chrome implements inside the TWA - so R8 removes the library
# as dead code and the scanner falls back to reporting the legacy "AIDL"
# implementation. Keep it so the release advertises 8.0.0.
-keep class com.android.billingclient.** { *; }
-keep interface com.android.billingclient.** { *; }
-keep class com.android.vending.billing.** { *; }
