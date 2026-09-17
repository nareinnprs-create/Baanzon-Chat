# approval-batches.md

> **Purpose.** One tracked, batched approval list for the Baanzon Chat rebuild against `Masterblueprint(1).md` (3559 lines / 116 sections). Every skip item is a verdict, and every verdict has an evidence fingerprint (disk probe). Update this file as batches complete — it is the single source of truth for what has been approved vs. built.
>
> **Workflow.** Each batch is its own branch off `dev` and its own PR into `dev` (per repo convention). Complete batches in order unless re-prioritized here. After each batch: `npx tsc --noEmit`, unit tests for the workspaces touched, `npm run lint`/`sort-imports` on touched paths, and a Lighthouse run for any visible-surface changes — then push and request review on the exact pushed head.
>
> **Legend.**
> - `missing` — zero matching files on disk; build from blueprint.
> - `stub` — a skeleton/entrypoint exists but unimplemented; complete.
> - `partial→enhance` — core exists; extend toward blueprint.
> - `partial→fine-tune` — exists and works; tune defaults/UX/copy per blueprint.
> - `built` — present and matches blueprint; no work required beyond maintenance.
>
> Probe evidence lives in `%TEMP%\opencode\audit\` (`cb*.txt`, `cl*.txt`, `rag*.txt`, `svc*.txt` etc.).

---

# PHASE 1 — BUILD (server intelligence + platform foundations)

## B1 — Server domain engines

| id | Item | Blueprint | Status |
|----|------|-----------|--------|
| 1.1 | RAG / knowledge service (vector-store orchestration, collections, hybrid search) — **START (user-approved)** | §20,24 | missing |
| 1.2 | Semantic search service (embeddings, rerank, hybrid snippet search) + client search surface | §22,24,53 | missing |
| 1.3 | Deep Research pipeline (research overview → report lab) | §22,31 | missing |
| 1.4 | Memory service: thread/global/knowledge memory + CRUD + schema alignment (`MemoryEntry` model exists) | §24 | partial→enhance |
| 1.5 | Projects / Documents service (collab-doc data model + API; `ProjectsService` old-root exists) | §25,29 | partial→enhance |
| 1.6 | Canvas / Data Lab engine (modeling surface + execution runtime) | §27–29 | missing |
| 1.7 | Artifacts service hardening (versioning, auto-repair, validation) — `ArtifactsService` old-root exists | §17–19 | partial→enhance |
| 1.8 | Voice realtime: STT/TTS orb + streaming (`api/server/services/Files/Audio` TTS/STT exist, legacy) | §30,76 | partial→enhance |

## B2 — Agent / workflow platform

| id | Item | Blueprint | Status |
|----|------|-----------|--------|
| 2.1 | Universal modes engine (Think/Search/Research/Create/Analyze/Build/Study/Work) | §3 | missing |
| 2.2 | Workflow Builder (node graph → runs → approvals) — **HELD** pending workflow-builder UI decision | §33–34 | missing |
| 2.3 | Automation / scheduled jobs / triggers orchestration — **HELD** (depends on 2.2) | §33,44 | partial→enhance |
| 2.4 | Trust engine (verification, approval gateways, legitimate-context guardrails) | §9,58 | missing |
| 2.5 | ActionService + agent callbacks (in-chat approvals, askUserQuestion wiring) | §58,86 | partial→enhance |
| 2.6 | Model gateway cost tiers + usage budgets (gateway exists) | §10,52,56 | partial→enhance |

## B3 — Tenancy, admin, billing, observability

| id | Item | Blueprint | Status |
|----|------|-----------|--------|
| 3.1 | Multi-tenancy: orgs, workspaces, projects-scoped data (`tenant.ts`/`preAuthTenant.js` exist) | §57 | partial→enhance |
| 3.2 | Admin platform (admin middleware exists; controllers partial) | §58 | partial→enhance |
| 3.3 | Billing / entitlements / usage budgeting — **HELD** (depends on 2.2) | §52,56 | missing |
| 3.4 | Observability: eval dashboards, OpenTelemetry, RUM/insights — `telemetry`, `rum`, `insights` dirs exist | §59 | partial→enhance |
| 3.5 | Multi-tenant isolation hardening across models (tenantIsolation plugin exists) | §57 | partial→fine-tune |

## B4 — Client surfaces & UX

| id | Item | Blueprint | Status |
|----|------|-----------|--------|
| 4.1 | Command palette / global search — **HELD** pending workflow-builder UI surface | §53 | missing |
| 4.2 | Voice orb client UI (voice services exist server-side `Files/Audio`) | §76,30 | stub |
| 4.3 | Canvas / Data Lab client UI — **HELD** pending 2.2 UI decisions | §27–29 | missing |
| 4.4 | Notifications / activity center / announcement banner — **HELD** pending 2.2 | §85 | missing |
| 4.5 | Universal Composer upgrade (mode orb + multimodal input) | §14,71 | partial→enhance |
| 4.6 | Trust indicator / approval surface in-chat | §86 | missing |
| 4.7 | Artifacts + Canvas client (component dirs partially exist) | §17,27 | partial→enhance |
| 4.8 | PWA upgrade (manifest exists; offline/streaming installability) | §83 | partial→fine-tune |

## B5 — Niche agent families

| id | Item | Blueprint | Status |
|----|------|-----------|--------|
| 5.1 | Vision agent (image understanding/OCR) | §31,32 | missing |
| 5.2 | Video agent (upload→transcribe→scenes) | §32 | missing |
| 5.3 | Voice dialogs / real-time conversation agent | §30,33 | missing |
| 5.4 | Browser / computer-use agent | §21 | missing |
| 5.5 | Data Lab / notebook agent runtime | §28 | missing |
| 5.6 | Brainstorm/Music/Image creation specialists (agent registry extension) | §21,31 | missing |

---

# EXECUTION LOG (update per batch)

| Batch | Status | PR | Notes |
|-------|--------|----|-------|
| B1 | **STARTED — 1.1 first** (user-approved) | – | RAG/knowledge service build begins |
| B2 | queued | – | – |
| B3 | queued | – | – |
| B4 | queued | – | 4.1/4.3/4.4 held; 4.2/4.5–4.8 go when reached |
| B5 | queued | – | – |

**Decisions log**
- 2026-09: User approved B1–B5 in order; each batch ships as its own branch-off-`dev` PR. Batch ordering may be re-prioritized at any time.
- 2026-09: Workflow-builder UI (2.2) is the unlock for 2.3, 3.3, 3.1, 4.1/4.3/4.4 — build server engines (B1, B5.1/B5.6) first, land builder UI, then bring orchestration/billing/surfaces on top.
- 2026-09: User affirmed: save tracked list, and for the orchestrator/automation/billing work — **wait for workflow-builder UI first** (deferred).
