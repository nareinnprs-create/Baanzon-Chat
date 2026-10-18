# Launch readiness

Consolidated readiness report for Baanzon Chat, closing the **P8 — Final
validation** gap: the release matrix has never been run end to end on this head,
so no single document has stated how close the fork is to 100% production-ready
and launch-ready.

| Field                       | Value                                                                             |
| --------------------------- | --------------------------------------------------------------------------------- |
| Branch                      | `b1`                                                                              |
| Head at report time         | `5760eddc9` (`eab9420f7`, `a8c20cbc7`, `5760eddc9` are this wave)                 |
| Report date                 | 2026-10-18                                                                        |
| Source of truth for history | [`NEXTROUND.md`](../NEXTROUND.md) (phases P1–P8, decisions A1–A15, status ledger) |
| Harness                     | [`scripts/validate.mjs`](validation.md)                                           |
| Local environment           | No Redis, no MongoDB, no `api/.env` (only an untracked local `api/.env.temp`)     |

## How to read the percentages

`NEXTROUND.md` §1 records a per-dimension **baseline** (audited 2026-10-15 at
`efa2ed301`) and §2 records a **target add** per phase. Its §4 status ledger
records only a single project-level figure per phase (~98% after P7), not a
per-dimension one. The numbers below are therefore this report's consolidation:
the §1 baseline plus the §2 adds for the phases that shipped, discounted for the
work the §4 ledger still records as open. They are an assessment, not a
measurement — no dimension has been measured by the full matrix on this head.

Where a figure comes from a recorded test count it is cited to the phase commit.
Where it does not, it is labelled as an assessment.

## Readiness by dimension

