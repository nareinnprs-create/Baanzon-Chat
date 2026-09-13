# BAANZON CHAT — BUILD SCOPE
## Deep Rebrand from LibreChat → Baanzon Chat

**Source of truth:** Masterblueprint(1).md Version 2.0
**Status:** PLANNED — AWAITING APPROVAL

---

## SCOPE SUMMARY

This document tracks every file, system, and surface that must change to transform
the LibreChat codebase into Baanzon Chat with the Aurora Pearl design identity.
Each batch is independently shippable and testable. No stubs, no partials, no placeholders.

---

## BATCH 1: DESIGN SYSTEM & THEME TOKENS
**Blueprint sections:** 62–70 (Design Identity, Palette, Typography, Tokens)

### 1.1 New Light Theme — "Pearl"
**File:** `packages/client/src/theme/themes/default.ts`

Replace all RGB values with the Pearl palette:
- Background: #F7FAF8 → rgb 247 250 248
- Surface: #FFFFFF → rgb 255 255 255
- Surface Soft: #EFF6F3 → rgb 239 246 243
- Border: #DDE9E5 → rgb 221 233 229
- Primary Text: #102A2D → rgb 16 42 45
- Secondary Text: #52686A → rgb 82 104 106
- Muted Text: #6E7F80 → rgb 110 127 128
- Primary: #087F83 → rgb 8 127 131
- Accent: #35D6C7 → rgb 53 214 199

### 1.2 New Dark Theme — "Deep Ocean"
**File:** `packages/client/src/theme/themes/dark.ts`

Replace all RGB values with the Deep Ocean palette:
- Background: #061316 → rgb 6 19 22
- Surface: #0A1C20 → rgb 10 28 32
- Surface Elevated: #10272B → rgb 16 39 43
- Border: #1D3A3D → rgb 29 58 61
- Primary Text: #F3F8F6 → rgb 243 248 246
- Secondary Text: #A9C0BD → rgb 169 192 189
- Muted Text: #6E8987 → rgb 110 137 135
- Primary: #13A6A0 → rgb 19 166 160
- Accent: #46E2D2 → rgb 70 226 210
- Orchid: #A998FF → rgb 169 152 255
- Champagne: #D8C29D → rgb 216 194 157

### 1.3 Theme Registry Rename
**File:** `packages/client/src/theme/registry.ts`
- `libreChatTheme` → `baanzonTheme`
- `name: 'librechat'` → `name: 'baanzon'`

### 1.4 CSS Variables
**File:** `client/src/style.css`
- Update `:root` raw RGB values to Pearl palette
- Update `.dark` raw RGB values to Deep Ocean palette
- Update accent-primary values
- Update semantic surface tokens (surface-chat, surface-code, etc.)
- Update font family to Inter + JetBrains Mono
- Update border-radius tokens to match blueprint (XS:6, SM:8, MD:12, LG:16, XL:20, Pill:999)
- Update spacing tokens to 4px base grid
- Add brand accent colors for Baanzon Aurora gradient

### 1.5 Tailwind Config
**Files:** `client/tailwind.config.cjs`, `packages/client/tailwind.config.js`, `packages/client/tailwind.preset.cjs`
- Update font families: Inter (sans), JetBrains Mono (mono)
- Verify color mappings from new createTailwindColors source

### 1.6 Color Source
**File:** `packages/client/src/theme/utils/createTailwindColors.js`
- Update hex source values to match Baanzon palette

### 1.7 Appearance Tokens
**File:** `packages/client/src/theme/registry.ts` (defaultAppearance)
- Verify/update radius tokens: controlRadius, surfaceRadius, largeSurfaceRadius
- Verify/update spacing tokens: spaceCompact, spaceNormal
- Verify/update font family default

**Verification:** `npx tsc --noEmit` in packages/client, visual check light/dark themes

---

## BATCH 2: BRAND IDENTITY — LOGOS, FAVICONS, MANIFEST
**Blueprint sections:** 62, 71 (Design Identity, Desktop UI)

### 2.1 HTML Entry Point
**File:** `client/index.html`
- `<title>Baanzon Chat</title>`
- Meta description: "Baanzon Chat — A unified AI workspace"
- Update theme-color to `#087F83` (Baanzon Teal)

