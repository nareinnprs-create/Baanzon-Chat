# Release validation

`scripts/validate.mjs` is the single entry point for the release matrix described
in `NEXTROUND.md` under **P8 — Final validation**. It runs every gate a release
must clear, in dependency order, stops at the first gating failure, and prints a
pass/fail line for each step.

```bash
npm run validate          # node scripts/validate.mjs
```

The harness delegates to the existing root npm scripts — `build:packages`, the
seven `test:*` suites, `static-checks`, `lint` — so a green run means the same
scripts CI runs and a developer runs by hand. It reimplements nothing. The one
step with no root script, TypeScript, is invoked directly as `tsc --noEmit` per
workspace by design.

Two convenience wrappers exist for the common local cases:

| Script                     | Same as                                                          | Use                                               |
| -------------------------- | ---------------------------------------------------------------- | ------------------------------------------------- |
| `npm run validate`         | `node scripts/validate.mjs`                                      | Full matrix.                                      |
| `npm run validate:changed` | `node scripts/validate.mjs --changed`                            | Only the workspaces the diff touched.             |
| `npm run validate:static`  | `node scripts/validate.mjs --only build,typecheck,static-checks` | The build + type + static gates, no suites or DB. |

## The matrix

| #   | Step id                       | Command                                                                            | What it proves                                                                                                                                                                                                                                                                                              |
| --- | ----------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `build`                       | `npm run build:packages`                                                           | `tsdown` emits fresh `dist` in dependency order — `packages/data-provider` → `packages/data-schemas` → `packages/api` → `packages/client`. Every later step resolves workspace imports through these artifacts. A tsdown build **emits without checking types**, so it earns no type confidence of its own. |
| 2   | `test:client`                 | `npm run test:client`                                                              | `client` Jest suite green (coverage thresholds enforced).                                                                                                                                                                                                                                                   |
| 3   | `test:api`                    | `npm run test:api`                                                                 | `api` Jest suite green (coverage thresholds enforced).                                                                                                                                                                                                                                                      |
| 4   | `test:packages:api`           | `npm run test:packages:api`                                                        | `packages/api` unit tier green; `*.integration.*` specs are excluded here and run in `integration.yml` (see below).                                                                                                                                                                                         |
| 5   | `test:packages:client`        | `npm run test:packages:client`                                                     | `packages/client` suite green (coverage thresholds enforced).                                                                                                                                                                                                                                               |
| 6   | `test:packages:data-provider` | `npm run test:packages:data-provider`                                              | `packages/data-provider` suite green (coverage thresholds enforced).                                                                                                                                                                                                                                        |
| 7   | `test:packages:data-schemas`  | `npm run test:packages:data-schemas`                                               | `packages/data-schemas` suite green against `mongodb-memory-server` (coverage thresholds enforced).                                                                                                                                                                                                         |
| 8   | `test:config`                 | `npm run test:config`                                                              | `config/` maintenance-script suite green (coverage thresholds enforced).                                                                                                                                                                                                                                    |
| 9   | `typecheck`                   | `tsc --noEmit -p <project>` per changed workspace                                  | Each TypeScript project compiles. Six projects: `packages/data-provider`, `packages/data-schemas`, `packages/api`, `packages/client` (plus `tsconfig.test.json`, the only project that sees its `*.spec.ts(x)`/`*.test.ts(x)` files), and `client`.                                                         |
| 10  | `static-checks`               | `npm run static-checks -- --full --skip typecheck,config-tests [--against <base>]` | ESLint, Prettier and import order on the changed files; tree-wide circular-dependency detection, unused i18n keys, unused npm packages (depcheck) and `package.json` validity. `typecheck` and `config-tests` are skipped here because steps 8 and 9 already cover them.                                    |
| 11  | `lint`                        | `npm run lint`                                                                     | `eslint .` over the whole tree, not just the diff.                                                                                                                                                                                                                                                          |
| 12  | `audit`                       | `npm audit --audit-level=high`                                                     | No high- or critical-severity advisories in the dependency tree. **Non-gating** — reported, but does not stop the run or fail the exit code unless `--strict`.                                                                                                                                              |

Steps run strictly in this order and the run stops at the first **gating**
failure, so a broken build never spends an hour on the suites behind it. Every
later step is reported as `not run` in the summary.

## Running it

```bash
npm run validate                                   # the full matrix
node scripts/validate.mjs --list                   # print the matrix, run nothing
node scripts/validate.mjs --only typecheck         # one step
node scripts/validate.mjs --skip test:api,lint     # everything but two
node scripts/validate.mjs --skip-audit             # skip the registry call
node scripts/validate.mjs --changed                # only steps the diff touched
node scripts/validate.mjs --only static-checks --base main
node scripts/validate.mjs --help
```

| Flag           | Effect                                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `--only <ids>` | Run only the listed step ids (comma-separated).                                                                              |
| `--skip <ids>` | Run every step except the listed ids.                                                                                        |
| `--skip-audit` | Shorthand for `--skip audit`; drops the network call to the registry.                                                        |
| `--changed`    | Scope `build` and the unit suites to the workspaces the diff touched; untouched suites report `no changes`.                  |
| `--base <ref>` | Diff base for the `typecheck`, `static-checks` and `--changed` steps. `--against` is an alias, matching `static-checks.mts`. |
| `--strict`     | Treat non-gating steps (`audit`) as gating.                                                                                  |
| `--list`       | Print the ordered matrix with each step's planned state and exit.                                                            |
| `-h`, `--help` | Print usage and exit.                                                                                                        |

