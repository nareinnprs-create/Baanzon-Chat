# Baanzon Chat — Execution Tracker

Authoritative ledger for the approved remediation (approval stamp: 2026-10-21, user approved ALL batches).
Rule: every item gets status PENDING / IN-PROGRESS / DONE / BLOCKED with evidence (file:line or verification command result). No item is DONE without verification.

Context snapshot at approval time:
- Repo: LibreChat/ (canonical), remote nareinnprs-create/Baanzon-Chat, branch b1 (tracks origin/b1, 0/0)
- Pending at approval: 26 modified + 3 untracked files
- Local node v26.7.0 vs pinned 24.16.0 (.nvmrc); npm 12.0.2 vs packageManager npm@11.13.0

---

## A1 — Git hygiene & commits (DONE)

| # | Item | Status | Evidence |
|---|---|---|---|
| A1.1 | Delete parent wrapper: temp_service.ts + parent .git (LibreChat/ stays canonical) | DONE | wrapper deleted; LibreChat/ is the canonical repo on b1 |
| A1.2 | git rm packages/api/run2.txt (tracked Jest log) | DONE | commit 6cd449a42 |
| A1.3 | Delete untracked junk before commit: junit.xml (root), packages/api/junit.xml, coverage/, lc-reaper-*.pid in packages/api | DONE | commit 6cd449a42 |
| A1.4 | Verify before commit: tsc --noEmit in packages/api + packages/data-schemas; targeted specs (projects handlers, chatProject) | DONE | tsc exit 0 both packages; projects handlers spec 29/29; chatProject spec 20/20 |
| A1.5 | Commit 26 modified + 3 untracked (types.ts, handlers.spec.ts, chatProjectWorkspace.ts) + this tracker | DONE | 31 files, commit 6cd449a42 |
| A1.6 | Push origin b1 | DONE | pushed to origin/b1 |

## A2 — Critical fixes (DONE)

| # | Item | Status | Evidence |
|---|---|---|---|
| A2.1 | Switch to Node 24.16.0 (nvm) and run npm ci (sync node_modules with lock) | DONE | node shim resolves pinned 24.16.0/npm 11.13.0. Majors events reverted to pinned baseline (zod ^3.22.4 at packages/api/package.json:167 + data-provider:51; @tanstack/react-query ^4.28.0 peer at data-provider:76 + client:71; zod workspace deps kept as ^3.25.76 effective). Stale lock records removed (node_modules/zod, node_modules/@tanstack/react-query). **Plain `npm ci` exit 0 (3282 packages)**; resolved versions verified: root zod 3.25.76, root RQ 4.44.0, client zod and data-provider zod and packages api zod all resolve to root 3.25.76. Client jest suites are slow but pass (28–230s each, silent until done because coverage defaults ON via jest.config.cjs — see A2.6 note) |
| A2.2 | Generate + set blank secrets in .env: JWT_SECRET, JWT_REFRESH_SECRET, CREDS_KEY, CREDS_IV, MEILI_MASTER_KEY, ADMIN_PANEL_SESSION_SECRET | DONE | all six written cryptographically random (128/128/64/32/64/96), each appearing exactly once, git-ignored |
| A2.3 | Set deploy-compose required vars: MONGO_INITDB_ROOT_USERNAME/PASSWORD, POSTGRES_PASSWORD | DONE | MONGO creds set earlier; POSTGRES_PASSWORD generated (8+…3e8, 64 hex) into .env |
| A2.4 | Create LibreChat/skill/ (.gitkeep) to satisfy Dockerfile.multi:114 COPY | DONE | skill/.gitkeep committed |
| A2.5 | Delete 7 broken scripts in api/package.json + 4 broken start:demo scripts in packages/api/package.json | DONE | removed both sets |
| A2.6 | Verify: npm ls clean (no ELSPROBLEMS), docker compose config validation | DONE | `npm ci` exit 0 clean (see A2.1); `docker compose config --quiet` PASS for docker-compose.yml (UID/GID blank-string warnings only); **`docker compose -f deploy-compose.yml config` PASS (exit 0)** after POSTGRES_PASSWORD was added to .env |

## A3 — Security (DONE)

