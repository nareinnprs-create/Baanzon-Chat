# Release validation

`scripts/validate.mjs` is the single entry point for the release matrix described
in `NEXTROUND.md` under **P8 — Final validation**. It runs every gate a release
must clear, in dependency order, stops at the first gating failure, and prints a
pass/fail line for each step.

```bash
npm run validate          # node scripts/validate.mjs
```

The harness delegates to the existing root npm scripts — `build:packages`, the
seven `test:*` suites, `static-checks`, `lint`, `npm audit` — so a green run
means the same scripts CI runs and a developer runs by hand. It reimplements
nothing. The steps with no root script are invoked directly: TypeScript as
`tsc --noEmit` per workspace, and the coverage gate as a read-only re-check of
the reports the suites just wrote.

Three convenience wrappers exist for the common local cases:

| Script                     | Same as                                                          | Use                                                             |
| -------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| `npm run validate`         | `node scripts/validate.mjs`                                      | Full matrix, coverage enforced.                                 |
| `npm run validate:changed` | `node scripts/validate.mjs --changed`                            | Only the workspaces the diff touched.                           |
| `npm run validate:static`  | `node scripts/validate.mjs --only build,typecheck,static-checks` | Build + type + static gates, no suites. Add coverage separately |

## The matrix

Thirteen steps, in order. Every step but `audit` is **gating**.

