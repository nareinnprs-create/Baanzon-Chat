# BAANZON CHAT — REMEDIATION & BUILD PLAN

Derived from the 6-agent audit (2026-09-30) against `Masterblueprint(1).md` v2.0
(L116 LOCKED 2026-09-08), branch `b1` @ `b5dfc7867`, v0.8.8-rc2.

**Baseline:** build ✅ · typecheck ✅ (5/5 workspaces) · tests ❌ 121 failing ·
lint ❌ 109 errors · deploy ❌ ships wrong software · CI ❌ absent ·
rebrand ~70% · blueprint coverage ~35%.

**No code was modified to produce this plan.** Every claim is file:line verified.
Items marked **[OWNER DECISION]** need your answer before implementation.

---

## READ THIS FIRST — 4 GATES THAT BLOCK EVERYTHING ELSE

### GATE A — Blueprint §84 contradicts the repo in 5 places
§84 is titled **"RECOMMENDED** TECH STACK" — the only section in 116 using
recommendation rather than imperative framing. §116's lock record covers **only**
the Aurora Pearl *visual* direction, not the stack. §0:19 says *"Do not silently
invent architecture"* — which the current gap is already doing.

| §84 | Repo | Blast radius | Verdict |
|---|---|---|---|
| Next.js 16 | Vite + React Router 7 | 1,573 files / 194k lines, 96 router files, PWA lane. **No Next.js in 5,532 commits of history.** | **Deviate** — §84 is its only mention; no SSR requirement exists anywhere |
| pnpm | npm 11.13 (+ `bun.lock`) | Config only. §84 is its only mention. | **Deviate** (low priority) |
| Vitest | Jest, 7 configs, 1,554 files / ~30k tests | 7 structural blockers (programmatic config composition, custom resolver, `workerIdleMemoryLimit`, 4× `transformIgnorePatterns`, `jest-junit`, babel-jest, `mongodb-memory-server` globalSetup). §94 never names a runner. | **Deviate** |
| Zustand | Jotai 74 files + Recoil 244 files | Starting a *third* library. Jotai is further along and matches the atom-per-feature rule. | **Deviate on library, finish Recoil→Jotai** |
| **PostgreSQL + pgvector** | **MongoDB + Mongoose** | **NOT the outlier** — §24:1035, §45:1611, §46:1667 all say PostgreSQL as flat fact. 58 schemas, 48 models, 48 method files (36,572 lines), `tenantIsolation` query plugin. | **Adopt later via FerretDB** (per unsigned `postgres-decision.md`) — never native+ORM |

**Corroboration:** Redis ✅ present (`ioredis 5.3.2`, `RedisJobStore`,
`LeaderElection`, 6 Lua CAS scripts). S3 ✅ present (`@aws-sdk/client-s3`,
presigner, CloudFront, Azure Blob, 22-file `storage/`). pgvector ✅ running as
the `vectordb` sidecar. Python ✅ runs as the prebuilt `rag_api` container.
`workers/` ❌ 0%. `Tiptap` ❌ · `ECharts` ❌ · `Terraform` ❌ · `Tauri` ❌ · `Expo` ❌.

**Action GATE-A:** write **ADR-002** recording the four §84 deviations +
`workers/`/sandbox deferrals, cross-referenced to unsigned ADR-001 for the
database. Converts 6 silent violations into 6 recorded decisions. **~2h, blocks
the build plan's architecture section.**

### GATE B — The deploy path ships the wrong product
`deploy-compose.yml:3-7` has the `build:` block **commented out** and pulls three
unbranded upstream LibreChat `-dev` images. `npm run start:deployed` runs stock
LibreChat with **zero fork features** and reports green. This is P0-1.

### GATE C — Nothing can fail a build
`.github/` does not exist (0 workflows) **and** `static-checks.mts` exits 0 on an
unstaged tree. Nothing in this repo can fail CI. P0-3 + P0-4.

### GATE D — Two spec conflicts need your ruling before building
1. **§45 says "Primary database: PostgreSQL" in 4 places; the repo is Mongo and
   `postgres-decision.md` recommends FerretDB substitution, not migration.** The
   ADR is **unsigned** (`postgres-decision.md:3 PROPOSED — awaiting sign-off`) and
   its FerretDB evidence covered 29 models; **48 exist today**. Build order for
   all 10 new areas depends on whether new entities land in Mongo or Postgres.
2. **§27–29 (Canvas/Data Lab) + §41 require a code-execution sandbox.** The
   control plane is fully met (`packages/api/src/code/lifecycle.ts`, approval
   policy, revocation leases) but **isolation is delegated to an external
   `baanzon-code` binary on the user's own machine**. `managed` does not exist.
   Zero hits for `nsjail`/`gVisor`/`seccomp`. Data Lab cannot ship without it.

**→ I'll present the build plan (§5) after GATE A + D are answered. The P0–P3
remediation below is independent of both and can start immediately.**

---

# 1. P0 — LAUNCH BLOCKERS

## P0-1 · `deploy-compose.yml` deploys upstream LibreChat, not this fork

**Files:** `deploy-compose.yml:3-7, 8, 22, 37-38, 43, 46, 62, 97-99, 104, 114-116`

**Depends on:** nothing. Ship first.

**Approach (safest = smallest diff):** replace lines 3-7 only:
```yaml
    build:
      context: .
      dockerfile: Dockerfile.multi
      target: api-build
    image: baanzon-chat-api:latest
```
`target: api-build` is correct as written — `Dockerfile.multi:118` is the only
stage that also carries `client/dist`, which is why the `client` service is
nginx-only. **Leave line 46** (ClickHouse admin panel, third-party prebuilt) and
**line 104** (`rag_api`) alone — this repo cannot build either.

Then, in the same PR: `container_name: LibreChat-API`→`baanzon-api`,
`LibreChat-NGINX`→`baanzon-nginx`, `librechat-data` volume →`baanzon-data`,
`MONGO_URI=.../LibreChat` →`/BaanzonChat`. P0-7 covers the rest of the strings.

**CRITICAL — do this or RAG ships dead:** `deploy-compose.yml:37-38` bind-mounts
`./baanzon.yaml`, which **does not exist on disk**. Docker creates a *directory*
named `baanzon.yaml`; `loadCustomConfig.js:87-95` then returns falsy → the app
boots with `req.config.rag` undefined. `baanzon.example.yaml` → `baanzon.yaml`
must land in the deploy runbook.

**Regression risk:** MEDIUM. Un-commenting the build block changes the image from
`librechat-dev-api` to a locally-built `api-build` — different base, different
`NODE_ENV` handling, and `Dockerfile.multi:131` runs as **root** (P1-6). First
`up` will take several minutes and will surface any previously-hidden build break.
**Contained by:** building `Dockerfile.multi` once on a scratch branch before
merging.

**Tests:** none exist. Required — smoke: `docker compose -f deploy-compose.yml
config` parses; `up` reaches `/readyz` 200 (§`api/server/index.js:310` exists);
`GET /api/config` returns `appTitle: "Baanzon Chat"`; `GET /api/knowledge` returns
200 (proving Baanzon code is running, not upstream).

## P0-2 · License incoherence — 4-way split + upstream copyright

**Files:** `LICENSE:1,3` · `packages/data-schemas/LICENSE:3` · `package.json:114` ·
`api/package.json` · `client/package.json` · `packages/api/package.json` ·
`packages/data-provider/package.json` · `packages/client/package.json` (unset) ·
`packages/data-provider/react-query/package.json` (unset)

**Depends on:** **[OWNER DECISION]** MIT vs ISC. The on-disk `LICENSE` is MIT
(2026); five manifests declare ISC; `data-schemas` declares MIT; two declare
nothing. `packages/data-schemas/LICENSE` says **2025**, root says **2026** —
two LICENSE files, two years, neither naming Opraiz.

**Approach:** align every field to the root LICENSE (recommended: **MIT**, since
that is the only license actually present in the tree, and neither is copyleft so
no relicensing-obligation exists).
1. `"license": "ISC"` → `"MIT"` in 5 files.
2. Add `"license": "MIT"` to `packages/client/package.json` and
   `packages/data-provider/react-query/package.json`.
3. `LICENSE:3` → `Copyright (c) 2026 Opraiz Technology Pvt. Ltd.`
4. Delete `packages/data-schemas/LICENSE` (single source of truth) **or** sync its
   year to 2026.
5. Separately, repoint `repository`/`homepage`/`bugs` in 6 manifests from
   `danny-avila/LibreChat` + `https://librechat.ai` to
   `opraiz-technology/baanzon-chat` + `https://baanzon.com` (mirror root
   `package.json:109-118`).

**Do NOT touch** the package **names** (`@librechat/api`, `librechat-data-provider`,
…). That is Batch 27.5, ~2,700 files of import rewrites, deferred by design.