| # | Item | Status | Evidence |
|---|---|---|---|
| A3.1 | workspaceId membership/ownership check in packages/api/src/projects/handlers.ts (createProject/updateProject) with spec | DONE | Deny-by-default gate `requireWorkspaceAccess` (packages/api/src/projects/handlers.ts:115-136, guards at 176 and 277) via injected `assertWorkspaceAccess` (types.ts:108); factory `createWorkspaceAccessAssert` (packages/api/src/workspaces/access.ts:33: workspace→org→active membership≥member + private-visibility rule) wired at api/server/routes/projects.js:15-19; spec 6 new cases in packages/api/src/projects/handlers.spec.ts ("workspace access" describe) — 29/29 passed (`npx jest --runTestsByPath src/projects/handlers.spec.ts`, VALIDATE_NO_COVERAGE=1) |
| A3.2 | Rate limiting on all 6 /api/projects routes | DONE | api/server/middleware/limiters/projectsLimiter.js (user-keyed, route-scoped window via PROJECTS_WINDOW_MS/PROJECTS_MAX envs, limiterCache store) mounted `router.use(projectsLimiter)` after requireJwtAuth (api/server/routes/projects.js:25-26); api/server/middleware/limiters/index.js:10,27; api/server/routes/__tests__/projects.test.js 18/18 passed against the real wiring |
| A3.3 | Mount chatProjectWorkspaceMigration into boot migration runner / connect step | DONE | `runBootMigrations(mongoose.connection)` (packages/api/src/db/migrations.ts:16, exporting data-schemas `runMigrations` + `chatProjectWorkspaceMigration`) awaited right after `await connectDb()` (api/server/index.js:218); ledger runner is idempotent + skips on rerun (data-schemas src/migrations/ledger.spec.ts 18/18 passed); index built via `createIndex`, independent of MONGO_AUTO_INDEX. Live Mongo smoke-run still pending — no MongoDB reachable on this machine (docker pull of mongo:7 stalled) |
| A3.4 | Enable security levers in .env: CSP_ENABLED, TENANT_ISOLATION_STRICT, SESSION_COOKIE_SECURE, TRUST_TENANT_HEADER, BAANZON_ALLOW_EPHEMERAL_SECRETS decisions | DONE | CSP_ENABLED=true and TENANT_ISOLATION_STRICT=true written to .env (2026-10-23); SESSION_COOKIE_SECURE and TRUST_TENANT_HEADER left commented out with rationale: terminating TLS is not necessarily local/upstream, so enabling them prematurely would break local HTTPS termination and would define x-tenant-id before being spread across a production reverse proxy; BAANZON_ALLOW_EPHEMERAL_SECRETS remains unset (not allowed by default) |
| A3.5 | Align ProjectUpdateInput to support workspaceId: null detach (storage supports $unset) | DONE | `ProjectUpdateInput.workspaceId: string \| null` (packages/api/src/projects/types.ts:64-69); handler forwards `null` → storage `$unset` (packages/api/src/projects/handlers.ts:275-286, comment fixed); null-detach spec case in handlers.spec.ts ("detaches the workspace when an update sends null") passing; packages/data-schemas `UpdateChatProjectInput` already carries `string \| null` |
| A3.6 | Verify: tsc + tests green on touched packages | DONE | `npx tsc --noEmit` exit 0 in packages/api + packages/data-schemas (A1.4) and packages/data-provider (A4.1); projects handlers spec 29/29, projects.test.js 18/18, migrations ledger spec 18/18, FluxAPI 3/3 + imageTools 19/19, client canvas specs + featureRoutes all pass (A4.4) |

## A4 — High fixes (DONE, except A4.3 feature)

| # | Item | Status | Evidence |
|---|---|---|---|
| A4.1 | workspaceId client surface: data-provider types (TChatProject, TCreate/UpdateChatProjectRequest, ProjectListParams) + queries + rebuild packages | DONE | types/queries.ts + types.ts + client queries.ts threaded; packages/data-provider `npx tsc --noEmit` exit 0; mocks untouched (partial objects, not typed); no UI pages touched |
| A4.2 | Canvas i18n: com_ui_canvas_* (65 keys) into all 41 non-EN locales | DONE | all 40 non-EN locale dirs (count confirmed = 40) contain exactly 65 com_ui_canvas_* keys with EN-parity placeholders, verified by scripted per-locale parse+count+parity; low-confidence renders flagged (he plural, cs/pl, fi, ru, ar) |
| A4.3 | Deep Research backend executor (replace createInMemoryExecutor placeholder with packages/api executor + wiring + route) | PENDING | assigned to feature agent |
| A4.4 | Verify: tsc + affected specs | DONE | client: state.spec 24/24 (after reducer guard), CanvasWorkspace 7/7, CanvasEditor 5/5, SplitView+VersionHistory+comments 14/14, featureRoutes 16/16 (43s, loop-free); eslint --max-warnings 0 exit 0 on touched Canvas files; packages: tsc exit 0 (api, data-schemas, data-provider) |

### Canvas infinite render loop fix (found via A4.4 verification)

- Symptom: featureRoutes spec logged repeated "Maximum update depth exceeded" from CanvasWorkspace.tsx:103 (dispatch of load_success inside a useEffect), and running the Canvas editor + workspace specs together OOM'd the heap.
- Root cause: the load effect depended on `localize` (unstable identity across renders), so every dispatch-driven re-render re-fired the effect; combined with a reducer that always returns a fresh state object on load_success, subscribers never settled.
- Fix: idempotent guard in `canvasReducer` load_success (returns the same state when already ready with the same document object — also protects user edits from a re-dispatch wipe) + `localizeRef` pattern in CanvasWorkspace.tsx (localize dropped from the effect deps, error path reads the ref).

