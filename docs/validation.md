# Release validation

`scripts/validate.mjs` is the single entry point for the release matrix described
in `NEXTROUND.md` under **P8 — Final validation**. It runs every gate a release
must clear, in dependency order, stops at the first failure, and prints a
pass/fail line for each step.

```bash
node scripts/validate.mjs
```

The harness delegates to the existing root npm scripts — `build:packages`,
the seven `test:*` suites, `static-checks`, `lint` — so a green run means the
same scripts CI runs and a developer runs by hand. It reimplements nothing. The
one step with no root script, TypeScript, is invoked directly as
`tsc --noEmit` per workspace by design.

## The matrix

| #   | Step id                       | Command                                                                            | What it proves                                                                                                                                                                                                                                                                            |
| --- | ----------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `build`                       | `npm run build:packages`                                                           | `tsdown` emits fresh `dist` for `packages/data-provider`, `packages/data-schemas`, `packages/api` and `packages/client`. Every later step resolves workspace imports through these artifacts. A tsdown build **emits without checking types**, so it earns no type confidence of its own. |
| 2   | `test:client`                 | `npm run test:client`                                                              | `client` Jest suite green (coverage thresholds enforced).                                                                                                                                                                                                                                 |
| 3   | `test:api`                    | `npm run test:api`                                                                 | `api` Jest suite green.                                                                                                                                                                                                                                                                   |
| 4   | `test:packages:api`           | `npm run test:packages:api`                                                        | `packages/api` suite green.                                                                                                                                                                                                                                                               |
| 5   | `test:packages:client`        | `npm run test:packages:client`                                                     | `packages/client` suite green.                                                                                                                                                                                                                                                            |
| 6   | `test:packages:data-provider` | `npm run test:packages:data-provider`                                              | `packages/data-provider` suite green.                                                                                                                                                                                                                                                     |
| 7   | `test:packages:data-schemas`  | `npm run test:packages:data-schemas`                                               | `packages/data-schemas` suite green.                                                                                                                                                                                                                                                      |
| 8   | `test:config`                 | `npm run test:config`                                                              | `config/` maintenance-script suite green.                                                                                                                                                                                                                                                 |
| 9   | `typecheck`                   | `tsc --noEmit -p <project>` per changed workspace                                  | Each TypeScript project compiles. Six projects: `packages/data-provider`, `packages/data-schemas`, `packages/api`, `packages/client` (plus `tsconfig.test.json`, which is the only project that sees its `*.spec.ts(x)`/`*.test.ts(x)` files), and `client`.                              |
| 10  | `static-checks`               | `npm run static-checks -- --full --skip typecheck,config-tests [--against <base>]` | ESLint, Prettier and import order on the changed files; tree-wide circular-dependency detection, unused i18n keys, unused npm packages (depcheck) and `package.json` validity. `typecheck` and `config-tests` are skipped here because steps 8 and 9 already cover them.                  |
| 11  | `lint`                        | `npm run lint`                                                                     | `eslint .` over the whole tree, not just the diff.                                                                                                                                                                                                                                        |
| 12  | `audit`                       | `npm audit --audit-level=high`                                                     | No high- or critical-severity advisories in the dependency tree.                                                                                                                                                                                                                          |

Steps run strictly in this order and the run stops at the first non-zero exit, so
a broken build never spends an hour on the suites behind it. Every later step is
reported as `not run` in the summary.

## Running it

```bash
node scripts/validate.mjs                          # the full matrix
node scripts/validate.mjs --list                   # print the matrix, run nothing
node scripts/validate.mjs --only typecheck         # one step
node scripts/validate.mjs --skip test:api,lint     # everything but two
node scripts/validate.mjs --skip-audit             # skip the registry call
node scripts/validate.mjs --only static-checks --base main
node scripts/validate.mjs --help
```

| Flag           | Effect                                                                |
| -------------- | --------------------------------------------------------------------- |
| `--only <ids>` | Run only the listed step ids (comma-separated).                       |
| `--skip <ids>` | Run every step except the listed ids.                                 |
| `--skip-audit` | Shorthand for `--skip audit`; drops the network call to the registry. |
| `--base <ref>` | Diff base for the `typecheck` and `static-checks` steps.              |
| `--list`       | Print the ordered matrix with each step's planned state and exit.     |
| `-h`, `--help` | Print usage and exit.                                                 |

Exit codes: `0` all selected steps passed, `1` a step failed, `2` a usage error
(unknown flag or step id, a step named by both `--only` and `--skip`).

## The diff base and changed workspaces

Two steps are diff-scoped. `static-checks` skips groups the diff does not touch,
and `typecheck` runs only the workspaces the diff changed. Both need a base ref,
resolved automatically in this order:

1. `origin/dev`
2. `dev`
3. `origin/main`
4. `main`

`--base <ref>` overrides the detection. Against the resolved base the harness
diffs `<base>...HEAD` (merge-base, not two-dot) plus uncommitted and untracked
files.

When there is no base ref — or the tree is clean — the harness takes the safest
reading rather than a vacuous pass: `typecheck` checks **every** workspace and
`static-checks` reads the working tree. A change to `package.json` or
`package-lock.json` also widens `typecheck` to every workspace, since a
dependency bump can break any project.

Pass / fail per step is the only signal. The `typecheck` step runs one `tsc`
per selected project in sequence and fails on the first project that does not
compile.

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

`✓` passed, `✗` failed, `–` skipped or not selected, `·` not run because an
earlier step failed.

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