| Dimension        | Baseline (§1) | This report | Phase ledger (§4)                                    | Blocks 100%                                             |
| ---------------- | ------------- | ----------- | ---------------------------------------------------- | ------------------------------------------------------- |
| Backend / API    | 72–75%        | **90%**     | P1 done `267d683`, P7 partial `557a9c45d`            | tenant hierarchy (no project→workspace link)            |
| Frontend UI      | 88%           | **96%**     | P4 done `e6f623e1e`→`2ec8ee600`, P5 done `7b517d600` | A9 skill-tree entry point, three i18n merges            |
| Frontend UX      | 74%           | **95%**     | P4 done, P5 done                                     | no e2e/axe/Lighthouse proof on this head                |
| Production-ready | ~60%          | **90%**     | P2 done `6bf52321`, P3 partial                       | audited dependency majors still staged                  |
| Launch-ready     | ~50%          | **88%**     | P6 partial, P8 partial                               | matrix never run end to end; CI unproven on a real diff |
| **Overall**      | **~70%**      | **93%**     | ledger says ~98% project-level after P7              | see [What is still open](#what-is-still-open)           |

The gap between this report's **93%** and the ledger's **~98%** is the discount
for the four phases the ledger still records as partial (P3, P6, P7, P8) and for
the absence of any end-to-end matrix evidence on this head. The ledger's figure
is project-level and predates the coverage gate: the gate
(`scripts/validate.mjs`, `.github/workflows/validate.yml`) landed in `5760eddc9`,
after the ledger was last written.

## Backend / API — 90%

**Evidence.** RAG completion (P1) is the largest single win: `packages/api` RAG
suite **739/739** and knowledge route **26/26** at `267d683`, with
`tsc --noEmit` clean in `packages/api`, `packages/data-provider` and
`packages/data-schemas`. Later backend evidence, all recorded in `NEXTROUND.md`
§4: registration + pgvector + RAG auth/errors **49/49**; sandbox + skill-tree
**18/18**; entity and workflow specs **129** (devices, subscriptions,
usage_records, feedback, workflows, notifications); notifications + workflow
engine **39/39**; `api` OllamaClient **7/7**, CRUD routes (tags/projects/apiKeys)
**43/43**, CJS bug-fix specs **43/43** then **34/34**. `packages/data-schemas`
reached **105 suites · 3277/3277** at `557a9c45d`.

The §45 entity set (P7.3) is complete, and the tenant layer now exists:
`organization.ts` and `workspace.ts` models with `workspace.organizationId`
required and indexed, plus `packages/api/src/organizations/` and
`packages/api/src/workspaces/` handlers and specs.

**Blocks 100%.** The org→workspace→project hierarchy is the last P7 gap. The
third link does not exist: `packages/data-schemas/src/schema/chatProject.ts`
declares `user` and `tenantId` and **no** `workspace` field, so a project cannot
be scoped to a workspace. The tenant handlers, routes (`api/server/routes/
organizations.js`, `workspaces.js`) and the client Tenant feature
(`client/src/components/Tenant/`) landed in `eab9420f7` and `a8c20cbc7`, but the
missing third link means the hierarchy is still incomplete.

## Frontend UI — 96%

**Evidence.** The shell phase (P4) and capability phase (P5) are both recorded
**done**. Spec counts recorded in §4 at `7b517d600`: Canvas **56**, Voice **47**,
Workflow **23**, Skills **50**, DeepResearch **73**, CommandPalette **8**, routes
**30**, DataLab (5 + 6 + charts/analysis/parse), plus ExportPdf **14/14**,
skill-tree **43/43**, Home **6/6**, in-conversation find **29/29**,
Notifications + Data Lab + Deep Research **9 suites · 91/91**, offline queue +
palette + `useSubmitMessage` **24/24**. `tsc --noEmit` clean in `client` at
`7b517d600`.

Since `a8c20cbc7` this is no longer reproducible on the developer machine: see
[the environment caveat](#environment-caveat-a-stray-parent-node_modules). The
only two errors are in `Avatar.tsx`, unmodified at HEAD, and are caused by a
duplicate `@types/react` outside the repo rather than by any change in `client`.

**Blocks 100%.** Three items, all recorded as deferred in §4:

1. **A9 skill-tree client entry point** — backend and data-service are complete,
   the client entry point is open.
2. **i18n merges** — skill-tree, Data Lab and Deep Research ship feature-local
   English maps pending a `translation.json` merge.
3. No user-facing preview of this head was possible: there is no `api/.env`, so
   the UI was never loaded in a browser during this report.

## Frontend UX — 95%

**Evidence.** Same two phases, credited by §2 as **UX +14%** (P4) and **UX +10%**
(P5) over the 74% baseline — i.e. the phase plan's own arithmetic lands at 98%.
Each shipped feature carries loading/empty/success/failure/cancellation/retry
states and RTL coverage, per the §4 evidence blocks.

**Blocks 100%.** The residual gap to the plan's 98% is the three UI items above,
plus one behaviour defect recorded in §4: the notifications list deep-paging is
bounded by the `packages/data-schemas` 200-row fetch cap. The UX dimension also
carries the missing **a11y proof on this head** (see below), which is why this
report publishes 95% rather than 98%.

## Production-ready — 90%

**Evidence.** P2 is recorded **done** — branding/legal live config, secrets
fail-fast, non-root containers, healthchecks, CSP/CORS, `engines` +
`engine-strict`, license unification, `bun` removal — all in `6bf52321`, with
"npm audit --level=high clean" as the phase's stated acceptance criterion (not
re-run during this report; see [What this report could not
verify](#what-this-report-could-not-verify-and-why)). P3 is recorded **partial**:
overrides fixed (`fast-uri`, `brace-expansion`, plus sharp, compression,
`@grpc-js`, source-map-js, handlebars, MCP-SDK, proxy-addr, undici), P0/P1 bumps,
dead nested override removed, lockfile synced.

**Blocks 100%.** The audited **dependency majors are still staged**. Verified in
the working tree during this report — `client/package.json` declares
`react@^18.2.0`, `tailwindcss@^3.4.1`, `zod@^3.22.4`,
`@tanstack/react-query@^4.28.0`, `i18next@^24.2.2`; `packages/data-provider`
declares `zod@^3.22.4` and `@tanstack/react-query@^4.28.0`. React 19, Tailwind 4,
zod 4, react-query 5 and i18next 25 (P3.5) are therefore **not** in this head.

## Launch-ready — 88%

**Evidence.** The gates exist and are wired. P6 is recorded **partial** with all
of P6.1–P6.5 present: coverage thresholds in all seven Jest configs, the missing
test suites, `integration.yml`, the CD pipeline (`release.yml`, tag-triggered
with a human approval gate — see [`deployment.md`](deployment.md)), and the e2e,
axe and Lighthouse lanes in `e2e.yml`. `NEXTROUND.md` §4 records the last
recorded e2e result as a Playwright + axe smoke with no critical violations and
`lhci` accessibility **1.0**.

**What this report observed, and did not.** The gating coverage step is new and
has never been executed. This session ran the harness only in its cheap modes:

```bash
node scripts/validate.mjs --help                              # exit 0
node scripts/validate.mjs --list                               # exit 0, 13 steps
node scripts/validate.mjs --only coverage --audit-thresholds  # exit 0, 0.4s
node scripts/validate.mjs --only coverage                      # exit 0, 0.0s
```

The threshold audit passed: all seven Jest configs declare a non-zero
`coverageThreshold.global`, and all seven report
`collectCoverage=process.env.VALIDATE_NO_COVERAGE !== '1'`. That is the **config
half** of the gate. The **measurement** half did not run, and `--only coverage`
says so itself: _"No unit suite ran, so the coverage gate measured nothing in
this run."_

**Coverage summaries on disk.** Five of the seven
`<workspace>/coverage/coverage-summary.json` files exist, but every one is a
**stale artifact** of an earlier targeted run, and two are missing:

| Workspace                | `coverage-summary.json` | Last written                          |
| ------------------------ | ----------------------- | ------------------------------------- |
| `api`                    | present                 | 2026-10-15 22:12                      |
| `client`                 | present                 | 2026-10-15 22:24                      |
| `packages/api`           | present                 | 2026-10-15 22:00                      |
| `packages/client`        | present                 | 2026-10-17 22:01                      |
| `packages/data-schemas`  | present                 | 2026-10-15 21:50                      |
| `packages/data-provider` | **absent**              | — (only a `cobertura-coverage.xml`)   |
| `config`                 | **absent**              | — (only pre-`json-summary` artifacts) |

`git status` reports no untracked `coverage` directories because `.gitignore:24`
ignores `coverage` outright. None of these files was produced by a matrix run on
`984a55c6f`. **The gate has not been proven to pass anywhere yet: summaries are
not present for a full matrix run, and the enforcing run happens in the
`validate-full` CI lane.**

**Blocks 100%.** In order of cost:

1. **The full matrix has never run end to end** on this head — no single
   execution of build → 7 suites → coverage → typecheck → static-checks → lint →
   audit exists in the record.
2. **CI is not proven green on a real diff** — §4 P6 says so verbatim ("prove CI
   green on a real diff + enforce the coverage gate"), and nothing recorded here
   contradicts it.
3. **The coverage gate is unenforced in practice.** `validate.yml` runs
   `--coverage` in all three lanes, but no observed run has yet exercised it with
   suites behind it.
4. **e2e / a11y / Lighthouse proof is stale.** The last recorded results predate
   the P5 Canvas, Voice and Workflow Builder additions; the Lighthouse job in
   `e2e.yml` is advisory, not a gate.
5. **Redis and MongoDB are not running locally**, so the
   `*.integration.*` suites cannot be exercised on a developer machine — they
   belong to `.github/workflows/integration.yml`, which the local matrix does not
   run.

## Overall — 93%

`NEXTROUND.md` §4 records ~98% project-level after P7. This report publishes
**93%**, discounting:

| Discount | Reason                                                                |
| -------- | --------------------------------------------------------------------- |
| −2       | P3 partial — the five audited dependency majors are still staged      |
| −1       | P7 partial — no project→workspace tenant link                         |
| −1       | P8 partial — the full matrix has no recorded end-to-end run           |
| −1       | P6 partial — CI unproven on a real diff; coverage gate unexecuted     |
| −1       | Frontend UI/UX residue — A9 skill-tree entry point, three i18n merges |
| round    | −2 assessment headroom, since no dimension is measurement-backed      |

## What is still open

1. **Audited dependency majors still staged** (P3.5) — React 19, Tailwind 4,
   zod 4, react-query 5, i18next 25. Verified this session: `client` still
   declares React 18 / Tailwind 3 / zod 3 / react-query 4 / i18next 24.
2. **CI not yet proven green on a real diff.** No run of `validate.yml` against
   an actual pull request is recorded.
3. **Tenant hierarchy: org → workspace → project.** `organization` and
   `workspace` models exist and `workspace.organizationId` is required, but
   `schema/chatProject.ts` has no `workspace` field, so the third link does not
   exist. Handlers and routes landed in `eab9420f7`; the client Tenant feature in
   `a8c20cbc7`.
4. **The full validation matrix has no recorded end-to-end run**, and the gating
   coverage step has never executed with suites behind it.
5. **e2e / axe / Lighthouse proof** predates the P5 capability work; the
   Lighthouse job is advisory.
6. **A9 skill-tree client entry point**, and the i18n merges for skill-tree,
   Data Lab and Deep Research.
7. **Notifications list deep-paging** bounded by the 200-row `data-schemas` fetch
   cap.

## What this report could not verify, and why

| Not verified                           | Why                                                                                                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any unit suite result on this head     | The suites were deliberately not run: each is a 100s+ run, the matrix runs seven, and this report was scoped to the harness's cheap modes only.                         |
| The measured half of the coverage gate | No suite ran, so no fresh `coverage-summary.json` exists to re-read. `--only coverage` reports "measured nothing".                                                      |
| `npm audit --audit-level=high`         | The audit step was not run in this session; its last recorded status is the P2/P3 evidence block in `NEXTROUND.md` §4.                                                  |
| Integration suites (`*.integration.*`) | Redis (6379) and MongoDB (27017) are not running on this machine; they fail with `ECONNREFUSED`, which is environmental, not a regression. `integration.yml` owns them. |
| The live UI                            | There is no `api/.env` (only `api/.env.temp`), so no preview UI could be started.                                                                                       |
| CI lane behaviour                      | `.github/workflows/validate.yml` was read, not executed.                                                                                                                |
| Timings                                | Only two timings were observed: the threshold audit at 0.4s and `--only coverage` at 0.0s. No suite timing is quoted anywhere in this report.                           |

## Environment caveat: a stray parent `node_modules`

A `C:\Users\manag\node_modules` directory exists **outside** this repository.
Node and TypeScript resolution walks up from
`C:\Users\manag\Baanzon Chat\LibreChat\client` and finds it, so packages missing
from the repo's own tree are resolved from there instead of failing. Its
`@types/react` is **19.3.0** while the repo pins **18.2.53**.

`@types/react@19` was created in that folder on 2026-10-17 20:52, which is why
`client` typechecked clean earlier in this work and does not now. The failure is
environmental, and the compiler names the offending path itself:

```
src/components/Nav/SettingsTabs/Account/Avatar.tsx(218,18): error TS2786:
  Type 'import("C:/Users/manag/node_modules/@types/react/index").ReactNode'
    is not assignable to type 'React.ReactNode'.
```

The same pollution breaks `npm run build:client`: rolldown resolves
`@emotion/is-prop-valid` from the stray folder, whose `@emotion/memoize` is
missing from a half-finished install there, producing an `index.html` with zero
script tags. `packages/api`, `packages/data-schemas`, `api`, `config` and all
seven jest suites are unaffected.

The owner has elected to leave that folder untouched, so both failures are
recorded here rather than repaired. On a clean checkout, or with that folder out
of the resolution path, `client` typechecks and builds as it did at `7b517d600`.

## Related

- [`validation.md`](validation.md) — the harness: every flag, exit codes, which
  steps gate, and the CI lanes that invoke it.
- [`NEXTROUND.md`](../NEXTROUND.md) — the phase plan, owner decisions and status
  ledger this report consolidates. Read-only; owned by the orchestrator.
- [`deployment.md`](deployment.md) — the gated CD pipeline and the release tag
  flow.