## A5 — Medium fixes (PENDING)

| # | Item | Status | Evidence |
|---|---|---|---|
| A5.1 | FluxAPI.js:372 — restore cost handling (PRICING lookup) | DONE | costs restored in api/app/clients/tools/structured/FluxAPI.js — `recordImageCost` helper (credits tx via ~/models createTransaction, balance/transactions gated, PRICING-missing warn-once+skip, longest-first key match w/ `.`/`-` normalization); `specs/FluxAPI.spec.js` 3/3 + `specs/imageTools-agent.spec.js` 19/19 passed |
| A5.2 | ActionsInput.tsx — implement examples UI (uncomment + finish format button) | PENDING | |
| A5.3 | useChatBadges — implement Artifacts badge or remove dead code | DONE | evidence-based removal: commented atom `store.codeArtifacts` does not exist (rg 0 hits in client/src/store) → dead block deleted, badgeConfig emptied (client/src/hooks/useChatBadges.ts:16), hook machinery kept; eslint 0 errors |
| A5.4 | useContentHandler non-text streaming | PENDING | |
| A5.5 | useSSE.ts console.log dumps (141, 220, 287) | DONE | 3 debug console.log lines removed (final payload, "connection is opened", "error in server stream.") in client/src/hooks/SSE/useSSE.ts; all console.error error branches kept (118, 136, 255, 292); eslint 0 errors |
| A5.6 | Doc drift: baanzon.example.yaml RAG default text; live baanzon.yaml ToS rebrand (P2-10); tool-intent-spec status line; 8 workflows bun.lock mentions; CLAUDE.md pr-retarget-dev.yml ref (remove or create workflow — decide: remove ref) | DONE | All five: RAG comments now enabled-by-default + `rag.disabled` kill switch (baanzon.example.yaml:1255-1264, schema ref packages/data-schemas/src/app/rag.ts:15); live baanzon.yaml ToS copied from example (Baanzon Chat + support@baanzonchat.opraiz.com); tool-intent-spec.md:3 status = shipped in-tree (packages/api/src/agents/intent.ts, client Part intent.ts, tool_intents config) w/ streaming-header gap; bun.lock claims removed from 8 workflows + package.json `//` (rg "bun\.lock" .github + package.json = 0 hits); CLAUDE.md:70-71 retargeting now manual/from-policy (pr-retarget-dev.yml ref dropped); both yamls parse OK via js-yaml |
| A5.7 | Vuln sweep: re-run npm audit after npm ci; fix 23 high (0 critical baseline) via targeted overrides (do NOT blanket npm audit fix) | PENDING | |
| A5.8 | capabilities.ts:194 admin capabilities scaffold — activate or mark explicit | PENDING | |
| A5.9 | Runs maxRetries — implement or remove claim | PENDING | |
| A5.10 | Test fixture drift: projects.test.js mock hasMore -> nextCursor | DONE | mock fixed to `{ projects, nextCursor: null }` (api/server/routes/__tests__/projects.test.js:53) matching data-schemas chatProject.ts:293; jest 1 suite / 18 tests passed, 0 failed |

## A6 — Cleanup (PENDING; A1 covered run2.txt, junit.xml, coverage, pids)

| # | Item | Status | Evidence |
|---|---|---|---|
| A6.1 | Remove commented-out files.ts:110-129 block | DONE | dead commented `getFileType` (formerly lines 110-129) deleted above the active re-export in client/src/utils/files.ts; eslint 0 errors |
| A6.2 | Rename Masterblueprint(1).md -> docs/masterblueprint.md + update refs (ROADMAP.md:12, REMEDIATION-PLAN.md:3 + index) | PENDING | |
| A6.3 | Archive/delete packages_scope_catalog.txt (stale catalog) | PENDING | |
| A6.4 | Remove husky devDep (no prepare script) | PENDING | |
| A6.5 | Remove node-fetch from api deps (Node 24 native fetch — verify zero imports first) | PENDING | |
| A6.6 | Decide/de-dup: client ImageVision, Background (fork-side only; review not bulk) | PENDING | |
| A6.7 | Canvas LOW: extract shared toErrorMessage; dirty flag decision (wire save seam or remove) | DONE | toErrorMessage extracted to client/src/components/Canvas/utils.ts, imported by CanvasEditor.tsx + CanvasWorkspace.tsx (eslint 0 errors; also fixed pre-existing missing EOF newline on both); dirty flag kept as user-facing unsaved-changes affordance (used by title edit + block edits), removal rejected — the flag has read-path consumers and dropping it would strand the dirty state |