| #   | Step id                       | Command                                                                            | Gating  | What it proves                                                                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------- | ---------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `build`                       | `npm run build:packages`                                                           | yes     | `tsdown` emits fresh `dist` in dependency order — `packages/data-provider` → `packages/data-schemas` → `packages/api` → `packages/client`. Every later step resolves workspace imports through these artifacts. A tsdown build **emits without checking types**, so it earns no type confidence of its own.                                          |
| 2   | `test:client`                 | `npm run test:client`                                                              | yes     | `client` Jest suite green; with coverage on, it writes `client/coverage/coverage-summary.json`.                                                                                                                                                                                                                                                      |
| 3   | `test:api`                    | `npm run test:api`                                                                 | yes     | `api` Jest suite green; with coverage on, it writes `api/coverage/coverage-summary.json`.                                                                                                                                                                                                                                                            |
| 4   | `test:packages:api`           | `npm run test:packages:api`                                                        | yes     | `packages/api` unit tier green. `*.integration.*` specs are excluded here and run in `integration.yml` (see [Environment limitations](#environment-limitations)).                                                                                                                                                                                    |
| 5   | `test:packages:client`        | `npm run test:packages:client`                                                     | yes     | `packages/client` suite green.                                                                                                                                                                                                                                                                                                                       |
| 6   | `test:packages:data-provider` | `npm run test:packages:data-provider`                                              | yes     | `packages/data-provider` suite green.                                                                                                                                                                                                                                                                                                                |
| 7   | `test:packages:data-schemas`  | `npm run test:packages:data-schemas`                                               | yes     | `packages/data-schemas` suite green against `mongodb-memory-server`.                                                                                                                                                                                                                                                                                 |
| 8   | `test:config`                 | `npm run test:config`                                                              | yes     | `config/` maintenance-script suite green.                                                                                                                                                                                                                                                                                                            |
| 9   | `coverage`                    | direct, read-only                                                                  | **yes** | Re-reads each suite's `coverage/coverage-summary.json` against the `coverageThreshold.global` in **that workspace's own Jest config**. Fails the run on a missing summary, a missing or `NaN` metric, a metric under its floor, a config with no threshold, or a threshold that is `0` on every metric. See [The coverage gate](#the-coverage-gate). |
| 10  | `typecheck`                   | `tsc --noEmit -p <project>` per changed workspace                                  | yes     | Each TypeScript project compiles. Six projects: `packages/data-provider`, `packages/data-schemas`, `packages/api`, `packages/client` (plus `tsconfig.test.json`, the only project that sees its `*.spec.ts(x)`/`*.test.ts(x)` files), and `client`.                                                                                                  |
| 11  | `static-checks`               | `npm run static-checks -- --full --skip typecheck,config-tests [--against <base>]` | yes     | ESLint, Prettier and import order on the changed files; tree-wide circular-dependency detection, unused i18n keys, unused npm packages (depcheck) and `package.json` validity. `typecheck` is skipped because step 10 is the same work, and `config-tests` because step 8 runs the identical `jest --config config/jest.config.js` invocation.       |
| 12  | `lint`                        | `npm run lint`                                                                     | yes     | `eslint .` over the whole tree, not just the diff.                                                                                                                                                                                                                                                                                                   |
| 13  | `audit`                       | `npm audit --audit-level=high`                                                     | **no**  | No high- or critical-severity advisories. **Non-gating** — reported, but it does not stop the run or fail the exit code unless `--strict`.                                                                                                                                                                                                           |

Steps run strictly in this order and the run stops at the first **gating**
failure, so a broken build never spends an hour on the suites behind it. Every
later step is reported as `not run` in the summary. Only `audit` is
non-gating; `--strict` promotes it.

## The coverage gate

Coverage is enforced, not merely collected. Step 9 is the gate and it is
gating; the seven suites are what feed it.

**Where the numbers come from.** Each unit suite writes
`<workspace>/coverage/coverage-summary.json` — the `json-summary` reporter is set
in all seven Jest configs, inherited by `config/jest.config.js` from
`api/jest.config.js`. The gate re-reads that file after the suite and compares
it against `coverageThreshold.global` **read out of the same Jest config jest
itself reads**, so the floors live in exactly one place. Measured values come
from `total.<metric>.pct`; the gate never trusts jest's own exit code.

**Failure modes.** Each of these fails the run (exit 1):

| Failure                                        | Detected as                                                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| A suite did not write its summary              | `no coverage summary was written` — jest collected with coverage silently off, which is a regression in itself |
| The summary is unparseable                     | `unreadable coverage summary (<reason>)`                                                                       |
| A metric is absent or `NaN` in the summary     | `no <metric> figure in <summary>`                                                                              |
| A metric is below its floor                    | `<metric> 61.40% < floor 65%`                                                                                  |
| The Jest config declares no threshold          | `no coverageThreshold.global in <config>`                                                                      |
| A threshold is missing or `NaN` for one metric | `coverageThreshold.global.<metric> missing in <config>`                                                        |
| The threshold is `0` on every metric           | `coverageThreshold.global is 0 on every metric in <config> — trivially satisfied`                              |
| The Jest config cannot be loaded               | `cannot load <config>: <reason>`                                                                               |

Before each suite runs, the gate **deletes** that suite's summary file, so a
stale report from an earlier run can never stand in for a fresh one. If the
suite then fails to write a new one, the gate fails the run.

**A run that measures nothing says so.** With `--only coverage` or a
`--skip`/`--only` that excluded the suites, the gate exits 0 and prints:

```
⚠ No unit suite ran, so the coverage gate measured nothing in this run
  (pass --coverage, or drop the --skip/--only that excluded the suites).
```

That is the honest outcome, not a pass on the numbers.

## Coverage flags

| Flag                 | Effect                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--coverage`         | Collect and enforce (the default). Every CI lane states it explicitly so the gate does not depend on the default holding.                                                                                                                                                                                                                                                             |
| `--no-coverage`      | Fast path for local iteration: the gate stops gating and the suites stop being required to write reports. The suites still run, so the matrix stays honest about what it did not measure. Implemented as `VALIDATE_NO_COVERAGE=1`, which the seven Jest configs read as `collectCoverage: process.env.VALIDATE_NO_COVERAGE !== '1'`; the gate reports `coverage off (--no-coverage)`. |
| `--audit-thresholds` | Runs the **config half only**: reads all seven Jest configs and fails on a missing, partial or all-zero `coverageThreshold.global`. No suite runs, no report is read. This is what the static CI lane uses.                                                                                                                                                                           |
| neither flag         | The default is `--coverage`: measured-vs-floor against whatever the suites wrote.                                                                                                                                                                                                                                                                                                     |

**Why an environment variable and not `--coverage=false`.** The root `test:*`
scripts delegate through a nested `npm run` (`cd api && npm run test:ci`), and
npm consumes anything that looks like a flag on the inner call, so a flag cannot
be forwarded to jest through them. The environment variable is the only channel
that survives the delegation.

**Caveat — three suites ignore `--no-coverage`.** `packages/api`,
`packages/data-provider` and `packages/data-schemas` run `jest --coverage` in
their own `test:ci` script, and a command-line flag outranks the config, so
those three still instrument and still enforce their own thresholds under
`--no-coverage`. The gate itself is still off. The harness prints this note on
every `--no-coverage` run.

## Declared floors

Every Jest config that runs a suite declares a `coverageThreshold`, set two
points below the measured suite coverage. The harness prints all seven with
`--only coverage --audit-thresholds`, so this table is verifiable without
running a suite:

| Suite                    | Statements | Branches | Functions | Lines |
| ------------------------ | ---------- | -------- | --------- | ----- |
| `api`                    | 68         | 62       | 63        | 68    |
| `client`                 | 57         | 51       | 51        | 57    |
| `packages/api`           | 65         | 72       | 65        | 66    |
| `packages/client`        | 55         | 48       | 47        | 54    |
| `packages/data-provider` | 65         | 69       | 36        | 67    |
| `packages/data-schemas`  | 78         | 73       | 83        | 78    |
| `config`                 | 18         | 12       | 21        | 17    |

**Single-file caveat.** A global `coverageThreshold` measures the whole source
tree, so running one spec by hand in a package whose config collects coverage
(`api`, `client`, `config`, `packages/client`) exercises only part of the tree
and fails the floor even though the spec passed. Pass `--coverage=false` for a
focused run — or `VALIDATE_NO_COVERAGE=1`, which the same four configs read:

```bash
cd client && npx jest src/.../Foo.spec.tsx --coverage=false
```

The other three packages only collect coverage when `test:ci` (or `--coverage`)
is used, so their focused runs need no flag.

## Running it

### A fast local pass

No suites, no database, no registry call:

```bash
node scripts/validate.mjs --only coverage --audit-thresholds   # measured at 0.4s
node scripts/validate.mjs --only build,typecheck --skip-audit  # build + types, no DB
npm run validate:static                                        # build + types + static
```

`--list` and `--help` run nothing at all and cost nothing. Of these, only the
threshold audit has an observed runtime on this head (0.4s); the other two build
four packages and run `tsc` six times, so treat them as build-length, not
seconds.

### The full matrix

```bash
npm run validate                       # 13 steps, coverage enforced
node scripts/validate.mjs --no-coverage  # same 13 steps, gate off, faster
node scripts/validate.mjs --changed    # only the steps the diff touched
node scripts/validate.mjs --strict     # audit becomes gating too
```

The suites dominate the wall clock, and `static-checks --full` also carries the
tree-wide gates — circular-dependency detection, the i18n sweep and depcheck —
so they scale with the size of the tree rather than the diff. `--changed` is the
cheap local approximation of a pull request's diff-scoped lanes; it still runs
whole suites for the workspaces it touches, so it is bounded by those suites, not
by a fast pass.

### Every flag

| Flag                 | Effect                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `--only <ids>`       | Run only the listed step ids (comma-separated). Step ids are the labels in `--list`.                                         |
| `--skip <ids>`       | Run every step except the listed ids.                                                                                        |
| `--skip-audit`       | Shorthand for `--skip audit`; drops the network call to the registry.                                                        |
| `--coverage`         | Collect and enforce the per-workspace coverage thresholds (the default).                                                     |
| `--no-coverage`      | Fast path: stop collecting and stop gating coverage. See [Coverage flags](#coverage-flags).                                  |
| `--audit-thresholds` | Run the coverage gate's config half alone — all seven Jest configs, no suites. See [The coverage gate](#the-coverage-gate).  |
| `--changed`          | Scope `build` and the unit suites to the workspaces the diff touched; untouched suites report `no changes`.                  |
| `--base <ref>`       | Diff base for the `typecheck`, `static-checks` and `--changed` steps. `--against` is an alias, matching `static-checks.mts`. |
| `--strict`           | Treat non-gating steps (`audit`) as gating.                                                                                  |
| `--list`             | Print the ordered matrix with each step's planned state and exit.                                                            |
| `-h`, `--help`       | Print usage and exit.                                                                                                        |

`--changed` needs a base: if none of `origin/dev`, `dev`, `origin/main`, `main`
resolves (see [The diff base](#the-diff-base-and-changed-workspaces)), the
harness exits 2 rather than scoping to nothing.

## What "green" means

The run is green — exit code `0` — when every **selected, gating** step passed.
Non-gating failures (`audit` only, and only without `--strict`) are reported on
the final line but leave the exit code at `0`. Exit code `1` means a gating step
failed, **including the coverage gate**. Exit code `2` is a usage error: an
unknown flag, an unknown step id, a step named by both `--only` and `--skip`,
or `--changed` with no resolvable base.

`✓` passed, `✗` failed, `–` skipped / not selected / no changes, `·` not run
because an earlier gating step failed.

## The diff base and changed workspaces

Two steps are diff-scoped by default: `static-checks` skips groups the diff does
not touch, and `typecheck` runs only the workspaces the diff changed. Both need a
base ref, resolved automatically in this order:

1. `origin/dev`
2. `dev`
3. `origin/main`
4. `main`

`--base <ref>` (alias `--against`) overrides the detection. Against the resolved
base the harness diffs `<base>...HEAD` (merge-base, not two-dot) plus uncommitted
and untracked files.

With `--changed`, `build` and each unit suite join them: only the steps whose
workspace the diff touched run, and the rest report `no changes`. A change to
`package.json` or `package-lock.json` widens every step, since a dependency bump
can break any workspace. The coverage gate is **not** diff-scoped — any suite in
the matrix can move any workspace's numbers, so it always runs when selected.

When there is no base ref — or the tree is clean — the harness takes the safest
reading rather than a vacuous pass: `typecheck` checks **every** workspace and
`static-checks` reads the working tree (staged diff, else every changed path).

## Output

Each step streams its own output live (the suites are long-running; a silent wait
is indistinguishable from a hang). The run ends with a summary — this is the real
one printed by `node scripts/validate.mjs --only coverage --audit-thresholds`:

```
── Summary ─────────────────────────────────────────────
  – build                         Build workspace packages                  not selected
  – test:client                   Unit suite — client                       not selected
  ...
  ✓ coverage                      Coverage gate (per-workspace thresholds)  passed · 0.4s
  – typecheck                     Typecheck changed workspaces              not selected
  – static-checks                 Static checks                             not selected
  – lint                          Lint                                      not selected
  – audit                         Dependency audit (high)                   not selected

Coverage gate checked the declared thresholds of all 7 workspaces
(--audit-thresholds; no suite ran).

Validation passed (1 step(s)).
```

When a gating step fails, the run stops and the trailing line names it:

```
Validation FAILED at: test:api
```

The coverage gate prints one block per workspace — in `--audit-thresholds` mode
with no report to compare against, so the measured column is `—`:

```
coverage gate — declared thresholds (all seven workspaces)
test:packages:api (packages/api)  collectCoverage=true
  statements          —  floor 65%
  branches            —  floor 72%
  functions           —  floor 65%
  lines               —  floor 66%
```

In the default (enforcing) mode the header reads `coverage gate — measured vs
floor`, each metric shows its measured percentage against the floor, and a metric
under the floor is listed in a trailing `coverage gate failed:` block.

## Environment limitations

The matrix is designed to run on a laptop with no external services. Three
limitations are expected, not regressions:

- **No production `api/.env` is needed.** The suites read `api/test/.env.test`
  (created from the tracked `.env.test.example`) and `api/test/jestSetup.js` sets
  dummy `MONGO_URI`/JWT/CREDS values itself. The `api` and `config` suites also
  read `api/data/auth.json` at require time. `validate.mjs` creates both the
  missing `api/data/auth.json` and `api/test/.env.test` before the test steps —
  exactly what `.github/workflows/test.yml` and `scripts/static-checks.mts` do —
  and never overwrites an existing file. (A preview UI is a different matter:
  `api/.env` is what the app reads to boot, and a checkout without one has no
  local UI.)
- **No live MongoDB.** `packages/data-schemas` supplies its own database through
  `mongodb-memory-server`, which downloads a binary on the first run; no server
  needs to be running. `api/test` uses dummy connection values.
- **No live Redis or MongoDB for the integration suites.** The
  `*.integration.*`, `*.cache_integration.*` and `*.stream_integration.*` specs in
  `packages/api` open a real Redis/Mongo and are **excluded** from
  `test:packages:api` (`test:ci` passes
  `--testPathIgnorePatterns="\.*integration\."`). They run in
  `.github/workflows/integration.yml`, which the local matrix does not run.
  Running one by hand without those services fails with `ECONNREFUSED 127.0.0.1:6379`
  — environmental, not a code defect.

`static-checks`' `depcheck` gate and `audit` both need network access;
`depcheck` is allowed to skip when the package is not installed, and `audit` is
non-gating.

## Relationship to CI

`.github/workflows/validate.yml` owns three lanes, each invoking the harness with
a specific flag combination. `validate-changed` and `validate-full` pass
`--coverage` **explicitly** — it is the default today, but a gate that only holds
because of a default is a gate nobody can see in review. `validate-static`
selects the coverage step without suites and audits the configs instead.

| Lane               | Trigger                                                  | Command                                                                   | Flag combination                                                                                               |
| ------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `validate-static`  | pull request, push to `b1`/`dev`/`main`, weekly schedule | `npm run validate:static`, then a second invocation                       | `--only build,typecheck,static-checks` **plus** `node scripts/validate.mjs --only coverage --audit-thresholds` |
| `validate-changed` | pull request                                             | `npm run validate:changed -- --against ${{ github.base_ref }} --coverage` | `--changed --against <base> --coverage`                                                                        |
| `validate-full`    | push to `b1`/`main`/`dev`, weekly schedule               | `npm run validate -- --coverage`                                          | full matrix, coverage enforced                                                                                 |

`validate-static` runs the threshold audit as a **separate** invocation rather
than inside `validate:static`, because that script runs `--only
build,typecheck,static-checks` and would re-run all three. The audit is the only
coverage check that lane can make — it runs no suites, so it cannot compare
numbers, which is `validate-changed`'s and `validate-full`'s job.

The other workflows still own the individual gates, so the harness is a local
preflight and a consolidated lane rather than a replacement:

| Step            | Owning CI workflow                                                  |
| --------------- | ------------------------------------------------------------------- |
| `build`         | `.github/workflows/build.yml`                                       |
| `test:*`        | `.github/workflows/test.yml`, `.github/workflows/integration.yml`   |
| integration     | `.github/workflows/integration.yml`                                 |
| `typecheck`     | `.github/workflows/typecheck.yml`                                   |
| `static-checks` | `.github/workflows/static-checks.yml`                               |
| `lint`          | `.github/workflows/lint.yml`                                        |
| e2e / a11y      | `.github/workflows/e2e.yml` (Playwright + axe, Lighthouse advisory) |
| CD              | `.github/workflows/release.yml` (see `docs/deployment.md`)          |
| `audit`         | (release preflight)                                                 |

The harness runs on a developer machine against the working tree, while CI runs
against a pull request's exact head. `static-checks` and `typecheck` are scoped
to the diff locally; CI is too, through the same scripts and `dorny/paths-filter`.

## Status at the time of writing

The coverage gate and the `--coverage` / `--no-coverage` / `--audit-thresholds`
flags are new, and **no end-to-end run of the full matrix has been recorded on
this head**. The cheap invocations were exercised — `--help`, `--list`, and
`--only coverage --audit-thresholds`, which printed all seven declared floors and
passed — but that is the config half of the gate. The measured half runs only in
`validate-full` and `validate-changed`, so **coverage numbers are unverified
locally**: `coverage/coverage-summary.json` is gitignored, so `git status` never
shows it, and any file present in a checkout is a stale artifact of an earlier
targeted run rather than proof that the gate passed. For the consolidated
readiness picture, see [`launch-readiness.md`](launch-readiness.md).
