# BAANZON CHAT — ROADMAP

## Purpose & status

- **This is the single source of truth for outstanding work.** It merges the former
  `needtodo.md`, `buildscope.md`, `approval-batches.md` and `postgres-decision.md`,
  which were deleted under owner decision **A15**. Content is de-duplicated and split
  into *outstanding work* vs. a **Decided** record.
- **`NEXTROUND.md` is the phased execution plan and stays separate.** It owns phase
  sequencing, the live status ledger and per-phase detail; this file owns the backlog
  and the decision record. Read both.
- Requirement authority: `Masterblueprint(1).md` v2.0 (locked 2026-09-08). Audit /
  remediation detail: `REMEDIATION-PLAN.md`.
- **Status legend:** ⬜ pending · 🔄 in progress · ✅ complete · ⛔ blocked · 🚫 deferred · ☑ decided
- Rule per sub-batch: build → wire → test → verify. A sub-batch is complete only when
  it builds, `npx tsc --noEmit` is clean in the touched workspaces, focused tests pass,
  and it is wired to real entry points (no dead code).

---

## Needs to do (build & fix backlog)

Backlog only; **live status and sequencing live in `NEXTROUND.md`.** Batch 1 (branding)
is complete — see **Decided**. Batches 2–28 below are the outstanding feature/architecture work.

| Batch | Scope | Refs |
|---|---|---|
| 2 | Design system completion — Pearl + Deep Ocean tokens (incl. `#E8F3F0` Mist, champagne, muted fg), Inter + JetBrains Mono wiring, type scale / 4px spacing / radius map as semantic tokens, motion tokens honoring reduced-motion, Baanzon Aurora gradient token set | §63/§64 |
| 3 | Aurora Pulse signature activity states (Idle/Thinking/Searching/Reading/Creating/Voice/Completed/Attention) wired into assistant header + composer slot; tests + reduced-motion guard | — |
| 4 | Home experience + Command Palette — centered single-action home ("What are you working on?"), compact primary nav (Home/Chats/Projects/Library/Explore), Cmd/Ctrl+K palette, mode chips (Write/Research/Create/Analyze); keyboard/E2E tests | §63.2, §71 |
| 5 | Composer enhancement — locked states (Idle/Focused/File/Image/Voice/Search/Tool/Long-running/Error/Offline-draft), attachment affordances, model+mode selector placement; tests | §63.4 |
| 6 | Trust UI + execution transparency — Trust indicator (Verified/Supported/Uncertain/Conflicting/Sources·N + evidence), tool/agent activity summary, citation/source mapping | §9, §73–75 |
| 7 | Chat engine — suggested follow-ups, prompt templates, Tags/folders polish, search-in-chat + export polish | — |
| 8 | Projects upgrade — schema (instructions, members, files, tasks, automations, activity, memory refs), CRUD/permissions API, workspace tabs + instructions editor, migrations | §25, §29 |
| 9 | Global search + palette backend — cross-entity endpoint (chats+projects+files+artifacts+memory) + client query layer | §53 |
| 10 | Notifications + Activity Center + realtime — schema/API/in-app center, WebSocket activity push, Active/Completed/Attention UI | §85 |
| 11 | Deep research flow — editable research plan, progress/pause/resume/redirect/cancel, report export, citation validation hooks | §22, §31 |
| 12 | Data Lab — ECharts in message parts + file previews, CSV/XLSX/JSON analysis actions, sandbox-backed Python bridge | §28 |
| 13 | Artifacts versioning + validation — version model (history/restore/compare/duplicate/export), validation pipeline + bounded auto-repair | §17–19 |
| 14 | Canvas workspace — route + split view, selection AI actions, inline edit, comments, versions, zoom/navigation, share | §27 |
| 15 | Voice polish — aspect-ratio aurora orb states, VAD/interruption review, streaming TTS/STT reliability | §30, §76 |
| 16 | Automation + workflow engine — workflow schema/engine (trigger→input→agent→tool→condition→approval→artifact→notification), one-time/scheduled/conditional/event/webhook triggers, version/retry/timeout/history/audit | §33–34, §44 |
| 17 | Tool registry additions — browser automation, database, email/calendar (env-gated), connectors runtime (OAuth vault) + first-party connectors (Drive, GitHub) | §35–37 |
| 18 | Billing / entitlements — entitlements model (plan→limits), usage metering + balance enforcement | §52, §56 |
| 19 | Admin platform (frontend) — embedded console (users/agents/tools/usage/config), feature-flag & health views | §58 |
| 20 | Multi-tenancy — org/workspace schema + membership + roles, tenant scoping on queries, per-user private default, migration | §57 |
| 21 | Memory layers — short-term/project/long-term/knowledge/temporary, relevance/confidence/expiration, search/edit/delete/disable, settings + panel UI | §24 |
| 22 | AI evaluation framework — eval runner + dataset registry + regression gate, sample evals (models/agents/trust/UX) | §60–61 |
| 23 | Feature flags — flag store (user/org/cohort/canary/kill-switch) + admin toggle, client/backend read hooks | §92 |
| 24 | Offline support — IndexedDB last conversations/drafts/pending uploads, sync queue + conflict resolution, reconnect handling | §49 |
| 25 | Mobile purpose-built nav — bottom nav (Home/Chats/Projects/Explore/Library), sheets for controls, mobile-first home/composer, PWA install | §83 |
| 26 | i18n expansion — add blueprint languages (Tamil, Malayalam, Gujarati, Kannada, Sinhala, Nepali, …), RTL audit, `com_nav_about_version` key parity | §79–80 |
| 27 | Architecture decisions (needs explicit sign-off) — DB engine (see **Postgres decision**), Jotai→Zustand evaluation, Vite vs Next.js, pnpm vs npm, plus the deferred import-specifier rename (27.5, see **Decided**) | §84 |
| 28 | Native clients (Phase 9, requires infra) — Expo mobile scaffold, Tauri 2 desktop scaffold | §110 |

