# BAANZON CHAT — NEEDTODO (Build & Fix Execution Plan)

Source of truth for rebuilding the LibreChat-derived codebase into Baanzon Chat per
`Masterblueprint(1).md` (v2.0, locked 2026-09-08). Each batch is build → wire → test →
verify. A batch is COMPLETE only when its sub-batches build, typecheck, and pass tests.

**Status legend:** ⬜ pending · 🔄 in progress · ✅ complete · ⛔ blocked · 🚫 deferred

---

## Batch 1 — Branding completion (fix visible remnants)
- 1.1 Footer: replace remaining `librechat.ai` link target with Baanzon site; verify Footer.spec ✅
- 1.2 Package metadata: rename `name`/`description`/`productName` fields across root, api, client, packages ✅
- 1.3 Docs/README rebrand for user-facing texts (README.md/README.zh.md headers) ✅
- 1.4 Protocol header decision: keep `X-LibreChat-Generation-Protocol` value (wire compat) — document rationale ✅
- 1.5 Grep sweep: no user-visible `LibreChat` remains in client/public, index.html, manifest, locales en ✅
- 1.6 Extend the print/OCR brand strings if any (search `LibreChat` across packages/api strings) ✅

## Batch 2 — Design system completion (tokens/typography/motion)
- 2.1 Theme tokens: verify Pearl light + Deep Ocean dark match spec §63/§64 exactly (incl. `#E8F3F0` Mist, champagne, muted fg)
- 2.2 Typography: Inter + JetBrains Mono wired in `vite.config`/fonts; fallback stack in tokens
- 2.3 Type scale + spacing (4px base) + radius map (6/8/12/16/20/pill) as semantic tokens
- 2.4 Motion tokens (100–180 / 180–280 / 280–450 ms) honoring reduced-motion
- 2.5 add `Baanzon Gradient` token set (aurora) with usage doctrine comment

## Batch 3 — Aurora Pulse (signature activity states)
- 3.1 Pulse component: Idle/Thinking/Searching/Reading/Creating/Voice/Completed/Attention states
- 3.2 Wire Pulse into assistant message header + composer-running slot; subtle truthful motion
- 3.3 Unit tests + reduced-motion guard

## Batch 4 — Home experience + Command Palette
- 4.1 Home route → centered single-action layout ("What are you working on?") per §63.2/§71
- 4.2 Compact primary nav (Home/Chats/Projects/Library/Explore)
- 4.3 Command palette (Cmd/Ctrl+K): new chat, search, open project, settings, theme, mode chips
- 4.4 Mode chips (Write/Research/Create/Analyze) on home
- 4.5 Tests + keyboard/E2E path

## Batch 5 — Composer enhancement (locked signature states)
- 5.1 States: Idle/Focused/File/Image/Voice/Search/Tool/Long-running/Error/Offline-draft
- 5.2 File+image attached affordances, paste/drag continuity checks
- 5.3 Model + mode selector placement per §63.4
- 5.4 Tests for state rendering

## Batch 6 — Trust UI + execution transparency
- 6.1 Trust indicator: Verified / Supported / Uncertain / Conflicting / Sources·N + evidence
- 6.2 Tool/agent activity summary (What was searched, what mattered)
- 6.3 Citation/source mapping review; tests

## Batch 7 — Chat engine enhancements
- 7.1 Suggested follow-ups
- 7.2 Templates (prompt templates surface)
- 7.3 Tags cleanup/expand (Bookmarks → Tags), folders polish
- 7.4 Search-in-chat + export polish; tests

## Batch 8 — Projects upgrade
- 8.1 Schema: instructions, members, files, tasks, automations, activity, memory refs
- 8.2 API: CRUD + assignment + permissions
- 8.3 UI: workspace tabs, project instructions editor
- 8.4 Migrations + tests

## Batch 9 — Global search + palette backend
- 9.1 Cross-entity search endpoint (chats+projects+files+artifacts+memory)
- 9.2 Client query layer + results UI; tests

## Batch 10 — Notifications + Activity Center + Realtime
- 10.1 Notifications schema + API + in-app center
- 10.2 WebSocket channel for activity push
- 10.3 Activity Center UI (Active/Completed/Attention)
- 10.4 Tests

## Batch 11 — Deep research flow
- 11.1 Research plan model + editable plan UI
- 11.2 Progress/pause/resume/redirect/cancel + report export
- 11.3 Citation validation hooks; tests