**Regression risk:** LOW-MEDIUM. `license`/`repository` fields affect only npm
publish metadata and SBOM scans. The `homepage`/`bugs` repoint breaks any link
checker pointing at the old repo — none exists.

**Tests:** `npm pack --dry-run` in each workspace and confirm the license field in
the packed manifest. A repo-wide grep asserting zero `danny-avila` in any
`package.json`.

## P0-3 · `static-checks` is a silent no-op over a dirty tree

**Files:** `scripts/static-checks.mts:421-427, 503-506, 1155-1159, 1208-1215`

**Depends on:** nothing.

**Root cause (verified live):** `EXIT=0` while `git status --short` shows 71
changed files. `resolveTarget` defaults to `diffPaths(['diff','--cached',...])`
(`:503-506`); `if (target.files.length === 0) { console.log('Nothing to check.'); return; }`
(`:1156-1159`) — a bare `return` leaves `process.exitCode` undefined.

**Approach (two minimal edits):**
- **(a) Fall back to the working tree.** After computing the staged diff, if it is
  empty, select `git status --porcelain=v1 -z --untracked-files=all
  --diff-filter=ACMRTUXB` and slice the path from the `XY ` prefix. Label it
  `'working tree (nothing staged)'`. Add a `splitPorcelainZ` helper beside
  `diffPaths` (after `:427`). Keep the `SOURCE_FILE_PATTERN` filter
  (`:120`) so `.md`/lockfiles are dropped.
  **Do NOT touch `:437`** — `--staged` belongs in the duplicate-selector guard;
  the fallback goes *after* selection, not as a fourth selector.
- **(b) Fail when a gate was requested but never ran.** Before `:1208`, if
  `failures.length === 0` and `OPTIONS.only.length > 0` and every selected check
  was skipped or matched no pattern, print a diagnostic and set
  `process.exitCode = 1`. Use `1`, not `fail()`'s `2` — this is a verification
  failure, not a usage error.

**Regression risk:** MEDIUM. A pre-commit hook that starts failing on files the
author did not stage will be *annoying* — that is the point, but it needs
`--staged` to remain available as the opt-out. The `--staged` flag is currently
**inert** (`:220` declares it, `:437` only guards it); wire it explicitly so
`--staged` still means "only what I staged".

**Tests:** add a spec asserting (i) unstaged-only changes are selected,
(ii) `--staged` on an unstaged tree selects nothing, (iii) `--only nonexistent`
exits 1, (iv) a clean tree with no flags still exits 0. Then run
`npm run static-checks` on this repo and confirm it now *reports* the 58
changed files.

## P0-4 · `.github/` does not exist — zero CI

**Files:** new `.github/workflows/*.yml`, `.github/pull_request_template.md`,
`.github/CODE_OF_CONDUCT.md`, `.github/ISSUE_TEMPLATE/*`