---

## Build scope (deep rebrand — residual)

Formerly `buildscope.md`. The deep rebrand has largely shipped (theme tokens, logos/
manifest, client + backend brand strings, env/config, i18n, docs, CI/CD, package
metadata) — shipped layers are recorded in **Decided**. Remaining / unverified scope:

- **Theme fidelity** — confirm Pearl light + Deep Ocean dark match the blueprint RGB
  values exactly, including Mist `#E8F3F0`, champagne, muted fg, and Aurora gradient
  token set. Files: `packages/client/src/theme/{themes/default.ts,themes/dark.ts,registry.ts}`,
  `packages/client/src/theme/utils/createTailwindColors.js`, `client/src/style.css`,
  `client/tailwind.config.cjs`, `packages/client/tailwind.config.js`,
  `packages/client/tailwind.preset.cjs`.
- **Brand assets** — verify Aurora mark logo SVG (no text), favicons/apple-touch-icon
  (Deep Ocean + Teal), OG/social meta, `theme-color` `#087F83`. Files:
  `client/public/assets/*`, `client/index.html`, `client/vite.config.ts`.
- **Residual brand strings** — grep to zero user-visible `LibreChat` across
  `client/`, `api/`, `.env.example`, `baanzon.example.yaml`, and all locale files.
  Known operator-visible residuals are tracked in `REMEDIATION-PLAN.md` (P0-7, P2-9/10/11).
- **Package/CI identity** — package metadata + repository/homepage/bugs URLs in 6
  manifests; library image/chart names in `.github/workflows/*`.
- **Deferred by design:** import-specifier rename (`librechat-data-provider`,
  `@librechat/client`, `@librechat/api`, `@librechat/backend`, `@librechat/frontend`)
  — 🚫 see **Decided** (Batch 27.5).

**Completion criteria** (rebrand):
- [ ] Zero user-visible `LibreChat` on any surface.
- [ ] Light theme matches Pearl palette exactly; dark matches Deep Ocean exactly.
- [ ] Home matches blueprint §63.2 layout; composer placeholder "Ask Baanzon anything...".
- [ ] All 30+ locale files updated.
- [ ] All tests pass; `npx tsc --noEmit` passes in all workspaces.
- [ ] Docker compose up works; app loads with correct branding.

> Note: `buildscope.md` listed `helm/librechat/*` and "helm lint passes" as criteria,
> but no `helm/` directory exists in this repo (see `REMEDIATION-PLAN.md` P3-2).

---

## Approval batches (platform build)

Formerly `approval-batches.md`. Batched approval list against the blueprint. Each batch
is its own branch off `dev` and its own PR into `dev`. After each batch: `npx tsc --noEmit`,
unit tests for touched workspaces, `npm run lint` / `sort-imports` on touched paths, then
push and request review on the exact pushed head.

**Status legend:** `missing` = build from blueprint · `stub` = entrypoint exists, unimplemented ·
`partial→enhance` = core exists, extend · `partial→fine-tune` = works, tune per blueprint ·
`built` = matches blueprint.

