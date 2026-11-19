# Baanzon Chat — Android v1.0.1 Release Plan

Status: **DRAFT — awaiting approval** · Prepared: Nov 19, 2026
Playbook (asset specs, data-safety answers, listing copy): `RELEASE.md`

## What ships

**App**: Baanzon Chat v1.0.1 (versionCode 2), package `com.opraiz.baanzonchat`,
minSdk 24 (Android 7+), targetSdk 36. TWA shell over
`baanzonchat.opraiz.com` — web deploys reach users without Play releases.

**Included since the base build**:
- Google OAuth sign-in (Continue with Google), single button placement
- Mandatory phone collection for OAuth-created accounts (client gate + `POST /api/user/phone`)
- Play Billing: Digital Goods purchase flow in-app, server-side token
  verification, entitlements unified with Dodo in one admin view
- Training-data consent (signup checkbox + Settings toggle), `/terms`,
  public `/data-deletion` page
- Offline fallback page, app shortcuts (New chat / Voice / Marketplace),
  dark-mode support, Continue-with-Google in dark screenshots

**Explicitly not in this release**: server-side multilingual TTS engine
(client speechSynthesis ships instead), marketplace report/block,
RTDN subscription webhooks (polling verify v1).

## Release phases

### Phase 0 — Done (all verified)
| Item | Evidence |
| --- | --- |
| Signed AAB v1.0.1 (versionCode 2) | `android-twa/app/build/outputs/bundle/release/app-release.aab`, upload-key signed, SHA-256 matches served assetlinks |
| Store assets | 4 phone screenshots 1080×1920 (light+dark sets available), feature graphic 1024×500, icon 512×512 |
| Listing copy + data-safety answers | `RELEASE.md` §1–3 |
| OAuth live | `googleLoginEnabled: true` publicly; callback fixed (path-only value) |
| Purchase gate | In-app pricing renders Play-only purchase UI; Dodo web-only |
| UI pass | 720×1280 + 480×800 + desktop: no overflow, dark/light clean |

### Phase 1 — You, in Play Console (day 0, starts the 14-day clock)
1. Create the app → package name `com.opraiz.baanzonchat`, name "Baanzon Chat"
2. **Closed testing track** → upload the signed AAB → add ≥12 tester emails → publish
   *(new org accounts need 14 continuous days of ≥12 opted-in testers before production access — the clock starts when testers join)*
3. App content: content rating questionnaire, data safety (`RELEASE.md` §2), ads = none, trader = yes + business details
4. Store listing: copy + screenshots + feature graphic + icon (`RELEASE.md` §1, assets in `store-assets/final/`)
5. Monetization → create 4 subscriptions + 2 in-app products (ids per `RELEASE.md` §1 prices mirror web INR)
6. Setup → API access → service account JSON → hand to me (pod env)

### Phase 2 — Me, on your signals
| Trigger | Action |
| --- | --- |
| Service account JSON delivered | Wire `GOOGLE_PLAY_SERVICE_ACCOUNT_FILE` into **both** slot `.env`s, restart, smoke-test verify endpoint |
| First internal/closed upload live | Pull **Play App Signing SHA-256** you send me → add to `assetlinks.json` → deploy (keeps URL bar hidden) |
| Play pre-launch report findings | Triage + fix + re-upload |

### Phase 3 — Release timeline
| Day | Milestone |
| --- | --- |
| 0 | Closed test published, 12+ testers joined — **clock starts** |
| 0–3 | Billing-enabled build (v1.0.1, versionCode 2) replaces the closed-track build |
| 0–14 | Tester feedback; fix forward via new versionCode builds |
| 14 | Apply for production access (questionnaire: testers engaged + demo video if asked) |
| 14+ | Production: staged rollout 20% → 50% → 100%, one step per 24–48h watching vitals + RUM |

## Roles

- **You**: Play Console operations, service account creation, product prices,
  tester recruitment, real-device spot checks (push tray, live Play payment)
- **Me**: all code (billing/consent/terms shipped), AAB builds + signing,
  pod config + deploys, assetlinks updates, listing asset production,
  pre-launch report triage

## Success criteria for v1.0.1

1. Closed testers install and reach chat without a URL bar (TWA verified)
2. Continue with Google completes end-to-end including the phone step
3. Play Billing purchase (test card) grants the tier and appears in the admin payments view
4. Offline page shows in airplane mode; app shortcuts work
5. Pre-launch report: no new crashes; no policy warnings

## Rollback

Closed/production tracks: halt rollout in Play Console (users keep the
installed version). Server side is independent — web keeps serving; the
purchase gate keeps in-app purchases Play-only regardless of app version.

## Open risks

| Risk | Mitigation |
| --- | --- |
| 14-day closed-test requirement (new org account) | Clock starts at Phase 1 — recruit testers now |
| CF 429 rate limits on flux STT under load | STT reopen grace shipped; monitor, add `sttLanguage: 'en'` fast path if needed |
| Play policy review of UGC (marketplace) | Report/block recommended before production rollout |
| Emulator-only checks | Pre-launch report + your real-device spot check cover the gap |