### 2.2 PWA Manifest
**File:** `client/vite.config.ts`
- `name: 'Baanzon Chat'`
- `short_name: 'Baanzon'`
- `theme_color: '#087F83'`
- `background_color: '#F7FAF8'`

### 2.3 Logo SVG
**File:** `client/public/assets/logo.svg`
- Replace with Baanzon Aurora mark (teal/aqua gradient abstract shape)
- No text in SVG — brand recognition through shape alone

### 2.4 Favicons
**Files:**
- `client/public/assets/favicon-32x32.png`
- `client/public/assets/favicon-16x16.png`
- `client/public/assets/apple-touch-icon-180x180.png`
- Replace with Baanzon favicon (Deep Ocean + Teal)

### 2.5 Open Graph / Social
**File:** `client/index.html`
- Update og:title, og:description, og:image references

**Verification:** Load app in browser, check tab title, favicon, PWA install prompt

---

## BATCH 3: HARDCODED BRAND STRINGS — CLIENT
**Blueprint sections:** 1–3, 62 (Product Definition, Design Identity)

### 3.1 Default App Title Fallbacks
**Files to change `'LibreChat'` → `'Baanzon Chat'`:**
- `client/src/utils/documentTitle.ts` — DEFAULT_APP_TITLE
- `client/src/routes/Layouts/Startup.tsx` — startupConfig fallback
- `client/src/components/Auth/AuthLayout.tsx` — startupConfig fallback

### 3.2 Footer Brand
**File:** `client/src/components/Chat/Footer.tsx`
- `[LibreChat ${VERSION}]` → `[Baanzon Chat ${VERSION}]`
- URL `https://librechat.ai` → appropriate link or remove

### 3.3 RUM Proxy Key
**File:** `client/src/lib/rum/useRum.ts`
- `baanzon-rum-proxy` → `baanzon-rum-proxy`

### 3.4 CSS Keyframes
**File:** `packages/client/src/svgs/Spinner.css`
- `baanzon-spinner-rotate` → `baanzon-spinner-rotate`

**Verification:** App loads with correct title, footer shows Baanzon, no console errors

---

## BATCH 4: HARDCODED BRAND STRINGS — BACKEND
**Blueprint sections:** 10, 11, 12 (Model Gateway, Chat Engine, Streaming)

### 4.1 API Config Default
**File:** `api/server/routes/config.js`
- `process.env.APP_TITLE || 'LibreChat'` → `'Baanzon Chat'`

### 4.2 Auth Service
**File:** `api/server/services/AuthService.js`
- All `process.env.APP_TITLE || 'LibreChat'` → `'Baanzon Chat'`

### 4.3 Two-Factor Controller
**File:** `api/server/controllers/TwoFactorController.js`
- Same pattern

### 4.4 Invite User
**File:** `config/invite-user.js`
- Same pattern

### 4.5 OpenRouter Headers
**File:** `packages/api/src/endpoints/openai/config.ts`
- `'X-Title': 'LibreChat'` → `'X-Title': 'Baanzon Chat'`
- `'HTTP-Referer': 'https://librechat.ai'` → appropriate URL

### 4.6 CloudFront Cookie
**File:** `packages/api/src/cdn/cloudfront-cookies.ts`
- `LibreChat-CloudFront-Scope` → `Baanzon-CloudFront-Scope`

### 4.7 Shared Links Config
**File:** `packages/api/src/shared-links/config.ts`
- Same APP_TITLE fallback pattern

### 4.8 Trace Metadata Keys
**File:** `packages/data-provider/src/config.ts`
- `librechat.user.*` → `baanzon.user.*`
- `librechat.conversation.*` → `baanzon.conversation.*`
- `VERSION = '__BAANZON_VERSION__'` → `VERSION = '__BAANZON_VERSION__'`

### 4.9 Code Interpreter
**File:** `packages/data-provider/src/code/worker.ts`
- `baanzon-code pair/run` → `baanzon-code pair/run`
**File:** `packages/data-provider/src/config.ts`
- `'baanzon-code'` → `'baanzon-code'`

### 4.10 Parameter Settings Export
**File:** `packages/data-provider/src/parameterSettings.ts`
- `export const librechat =` → `export const baanzon =`