### B1 — Server domain engines
| id | Item | Blueprint | Status |
|----|------|-----------|--------|
| 1.1 | RAG / knowledge service (vector-store orchestration, collections, hybrid search) | §20,24 | 🔄 started / in progress |
| 1.2 | Semantic search service (embeddings, rerank, hybrid snippet search) + client search surface | §22,24,53 | ⬜ (wire-or-delete resolved → wire, see **Decided A3**) |
| 1.3 | Deep Research pipeline (research overview → report lab) | §22,31 | ⬜ |
| 1.4 | Memory service: thread/global/knowledge memory + CRUD + schema alignment | §24 | partial→enhance |
| 1.5 | Projects / Documents service (collab-doc data model + API) | §25,29 | partial→enhance |
| 1.6 | Canvas / Data Lab engine (modeling surface + execution runtime) | §27–29 | ⬜ |
| 1.7 | Artifacts service hardening (versioning, auto-repair, validation) | §17–19 | partial→enhance |
| 1.8 | Voice realtime: STT/TTS orb + streaming | §30,76 | partial→enhance |

### B2 — Agent / workflow platform
| id | Item | Blueprint | Status |
|----|------|-----------|--------|
| 2.1 | Universal modes engine (Think/Search/Research/Create/Analyze/Build/Study/Work) | §3 | ⬜ |
| 2.2 | Workflow Builder (node graph → runs → approvals) — **HELD** pending builder-UI decision | §33–34 | ⬜ |
| 2.3 | Automation / scheduled jobs / triggers orchestration — **HELD** (depends on 2.2) | §33,44 | partial→enhance |
| 2.4 | Trust engine (verification, approval gateways, legitimate-context guardrails) | §9,58 | ⬜ |
| 2.5 | ActionService + agent callbacks (in-chat approvals, askUserQuestion wiring) | §58,86 | partial→enhance |
| 2.6 | Model gateway cost tiers + usage budgets | §10,52,56 | partial→enhance |

### B3 — Tenancy, admin, billing, observability
| id | Item | Blueprint | Status |
|----|------|-----------|--------|
| 3.1 | Multi-tenancy: orgs, workspaces, projects-scoped data | §57 | partial→enhance |
| 3.2 | Admin platform (middleware exists; controllers partial) | §58 | partial→enhance |
| 3.3 | Billing / entitlements / usage budgeting — **HELD** (depends on 2.2) | §52,56 | ⬜ |
| 3.4 | Observability: eval dashboards, OpenTelemetry, RUM/insights | §59 | partial→enhance |
| 3.5 | Multi-tenant isolation hardening across models | §57 | partial→fine-tune |

### B4 — Client surfaces & UX
| id | Item | Blueprint | Status |
|----|------|-----------|--------|
| 4.1 | Command palette / global search — **HELD** pending builder-UI surface | §53 | ⬜ |
| 4.2 | Voice orb client UI | §76,30 | stub |
| 4.3 | Canvas / Data Lab client UI — **HELD** pending 2.2 UI decisions | §27–29 | ⬜ |
| 4.4 | Notifications / activity center / announcement banner — **HELD** pending 2.2 | §85 | ⬜ |
| 4.5 | Universal Composer upgrade (mode orb + multimodal input) | §14,71 | partial→enhance |
| 4.6 | Trust indicator / approval surface in-chat | §86 | ⬜ |
| 4.7 | Artifacts + Canvas client | §17,27 | partial→enhance |
| 4.8 | PWA upgrade (offline / streaming installability) | §83 | partial→fine-tune |

### B5 — Niche agent families
| id | Item | Blueprint | Status |
|----|------|-----------|--------|
| 5.1 | Vision agent (image understanding / OCR) | §31,32 | ⬜ |
| 5.2 | Video agent (upload→transcribe→scenes) | §32 | ⬜ |
| 5.3 | Voice dialogs / real-time conversation agent | §30,33 | ⬜ |
| 5.4 | Browser / computer-use agent | §21 | ⬜ |
| 5.5 | Data Lab / notebook agent runtime | §28 | ⬜ |
| 5.6 | Brainstorm / Music / Image creation specialists (agent registry extension) | §21,31 | ⬜ |

### Execution log
| Batch | Status | Notes |
|-------|--------|-------|
| B1 | started — 1.1 first | RAG/knowledge service build begins |
| B2 | queued | wait for workflow-builder UI (2.2) |
| B3 | queued | wait for workflow-builder UI (2.2) |
| B4 | queued | 4.1/4.3/4.4 held; 4.2/4.5–4.8 go when reached |
| B5 | queued | — |

