# Baanzon Chat — Execution Tracker

Authoritative ledger for the approved remediation (approval stamp: 2026-10-21, user approved ALL batches).
Rule: every item gets status PENDING / IN-PROGRESS / DONE / BLOCKED with evidence (file:line or verification command result). No item is DONE without verification.

Context snapshot at approval time:
- Repo: LibreChat/ (canonical), remote nareinnprs-create/Baanzon-Chat, branch b1 (tracks origin/b1, 0/0)
- Pending at approval: 26 modified + 3 untracked files
- Local node v26.7.0 vs pinned 24.16.0 (.nvmrc); npm 12.0.2 vs packageManager npm@11.13.0

---

## A1 — Git hygiene & commits (IN-PROGRESS)

| # | Item | Status | Evidence |
|---|---|---|---|
| A1.1 | Delete parent wrapper: temp_service.ts + parent .git (LibreChat/ stays canonical) | PENDING | |
| A1.2 | git rm packages/api/run2.txt (tracked Jest log) | PENDING | |
| A1.3 | Delete untracked junk before commit: junit.xml (root), packages/api/junit.xml, coverage/, lc-reaper-*.pid in packages/api | PENDING | |
| A1.4 | Verify before commit: tsc --noEmit in packages/api + packages/data-schemas; targeted specs (projects handlers, chatProject) | PENDING | |
| A1.5 | Commit 26 modified + 3 untracked (types.ts, handlers.spec.ts, chatProjectWorkspace.ts) + this tracker | PENDING | |
| A1.6 | Push origin b1 | PENDING | |

## A2 — Critical fixes (PENDING)

| # | Item | Status | Evidence |
|---|---|---|---|
| A2.1 | Switch to Node 24.16.0 (nvm) and run npm ci (sync node_modules with lock: jest 30.5.2, zod 4.6.7, react-query 5.104.4) | PENDING | |
| A2.2 | Generate + set blank secrets in .env: JWT_SECRET, JWT_REFRESH_SECRET, CREDS_KEY, CREDS_IV, MEILI_MASTER_KEY, ADMIN_PANEL_SESSION_SECRET | PENDING | |
| A2.3 | Set deploy-compose required vars: MONGO_INITDB_ROOT_USERNAME/PASSWORD, POSTGRES_PASSWORD | PENDING | |
| A2.4 | Create LibreChat/skill/ (.gitkeep) to satisfy Dockerfile.multi:114 COPY | PENDING | |
| A2.5 | Delete 7 broken scripts in api/package.json + 4 broken start:demo scripts in packages/api/package.json | PENDING | |
| A2.6 | Verify: npm ls clean (no ELSPROBLEMS), docker compose config validation | PENDING | |

## A3 — Security (PENDING)

| # | Item | Status | Evidence |
|---|---|---|---|
| A3.1 | workspaceId membership/ownership check in packages/api/src/projects/handlers.ts (createProject/updateProject) with spec | PENDING | |
| A3.2 | Rate limiting on all 6 /api/projects routes | PENDING | |
| A3.3 | Mount chatProjectWorkspaceMigration into boot migration runner / connect step | PENDING | |
| A3.4 | Enable security levers in .env: CSP_ENABLED, TENANT_ISOLATION_STRICT, SESSION_COOKIE_SECURE, TRUST_TENANT_HEADER, BAANZON_ALLOW_EPHEMERAL_SECRETS decisions | PENDING | |
| A3.5 | Align ProjectUpdateInput to support workspaceId: null detach (storage supports $unset) | PENDING | |
| A3.6 | Verify: tsc + tests green on touched packages | PENDING | |

## A4 — High fixes (PENDING)

| # | Item | Status | Evidence |
|---|---|---|---|
| A4.1 | workspaceId client surface: data-provider types (TChatProject, TCreate/UpdateChatProjectRequest, ProjectListParams) + queries + rebuild packages | PENDING | |
| A4.2 | Canvas i18n: com_ui_canvas_* (65 keys) into all 41 non-EN locales | PENDING | |
| A4.3 | Deep Research backend executor (replace createInMemoryExecutor placeholder with packages/api executor + wiring + route) | PENDING | |
| A4.4 | Verify: tsc + affected specs | PENDING | |

## A5 — Medium fixes (PENDING)

| # | Item | Status | Evidence |
|---|---|---|---|
| A5.1 | FluxAPI.js:372 — restore cost handling (PRICING lookup) | PENDING | |
| A5.2 | ActionsInput.tsx — implement examples UI (uncomment + finish format button) | PENDING | |
| A5.3 | useChatBadges — implement Artifacts badge or remove dead code | PENDING | |
| A5.4 | useContentHandler non-text streaming | PENDING | |
| A5.5 | useSSE.ts console.log dumps (141, 220, 287) | PENDING | |
| A5.6 | Doc drift: baanzon.example.yaml RAG default text; live baanzon.yaml ToS rebrand (P2-10); tool-intent-spec status line; 8 workflows bun.lock mentions; CLAUDE.md pr-retarget-dev.yml ref (remove or create workflow — decide: remove ref) | PENDING | |
| A5.7 | Vuln sweep: re-run npm audit after npm ci; fix 23 high (0 critical baseline) via targeted overrides (do NOT blanket npm audit fix) | PENDING | |
| A5.8 | capabilities.ts:194 admin capabilities scaffold — activate or mark explicit | PENDING | |
| A5.9 | Runs maxRetries — implement or remove claim | PENDING | |
| A5.10 | Test fixture drift: projects.test.js mock hasMore -> nextCursor | PENDING | |

## A6 — Cleanup (PENDING; A1 covered run2.txt, junit.xml, coverage, pids)

| # | Item | Status | Evidence |
|---|---|---|---|
| A6.1 | Remove commented-out files.ts:110-129 block | PENDING | |
| A6.2 | Rename Masterblueprint(1).md -> docs/masterblueprint.md + update refs (ROADMAP.md:12, REMEDIATION-PLAN.md:3 + index) | PENDING | |
| A6.3 | Archive/delete packages_scope_catalog.txt (stale catalog) | PENDING | |
| A6.4 | Remove husky devDep (no prepare script) | PENDING | |
| A6.5 | Remove node-fetch from api deps (Node 24 native fetch — verify zero imports first) | PENDING | |
| A6.6 | Decide/de-dup: client ImageVision, Background (fork-side only; review not bulk) | PENDING | |
| A6.7 | Canvas LOW: extract shared toErrorMessage; dirty flag decision (wire save seam or remove) | PENDING | |

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