`npm run validate:changed` and `npm run validate:static` are the two common
flag combinations, exposed as root scripts (see the top of this page).

## What "green" means

The run is green — exit code `0` — when every **selected, gating** step passed.
Non-gating failures (`audit` only, and only without `--strict`) are reported on
the final line but leave the exit code at `0`. Exit code `1` means a gating step
failed; `2` is a usage error (unknown flag or step id, a step named by both
`--only` and `--skip`).

`✓` passed, `✗` failed, `–` skipped / not selected / no changes, `·` not run
because an earlier gating step failed.

## Coverage thresholds

Every Jest config that runs a suite enforces a `coverageThreshold`, two points
below the measured suite coverage:

| Suite                    | Statements | Branches | Functions | Lines |
| ------------------------ | ---------- | -------- | --------- | ----- |
| `api`                    | 68         | 62       | 63        | 68    |
| `client`                 | 57         | 51       | 51        | 57    |
| `packages/api`           | 65         | 72       | 65        | 66    |
| `packages/client`        | 55         | 48       | 47        | 54    |
| `packages/data-provider` | 65         | 69       | 36        | 67    |
| `packages/data-schemas`  | 78         | 73       | 83        | 78    |
| `config`                 | 18         | 12       | 21        | 17    |

Each suite's `test:ci` collects coverage — `api`, `client`, `config` and
`packages/client` through `collectCoverage: true` in their Jest config, the other
three through the `--coverage` flag in their `test:ci` script. A full run therefore
fails when coverage drops below these floors.

**Single-file caveat.** A global `coverageThreshold` measures the whole source
tree, so running one spec by hand in a package whose config collects coverage
(`api`, `client`, `config`, `packages/client`) exercises only part of the tree and
fails the floor even though the spec passed. Pass `--coverage=false` to skip
collection for a focused run:

```bash
cd client && npx jest src/.../Foo.spec.tsx --coverage=false
```

The other three packages only collect coverage when `test:ci` (or `--coverage`)
is used, so their focused runs need no flag.

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
can break any workspace.

When there is no base ref — or the tree is clean — the harness takes the safest
reading rather than a vacuous pass: `typecheck` checks **every** workspace and
`static-checks` reads the working tree (staged diff, else every changed path).

## Output

Each step streams its own output live (the suites run for minutes; a silent wait
is indistinguishable from a hang). The run ends with a summary:

```
── Summary ─────────────────────────────────────────────
  ✓ build                         Build workspace packages                passed · 12.4s
  ✓ test:client                   Unit suite — client                     passed · 95.1s
  ✗ test:api                      Unit suite — api                        failed · 31.7s
  · test:packages:api             Unit suite — packages/api               not run
  ...
  – audit                         Dependency audit (high)                 not selected

Validation FAILED at: test:api
```

## Environment limitations

The matrix is designed to run on a laptop with no external services. Three
limitations are expected, not regressions:

- **No production `api/.env` is needed.** The suites read `api/test/.env.test`
  (created from the tracked `.env.test.example`) and `api/test/jestSetup.js` sets
  dummy `MONGO_URI`/JWT/CREDS values itself. The `api` and `config` suites also
  read `api/data/auth.json` at require time. `validate.mjs` creates both the
  missing `api/data/auth.json` and `api/test/.env.test` before the test steps —
  exactly what `.github/workflows/test.yml` and `scripts/static-checks.mts` do —
  and never overwrites an existing file.
- **No live MongoDB.** `packages/data-schemas` supplies its own database through
  `mongodb-memory-server`, which downloads a binary on the first run; no server
  needs to be running. `api/test` uses dummy connection values.
- **No live Redis or MongoDB for the integration suites.** The
  `*.integration.*`, `*.cache_integration.*` and `*.stream_integration.*` specs in
  `packages/api` open a real Redis/Mongo and are **excluded** from
  `test:packages:api` (`test:ci` passes
  `--testPathIgnorePatterns="\.*integration\."`). They run in
  `.github/workflows/integration.yml`, which the P8 matrix does not run. Running
  one by hand without those services fails with `ECONNREFUSED` — environmental,
  not a code defect.

`static-checks`' `depcheck` gate and `audit` both need network access; `depcheck`
is allowed to skip when the package is not installed, and `audit` is
non-gating.

## Relationship to CI

Every command is a delegation; the table maps each step to the workflow that owns
the same gate in CI:

| Step            | Owning CI workflow                                                |
| --------------- | ----------------------------------------------------------------- |
| `build`         | `.github/workflows/build.yml`                                     |
| `test:*`        | `.github/workflows/test.yml`, `.github/workflows/integration.yml` |
| `typecheck`     | `.github/workflows/typecheck.yml`                                 |
| `static-checks` | `.github/workflows/static-checks.yml`                             |
| `lint`          | `.github/workflows/lint.yml`                                      |
| `audit`         | (release preflight)                                               |

The harness is a local preflight, not a CI replacement: it runs on a developer
machine against the working tree, while CI runs against a pull request's exact
head. `static-checks` and `typecheck` are scoped to the diff locally; CI is too,
through the same scripts and `dorny/paths-filter`.

The seven unit suites plus `build`, `typecheck`, `static-checks`, `lint` and
`audit` are the full P8 matrix. Expect the complete run to take a while — the
suites dominate, and `static-checks --full` alone can run several minutes when
depcheck and the i18n sweep are in scope.
