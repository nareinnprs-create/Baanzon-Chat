# Baanzon Chat — Android (TWA) release playbook

Decisions locked 2026-11-18: no Play Billing integration (1b — purchase UI hidden in
the app), no phone OTP (phone collected at signup, email verification suffices),
offline fallback page, app shortcuts, CI build lane, staged rollout.

## Locked facts

| Item | Value |
| --- | --- |
| Package | `com.opraiz.baanzonchat` |
| min / target / compile SDK | 24 (Android 7.0) / 36 (Android 16) / 36 |
| Signing | upload key `C:\Users\manag\.bubblewrap\baanzon-upload.jks`, alias `baanzon-upload` |
| assetlinks.json | live; upload-key SHA-256 `E8:16:…:E0:13` verified matching |
| Notifications | delegated (`POST_NOTIFICATIONS` permission, TrustedWebActivityService) |
| Purchase gate | `client/src/utils/androidApp.ts` + `PricingView` gate (no purchase surface in-app) |

## 1. Store listing (Play Console → Main store listing)

- **App name** (≤30): `Baanzon Chat: AI Assistant`
- **Short description** (≤80): `Every AI for everyone. Chat, voice, agents & deep research — 9+ languages.`
- **Full description** (draft):
  > Baanzon Chat brings every AI to everyone — one assistant for conversations, voice,
  > agents, research and images, in English, Hindi, Gujarati, Bengali, Tamil, Telugu,
  > Kannada, Malayalam, Nepali, Sinhala and more.
  >
  > • Chat with fast, balanced or reasoning model lanes — free, every day
  > • Talk instead of typing with the Diya voice orb
  > • Explore the agent marketplace or build your own agents
  > • Deep research mode with cited sources
  > • Image generation built in
  > • Your conversations stay in sync on web and mobile at baanzonchat.opraiz.com
  >
  > Free tier included. Upgrade any time on the website for larger limits.
  > Support: support@opraiz.com · Privacy: https://baanzonchat.opraiz.com/privacy
- **Category**: Productivity · **Tags**: AI, chatbot, assistant
- **Assets needed** (upload-time): ≥2 phone screenshots (recommend 4: chat screen,
  voice orb, agent marketplace, deep research), 512×512 icon (store_icon.png exists),
  1024×500 feature graphic (TODO), promo video optional.
- Screenshots: no Android device on hand — capture from the emulator or from the
  user's phone; desktop-width captures do NOT qualify for the phone screenshot slot.

## 2. Data safety form (answers to enter)

Collected (all transmitted securely, deletion supported):

| Data | Collected | Shared | Purpose |
| --- | --- | --- | --- |
| Email | Yes (required) | No | Account management |
| Username | Yes (required) | No | Account management |
| Phone number | Yes (required, not verified/OTP) | No | Account management |
| User-generated content — chat text, files, images | Yes | No | App functionality |
| Audio (voice mode) | Yes, ephemeral (transcribed, not stored long-term) | No | App functionality |
| App interactions (usage metrics via RUM) | Yes | No | Analytics |
| Purchase history (tier, packs) | Yes | No (payment processing by Dodo Payments) | App functionality |

- Encryption in transit: **Yes**. Deletion request mechanism: **Yes**
  (in-app Settings → Delete account + web: `https://baanzonchat.opraiz.com/settings`).
- Committed to Play Families policy: No. Ads: No. Ephemeral: No (chat history stored
  at user request).

## 3. Content rating questionnaire (suggestions)

- No violence, sex, gambling, drugs, self-harm topics beyond general AI chat.
- **User-generated content shared between users: YES** (agent marketplace
  publications). IARC will still land at Everyone/PEGI 3 for a productivity app, but
  UGC obligations apply: in-app report + block for marketplace agents — **verify
  these exist in the marketplace UI before submission** (add if missing).
- AI-generated content declaration: answer per the current form prompt ( declare chat
  assistant with content moderation).

## 4. Play App Signing (after first upload — APPROVED, do at that point)

1. Play Console → Release → Setup → App signing: copy the **App signing key
   certificate SHA-256** (Google-managed).
2. Add it to `sha256_cert_fingerprints` in the served `assetlinks.json` **keeping the
   upload-key entry** (the API serves it — search `assetlinks` in `api/`).
3. Redeploy; verify `adb shell pm get-signing-leases`-style check or just install and
   confirm no URL bar.

## 5. CI lane (workflow_dispatch, release-privileged)

`.github/workflows/android-release.yml` (to add): manual dispatch only;
setup-node + JDK 17; secrets `ANDROID_KEYSTORE_B64` (base64 of the .jks),
`ANDROID_KEYSTORE_PASS`, `ANDROID_KEY_ALIAS`; install `@bubblewrap/cli`; run
`bubblewrap build --skipPwaValidation`; upload the signed `.aab` as a workflow
artifact. Never run on push — the keystore secret is release authority.

## 6. Version policy

- `versionCode`: +1 on every uploaded build (simple, monotonic).
- `versionName`: mirror the web app semver at release time (start 1.0.0).
- `twa-manifest.json` stays the source of truth; `bubblewrap update` regenerates
  Gradle files; commit both.

## 7. Rollout tracks

1. **Internal testing** (email list ≤100): verify install, TWA fullscreen (no URL
   bar), splash, offline page, pricing gate, shortcuts, push — minutes to propagate.
2. **Closed testing**: if the developer account is NEW (<90 days / personal), Play
   requires 14 days with ≥20 opted-in testers before production — start recruiting
   early; otherwise skip straight to production staging.
3. **Production**: staged rollout 20% → 50% → 100%, one step per 24-48h watching
   Play vitals + RUM.

## 8. Testing without a device

No physical device available. Options:
- **Android Emulator on this machine** (install Android SDK command-line tools +
  system image ≈ 3-4 GB): covers launch, splash, assetlinks verification (Chrome on
  emulator), offline page, pricing gate, shortcuts, back button. Cannot cover: Play
  Store install flow, real FCM/web-push delivery to the tray, real Dodo payment.
- Real-device checks remain: push notification tray behavior, Dodo live payment,
  store listing preview (Play Console's preview pane covers this without a device).