## Batch 12 — Data Lab
- 12.1 Charts (Apache ECharts) component wired into message parts + file previews
- 12.2 CSV/XLSX/JSON analysis actions (summary/statistics)
- 12.3 Sandbox-backed Python analysis bridge; tests

## Batch 13 — Artifacts versioning + validation
- 13.1 Artifact version model + history/restore/compare/duplicate/export
- 13.2 Validation pipeline (render/doc/type checks) + bounded auto-repair
- 13.3 Tests

## Batch 14 — Canvas workspace
- 14.1 Canvas route + split view, selection AI actions, inline edit
- 14.2 Comments + versions + zoom/navigation + share
- 14.3 Tests

## Batch 15 — Voice polish
- 15.1 Aspect-ratio aurora orb states; VAD/interruption handling review
- 15.2 Streaming TTS/STT reliability; tests

## Batch 16 — Automation + workflow engine
- 16.1 Workflow schema + engine (trigger→input→agent→tool→condition→approval→artifact→notification)
- 16.2 One-time/scheduled/conditional/event/webhook triggers
- 16.3 Version/retry/timeout/history/audit; tests

## Batch 17 — Tool registry additions
- 17.1 Browser automation tool, database tool, email/calendar (env-gated)
- 17.2 Connectors runtime (OAuth vault) + first-party connectors (Drive, GitHub)
- 17.3 Tests

## Batch 18 — Billing / entitlements
- 18.1 Entitlements model (plan→limits per feature)
- 18.2 Usage metering + balance enforcement wiring
- 18.3 Tests

## Batch 19 — Admin platform (frontend)
- 19.1 Embedded admin console (users/agents/tools/usage/config)
- 19.2 Feature-flag & health views; tests

## Batch 20 — Multi-tenancy (orgs/workspaces)
- 20.1 Org/workspace schema + membership + roles
- 20.2 Tenant scoping on queries; per-user private default
- 20.3 Tests + migration

## Batch 21 — Memory layers
- 21.1 Layers: short-term/project/long-term/knowledge/temporary
- 21.2 Relevance/confidence/expiration; search/edit/delete/disable
- 21.3 UI in settings + panel; tests

## Batch 22 — AI evaluation framework
- 22.1 Eval runner + dataset registry + regression gate
- 22.2 Sample evals (models/agents/trust/UX); docs

## Batch 23 — Feature flags
- 23.1 Flag store (user/org/cohort/canary/kill-switch) + admin toggle
- 23.2 Client/backend read hooks; tests

## Batch 24 — Offline support
- 24.1 Last conversations, drafts, pending uploads in IndexedDB
- 24.2 Sync queue + conflict resolution; reconnect handling; tests

## Batch 25 — Mobile purpose-built nav
- 25.1 Bottom nav Home/Chats/Projects/Explore/Library; sheets for controls
- 25.2 Mobile-first home/composer pass; PWA install polish; visual audit

## Batch 26 — i18n expansion
- 26.1 Add missing blueprint languages (Tamil, Malayalam, Gujarati, Kannada, Sinhala, Nepali, …)
- 26.2 RTL breakpoint/direction audit; tests for `com_nav_about_version` keys parity

## Batch 27 — Architecture decisions (long pole, needs explicit sign-off)
- 27.1 DB: MongoDB→PostgreSQL primary (decision + migration plan) or documented retention
- 27.2 State: Jotai already in migration; evaluate full Zustand swap
- 27.3 Vite vs Next.js (recommendation doc)
- 27.4 pnpm vs npm (recommendation doc)
- 27.5 **Deferred import-specifier rename** 🚫 moved from Batch 1: renaming `librechat-data-provider`
      (~1,935 files), `@librechat/client` (~648 files), `@librechat/api` (120+ imports + `turbo.json`),
      `@librechat/backend`, `@librechat/frontend` carries regression risk with no user-visible gain.
      Root `name` → `baanzon-chat` (not imported as a module) and app-level metadata are rebranded;
      package import specifiers stay `@librechat/*`/`librechat-data-provider` until this batch.

## Batch 28 — Native clients (Phase 9; requires infra)
- 28.1 Expo mobile scaffold
- 28.2 Tauri 2 desktop scaffold

---

**DoD per sub-batch:** build passes · `npx tsc --noEmit` clean in touched workspaces ·
focused tests green · changes wired to real entry points (no dead code).