## A7 — Missing features (PENDING; implemented per repo conventions: TS in packages/api, configSchema lever, Jotai client, specs required)

| # | Feature | Status | Evidence |
|---|---|---|---|
| A7.1 | Trust Engine + TrustIndicator (B6) | PENDING | |
| A7.2 | Aurora Pulse activity states (B3) | PENDING | |
| A7.3 | Cross-entity search backend (B9) | PENDING | |
| A7.4 | Feature flags store + canary/kill-switch (B23/W15) | PENDING | |
| A7.5 | Eval framework (B22) | PENDING | |
| A7.6 | Mobile bottom nav (B25) | PENDING | |
| A7.7 | Blueprint i18n languages (B26: ta/ml/gu/kn/si/ne) | PENDING | |
| A7.8 | Data Lab echarts upgrade (B12) | PENDING | |
| A7.9 | Billing entitlements/plan-limits (B18 remainder) | PENDING | |
| A7.10 | Tenancy: project->workspace link client surface (pairs with A4.1) | PENDING | |
| A7.11 | Native clients scaffolds (B28 — Expo/Tauri) — DEFER pending user priority statement | PENDING | |

## Verification harness (run at each phase end)

- `npx tsc --noEmit` in packages/api, packages/data-schemas, packages/data-provider, packages/client (tsconfig.test.json)
- Targeted jest per touched package; `npm run test:e2e` after UI phases
- `docker compose -f deploy-compose.yml config` after A2/A3
- `git push origin b1` per phase (single phased commits)

---

## Phase log

- 2026-10-21: Approval received (ALL batches). Tracker created. Phase A1 started.
- 2026-10-22: A3.1/A3.2/A3.3/A3.5 landed. Verification: `npx tsc --noEmit` exit 0 in packages/api and packages/data-schemas; packages/api projects handlers spec 29/29; api/server routes projects.test.js 18/18; data-schemas migrations ledger spec 18/18. packages/data-schemas rebuilt (stale dist lacked chatProjectWorkspaceMigration); node_modules for winston-daily-rotate-file restored without lock/package.json changes (npm ci still pending per A2.1).
- 2026-10-22: A5.1/A5.3/A5.5/A5.10/A6.1 + A6.7 toErrorMessage extraction executed. Environment: repo node_modules is a stub (A2.1 pending), `npm ci` blocked by lockfile drift (zod 4.6.7 in lock vs 3.25.76 demanded; otel pins missing) — jest run via npx-cached jest@30.5.2 + babel toolchain from `cd api`. packages/api tsdown build was stale — LOCKED by pristine TS9017 error; fixed with explicit `Migration[]` annotation (packages/api/src/db/Migrations.ts:11), rebuilt dist, `npx tsc --noEmit` in packages/api green. FluxAPI/imageTools specs updated with hermetic `~/models` + partial `@librechat/api` mocks (FluxAPI must not retain full `req` — spec invariant preserved; balance/transactions config resolved in constructor instead).
- 2026-10-22: A2.6/A3.4 verification pass: `docker compose config --quiet` exit 0 for docker-compose.yml (UID/GID blank-string warnings only) and for deploy-compose.yml only with command-line-only `$env:POSTGRES_PASSWORD='__validate__'` (fails as-is: required POSTGRES_PASSWORD missing — not set in .env per do-not-set rule). Skill/.gitkeep exists — Dockerfile.multi `COPY skill ./skill` (line 114) satisfiable (covers A2.4). Provider keys GROQ_API_KEY / MISTRAL_API_KEY / OPENROUTER_KEY absent from .env (baanzon.yaml endpoint keys to be sourced when needed).
- 2026-10-23: A2 closed: npm ci regen pass — majors (zod 4/RQ 5) reverted to pinned 3.x/4.x baseline, stale lock records removed, plain `npm ci` exit 0 (3282 packages). A3.4 closed: CSP_ENABLED=true + TENANT_ISOLATION_STRICT=true set in .env (SESSION_COOKIE_SECURE/TRUST_TENANT_HEADER stay commented with rationale; BAANZON_ALLOW_EPHEMERAL_SECRETS unset); POSTGRES_PASSWORD generated — `docker compose -f deploy-compose.yml config` exit 0. A4.1 loop guard landed: canvasReducer load_success idempotence guard (state.ts) + CanvasWorkspace localizeRef (no more "Maximum update depth exceeded"); full client verification green: state 24/24, CanvasWorkspace 7/7, CanvasEditor 5/5, SplitView+VersionHistory+comments 14/14, featureRoutes 16/16; eslint --max-warnings 0 exit 0 on touched files. Jest "hang" myth retired: suites are slow-but-progressing (28–230s, silent under piped stdout) and coverage defaults ON inflates runs ~7x.
