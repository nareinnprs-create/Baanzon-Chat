# NEXTROUND.md — Baanzon Chat: Road to 100% Production & Launch Ready

> Owner-approved execution plan. Branch: `b1`. Created 2026-10-15.
> Goal: take Baanzon Chat from the audited baseline to **100% production-ready and launch-ready**,
> delivered phase by phase with multiple agents/subagents, tested, committed and pushed after each phase.

---

## 0. Owner decisions (locked)

| ID | Decision | Resolution |
|----|----------|-----------|
| A1 | Licensing for subscription business (FREE/LITE/PRO/ENTERPRISE) | **MIT** for the LibreChat fork base (attribution required by upstream), **proprietary "Baanzon" terms** for Baanzon-original additions; unify the 4-way conflicting metadata (root `ISC`, MIT `LICENSE`, package `ISC`, data-schemas MIT). Add `NOTICE`/`ATTRIBUTION`. |
| A2 | `HELP_AND_FAQ_URL` | `https://baanzonchat.opraiz.com` |
| A3 | `semanticSearch` | **Wire it** (embedder + semantic client injection; keyword fallback guaranteed) |
| A4 | Data engine for 28 §45 entities | **MongoDB primary (existing, mature) + PostgreSQL/pgvector as the durable vector store** for RAG. Lowest migration risk + durable RAG. |
| A5 | Data Lab sandbox | **Ship `attached` now; build `managed` in Phase 7.** |
| A6 | `bun.lock` + 15 `b:*` scripts | **Delete** (npm is the install of record) |
| A7 | RAG default | **Enabled by default with keyword fallback + global kill switch + rate limiting** |
| A8 | Error tracking | **Self-hosted, OpenTelemetry-first** (Sentry-compatible DSN optional; no vendor lock-in). Errors stay inside the deployment unless a DSN is configured. |
| A9 | Skill tree | **Wire phase-2** (backend endpoints + UI) |
| A10 | Sandbox ruling | **`attached` now, `managed` later** (matches A5) |
| A11 | Persisted identifiers (MIME types) | **Freeze** — do not rename without a migration; record in ADR-002 |
| A12 | Embeddings provider | **OpenAI-compatible `/embeddings` via injected client** (works with OpenAI, Azure, Ollama, vLLM, LiteLLM); configurable |
| A13 | Admin panel | **Vendor/rebrand + pin**; require `ADMIN_PANEL_SESSION_SECRET` |
| A14 | Registration | **Invite/registration policy configurable; email verification required in production** |
| A15 | Trackers | **Collapse** `needtodo.md` / `buildscope.md` / `approval-batches.md` / `postgres-decision.md` → single `ROADMAP.md` |

Also approved: **build all, fix all, wire all** from the audit (sections B–G of the master audit).

---

## 1. Baseline (audited 2026-10-15, `efa2ed301`)

| Dimension | Baseline % |
|-----------|-----------|
| Backend / API | 72–75% |
| Frontend UI | 88% |
| Frontend UX | 74% |
| Production-ready | ~60% |
| Launch-ready | ~50% |
| **Overall** | **~70%** |

---

## 2. Phase map (target: 100%)

| Phase | Name | Primary outcome | Target add |
|-------|------|-----------------|-----------|
| **P1** | RAG completion | Semantic search wired, config forwarding fixed, schema expanded, rate limited, durable store seam | Backend +8% |
| **P2** | Production hardening | Branding/legal live config, secrets fail-fast, non-root, healthchecks, TLS, Mongo auth, engines, cleanup | Prod +25% |
| **P3** | Security & dependency hygiene | Under-fixed overrides fixed, P0 bumps, bun removed, lockfile normalized, peer floors | Prod +7% |
| **P4** | UI/UX parity — shell | ⌘K palette, dedicated Home, onboarding, in-conversation find, PDF export, notifications/activity | UX +14% |
| **P5** | UI/UX parity — capability | Canvas, realtime voice, Deep Research, Data Lab, Offline, Workflow Builder | UX +10%, features |
| **P6** | Tests, a11y, CI/CD | Coverage gates, missing tests, e2e/a11y/lighthouse, CD pipeline | Launch +13% |
| **P7** | Data platform & sandbox | Mongo/pgvector durable store, migration ledger, 28 entities, `managed` sandbox | Backend +9% |
| **P8** | Final validation | Full test matrix, commit, push, report | → 100% |

Each phase: implement with ≥7 agents/subagents in parallel → typecheck → focused tests → commit → push → update this file's status table.

---

## 3. Phase detail

### P1 — RAG completion  *(highest leverage)*
- **P1.1** Wire semantic search: build an `EmbeddingsProvider` adapter (OpenAI-compatible `/embeddings`) and a `semantic` client, inject into `createRagRoutes` in `api/server/routes/knowledge.js`.
- **P1.2** Inject a `ChunkEmbedder` for ingest so chunks carry vectors.
- **P1.3** Fix `loadRagConfig` (`packages/data-schemas/src/app/rag.ts`) to forward **all** tuning fields (chunkSize, chunkOverlap, hybridAlpha, candidateK, topK, minScore, inMemory*, embedding*), not just `disabled`/`apiUrl`.
- **P1.4** Add `semanticEnabled` to `ragSchema` + `TRagConfig` + `RagDomainConfig`; flip `disabled` default to `false` (A7).
- **P1.5** Add rate limiting to knowledge routes (`limiters/index.js` + wire into `knowledge.js`).
- **P1.6** Add a durable `VectorStore` seam (pgvector-backed) behind the existing interface; keep `InMemoryVectorStore` as the default.
- **P1.7** Tests: semantic wiring, config forwarding, rate limit, schema defaults.
- **Acceptance:** `packages/api` RAG suite green; new tests green; `baanzon.yaml` `rag:` levers visibly reach `req.config.rag`.