> Probe evidence for the status classifications lived in `%TEMP%\opencode\audit\`.

---

## Postgres decision (ADR-001) — DECIDED

Formerly `postgres-decision.md`. Blueprint §45/§24/§46 mandate PostgreSQL primary +
pgvector. **Ruling (owner decision A4): MongoDB stays the primary store (existing,
mature) + PostgreSQL/pgvector is adopted as the durable vector store for RAG.**
Lowest migration risk, durable RAG.

- **Closed options:** native PostgreSQL + ORM (Prisma/Drizzle) with a port of ~91.8k
  lines of data-access methods and a re-implementation of the `tenantIsolation` query
  plugin — rejected as the largest single change in the backlog; FerretDB
  (Postgres-backed Mongo wire protocol) as the store swap — not adopted. The existing
  `vectordb` pgvector sidecar is promoted to the durable vector store seam regardless.
- **§45 deviation to record:** §45's literal "PostgreSQL" is met in substance only
  (vectors live in Postgres, metadata in Mongo); a future blueprint revision should
  name the engine *and* the access layer. Record in ADR-002.
- **Tenant isolation preserved:** the fail-closed `tenantIsolation` plugin and the
  AsyncLocalStorage context remain the cross-cutting correctness guarantee.
- **Staleness caveat closed:** the FerretDB validation (`misc/ferretdb/`, 29-model
  schema) is moot; the schema now holds ~50 models.

**Remaining work that A4 does not change** (portable across engines; tracked in
`NEXTROUND.md` P7):
1. pgvector durable `VectorStore` implementation + migration.
2. Versioned migration ledger (up/down, ordered, idempotent) replacing the ad-hoc
   `migrations/` functions.
3. Implement the 28 missing §45 entities (orgs, memberships, workspaces,
   `message_parts`, agents/runs, tools/versions/permissions, memories + embeddings,
   `knowledge_*`, sources, citations, artifacts + versions, workflows + runs,
   notifications, devices, subscriptions, usage_records, feedback) — on Mongo per A4.
4. Widen tenant scoping to the §57 org → workspace → project hierarchy with a private
   default org for personal users (a flat `tenantId` is not the §57 hierarchy).

---

## Decided

Closed / shipped items removed from the outstanding lists above.

**Owner decisions (see also `NEXTROUND.md` §0).** Relevant to this consolidation:
- **A4 — Data engine:** ☑ MongoDB primary + PostgreSQL/pgvector durable vector store
  (ADR-001 resolved; native-ORM and FerretDB options closed).
- **A15 — Trackers:** ☑ collapse `needtodo.md` / `buildscope.md` / `approval-batches.md` /
  `postgres-decision.md` into this single `ROADMAP.md`.

**Branding — Batch 1 (formerly `needtodo.md` Batch 1), ✅ complete:**
- 1.1 Footer link repointed away from `librechat.ai`; Footer.spec verified.
- 1.2 `name`/`description`/`productName` renamed across root, api, client, packages.
- 1.3 README/docs user-facing rebrand.
- 1.4 Protocol header decision: keep `X-LibreChat-Generation-Protocol` value (wire
  compat); rationale documented.
- 1.5 Grep sweep: no user-visible `LibreChat` in client/public, index.html, manifest,
  locales `en`.
- 1.6 print/OCR brand strings extended.
- **27.5 (deferred, 🚫):** rename of package import specifiers
  (`librechat-data-provider` ~1,935 files, `@librechat/client` ~648, `@librechat/api`
  120+ imports + `turbo.json`, `@librechat/backend`, `@librechat/frontend`) — carried
  regression risk with no user-visible gain. Root `name` → `baanzon-chat` and app-level
  metadata are rebranded; import specifiers stay `@librechat/*` / `librechat-data-provider`
  until this batch is reopened.

**Rebrand layers shipped (formerly `buildscope.md` Batches 1–9):** design-system theme
tokens, brand identity (logo/favicons/manifest/OG), client + backend hardcoded brand
strings, environment/config files, localization, documentation/control files, CI/CD
workflows, package metadata — all shipped; residual verification only (see Build scope).

**Platform decisions (formerly `approval-batches.md`):**
- ☑ User approved B1–B5 in order; each batch ships as its own branch-off-`dev` PR.
  Batch ordering may be re-prioritized at any time.
- ☑ Workflow-builder UI (2.2) is the unlock for 2.3, 3.3, 3.1, 4.1/4.3/4.4 — build
  server engines (B1, B5.1/B5.6) first, land the builder UI, then bring
  orchestration/billing/surfaces on top.
- ☑ For orchestrator / automation / billing work: **wait for workflow-builder UI first**
  (deferred).