### 4.11 Config Utility
**File:** `packages/data-schemas/src/config/utils.ts`
- `cwd.includes('LibreChat')` → `cwd.includes('Baanzon')` (or remove)

### 4.12 App Checks
**File:** `packages/api/src/app/checks.ts`
- `librechat.ai` URLs → appropriate docs URL

### 4.13 Config Load
**File:** `api/server/services/Config/loadCustomConfig.js`
- `librechat.ai/docs` URLs → appropriate docs URL

### 4.14 Spec Errors
**File:** `packages/data-schemas/src/app/specs.ts`
- `librechat.ai/docs` URL → appropriate docs URL

**Verification:** `npx tsc --noEmit` in packages/api, packages/data-provider, packages/data-schemas

---

## BATCH 5: ENVIRONMENT & CONFIG FILES
**Blueprint sections:** 84, 86 (Tech Stack, Monorepo)

### 5.1 Environment Example
**File:** `.env.example`
- `APP_TITLE=LibreChat` → `APP_TITLE=Baanzon Chat`
- `HELP_AND_FAQ_URL=https://librechat.ai` → appropriate URL
- `EMAIL_FROM=noreply@librechat.ai` → `noreply@baanzon.ai`
- `EMAIL_FROM_NAME="LibreChat"` → `"Baanzon Chat"`
- `MONGO_URI=mongodb://127.0.0.1:27017/LibreChat` → `mongodb://127.0.0.1:27017/BaanzonChat`
- `OTEL_SERVICE_NAME=librechat` → `baanzon`
- `RUM_SERVICE_NAME=baanzon-web` → `baanzon-web`
- All comments referencing LibreChat

### 5.2 LibreChat YAML Example
**File:** `baanzon.example.yaml`
- All LibreChat references in comments and examples

### 5.3 MongoDB URI Defaults in Docker
**Files:**
- `docker-compose.yml` — container_name, MONGO_URI DB name, image names, volume names
- `deploy-compose.yml` — same patterns
- `.devcontainer/docker-compose.yml` — MONGO_URI
- `docker-compose.langfuse-fanout.yml` — image name
- `deploy-compose.langfuse-fanout.yml` — image name
- `utils/docker/test-compose.yml` — same patterns
- `rag.yml` — image names

### 5.4 Helm Charts
**Files:**
- `helm/librechat/Chart.yaml` — chart name, description, URLs
- `helm/librechat/values.yaml` — all references
- `helm/librechat/templates/configmap-env.yaml` — helper references
- `helm/librechat-rag-api/Chart.yaml` — chart name
- `helm/librechat-rag-api/values.yaml` — image names, DB name
- `helm/librechat-rag-api/templates/*` — secret names

**Verification:** Docker compose up works, env.example is clean, helm lint passes

---

## BATCH 6: LOCALIZATION / i18n
**Blueprint sections:** 79, 80 (Internationalization, Multilingual Intelligence)

### 6.1 English Translation
**File:** `client/src/locales/en/translation.json`
- `com_agents_mcp_trust_subtext`: "Custom connectors are not verified by LibreChat" → "Baanzon"
- `com_ui_admin_access_warning`: baanzon.yaml → baanzon.yaml (or keep as config reference)
- `com_ui_api_keys_description`: "through LibreChat's OpenAI-compatible API" → "Baanzon Chat's"
- `com_ui_tools_native_short`: "Built into LibreChat" → "Baanzon Chat"
- `com_ui_code_environments_description`: baanzon-code → baanzon-code
- `com_ui_code_environment_unavailable`: "This LibreChat instance..." → "This Baanzon Chat instance..."
- `com_ui_code_environment_remove_description`: "...removing it from LibreChat" → "Baanzon Chat"

### 6.2 All Other Locale Files (30+ languages)
**Files:** `client/src/locales/*/translation.json`
- Same keys as 6.1 in: es, de, fr, ja, ko, zh-Hans, zh-Hant, pt-BR, pt-PT, it, nl, pl, ru, uk, tr, sv, da, fi, nb, nn, is, he, fa, ka, lv, lt, ar, hu, th, ca, et, vi

**Verification:** App renders in English with correct brand, no missing translation keys