### P2 — Production hardening
- **P2.1** Live-config defaults: `APP_TITLE=Baanzon Chat`, `EMAIL_FROM` Baanzon address, `HELP_AND_FAQ_URL=https://baanzonchat.opraiz.com`, `MONGO_URI=.../BaanzonChat`; replace LibreChat ToS/contact in `baanzon.yaml` (legal copy).
- **P2.2** Secrets fail-fast: refuse production boot without fixed JWT/CREDS secrets; `BAANZON_ALLOW_EPHEMERAL_SECRETS` escape hatch.
- **P2.3** Docker: non-root `USER` in `Dockerfile.multi`; healthchecks in both compose files; `depends_on: service_healthy`; `.dockerignore` excludes `.env`, `*.env.temp`, uploads, logs, data-node.
- **P2.4** Mongo `--auth`; pgvector creds parameterized; no public DB ports.
- **P2.5** CSP default on (report-only first); CORS allowlist; `SESSION_COOKIE_SECURE=true`.
- **P2.6** `engines` (node>=24, npm>=11) + `engine-strict`; fix broken `upgrade`/`reinstall:docker`/`update.js` scripts.
- **P2.7** Remove tracked debug artifacts (`packages/api/rt_dbg.txt`, `run1*.txt`, `runtime*.txt`, `junit.xml`).
- **P2.8** License unification + `NOTICE`/`ATTRIBUTION`.
- **P2.9** Remove `bun.lock` + 15 `b:*` scripts; regenerate lockfile root name → `baanzon-chat`.
- **Acceptance:** compose boots with healthchecks; container runs non-root; `npm audit --level=high` clean; no `LibreChat` in live branding surfaces.

### P3 — Security & dependency hygiene
- **P3.1** Overrides: `brace-expansion`→≥2.1.7, `fast-uri`→≥3.1.8.
- **P3.2** Bumps: `nodemailer`→10.0.13, `multer`→2.4.0, `@node-saml/passport-saml`→5.1.1, `openid-client`→6.8.8.
- **P3.3** Peer floors: `@react-spring/web`→^10, `react-hook-form`→^7.56.4; align `@testing-library/jest-dom` on 6.x.
- **P3.4** Remove dead nested overrides in `packages/data-provider/react-query`.
- **P3.5** Major upgrades (staged): React 19, Tailwind 4, zod 4, react-query 5, i18next 25.
- **Acceptance:** install clean, build green, typecheck green, RAG/tools suites green.

### P4 — UI/UX parity: shell
- **P4.1** Command palette (⌘K) + unified cross-entity search.
- **P4.2** Dedicated Home route + onboarding ("What are you working on?", mode chips).
- **P4.3** In-conversation find / highlight / jump.
- **P4.4** PDF export + faithful citation export.
- **P4.5** Notifications + Activity Center (+ realtime push for background runs).
- **Acceptance:** each feature has loading/empty/success/failure/cancellation/retry states, localized strings, a11y intact, PWA-safe.

### P5 — UI/UX parity: capability
- **P5.1** Canvas workspace (split view, inline AI edit, comments, versions).
- **P5.2** Realtime voice (WebRTC, VAD, barge-in).
- **P5.3** Deep Research flow (editable plan → progress → pause/resume → report).
- **P5.4** Data Lab charts (ECharts) + analysis actions.
- **P5.5** Offline support (IndexedDB drafts/pending uploads + sync queue).
- **P5.6** Workflow Builder (unblocks billing/orchestration).
- **Acceptance:** feature-complete per competitor parity matrix; behind flags where risky.

### P6 — Tests, a11y, CI/CD
- **P6.1** Coverage thresholds in all configs.
- **P6.2** Missing tests: OllamaClient, client Skills tree, CRUD routes, RAG authorization/errors.
- **P6.3** e2e + a11y (axe) + Lighthouse lanes; wire into CI.
- **P6.4** Integration suites into CI; spec typecheck for `packages/api` + `packages/data-schemas`.
- **P6.5** CD pipeline (gated deploy).
- **Acceptance:** CI green on a real diff; coverage gate enforced; e2e/a11y/lighthouse lanes run.

### P7 — Data platform & sandbox
- **P7.1** pgvector durable `VectorStore` implementation + migration.
- **P7.2** Versioned migration ledger.
- **P7.3** Implement the 28 §45 entities on Mongo per A4.
- **P7.4** `managed` sandbox (nsjail/gVisor) per A5/A10.
- **Acceptance:** vectors survive restart and scale across replicas; migrations tracked.

### P8 — Final validation
- Full matrix: build:packages → 7 unit suites → typechecks → static-checks → lint → audit.
- Commit, push to `b1`. Final report with per-dimension % and remaining risk.

---

## 4. Status ledger

| Phase | Status | % of project after | Commit |
|-------|--------|--------------------|--------|
| P1 RAG completion | in progress | — | — |
| P2 Hardening | pending | — | — |
| P3 Security/deps | pending | — | — |
| P4 UX shell | pending | — | — |
| P5 UX capability | pending | — | — |
| P6 Tests/CI-CD | pending | — | — |
| P7 Data/sandbox | pending | — | — |
| P8 Validation | pending | — | — |

---

## 5. Definition of done (per AGENTS.md)

Ship the observable experience — loading, empty, success, failure, cancellation, retry, restored session —
with strings localized, accessibility intact, defaults and stored data preserved, and no backend
capability left without a frontend entry point. Run `npx tsc --noEmit` in every workspace changed.
`packages/client` specs via `npm run typecheck:spec`. `npm run sort-imports <paths>` for touched files.