**Depends on:** P0-3 (a gate that can't fail is useless without a runner to call it).

**Approach:** minimum viable 4 workflows, in dependency order:
1. `static-checks.yml` — `npm run static-checks:full` on every PR. **This is the
   gate that would have caught all 121 test failures and 109 lint errors.**
2. `typecheck.yml` — the five `npx tsc --noEmit -p <ws>/tsconfig.json` invocations.
   Never `npm run build:*` instead: `tsdown` emits without checking types
   (`AGENTS.md` "Verification"), and `packages/client` excludes `*.spec.ts(x)`
   from typechecking entirely.
3. `test.yml` — the 5 `npm run test:*` scripts + `test:config`.
4. `security.yml` — `npm audit --level=high` (gate on high/critical only; the
   medium/low set is not worth a red build) + a secret scan.
Then `build.yml` (`npm run build:packages && npm run build:client`).

Pin every third-party action to a SHA (not a floating tag), add a `permissions:`
block (least privilege), and a `concurrency:` group to cancel superseded runs.

**Dependency trap:** `static-checks.mts:65,68,112,774,822` filters changes by
`.github/workflows/{static-checks,backend-review,frontend-review}.yml` — **all
three absent**, so those filters can never activate today. Creating the files
turns them on, which may surface *new* gate failures. Budget for that.

**Regression risk:** LOW for the workflows themselves; MEDIUM for the surprise
failures. This is the moment the repo becomes honest. Do it as its own PR, and
expect to iterate.

**Tests:** the workflows are the test. Verify each fails on a deliberately broken
PR (introduce a lint error, a type error, a failing test) before trusting a green
one.

## P0-5 · 121 failing tests

**Files & the exact fix for each cluster:**

| Cluster | File | Fix |
|---|---|---|
| 32 failures, **12 distinct identifiers** | `packages/api/src/agents/__tests__/run-summarization.test.ts` | find/replace `librechatTraceAttributes`→`baanzonTraceAttributes` (21×); `librechat.`→`baanzon.` for these **12 keys only**: `tenant.id`(18), `langfuse.export_plan`, `langfuse.export_reason`, `langfuse.destination`(5), `langfuse.tenant_export.enabled`(5), `conversation.id`, `endpoint`, `provider`, `model`, `spec`, `user.role`. **Do NOT touch** `@librechat/agents` (6), `@librechat/data-schemas` (5), `librechat-data-provider` (2) — package names, unchanged. |
| 1 failure | `packages/api/src/telemetry/config.spec.ts:12` | `toBe('librechat')` → `toBe('baanzon')`; impl is `telemetry/config.ts:1 DEFAULT_SERVICE_NAME = 'baanzon'` |
| **0 failures — a MISSED rename** | `packages/api/src/agents/startup.spec.ts:274` + `startup.ts:151` | Both sides say `librechat.stream.id`; `telemetry/stream.ts:47` says `baanzon.stream.id`. Two emitters, contradictory keys, **same trace**. Rename both in one PR. Also decide the unpaired `librechat.agent.startup.*` family (`startup.ts:15,138,164,165,166`) and `librechat.telemetry` (`:114`) — these are **operator-visible in dashboards**, no `baanzon` counterpart exists. |
| 2 failures | `packages/api/src/rag/routes.spec.ts:1352,1371` | **Change the TESTS, not the implementation.** See P0-5b. |
| 1 failure | `packages/api/src/rag/service.spec.ts:881` | `toContain('overlap by 100')` → `toContain('collections store the 100 the chunker will apply')`. The string no longer exists anywhere; `service.ts:280-288` reworded it. Keep line 880. |
| ~40 failures | Windows/POSIX | **Not code defects.** `path.resolve` separators, `fs.mode & 0o777`, `bash -c 'trap "" TERM'`, shell `printf`. Verify on Linux/WSL before treating any as real. |

**P0-5b — the RAG 403-vs-404 verdict. The tests are stale; the code is right.**
`service.ts:131-150` documents why 403 is correct: `getCollection` **already
returned** the collection to the caller at 200 (`routes.spec.ts:1304-1316` proves
`u-2` can read it), so "not found" is a statement the caller can disprove — and
the shipped client acts on it. `resolveDelete`
(`client/src/data-provider/Knowledge/mutations.ts:30-52`) rewrites **any** 404 from
a delete into `{deleted:true}` and runs the full success path. If the server
answered 404, a non-owner deleting a shared collection would be **told it was
gone**, watch it vanish from their list, and find it still serving everyone at
200.

Decisive: `routes.spec.ts:1400-1410` already asserts 404-for-absent /
403-for-visible-and-not-writable for the *identical* condition **and passes**.
Two tests in one file cannot both be right; `:1352/:1371` are pre-`writableCollection`
survivors. **Fix = 2 assertions + 1 comment; zero implementation change.** Leave
`:1354`/`:1372` (the `semanticSearch` checks) — they are the real authorization
guarantee and already pass.

**Approach:** scoped regex, exactly as tabulated. Then
`npm run sort-imports -- <the 4 files>`.

**Regression risk:** LOW for the test edits (assertions only). MEDIUM for
`startup.ts` — it changes emitted trace attribute names, so any dashboard or
alert matching `librechat.agent.startup.*` breaks. Flag to ops first.

**Tests:** the existing specs. Target: `npx jest src/agents/__tests__/run-summarization.test.ts src/agents/startup.spec.ts src/telemetry/config.spec.ts` in `packages/api` → 180/180, and `npx jest src/rag` → 215/215.

## P0-6 · Lint / format / import gates red

**Files:** 121 files fail `sort-imports:check` (16 in the current batch);
49 `prettier/prettier` errors; 60 `i18next/no-literal-string` (all in
`client/src/components/Files/**`, pre-existing).

**Depends on:** P0-5 (fix tests before formatting them).

**Approach:** (1) `npm run sort-imports -- <scoped paths>` — never bare, it
rewrites every source root. (2) `npx prettier --write` on the batch. (3) The 60
i18next errors are **pre-existing debt in `Files/`** — separate PR, do not bundle
with the RAG batch. The rule is `mode: 'jsx-text-only'`
(`eslint.config.mjs:240-265`), so only literal JSX text is enforced; the in-repo
escape hatch is `{/* eslint-disable-next-line i18next/no-literal-string */}`.

**Regression risk:** LOW. Formatting-only. But **run `tsc --noEmit` after** —
prettier reformatting a `.tsx` can expose a latent parse issue.

**Tests:** `npx eslint <the batch paths>` scoped (expect 0) ·
`npm run sort-imports:check` (expect 0) · `npm run lint` (expect 0, or a
documented pre-existing baseline count).

## P0-7 · 9 user-visible `LibreChat` fallbacks + `.env.example`

**Files:** `api/server/routes/config.js:73,145` ·
`api/server/services/AuthService.js:273,542,593,982` ·
`api/server/controllers/TwoFactorController.js:12` · `config/invite-user.js:64` ·
`.env.example:30,1100,1184,1186`

**Depends on:** nothing. ~30 min.

**Approach:** `'LibreChat'` → `'Baanzon Chat'` at the 7 `APP_TITLE` sites. Highest
visibility is `config.js:73` (`GET /api/config` → `appTitle` → every `<title>`, the
wordmark fallback, and the PWA manifest name).

**`config.js:145` is a URL, not a name — [OWNER DECISION]:**
`helpAndFaqURL: process.env.HELP_AND_FAQ_URL || 'https://librechat.ai'`. Do **not**
auto-rewrite to `baanzon.com` (inventing a URL is exactly what §0:19 forbids).
Options: (a) set the real docs URL, (b) `|| ''` to hide the link. Same question
for `.env.example:1186`.

`.env.example`: `APP_TITLE=Baanzon Chat`, `EMAIL_FROM=noreply@<your-domain>`,
`MONGO_URI=.../BaanzonChat`, plus 5 commented-out stale values
(`OTEL_SERVICE_NAME=librechat`, `CODEAPI_AUTH_PROVIDER=librechat-jwt`,
`CODEAPI_JWT_ISSUER=librechat`, `EMAIL_FROM_NAME="LibreChat"`,
`REDIS_KEY_PREFIX=librechat`). **`CODEAPI_JWT_ISSUER` needs care** —
`packages/api/src/auth/codeapi.ts:62 DEFAULT_ISSUER = 'librechat'`; changing the
env without changing the code invalidates existing tokens. Change both or neither.

**Regression risk:** MEDIUM on the issuer (invalidates tokens). LOW on everything
else. 2FA (`TwoFactorController.js:12`) changes the TOTP account label — users who
already enrolled see a different name, **enrollment still works**.

**Tests:** `npx jest` on `AuthService.spec.js`, `TwoFactorController` specs,
`config.js` route specs. A grep gate asserting zero `'LibreChat'` in
`api/server/` and zero `librechat.ai` in `.env.example`.

## P0-8 · RAG ships dark, and has no consumer

**Files:** `packages/data-provider/src/config.ts:2655` (`disabled: true`) ·
`client/src/hooks/Nav/useUnifiedSidebarLinks.ts:26-40,125` · all of
`client/src/components/Knowledge/**`

**Depends on:** P0-1 (the feature must be running to be tested), P1-12
(semanticSearch wired), P1-9 (rate limit).

**The finding that matters:** knowledge retrieval is reachable **only** from a
manual "Test retrieval" panel in `KnowledgeCollectionWorkspace.tsx:169`. No agent,
no chat handler, no prompt path consumes it — while the UI copy promises
*"Collections of documents that ground your assistants and searches in your own
content"* (`com_ui_knowledge_description`). The feature is built, tested, and
**does nothing**.

**Approach:** this is the "wire it up" work. Ground an agent turn in knowledge:
1. Expose a retrieval step the agent pipeline can call — an MCP-style tool
   (`knowledge_retrieve`) registered through the existing tool registry, or a
   context handler. `packages/api/src/rag/service.ts` already has the service;
   what is missing is an **entry point that isn't a test panel**.
2. Follow the `packages/api/src/utils/llm.ts` pattern (the one existing
   retrieval-prompt assembly hook) rather than inventing a new path.
3. Only then flip `disabled: false` and let the nav link go live.
4. **[OWNER DECISION]** keep or remove `com_ui_knowledge_nav_disabled` copy.

**Regression risk:** HIGH — this is the first time retrieval touches a live
generation path. Guard: retrieval must be read-only, must never write to a
collection, and must be bounded (max chunks + a timeout) so a slow embedding
provider cannot stall a generation. Gate behind its own config lever
(per `AGENTS.md`: "New levers ship configurable").

**Tests:** an agent-integration spec proving a grounded turn calls
`knowledgeRetrieve` and the answer cites the retrieved chunk ids. A negative
spec: an empty collection produces an abstention, not a fabrication
(§9:447 *"The system must be able to abstain when evidence is inadequate"*).

---

# 2. P1 — SERIOUS PRODUCTION ISSUES

## P1-1 · `knowledgeCollection` breaks the repo's own index convention

**File:** `packages/data-schemas/src/schema/knowledgeCollection.ts:71-82`

**The trap — do NOT "fix" it by prefixing with `tenantId`.**
`tenant/policy.ts:98-100` injects `tenantId` **only** when a tenant scope is
active. In a default deployment there is no `tenantId` predicate, so
`{tenantId:1, userId:1, updatedAt:-1}` leaves `tenantId` unconstrained *ahead of*
the sort key and pushes the sort back into memory — **strictly worse**.
`message.ts:329-337` states the rule outright: *"tenantId is deliberately not in
the middle: untenanted deployments issue no tenantId predicate, and a gap in the
prefix would push the sort back into memory for them."*

**Why the current `index: true` on `tenantId` is wrong on four counts:** (1) no
sort key, so `.sort({updatedAt:-1})` forces an in-memory blocking sort; (2) zero
selectivity — one distinct value per tenant; (3) it contains **neither** `$or` term
(`userId`, `scope`), so the planner never picks it; (4) it becomes redundant the
moment a real compound lands.

**Approach:** (a) drop `index: true` from `tenantId`; (b) add `_id: 1` as a
tie-breaker to both sort-serving indexes, matching `skill.ts:229`'s
`{updatedAt:-1, _id:1}` — two collections written in the same millisecond can
otherwise swap between two list calls. Keep `{id:1}` unique.

**Regression risk:** LOW (new schema, untracked). MEDIUM at volume — `addIndex` on
an existing deployment is a foreground-blocking build. Needs a background index
option once real data exists.

**Tests:** `knowledgeCollection.spec.ts` already green 47/47 — extend with an
`explain('executionStats')` assertion: `IXSCAN` (not `COLLSCAN`) on **both** `$or`
branches, `nReturned` ≤ limit, and `SORT_KEY` consumed from the index. **This is
the Lighthouse-substitute:** `AGENTS.md:41` mandates `npm run lighthouse` and
links `e2e/lighthouse/README.md` — **neither exists**. Hand-verify the index plan
instead, per the vertical-slice template.

## P1-2 · `overrides` under-fix the advisories they target

**File:** `package.json:157,160,171`

**Finding:** npm reports `fixAvailable: true` while the repo's own overrides keep
the vulnerable versions installed.
`brace-expansion: "^2.1.2"` → resolves 2.1.4, advisory needs **≥2.1.7**.
`fast-uri: "^3.1.6"` → resolves 3.1.6, advisory needs **≥3.1.8**.

4 highs, all fixable with **no code change**: `brace-expansion` (3 advisories,
dev-only), `fast-uri` (2, runtime via ajv), `nodemailer` (quadratic backtracking
DoS **+ cross-tenant SMTP credential disclosure** via process-global DNS cache,
runtime), `undici` (**TLS certificate validation bypass** in BalancedPool +
WebSocket DoS, runtime).

**Approach:** bump the two override floors; `npm install` to refresh the lock.
Separately `npm update` the 10 security-relevant packages: `nodemailer`→10.0.13,
`multer`→2.4.0, `brace-expansion`→2.1.7, `@node-saml/passport-saml`→5.1.1,
`openid-client`→6.8.8.

**Regression risk:** LOW for overrides. MEDIUM for `nodemailer` 9→10 (a major) and
`openid-client` 6.5→6.8 — both on auth/email paths. Test the email templates and
every OIDC/SAML login flow explicitly.

**Tests:** `npm audit --level=high` → 0. Plus existing email + auth suites.

## P1-3 · Postgres creds hardcoded; `.env` cannot override

**Files:** `deploy-compose.yml:97-99` · `rag.yml:7-9,20-22,12-13`

`environment` **beats** `env_file` in compose, so these literals win over `.env`.
`rag.yml` additionally publishes `5433:5432` and `${RAG_PORT}` to the host — the
vector DB reachable from outside with known credentials. `vectordb` has no
`env_file` at all.

**Approach:** move all three to `${POSTGRES_DB:-baanzon}` / `${POSTGRES_USER:-…}` /
`${POSTGRES_PASSWORD:?set in .env}` (the `:?` form **fails loudly** rather than
defaulting to a known password). Delete the host port publishes.

**Regression risk:** LOW. MEDIUM: a deployment that relied on `mydatabase/myuser`
will need matching values in `.env`.

**Tests:** `docker compose config` with the vars unset → must error, not render
`mypassword`.

## P1-4 · MongoDB runs `--noauth`

**Files:** `deploy-compose.yml:80` · `docker-compose.yml:63` (inherited upstream)

**Approach:** generate credentials via `MONGODB_ROOT_USERNAME`/`_PASSWORD` +
`--auth`, and update `MONGO_URI` accordingly. Keep `--noauth` in
`docker-compose.yml` **only** if it is dev-only — it is (host-UID bind mounts,
`user: ${UID}:${GID}`, no nginx/TLS, `./.env` bind-mounted into the image at
`/app/.env`). So: fix `deploy-compose.yml`; annotate `docker-compose.yml` as
dev-only.

**Regression risk:** HIGH operationally — enabling auth with a fresh credential
against an existing volume orphans the data. Requires a documented migration
(`db.createUser` against the existing volume) before the switch.

**Tests:** boot with auth on; `MONGO_URI` without credentials must fail.

## P1-5 · No healthchecks, no readiness gating

**Files:** `Dockerfile` · `Dockerfile.multi` · all 3 compose files

`/health`, `/livez`, `/readyz` **do exist** (`api/server/index.js:308-310`) — the
endpoints are not the gap, the wiring is. Zero `healthcheck:` blocks, zero
`condition: service_healthy`. Result: api starts before Mongo accepts connections
→ crash-loop on first boot, no load-balancer gate.

**Approach:** add `healthcheck:` to every service using its real probe
(`/readyz` for api, `mongo` ping for mongodb, Meili `/health`); upgrade every
`depends_on` to `condition: service_healthy`.

**Regression risk:** LOW. Surfacing a boot race that has been silently retried.

## P1-6 · `Dockerfile.multi` runs as root, no `NODE_ENV`

**File:** `Dockerfile.multi` (no `USER` anywhere; `:131 CMD ["node","server/index.js"]`)

`Dockerfile:25` does it correctly (`USER node`). The two images ship with
different privilege levels. Also `uv` drift: `0.9.5` (`Dockerfile:14`) vs
`0.6.13` (`Dockerfile.multi:97`).

**Approach:** add `USER node` (create the user + `chown` the paths it writes:
`/app/data`, `/app/client/dist`); set `ENV NODE_ENV=production`; align the `uv`
pin. **Note:** `cross-env` is a **production** dep of the `client` workspace
(`client/package.json:67`), so `npm prune --production` in `Dockerfile:60` does
*not* remove it — an earlier audit claimed a boot failure here and was **wrong**.
`Dockerfile.multi` sidesteps `cross-env` entirely by calling `node` directly.

**Regression risk:** MEDIUM — running as non-root can surface file-permission
failures on the bind-mounted `./uploads`, `./images`, `./logs`, `./skill`.

**Tests:** `docker run` as the container user; `curl /readyz` from inside.

## P1-7 · JWT secrets auto-minted instead of refused in production

**File:** `packages/api/src/credentials.ts:276-370` (`:309-313` generate, `:345-359` warn-only)

**Good news:** `:46-57` is a SHA-256 blocklist of **retired upstream LibreChat
defaults** and `rejectLegacyJwtCredential` (`:61-69`) throws correctly.

**The problem:** the *unset* case is handled by **generating** secrets with
`crypto.randomBytes` and only `console.warn`-ing. Combined with
`deploy-compose.yml:24` / `docker-compose.yml:21` setting
`BAANZON_TEMP_CREDENTIALS_PATH=/app/data/.env.temp` on a **named volume**:
recreating that volume silently invalidates every session and refresh token — a
silent availability incident, not a refusal. Ten other call sites use
`process.env.JWT_SECRET!` non-asserting (`crypto/jwt.ts:17,25,42`,
`data-schemas/src/methods/user.ts:605`, `api/server/routes/actions.js:21`), so a
missing secret becomes a runtime throw instead of startup validation.

**Approach:** in `NODE_ENV=production`, refuse to boot when
`JWT_SECRET`/`JWT_REFRESH_SECRET`/`CREDS_KEY`/`CREDS_IV` are absent — unless an
explicit `BAANZON_ALLOW_EPHEMERAL_SECRETS=true` is set, which is what dev
containers should use. Keep generation for dev.

**Regression risk:** MEDIUM — a deployment relying on auto-generation will now
**fail fast** instead of starting. That is the intent, but it converts a silent
problem into a visible outage at upgrade time. Announce it.

**Tests:** assert production boot throws on a missing secret; assert dev boot
generates. Extend `credentials.spec.ts` (it already covers the blocklist).

## P1-8 · CSP off by default

**File:** `.env.example:117` (`# CSP_ENABLED=false`) · impl `packages/api/src/security/csp.ts:200` + `api/server/index.js:298-302`

**Corrected:** helmet's CSP is off because a **real nonce CSP exists** — not
because CSP was rejected. `createCspPolicy` returns `null` unless `CSP_ENABLED`.
**Opt-in and off by default** is the finding, not "no CSP."

**Approach:** flip to `true` in `.env.example`, verify every inline-script and
style nonce is issued, and confirm the client has no inline handler that breaks.
For a product rendering LLM output and user markdown this is the XSS
defense-in-depth layer.

**Regression risk:** MEDIUM — CSP breaks on the first undiscovered inline script.
Roll out behind the flag, with a report-only phase.

**Tests:** `csp.spec.ts` exists (`:226` covers `/readyz`) — extend with a
`script-src` violation assertion and a nonce-issued assertion.

## P1-9 · No rate limiting on the new RAG API

**Files:** `api/server/routes/knowledge.js` · `packages/api/src/rag/routes.ts`

A limiter library exists and is well used elsewhere (32 refs:
`loginLimiter`, `registerLimiter`, `messageLimiters`, `importLimiters`,
`forkLimiters`, `resetPasswordSubmissionLimiter`). Zero matches in
`knowledge.js` or `packages/api/src/rag`. `POST /:collectionId/documents` triggers
chunking + embedding on every call — an unthrottled cost/DoS lever.

**Approach:** add a limiter **in `api/`** (wiring, not behavior) using the
existing `limiters/index.js` factory, applied router-wide in
`api/server/routes/knowledge.js` alongside `requireJwtAuth`. Set the limit in
`configSchema` per the `AGENTS.md` rule, defaulting to today's (absent) behavior
— which is to say, set an explicit number now and document it.

**Regression risk:** LOW. A legitimate bulk-ingest could hit the ceiling — make
the limit generous and return `429` with `Retry-After`.

**Tests:** a spec that the 6th request in a window gets 429 and the limiter is
skipped when `rag.disabled`.

## P1-10 · Two divergent lockfiles; bun resolves different majors

**Files:** `package-lock.json` (1.69 MB) · `bun.lock` (1.13 MB) · 15 `b:*` scripts

Both are git-tracked. They **disagree**: `nodemailer` **10.0.1 vs ^9.0.1**,
`multer` 2.3.0 vs ^2.2.0, `moment` 2.30.1 vs ^2.29.1, `fast-uri` 3.1.6 vs ^3.0.1.
`packageManager` is `npm@11.13.0` and both Dockerfiles use `npm ci` and never
reference `bun.lock` — **npm is authoritative**. But the 15 `b:*` scripts make
bun a live path, and the audited security posture is **not reproducible** under
`bun install`. Both lockfiles also still carry root `"name": "LibreChat"`.

**Approach:** pick one. Recommended — **keep npm, delete the `b:*` scripts and
`bun.lock`**, and record it in ADR-002 (§84 says pnpm; we're deviating to npm —
being explicit about *which* non-pnpm tool is the point). If bun must be
supported, that is a real CI matrix and the audit must run twice.

**Regression risk:** MEDIUM — removing `b:*` breaks any workflow using them.
Low if unused (verify with a grep for `bun run` in CI/docs first).

**Tests:** `npm ci` from clean → `npm audit --level=high` → 0.

## P1-11 · Tenant isolation correct in code but off by default

**Files:** `packages/data-schemas/src/tenant/policy.ts:50,99-103` ·
`api/server/index.js:210-214`

`TENANT_ISOLATION_STRICT === 'true'` **defaults off** — with strict off,
`tenantId`-absent passes through as "transitional/pre-tenancy". And
`TRUST_TENANT_HEADER` accepts tenant identity **from an HTTP header**, emitting
only a `logger.warn`. The plugin itself is genuinely good: it injects
`tenantId` into every find/update/delete/aggregate (`plugins/tenantIsolation.ts:112-173`),
fail-closed on the write path, and `KnowledgeCollection` does apply it
(`models/knowledgeCollection.ts:12`).

**Approach:** default `TENANT_ISOLATION_STRICT` to `true` for new deployments,
keep an explicit opt-out; when `TRUST_TENANT_HEADER` is on, log at `error` and
restrict it to a documented internal-proxy set.

**Regression risk:** HIGH. Turning strict on breaks every single-tenant deployment
that has no `tenantId` on existing documents. Needs a backfill migration first.
`config/migrate-tenant-indexes.js` exists — a data migration does not.

**Tests:** `preAuthTenant.spec.ts` and the tenant plugin's own spec cover the
mechanics. Add: an untenanted query under strict mode.

## P1-12 · `semanticSearch` is dead; `hybridAlpha` is inert

**Files:** `packages/api/src/rag/semanticSearch.ts` (101 lines, 0 consumers) ·
`packages/api/src/rag/runtime.ts:35-45` · `service.ts:602,627,649-650` ·
`packages/data-provider/src/types/knowledge.ts:117`

`createSemanticSearchService` is re-exported by the barrel and called by nothing.
`RagRuntimeDeps.semantic` is optional and **never injected** in production
(`api/server/routes/knowledge.js:27` passes only `knowledgeMethods` +
`vectorStore`), so `service.ts:602,627` always treat the weight as 0 — hybrid
retrieve **silently runs keyword-only**, while the public API accepts and forwards
a per-request `hybridAlpha` that does nothing.

**Approach — this is "wire it up" item 2.** Two valid paths; **[OWNER DECISION]**:
- **(A) Wire it.** Add `semantic` to `RagRuntimeDeps`, inject at
  `knowledge.js:27`. Requires an embeddings provider — which is `RAG_API_URL` /
  the `rag_api` container, or the legacy `fileSearch.js` path. Then
  `runtimeCacheKey` grows a field automatically (`:155-164` is `Object.keys`-derived
  by design) and `config.drift.spec.ts` extends to cover the new default.
- **(B) Delete it** and drop `hybridAlpha` from the public type. Honest, smaller.

**Regression risk:** MEDIUM for (A) — it puts a network call on the retrieve path
inside a generation. Bound it: timeout + max chunks + never-throw (degrade to
keyword). LOW for (B) — a breaking API change on an unreleased feature.

**Tests:** `semanticSearch.spec.ts` **does not exist** — that is the first gap.
`EmbeddingsProvider`, `Reranker`, `cosineSimilarity`, `SemanticSearchDeps`,
`SemanticSearchService` are all untested and all exported.

## P1-13 · `reranker` and `apiUrl` are unreachable/dead levers

**Files:** `packages/api/src/rag/service.ts:50` (`reranker?: SnippetReranker`) ·
`packages/api/src/rag/runtime.ts:35-45,66,69,155-164` ·
`packages/data-schemas/src/app/rag.ts:34,42,46` · `.env.example:772`

- `reranker` is consumed at `service.ts:649-650` but **never added to
  `RagRuntimeDeps`** — added to the service after the injection seam was written.
- `apiUrl` is documented in `baanzon.example.yaml:1236-1254` and resolved, but
  **zero production reads** (`runtime.spec.ts:347` even asserts it is *ignored*).
  It still lands in `runtimeCacheKey`, so editing it rebuilds the entire
  store/service/handler graph for byte-identical behavior. Worse: `RAG_API_URL` is
  the **legacy** python `rag_api` env var, still live at
  `api/app/clients/tools/util/fileSearch.js:140`,
  `api/server/services/Files/VectorDB/crud.js:21,27,68,88`,
  `packages/api/src/app/checks.ts:265-271`, and set in
  `docker-compose.yml:23` — so the new config **silently inherits it**.

**Approach:** add `reranker?` to `RagRuntimeDeps` and inject; then either wire
`apiUrl` to a real consumer or **remove it from the resolved object** so it stops
polluting the cache key. Rename the legacy env var
(`RAG_API_URL` → `BAANZON_LEGACY_RAG_API_URL`) with a fallback, so the two
concerns stop aliasing.

**Regression risk:** LOW. Touching `runtimeCacheKey` invalidates cached runtimes —
harmless (they rebuild), but a test may assert cache-hit counts.

**Tests:** `runtime.spec.ts` — assert a changed `reranker` produces a new key and
an identical `apiUrl` does **not**.

---

# 3. P2 — IMPORTANT QUALITY ISSUES

| id | Issue | Files | Approach | Risk | Tests |
|---|---|---|---|---|---|
| **P2-1** | `knowledgeCollection.spec.ts` teardown leak | `packages/data-schemas/src/methods/knowledgeCollection.spec.ts:39-51` | `models/knowledgeCollection.ts:13-16` is **cache-first**, so the model outlives `mongoose.disconnect()` + `mongoServer.stop()` still bound to a dead connection → the `MongooseError … buffering timed out` seen in the `api` workspace. Adopt the house pattern verbatim from `api/server/routes/files/files.test.js:105,146-148`: capture `modelsToCleanup = Object.keys(models)` in `beforeAll`, `delete mongoose.models[name]` in `afterAll`. Also `conversation.spec.ts:40,54`, `accessPermissions.test.js:61,75-76`, `images.agents.test.js:74,90-92`. | LOW (suite is green 47/47 — latent) | Re-run the `api` suite; assert no suite registers a model it doesn't clean up |
| **P2-2** | `console.log` dumps full message payloads | `client/src/hooks/SSE/useSSE.ts:141` (`console.log('final', data)` — the **complete final message payload** on the SSE hot path), `:220,283,287,296`; `useResumeOnLoad.ts:796-1104` (12 calls); `useChatHelpers.ts:208,229,236,332`; `useRenderChangeLog.ts:38,49,62`; `useWakeLock.ts:61,92,124,150,155,178`; `AuthContext.tsx:237,251,303`; `api/cache/getLogStores.js:129-221`; `Runs/handle.js:207` | Delete `:141` outright. Convert the rest to the existing winston logger behind a dev-only guard. This is a **content-exposure** issue, not just noise. | LOW (debug affordance loss) | Assert no `console.log` in `client/src/hooks/**` via a lint rule or a grep gate |
| **P2-3** | Orphan file ships in the build | `packages/client/src/hooks/ThemeContext.old.tsx` (2,567 B, 0 refs) | Delete. Only `.old/.bak/.orig/.tmp` in any source root. | LOW | `npm run build:client-package`; assert the chunk is gone |
| **P2-4** | Dead exports / stale TODO / duplicate spec | `packages/api/src/rag/authorization.ts:23` (`canAccessCollection` exported, re-exported, never called — its siblings **are** used) · `packages/data-schemas/src/admin/capabilities.ts:194-198` (TODO says section capabilities are "not yet active" — **all three activation steps are done** at `capabilities.ts:205,211,271`, `admin/config.ts:452+`, `shared-links/session.ts:60`) · `packages/api/src/rag/ragService.spec.ts` (173-line stale duplicate of the 73KB `service.spec.ts`, with `as never` fixtures that `service.spec.ts` deliberately reaches differently) · `packages/api/src/rag/config.ts:46` (a second zero-arg `loadRagConfig` shadowing the real one at `data-schemas/src/app/rag.ts:33`) | Delete `ragService.spec.ts`. Delete the dead `loadRagConfig`/`isRagApiConfigured`/`usesRagApi` (consumers are the barrel + 2 specs only) or make them the single source. Fix the `capabilities.ts` comment. Wire or remove `canAccessCollection`. | LOW | `npx jest src/rag` must stay 215/215; `config.drift.spec.ts` guards the 3-way default duplication — re-verify after removing `RAG_DEFAULTS` copy 3 |
| **P2-5** | Dead branches in shipped clients | `api/app/clients/OllamaClient.js:136,154-159` — non-streaming `else` is **empty** (`// TODO: regular completion`, commented-out `this.client.generate`), returns `''`. `ollamaPayloadSchema` permits `stream:false`, so a caller gets a **silent empty completion** (inherited upstream). `api/app/clients/BaseClient.js:352-385` — `recordTokenUsage` is a silent no-op that logs the *wrong function name* from inside `getTokenCountForResponse`, which `@returns {number}` but returns `undefined`. | Either implement the Ollama non-stream path (`this.client.generate(payload)`) or **reject** `stream:false` in the schema so the failure is loud. Split the two BaseClient methods and correct the log label. | LOW (removing a broken capability is safer than leaving it) | Ollama client specs: a non-streaming request now either completes or **throws** — assert not-silent. `BaseClient`: assert `getTokenCountForResponse` returns a number for a well-formed response |
| **P2-6** | `as unknown as` in production code | `packages/data-schemas/src/methods/knowledgeCollection.ts:154` | Remove by typing the store double / narrowing properly. Test-only suppressions (`service.spec.ts:548,563`; `routes.spec.ts` ×10) are acceptable and documented. | LOW | `npx tsc --noEmit` in data-schemas |
| **P2-7** | 222 outdated deps (164 major behind) | `package.json` | Security-relevant only (P1-2). Defer the rest — 164 majors is a quarter of work with no launch value. | — | — |
| **P2-8** | No error tracking | — | Add Sentry (or equivalent) for API + client. Today every fault is log-only with no aggregation and no alerting hook — which is why the `api` workspace's 5-vs-33 failure instability went unnoticed. **[OWNER DECISION]** vendor + whether errors may leave the deployment. | LOW | Verify an intentional throw surfaces with a fingerprint |
| **P2-9** | 50 `LibreChat` lines in 28 non-English locales | `client/src/locales/{ca,de,es,fa,fi,fr,he,is,it,ja,ka,ko,lt,lv,nb,nl,nn,pl,pt-BR,pt-PT,ru,sv,th,tr,uk,vi,zh-Hans,zh-Hant}/translation.json` | 3 keys: `com_agents_mcp_trust_subtext`×28, `com_ui_api_keys_description`×13, `com_ui_tools_native_short`×9. Worst offenders (3 each): `de,he,is,it,lv,pl,pt-PT,zh-Hant`. `i18n.ts:290-295` falls through to `en`, so this is **cosmetic, not a defect** — fix for polish, not correctness. | LOW | `npm run static-checks:full` (runs `findUnusedI18nKeys`) |
| **P2-10** | 31 `librechat` lines in `baanzon.example.yaml` | `baanzon.example.yaml:145` (`customWelcome: 'Welcome to LibreChat!'`), `:152-194` (ToS/privacy **legal copy** + `contact@librechat.ai`), `:286` (the only `Librechat` variant, user-facing MCP warning), `:412` (`- 'librechat.ai'` allowlist), `:103,541,607,647,670` (comments) | `:286` and `:145` are user-facing → fix now. `:412` is a **security-relevant allowlist** → fix with P0-7. The ToS/privacy block is **legal text requiring your input** — do not auto-rewrite. | LOW (except `:412`) | grep gate: zero `librechat.ai` in the yaml |
| **P2-11** | Package metadata + lockfile names | 6 manifests' `repository`/`homepage`/`bugs` → `danny-avila/LibreChat` (P2 of P0-2) · `packages/data-schemas/package.json:96` keyword `"librechat"` · `package-lock.json:2,8` + `bun.lock:6` root `"name": "LibreChat"` · `api/app/clients/tools/manifest.json:24,29` ("Our Docs" → `danny-avila`) · `packages/api/src/app/checks.ts:28,33,102,136,382,428` (operator error text + docs links) | Repoint URLs; regenerate the lockfile root name. `checks.ts` strings are **operator-visible** — fix in P1 batch. | LOW | `npm pack --dry-run` metadata check |
| **P2-12** | Persisted internal identifiers (P3-candidate, listed here for review) | `client/src/utils/artifacts.ts:20-22,57-59,155-157,298-300` — MIME types `application/vnd.librechat.docx-preview` etc. **cross the wire and can be stored in message records** · `packages/data-provider/src/request.ts:70` + `components/Chat/Subagents/state.ts:309` — localStorage keys (safe to rename, users just re-auth) · `packages/api/src/credentials.ts:43` + `tools/rolePermissions.ts:248` — `Symbol.for(...)` in the **global** registry (renaming orphans any live process's grants) | **MIME types: do NOT rename** without a data migration + back-compat read. localStorage + Symbols: safe. Record the decision in ADR-002 rather than acting. | MEDIUM (MIME) | If renamed later: a read-path spec that accepts both old and new |

---

# 4. P3 — POLISH / OPTIMIZATION

| id | Issue | Approach | Risk |
|---|---|---|---|
| **P3-1** | **Four conflicting trackers.** `needtodo.md` (Batches 1–28), `buildscope.md` (Batches 1–13, header `PLANNED` for shipped work), `approval-batches.md` (B1–B5), `postgres-decision.md` ("B13 Platform" — a scheme in no other file). No single source of truth. | Collapse to **one** file (`ROADMAP.md`), map the other three into it, delete the two superseded. `approval-batches.md` marks **shipped** subsystems `missing` (B1.1 RAG, B1.2 semantic) and cites symbols that **never existed** (`ProjectsService`, `ArtifactsService`, `ActionService`, `tenant.ts`, `preAuthTenant.js`). | LOW |
| **P3-2** | **`AGENTS.md`/`CLAUDE.md` instruct branching off `dev` — no `dev` branch exists** (only `b1`, `main`). 6 references to a non-existent `.github/`, including `pr-retarget-dev.yml` — so the documented auto-retarget of `main` PRs **never happens**. `AGENTS.md:41` mandates `npm run lighthouse` + `e2e/lighthouse/README.md` — **neither exists** (`lighthouse@13.4.1` is installed, unwired; no `e2e/` dir, yet `.gitignore:193-195` still carries its paths). `buildscope.md:245-250` specifies `helm/librechat/*` and makes "helm lint passes" a criterion — **no `helm/`**. | Fix the branch policy to `b1` (or create `dev`). Delete the `.github/`/lighthouse/helm references or create the artifacts. **This is the highest-value P3 item** — these instructions actively mislead every agent session. | LOW |
| **P3-3** | `Masterblueprint(1).md` has a **duplicate §63** (`:2090` LOCKED VISUAL MASTER governs Home; `:2238` LIGHT THEME/PEARL is theme tokens only). 118 headers, 117 distinct numbers. `approval-batches.md:3` says "116 sections" — matches neither. Every later "§63" reference is ambiguous. | Renumber `:2238` onward, or mark the duplicate as §63b. Add per-section status markers so the blueprint is checkable against code (§0:17 makes it the source of truth; it currently cannot be verified against anything). | LOW |
| **P3-4** | Stale doc claims | `tool-intent-spec.md` describes a **shipped** feature as "a proposal ready for implementation", names `danny-avila/*` repos, pins `@librechat/agents` 3.3.x (installed **3.8.5**), and a file that doesn't exist (`SidePanel/Agents/Intent.tsx`). `CONTEXT.md` — **12 of 30 glossary types don't exist in the codebase**; mixes 3 subjects under one namespace. `README.md` — links a nonexistent `README.zh.md` + Discord/YouTube/sponsors/Railway/Zeabur/Sealos. `client/src/locales/README.md` — documents `uk-UA` (dir is `uk`), Locize, no `locize.config.js`. `config/translations/README.md` + `scan.ts:22` share one dead path (one fix won't help). `postgres-decision.md` — stale counts (58 schemas not 57, 48 method files not 94, 3 transaction sites not 2), pgvector image missing its tag. `FOLLOWUPS.md` describes closed gaps. | Use `packages/api/src/agents/triggers/README.md` as the template — it is the **only** doc where every numeric claim verified first try (750 ms, 8 events, 512 KiB, 90 days all exact). | LOW |
| **P3-5** | `npm run lint` takes **>22 min** and was killed at 15 min with **zero diagnostics emitted** | Scope it: split the 60 `Files/**` i18next errors into a workspace-specific override, and add `client/src/components/Files/**` to a slower lane. A gate that cannot complete in CI is not a gate. | LOW |
| **P3-6** | `Dockerfile` is **single-stage** — `python3`, `py3-pip`, `uv`, and the npm cache all ship in the runtime image | Convert to multi-stage, or adopt `Dockerfile.multi` as the only deploy path and retire `Dockerfile`. | LOW |
| **P3-7** | No resource limits / `read_only` / `cap_drop` / log-size limits on any compose service | Add `deploy.resources.limits` + `logging.options.max-size`/`max-file` to every service. | LOW |
| **P3-8** | Sidebar emits only **3** nav ids | `useUnifiedSidebarLinks.ts:106,125,155` → `conversations`, `knowledge`, `insights`. §63.3/§71 require Home/Chats/Projects/Library/Explore, and §63.3 adds: *"Secondary and advanced capabilities must appear contextually"* + §71: *"Agents, automations, technical tools and advanced configuration are not persistent primary navigation items."* | Undocumented in any tracker. Part of the Home/nav build (W7). | MEDIUM (visual lock — needs the §63 acceptance test) |
| **P3-9** | `AGENTS.md` review workflow prescribes `.github/workflows/{backend,frontend}-review.yml` — absent | Create alongside P0-4 or delete the instruction. | LOW |

---

# 5. BUILD PLAN — EVERYTHING IN THE BLUEPRINT

**Status: 35% complete.** 10 areas have **zero** code. Full spec extracted
(§3.1/§3.2, §9, §22, §24, §27, §28, §34, §36, §37, §45, §51, §52, §56, §60, §61,
§84, §86, §90, §109, §110, §111, §112). Blocked on **GATE A** (ADR-002) and
**GATE D** (DB + sandbox rulings).

## The blueprint's own ordering (§110, verbatim, 10 phases / 73 items)

Phase 0 Foundation · 1 Core Chat · 2 Intelligence · 3 Knowledge · 4 Work ·
5 Creation · 6 Realtime · 7 Action · 8 Platform · 9 Clients.
§111 MVP priority: **P0** 17 items · **P1** 8 · **P2** 5.
§112 **WHAT NOT TO BUILD** (12 items) — the binding constraint on every UI decision.

## Derived dependency order (this is inference, not spec — §110 states no
## dependencies; these are forced by the section cross-references)

```
W0  Foundations       ← P0 remediation + ADR-002 + migration ledger
W1  Schema gaps       ← sources, citations, artifact_versions, workflows,
                         workflow_runs, notifications, subscriptions,
                         usage_records  (28 of §45's 41 entities absent)
W2  Universal Mode    ← §3.1/§3.2 + §4.1 + §99. CROSS-CUTTING ROUTER.
W3  Trust Engine      ← P0 in §111. Needs W1 + §12 + §21
W4  Tool registry     ← Browser, Connector, Custom API, Database, Code
                         execution, Calculator (§35). Needs W2
W5  Approval + perms  ← §38/§39. Unblocks W7, W8
W6  Managed sandbox   ← §41. SECURITY clause, not a §84 preference
W7  Projects + Canvas ← §25 + §27. Needs W3, W6
W8  Research          ← §22. Needs W3, workers, §44 checkpoints
W9  Data Lab          ← §28. Needs W6, W4
W10 Workflows         ← §33/§34. Needs W4, W5. Builder explicitly DEFERRED
W11 Connectors        ← §36/§37. Needs W4, W5, token vault
W12 Notifications     ← §51/§52. Needs §6 lifecycle + §48 realtime
W13 Billing           ← §56/§97. Needs W12 + metering
W14 Eval framework    ← §60/§61. Needs W3 metrics. GATE from here on
W15 Feature flags     ← §92. Retro-fit W2..W14 behind it
```

**Load-bearing insight:** **W2 (Universal Mode) is the cross-cutting router.** §63.6
is a core interaction pattern — *"INTENT → CONVERSATION → UNDERSTANDING →
WORKSPACE EMERGES WHEN NEEDED"*, and §3.1 says *"Users do not need to manually
select agents."* W7/W8/W9/W10/W11 are the **workspaces W2 escalates into**. Build
W2 before them or every one of them ships a hand-rolled entry point.

**Load-bearing insight 2:** **§109 Definition of Done has 18 gates**, and gate 18
is *"AI evaluation added for AI behavior"*. So **W14 (eval) is not optional** — it
is a DoD gate on every AI feature from Phase 2 onward. Building it after W3–W9
means back-filling evals for everything shipped first.

**Load-bearing insight 3:** §41 is a **security** clause, not a §84 preference.
The control plane is met (`packages/api/src/code/lifecycle.ts` — approval policy
`allow`/`ask`/`deny`, revocation tokens, `deletionLeaseId`/`deletionCommittedAt`);
the isolation is not (`managed` doesn't exist; `nsjail` is a *named target adapter*,
zero hits). W9 (Data Lab) is **blocked** on W6.

## Per-workstream detail

| WS | Scope | Size | Key requirements to honor |
|---|---|---|---|
| **W0** | P0-1..P0-8, ADR-002, migration ledger (§45:1659 *"All schema changes use migrations. Never silently alter production schema."* — **currently violated**: `migrations/` has no versioned ledger) | ~3d | — |
| **W1** | 8 new schemas. Copy the `knowledgeCollection` slice exactly. **Fix P1-1's index pattern from day one** — do not repeat the lonely-`tenantId` mistake. `sources`/`citations` are prerequisites for W3. | ~4d | §45:1659 migrations |
| **W2** | 9 modes (§3.1), 6 execution strategies (§4.1), 10 composer states (§63.4), 5 adaptive triggers (§3.2), 5 contextual-power triggers (§63.5), 9 format mappings (§99), intent→workspace escalation (§63.6) | ~XL | §2.22–27: intent-first, not control-first · §3.2 *"Do not expose every possible control simultaneously"* · §63.5 *"The user should never need to understand Baanzon's internal agent architecture"* |
| **W3** | 8-stage pipeline, 6 internal classifications, **abstain path**, 5 transparency surfaces, 5 `TrustIndicator` states, 4 eval metric hooks | ~L | §9:447 *"must be able to abstain when evidence is inadequate"* · §9:449 + §106:3197 *"Do not expose private chain-of-thought"* · §2.6 *"Never claim zero hallucinations"* · §2.7 *"Never fabricate sources, files, tool results, or completed work"* · §75:2481 *"Trust information should be accessible without overwhelming the normal answer"* |
| **W4** | 6 registry entries. Each needs: ID, Name, Description, Input schema, Output schema, Permissions, **Risk level**, **Timeout**, Version (§35) | ~M | §35 field list is a hard contract |
| **W5** | 8-level permission hierarchy, 3 risk tiers | ~M | §38 *"Least privilege is mandatory"* · §39 High-risk list: external comms, delete data, financial, publish, account/security |
| **W6** | 9 sandbox controls: CPU, memory, runtime, storage, network, process, container isolation, cancellation, cleanup | ~XL | §41 *"Never execute arbitrary model-generated code directly on the application/API host"* · §28 *"Use a sandbox for code execution"* · **every limit is a `configSchema` lever — the blueprint states NO numbers, so invent none** |
| **W7** | 7 canvas modes + 10 capabilities | ~XL | §19 versions (*"Do not destructively overwrite user work by default"*) · §103 undo/redo (*"Never destroy user work unnecessarily"*) · §48 realtime reconcile-after-reconnect · §54 8 share options · needs **Tiptap + Monaco** (both absent) |
| **W8** | 9 pipeline stages + 13 support items | ~XL | §44 *"Checkpointed, Resumable, Cancellable, Observable, Idempotent, Recoverable"* · *"Closing the app must not necessarily terminate valid background work"* · **VERIFY is W3's pipeline** |
| **W9** | 5 formats + 14 capabilities | ~XL | §15:694 *"must not claim completion if the artifact has not passed appropriate validation"* · §17 XLSX validation: workbook integrity, sheets, formulas, references, charts, named ranges · needs **ECharts** (absent) · **blocked on W6** |
| **W10** | Engine only | ~L | §34:1316 is the cut-line: *"the underlying workflow engine must exist independently"* of the builder. §33's 8-field block is the AC. §43 *"Stop/cancel must propagate through the entire execution chain"* · §18 *"Never enter infinite repair loops"* |
| **W11** | 18 targets, 10 architecture requirements | ~XL | §36:1379 ten-item *"must support"* list · §37:1408 *"External side effects require permission and, where configured, user approval"* · §96 *"Connector unavailable → continue with available context"* · **needs an OAuth token vault — §45 names no table for it (spec gap)** |
| **W12** | 4 channels × 8 events, 3 activity buckets | ~L | §52:1813 *"Only display truthful execution status"* · §74:2467 *"Do not fake reasoning activity"* · §63.9 *"Motion must be subtle and truthful"* · §49 offline preservation + reconnect reconcile |
| **W13** | 6 layers, 8 metered dimensions | ~L | §56:1910 *"Do not hard-code plan limits across application modules"* — the testable AC is that **no module contains a literal plan cap**. §97 *"Never allow accidental runaway agent execution"* |
| **W14** | 4 families, 17 dimensions, 8-stage loop | ~XL | §60:2021 *"Every model, agent, prompt, or orchestration change must run regression evaluations"* · §6 *"every agent must have an Evaluator"* — a first-class agent field · **the blueprint states NO thresholds, sample sizes, or pass/fail bars — all are product decisions** |
| **W15** | user/org/cohort/canary/kill-switch | ~M | §92:2929 *"Major features must be remotely controllable"* · retro-fit so W2–W14 ship dark |

**§86 layout gap:** the blueprint specifies `services/*` (11), `workers/*` (6),
`apps/*` (4), `infrastructure/*` (4) — **none exist**. The repo is flat
`api/ client/ packages/*`. §85 says *"Modular monolith + workers … Do not begin
with dozens of microservices"* — **the repo is already §85-compliant**; §86's
tree is aspirational. **Decision: do not restructure.** Create new domains as
`packages/api/src/<domain>/` per the RAG pattern, and record the §86 deviation in
ADR-002. Restructuring 5,532 commits of history to match an ASCII diagram is
pure risk for zero product gain.

**§47 gap:** *"Heavy tasks run outside the interactive API process"* is
**violated** — 19 in-process `setInterval` sites in `packages/api/src`. Only
`rag_api` is genuinely out-of-process. Redis is fully wired (`RedisJobStore`,
`LeaderElection`, 6 Lua CAS scripts, a working claim-token engine in
`schedules/`) but **nothing is enqueued and consumed** — no BullMQ, no
producer/consumer pair. A real queue layer is a Phase 0/3 investment; documenting
the existing claim-token engine as the automation worker closes most of §47's
intent at near-zero cost.

---

# 6. IMPLEMENTATION SEQUENCE

**Rules for the whole run:** one concern per PR · `npm run build:packages`
before any typecheck (everything downstream resolves through `dist/`) ·
`npx tsc --noEmit` per touched workspace, never `npm run build:*` as a substitute ·
scoped `npm run sort-imports -- <paths>` · `npm run static-checks:full` before
done · §109's 18 gates before calling anything complete.

### Stage 0 — Unblock everything (½ day)
1. **ADR-002** — the four §84 deviations + `workers/`/sandbox deferrals, cross-ref
   ADR-001. *No code.*
2. **GATE-D rulings** from you: (a) Mongo-vs-Postgres for the 28 new entities,
   (b) Data Lab sandbox: build `managed`, or ship `attached` with a documented
   operator-trusted ceiling and defer `managed`. *W2–W15 ordering depends on (a).*
3. **Commit the current WIP.** 58 changed files — the entire RAG/Knowledge feature
   — is uncommitted. Nothing else is safe to build on until it has a commit.

### Stage 1 — P0, launch blockers (2 days)
4. **P0-1** deploy-compose builds this fork · **P0-8a** commit `baanzon.example.yaml` → `baanzon.yaml` into the runbook
5. **P0-2** license (needs your MIT/ISC call)
6. **P0-3** static-checks stops silently passing
7. **P0-5** the failing tests: 12-identifier rename table, the 2 RAG specs (**tests, not code**), the wording drift, the **missed** `startup.ts` rename
8. **P0-6** prettier + sort-imports scoped to the batch
9. **P0-4** `.github/` — 4 workflows. *Expect new gate failures; iterate.*
10. **P0-7** the 9 fallbacks + `.env.example` (**needs your URL decision** for `HELP_AND_FAQ_URL`)

> **Gate:** `npm run build:packages && npm run build:client` ✅ ·
> `npx tsc --noEmit` ×5 ✅ · `npm run test:all` **0 failures** ·
> `npm run lint` 0 · `npm run static-checks:full` 0 · CI green ·
> `docker compose -f deploy-compose.yml up` reaches `/readyz` and
> `GET /api/config` returns `"Baanzon Chat"`.

### Stage 2 — P1, serious production (3 days)
11. **P1-1** knowledgeCollection index (drop the lonely `tenantId`, add `_id` tie-breakers)
12. **P1-2** override floors + the 10 security-relevant `npm update`s
13. **P1-3/4/5/6** compose + Dockerfile hardening
14. **P1-7** JWT refusal in production · **P1-8** CSP on
15. **P1-9** RAG rate limiting
16. **P1-12 / P1-13** **wire it up**: `semanticSearch` + `reranker` into `RagRuntimeDeps` (or delete them — your call), and resolve `apiUrl`
17. **P0-8b** the agent/chat knowledge consumer, then flip `disabled: false`
18. **P1-10** one lockfile · **P1-11** tenant strict-mode (**needs a backfill migration first** — do it last in this stage)

> **Gate:** `npm audit --level=high` → 0 · index `explain()` shows `IXSCAN` on both
> `$or` branches · `knowledgeCollection.spec.ts` 47/47 · a grounded agent turn
> demonstrably cites retrieved chunks · production boot **refuses** a missing JWT secret.

### Stage 3 — P2, quality (2 days)
19. **P2-1** teardown leak · **P2-3** orphan file · **P2-4** dead exports/duplicate spec
20. **P2-5** Ollama non-streaming (implement or reject — never silent) · `BaseClient` no-ops
21. **P2-2** the `console.log('final', data)` payload dump + the rest
22. **P2-9/10/11** locales, `baanzon.example.yaml`, package metadata
23. **P2-8** error tracking (your vendor decision)

### Stage 4 — P3, polish (2 days)
24. **P3-2 first** — fix `AGENTS.md`/`CLAUDE.md`. *Every later agent session reads these; a wrong branch instruction costs more than any bug on this list.*
25. **P3-1** collapse 4 trackers → 1 · **P3-3** renumber blueprint §63 + add status markers
26. **P3-4** doc corrections (use `triggers/README.md` as the template) · **P3-5/6/7** lint scoping, Dockerfile stages, compose limits
27. **P3-8** sidebar nav to the §63.3 set (needs the §63.12 visual acceptance test)

### Stage 5 — Build (post-GATE-D)
28. **W1** 8 schemas + migration ledger → **W2** Universal Mode (the router)
29. **W15** feature flags (so everything after ships dark) → **W3** Trust Engine
30. **W4** tools → **W5** permissions/approval → **W6** sandbox → **W12** notifications
31. **W7** Projects+Canvas → **W8** Research → **W9** Data Lab
32. **W10** Workflows → **W11** Connectors → **W13** Billing → **W14** evals
33. Phase 9 clients (Expo, Tauri 2) — **both absent, full scaffolds, needs infra**

---

## 7. OPEN DECISIONS — I need these answers

| # | Decision | Blocks | Why it's yours |
|---|---|---|---|
| 1 | **MIT or ISC?** | P0-2 | Legal, not engineering. The tree is MIT with an upstream copyright line. |
| 2 | **`HELP_AND_FAQ_URL` target** — real docs URL, or `''` to hide the link? | P0-7 | §0:19 forbids inventing a URL. |
| 3 | **`semanticSearch`: wire it or delete it?** | P1-12 | (A) = real hybrid search but a network call in the generation path. (B) = honest, smaller, breaking on an unreleased type. |
| 4 | **Mongo or Postgres for the 28 new §45 entities?** | **W1, and therefore the whole build** | 4 blueprint sections say Postgres; `postgres-decision.md` recommends FerretDB substitution; the ADR is unsigned and its evidence predates 19 models. |
| 5 | **Data Lab sandbox: build `managed`, or ship `attached` + defer?** | **W6 → W9** | §41 is a security clause. This is a multi-week build. |
| 6 | **Delete the 15 `b:*` bun scripts + `bun.lock`?** | P1-10 | Removes a toolchain path. |
| 7 | **RAG ships dark by default — keep or flip?** | P0-8 | A shipped, documented, tested feature no user sees. Deliberate-looking, but it's a choice. |
| 8 | **Error-tracking vendor, and may errors leave the deployment?** | P2-8 | Data-handling decision. |

---

## 8. POST-FIX READINESS PROJECTION

| Area | Now | After Stage 1 | After Stage 2 | After Stage 4 |
|---|---|---|---|---|
| Build / typecheck | 100% | 100% | 100% | 100% |
| Tests | 62% | 100% | 100% | 100% |
| Lint / imports | 45% | 100% | 100% | 100% |
| CI/CD | 0% | 90% | 95% | 95% |
| Docker & deployment | 20% | 85% | 95% | 95% |
| Security | 60% | 70% | 88% | 90% |
| Config & secrets | 60% | 88% | 92% | 92% |
| Observability | 45% | 55% | 70% | 75% |
| Rebrand | 55% | 92% | 97% | 99% |
| Documentation | 30% | 35% | 40% | 92% |
| Blueprint coverage | 35% | 35% | 38% | 40% |
| **Production ready** | **~52%** | **~76%** | **~86%** | **~91%** |
| **Launch ready** | **~45%** | **~72%** | **~83%** | **~89%** |

**After Stage 4 the product is launch-ready.** Blueprint coverage is the
outlier at 40% — that is the 10 unbuilt areas, and it is *by design* that it
doesn't block launch: §111 puts only **Trust, Deep Research, Canvas, Data Lab,
Connectors** in P0/P1, and Workflows/Billing/Notifications/Evals in later phases.
**But** §109 gate 18 (*"AI evaluation added for AI behavior"*) means W14 is a DoD
gate on the AI features, so the true path to blueprint-complete is Stages 5–6,
not Stage 4.