---

## BATCH 7: DOCUMENTATION & CONTROL FILES
**Blueprint sections:** 107, 108 (Repository Control Files, AI Rules)

### 7.1 Root Documentation
**Files:**
- `README.md` — Complete rewrite for Baanzon Chat
- `README.zh.md` — Update
- `CONTEXT.md` — Replace all "LibreChat" with "Baanzon Chat"
- `CLAUDE.md` — Update project identity, package references
- `AGENTS.md` — Update references
- `LICENSE` — Update if needed

### 7.2 Package READMEs
**Files:**
- `packages/data-schemas/README.md`
- `packages/client/src/theme/README.md`
- `client/src/locales/README.md`
- `e2e/README.md`
- `e2e/byom/README.md`
- `e2e/lighthouse/README.md`
- `otel/langfuse-fanout/README.md`

### 7.3 GitHub Files
**Files:**
- `.github/CODE_OF_CONDUCT.md`
- `.github/ISSUE_TEMPLATE/BUG-REPORT.yml`
- `.github/ISSUE_TEMPLATE/FEATURE-REQUEST.yml`
- `.github/ISSUE_TEMPLATE/NEW-LANGUAGE-REQUEST.yml`
- `.github/ISSUE_TEMPLATE/LOCIZE_TRANSLATION_ACCESS_REQUEST.yml`

**Verification:** All docs reference Baanzon Chat, no stale LibreChat links

---

## BATCH 8: GITHUB CI/CD WORKFLOWS
**Blueprint sections:** 84 (Tech Stack)

### 8.1 Workflow Files
**Files:**
- `.github/workflows/client.yml` — package name, artifacts
- `.github/workflows/data-provider.yml` — same
- `.github/workflows/data-schemas.yml` — same
- `.github/workflows/dev-images.yml` — image names `librechat-dev-api` → `baanzon-dev-api`, `librechat-dev` → `baanzon-dev`
- `.github/workflows/main-image-workflow.yml` — `librechat-api` → `baanzon-api`, `librechat` → `baanzon`
- `.github/workflows/docker-publish.yml` — image name references
- `.github/workflows/docker-smoke.yml` — image names, docker run commands
- `.github/workflows/helmcharts.yml` — chart names
- `.github/workflows/static-checks.yml` — package references
- `.github/workflows/backend-review.yml` — step names
- `.github/workflows/frontend-review.yml` — step names
- `.github/workflows/deploy.yml` — GH_REPOSITORY

**Verification:** CI workflows parse correctly, image names are consistent

---

## BATCH 9: PACKAGE.JSON & NPM IDENTITY
**Blueprint sections:** 84, 86 (Tech Stack, Monorepo)

**⚠️ NOTE:** Renaming npm packages is a breaking change for all consumers.
This batch updates names, descriptions, and URLs only — import paths stay as `@librechat/*`
until a future migration batch.

### 9.1 Package Metadata
**Files (name, description, repository, homepage, bugs URLs):**
- `package.json` (root)
- `client/package.json`
- `api/package.json`
- `packages/client/package.json`
- `packages/api/package.json`
- `packages/data-provider/package.json`
- `packages/data-provider/react-query/package.json`
- `packages/data-schemas/package.json`

**Verification:** `npm ls` resolves, package names are correct

---

## BATCH 10: HOME SCREEN UI
**Blueprint sections:** 63, 71 (Locked Visual, Desktop UI)

### 10.1 Startup / Home Layout
**File:** `client/src/routes/Layouts/Startup.tsx`
- Minimal centered layout matching blueprint §63.2:
  - "Baanzon" header
  - "What are you working on?" heading
  - "Tell Baanzon what you need." subtext
  - Composer centered
  - Quick action chips: Write, Research, Create, Analyze

### 10.2 Sidebar Rebrand
**Files:**
- `client/src/components/UnifiedSidebar/UnifiedSidebar.tsx`
- `client/src/components/UnifiedSidebar/Sidebar.tsx`
- `client/src/components/UnifiedSidebar/constants.ts`
- Navigation items matching §63.3: Home, Chats, Projects, Library, Explore
- Compact and quiet sidebar design

### 10.3 Composer Update
**Files:**
- `client/src/components/Chat/Input/ChatForm.tsx`
- `packages/client/src/components/Composer.tsx`
- Placeholder text: "Ask Baanzon anything..."
- Model selector label, tools, voice button
- Focus states with Baanzon Teal accent

**Verification:** Home screen matches blueprint layout, sidebar navigation works

---

## BATCH 11: CHAT RESPONSE & MESSAGE UI
**Blueprint sections:** 73, 74, 75 (AI Response, AI Activity, Trust UI)

### 11.1 Message Display
**Files:**
- `client/src/components/Messages/` — Message renderers
- Content-first editorial layout (not giant chat bubbles)
- Clean hierarchy: sender label → content → sources/trust indicators

### 11.2 Intelligence Pulse
**New component:** `client/src/components/Chat/IntelligencePulse.tsx`
- States: Idle, Thinking, Searching, Reading, Creating, Voice, Completed, Needs attention
- Subtle animated indicator using Baanzon Aurora gradient

### 11.3 Trust Indicators
**Files:**
- Source count display
- Verification status badges
- Evidence availability indicators

### 11.4 Agent Activity Display
**Files:**
- Tool activity rendering
- Agent activity tree (researching → searching sources, reading documents, etc.)
- No fake reasoning — only real activity

**Verification:** Chat responses render in editorial style, pulse shows during streaming

---

## BATCH 12: TEST UPDATES
**Blueprint sections:** 94 (Testing Pyramid)

### 12.1 Theme Tests
**Files:**
- `packages/client/src/theme/registry.spec.ts` — libreChatTheme → baanzonTheme
- `packages/client/src/theme/tailwind.spec.js` — description update

### 12.2 Config Tests
- Update any test fixtures referencing 'LibreChat' brand strings

### 12.3 Skill Sync Tests
- Update owner: 'LibreChat' references

**Verification:** All tests pass, no brand-related test failures

---

## BATCH 13: TRACE, TELEMETRY & SERVICE NAMES
**Blueprint sections:** 59 (Observability)

### 13.1 OpenTelemetry
**File:** `packages/data-provider/src/config.ts`
- Trace metadata keys: `librechat.user.*` → `baanzon.user.*`
- Service name defaults

### 13.2 RUM
**File:** `client/src/lib/rum/useRum.ts`
- Proxy key rename

**Verification:** OTEL traces use baanzon.* namespace

---

## DEPENDENCY GRAPH

```
Batch 1 (Design System)
  └→ Batch 2 (Logos/Manifest) — depends on colors
  └→ Batch 10 (Home UI) — depends on tokens
  └→ Batch 11 (Chat UI) — depends on tokens

Batch 3 (Client Strings)
  └→ Batch 6 (i18n) — same strings in all languages

Batch 4 (Backend Strings)
  └→ Batch 5 (Env/Config)

Batch 7 (Docs)
  └→ Batch 8 (CI/CD)

Batch 9 (Package.json) — independent, can be last

Batch 12 (Tests) — after all code changes
Batch 13 (Telemetry) — after batch 4
```

## RECOMMENDED EXECUTION ORDER

1. **Batch 1** — Design system (foundation for everything visual)
2. **Batch 2** — Logos and manifest
3. **Batch 3** — Client brand strings
4. **Batch 4** — Backend brand strings
5. **Batch 5** — Environment and config files
6. **Batch 6** — Localization
7. **Batch 10** — Home screen UI
8. **Batch 11** — Chat response UI
9. **Batch 12** — Test updates
10. **Batch 13** — Telemetry
11. **Batch 7** — Documentation
12. **Batch 8** — CI/CD workflows
13. **Batch 9** — Package identity (last, breaking)

## COMPLETION CRITERIA

- [ ] Zero occurrences of "LibreChat" in user-facing surfaces
- [ ] Light theme matches Pearl palette exactly
- [ ] Dark theme matches Deep Ocean palette exactly
- [ ] Home screen matches blueprint §63.2 layout
- [ ] Composer shows "Ask Baanzon anything..."
- [ ] All 30+ locale files updated
- [ ] All tests pass
- [ ] `npx tsc --noEmit` passes in all workspaces
- [ ] Docker compose up works
- [ ] App loads in browser with correct branding
