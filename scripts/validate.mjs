#!/usr/bin/env node
/**
 * Release validation harness (NEXTROUND.md P8 — "Final validation").
 *
 * Runs the full release matrix in order and reports pass/fail per step, stopping
 * at the first failure so a broken build never wastes an hour on the suites
 * behind it:
 *
 *   1. build:packages                                   (npm script)
 *   2. the seven unit suites                            (npm scripts)
 *      client, api, packages/api, packages/client,
 *      packages/data-provider, packages/data-schemas, config
 *   3. coverage gate                                    (direct, read-only)
 *      measures each suite's summary against the floor in its own jest config;
 *      `--audit-thresholds` checks the config half alone
 *   4. tsc --noEmit in each changed workspace           (npx tsc, direct)
 *   5. static-checks with typecheck & config-tests skipped (npm script)
 *   6. lint                                             (npm script)
 *   7. npm audit --audit-level=high                     (npm)
 *
 * The npm-backed steps are delegations, not reimplementations: the matrix must
 * exercise the same scripts CI and a developer run by hand, or a green harness
 * says nothing about either. Only the TypeScript step is invoked directly,
 * because there is no root `typecheck` script and the step is defined as
 * `tsc --noEmit` per changed workspace.
 *
 * The diff-scoped steps need a base ref to compare against. One is resolved
 * automatically from `origin/dev`, `dev`, `origin/main`, `main` (in that order)
 * unless `--base`/`--against <ref>` overrides it. With no base — or a clean tree —
 * the harness falls back to the safest reading: typecheck every workspace, and let
 * `static-checks` read the working tree. With `--changed`, the build and unit
 * suites are scoped the same way: only the steps whose workspace the diff
 * touched run, the rest report "no changes".
 *
 * `audit` is non-gating: a high/critical advisory that cannot be fixed locally
 * is reported loudly but does not stop the run or fail the exit code. Every
 * other step is gating — the first gating failure stops the run, and later
 * steps report "not run". `--strict` promotes non-gating steps to gating.
 *
 * Coverage is enforced, not merely collected. Each unit suite leaves a
 * `coverage/coverage-summary.json` behind (the `json-summary` reporter is set in
 * every jest config), and the `coverage` step re-reads each summary against the
 * `coverageThreshold` declared in that workspace's own jest config: a missing
 * report, a config whose threshold vanished, and a metric below its floor are
 * all gating failures. So a regression below the floor fails the run even if
 * jest's own exit code were somehow lost, and a suite that silently stops
 * collecting coverage fails too. `--no-coverage` turns the collection and the
 * gate off together for fast local iteration; the default is the enforcing one.
 * `--audit-thresholds` runs the gate's config half alone — no suite, no reports
 * — so the fast CI lane can still fail a threshold that rotted to 0/0.
 *
 * Usage:
 *   node scripts/validate.mjs                       # full matrix, coverage on
 *   node scripts/validate.mjs --list                # show steps, run nothing
 *   node scripts/validate.mjs --only static-checks  # one step
 *   node scripts/validate.mjs --skip test:api,lint  # all but two
 *   node scripts/validate.mjs --skip-audit          # skip the registry call
 *   node scripts/validate.mjs --no-coverage         # matrix without coverage
 *   node scripts/validate.mjs --only coverage --audit-thresholds
 *   node scripts/validate.mjs --changed             # only steps the diff touched
 *   node scripts/validate.mjs --against main        # explicit diff base
 *
 * Flags: --help/-h, --list, --only <ids>, --skip <ids>, --skip-audit,
 * --coverage, --no-coverage, --audit-thresholds, --changed,
 * --base/--against <ref>, --strict. Step ids are the labels in `--list`.
 *
 * Exit codes: 0 pass (non-gating failures allowed unless --strict), 1 a gating
 * step failed, 2 usage error (bad flag or step id).
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';
const require = createRequire(import.meta.url);

/** `npm.cmd` is only reachable through a shell on Windows. */
const NPM = { command: WIN ? 'npm.cmd' : 'npm', shell: WIN };

/**
 * The flag the jest configs read to switch coverage off. The root `test:*`
 * scripts delegate through a nested `npm run` (`cd api && npm run test:ci`),
 * and npm consumes anything that looks like a flag on the inner call, so
 * `--coverage=false` cannot be forwarded to jest through them — an environment
 * variable is the only channel that survives the delegation.
 */
const NO_COVERAGE_ENV = 'VALIDATE_NO_COVERAGE';

// ------------------------------------------------------------------- process

/**
 * Runs a command with its output streamed live (the suites take minutes; a
 * silent wait is indistinguishable from a hang) while accumulating it for the
 * end-of-run report.
 */
function runStreaming(command, args, { shell = false, cwd = ROOT, env = process.env } = {}) {
  // A `shell: true` spawn that is handed an args array is deprecated (DEP0190),
  // so fold the command line into a single string instead; nothing here carries
  // a character the shell would reinterpret.
  const line = shell ? [command, ...args].join(' ') : command;
  const spawnArgs = shell ? [] : args;
  return new Promise((resolveRun) => {
    let output = '';
    const child = spawn(line, spawnArgs, {
      cwd,
      shell,
      env,
      windowsHide: true,
    });

    child.stdout.on('data', (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    child.on('error', (error) => resolveRun({ code: 1, output: output + error.message }));
    child.on('close', (code) => resolveRun({ code: code ?? 1, output }));
  });
}

/** Wraps a root `npm run <script>` (with optional `-- <args>`) as a step body. */
function npmStep(script, extraArgs = [], { env = process.env } = {}) {
  const args = ['run', script];
  if (extraArgs.length > 0) args.push('--', ...extraArgs);
  return () => runStreaming(NPM.command, args, { shell: NPM.shell, env });
}

/** The environment the jest configs read to decide whether to collect coverage. */
function coverageEnv(enabled) {
  if (enabled) {
    const env = { ...process.env };
    delete env[NO_COVERAGE_ENV];
    return env;
  }
  return { ...process.env, [NO_COVERAGE_ENV]: '1' };
}

/**
 * The workspaces whose own `test:ci` script passes `--coverage` on the command
 * line (`jest --coverage --ci`). Jest's CLI flag outranks the config, so
 * `VALIDATE_NO_COVERAGE` cannot switch collection off there and `--no-coverage`
 * cannot make those three suites skip the instrumentation. The gate itself is
 * still off; only the collection saving is unavailable.
 */
const CLI_COVERAGE_SUITES = new Set([
  'test:packages:api',
  'test:packages:data-provider',
  'test:packages:data-schemas',
]);

function git(args) {
  return new Promise((resolveGit) => {
    let output = '';
    const child = spawn('git', args, { cwd: ROOT, windowsHide: true });
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', () => {});
    child.on('error', () => resolveGit({ code: 1, stdout: '' }));
    child.on('close', (code) => resolveGit({ code: code ?? 0, stdout: output }));
  });
}

// ---------------------------------------------------------------- the matrix

/**
 * TypeScript projects, one per `tsc --noEmit` a release must pass. `match` is
 * the workspace prefix that puts a project in scope when a file under it
 * changed; `packages/client` carries two, because its `tsconfig.json` excludes
 * the `*.spec.ts(x)`/`*.test.ts(x)` files that `tsconfig.test.json` covers.
 */
const TYPECHECK_PROJECTS = [
  {
    id: 'packages/data-provider',
    project: 'packages/data-provider/tsconfig.json',
    match: 'packages/data-provider/',
  },
  {
    id: 'packages/data-schemas',
    project: 'packages/data-schemas/tsconfig.json',
    match: 'packages/data-schemas/',
  },
  { id: 'packages/api', project: 'packages/api/tsconfig.json', match: 'packages/api/' },
  { id: 'packages/client', project: 'packages/client/tsconfig.json', match: 'packages/client/' },
  {
    id: 'packages/client (specs)',
    project: 'packages/client/tsconfig.test.json',
    match: 'packages/client/',
  },
  { id: 'client', project: 'client/tsconfig.json', match: 'client/' },
];

/** Root manifests can break any project through a dependency bump. */
const ROOT_MANIFESTS = new Set(['package.json', 'package-lock.json']);

/**
 * Resolves the installed TypeScript to `node <tsc.js>` so the spawn is
 * shell-free on every platform, falling back to `npx tsc`.
 */
function resolveTsc() {
  try {
    const manifestPath = require.resolve('typescript/package.json', { paths: [ROOT] });
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.tsc;
    if (entry) {
      return {
        command: process.execPath,
        args: [resolve(dirname(manifestPath), entry)],
        shell: false,
      };
    }
  } catch {
    /* fall through to npx */
  }
  return { command: 'npx', args: ['tsc'], shell: WIN };
}

/** Files changed against `base...HEAD`, plus everything not yet committed. */
async function changedFiles(base) {
  const files = new Set();
  const collect = async (args) => {
    const { code, stdout } = await git(args);
    if (code !== 0) return;
    for (const line of stdout.split('\n')) {
      const file = line.trim();
      if (file) files.add(file.split('\\').join('/'));
    }
  };

  if (base) await collect(['diff', '--name-only', `${base}...HEAD`]);
  await collect(['diff', '--name-only', 'HEAD']);
  await collect(['ls-files', '--others', '--exclude-standard']);
  return files;
}

async function resolveBase(explicit) {
  if (explicit) return explicit;
  for (const candidate of ['origin/dev', 'dev', 'origin/main', 'main']) {
    const { code } = await git(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]);
    if (code === 0) return candidate;
  }
  return null;
}

/** The projects a release must typecheck, given the base ref and the diff. */
async function selectTypecheckProjects(base, changed) {
  if (!base || !changed) return TYPECHECK_PROJECTS;
  if (changed.size === 0) return TYPECHECK_PROJECTS;
  if ([...changed].some((file) => ROOT_MANIFESTS.has(file))) return TYPECHECK_PROJECTS;
  const selected = TYPECHECK_PROJECTS.filter((entry) =>
    [...changed].some((file) => file.startsWith(entry.match)),
  );
  // No project in scope still means a workspace other than these changed —
  // typechecking nothing would report a pass the run never earned.
  return selected.length > 0 ? selected : TYPECHECK_PROJECTS;
}

/**
 * The `api` and `config` suites require `api/data/auth.json` (read at require
 * time) and `api/test/.env.test` (gitignored; only the `.example` is tracked).
 * A fresh checkout has neither, and `.github/workflows/test.yml` creates both
 * before its steps — `static-checks.mts` does the same for the config suite.
 * Mirror that here so the test steps work without the manual prep, and never
 * overwrite a file that already exists.
 */
function prepareTestEnvironment() {
  mkdirSync(resolve(ROOT, 'api/data'), { recursive: true });
  const authFile = resolve(ROOT, 'api/data/auth.json');
  if (!existsSync(authFile)) writeFileSync(authFile, '{}\n');

  const envFile = resolve(ROOT, 'api/test/.env.test');
  const envExample = resolve(ROOT, 'api/test/.env.test.example');
  if (!existsSync(envFile) && existsSync(envExample)) copyFileSync(envExample, envFile);
}

// ------------------------------------------------------------------ coverage

/**
 * The seven unit suites, with what the coverage gate needs to check each one:
 * the workspace directory that holds its `coverage/` output and the jest config
 * that declares its floors. `TEST_SUITES` is ordered as the matrix runs them.
 */
const TEST_SUITES = [
  {
    id: 'test:client',
    title: 'Unit suite — client',
    workspace: 'client',
    config: 'client/jest.config.cjs',
  },
  { id: 'test:api', title: 'Unit suite — api', workspace: 'api', config: 'api/jest.config.js' },
  {
    id: 'test:packages:api',
    title: 'Unit suite — packages/api',
    workspace: 'packages/api',
    config: 'packages/api/jest.config.mjs',
  },
  {
    id: 'test:packages:client',
    title: 'Unit suite — packages/client',
    workspace: 'packages/client',
    config: 'packages/client/jest.config.js',
  },
  {
    id: 'test:packages:data-provider',
    title: 'Unit suite — packages/data-provider',
    workspace: 'packages/data-provider',
    config: 'packages/data-provider/jest.config.js',
  },
  {
    id: 'test:packages:data-schemas',
    title: 'Unit suite — packages/data-schemas',
    workspace: 'packages/data-schemas',
    config: 'packages/data-schemas/jest.config.mjs',
  },
  {
    id: 'test:config',
    title: 'Unit suite — config',
    workspace: 'config',
    config: 'config/jest.config.js',
  },
].map((suite) => ({
  ...suite,
  workspaces: [`${suite.workspace}/`],
  summary: `${suite.workspace}/coverage/coverage-summary.json`,
}));

/** The coverage metrics the gate compares, in the order the reports print. */
const COVERAGE_METRICS = ['statements', 'branches', 'functions', 'lines'];

/**
 * Reads `coverageThreshold.global` out of a workspace's jest config. Jest owns
 * the floors, so the gate reads them from the same object jest reads instead of
 * duplicating the numbers here — a config that loses its threshold then becomes
 * a coverage failure rather than a silently satisfied gate.
 */
async function readCoverageThreshold(configPath) {
  const absolute = resolve(ROOT, configPath);
  if (!existsSync(absolute)) return { error: `jest config not found: ${configPath}` };
  let config;
  try {
    // `require` handles both module systems here (`packages/api` and
    // `packages/data-schemas` are `.mjs`, `packages/client` is ESM-syntax in a
    // package with no `type`); `import` is the fallback for a runtime where
    // require(esm) is off.
    const loaded = require(absolute);
    config = loaded?.default ?? loaded;
  } catch (error) {
    try {
      const loaded = await import(pathToFileURL(absolute).href);
      config = loaded?.default ?? loaded;
    } catch {
      return { error: `cannot load ${configPath}: ${error?.message ?? error}` };
    }
  }
  const threshold = config?.coverageThreshold?.global;
  if (!threshold) return { error: `no coverageThreshold.global in ${configPath}` };
  const floors = {};
  for (const metric of COVERAGE_METRICS) {
    const value = threshold[metric];
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return { error: `coverageThreshold.global.${metric} missing in ${configPath}` };
    }
    floors[metric] = value;
  }
  // Zero on every metric is the shape a gate rots into when nobody is looking:
  // jest accepts it, so nothing fails and nothing is measured.
  if (COVERAGE_METRICS.every((metric) => floors[metric] <= 0)) {
    return {
      error: `coverageThreshold.global is 0 on every metric in ${configPath} — trivially satisfied`,
    };
  }
  return { floors, collect: config?.collectCoverage };
}

function readCoverageSummary(summaryPath) {
  const absolute = resolve(ROOT, summaryPath);
  if (!existsSync(absolute)) return { error: 'no coverage summary was written' };
  try {
    const parsed = JSON.parse(readFileSync(absolute, 'utf8'));
    return { total: parsed.total };
  } catch (error) {
    return { error: `unreadable coverage summary (${error?.message ?? error})` };
  }
}

function formatMetric(value) {
  return typeof value === 'number' ? `${value.toFixed(2)}%` : '—';
}

/**
 * Clears one suite's summary so a stale report from an earlier run can never be
 * mistaken for a fresh one — the postcondition that coverage actually ran.
 */
function clearCoverageSummary(summaryPath) {
  rmSync(resolve(ROOT, summaryPath), { force: true });
}

/**
 * Whether `--changed` puts a step in scope: steps declare the workspace
 * prefixes whose files they test; a step with no prefixes (lint, static-checks,
 * audit, typecheck) is tree-wide or already diff-scoped and always runs. A root
 * manifest bump can break anything, so it widens every step.
 */
function stepTouched(step, changed) {
  if (!step.workspaces) return true;
  if ([...changed].some((file) => ROOT_MANIFESTS.has(file))) return true;
  return [...changed].some((file) => step.workspaces.some((prefix) => file.startsWith(prefix)));
}

/**
 * Step bodies receive the run context ({ base, projects, coverage }) and return
 * `{ code, output }`. `code === 0` is the only pass.
 */
function buildSteps(options) {
  const staticArgs = ['--full', '--skip', 'typecheck,config-tests'];
  const coverageEnabled = options.coverage;

  const testSteps = TEST_SUITES.map((suite) => ({
    id: suite.id,
    title: suite.title,
    workspaces: suite.workspaces,
    run: async (context) => {
      if (!coverageEnabled) return npmStep(suite.id, [], { env: coverageEnv(false) })();
      // Clear first: a stale report from an earlier run must not be able to
      // stand in for a fresh one.
      clearCoverageSummary(suite.summary);
      const result = await npmStep(suite.id, [], { env: coverageEnv(true) })();
      if (result.code !== 0) return result;
      // Coverage ran or it did not: a suite whose summary is missing was
      // collected with coverage silently off, which is a regression in itself.
      const summary = readCoverageSummary(suite.summary);
      if (summary.error) {
        return {
          code: 1,
          output: `${result.output}\n${suite.id}: ${summary.error} (${suite.summary})`,
        };
      }
      context.coverage.runs.push({ suite, ...summary });
      return result;
    },
  }));

  return [
    {
      id: 'build',
      title: 'Build workspace packages',
      workspaces: [
        'packages/data-provider/',
        'packages/data-schemas/',
        'packages/api/',
        'packages/client/',
      ],
      run: npmStep('build:packages'),
    },
    ...testSteps,
    {
      id: 'coverage',
      title: 'Coverage gate (per-workspace thresholds)',
      // Tree-wide: any suite in the matrix can move any workspace's numbers.
      run: async ({ coverage: state }) => {
        if (!state.enabled) return { code: 0, output: 'coverage off (--no-coverage)' };
        // Threshold audit: the cheap half of the gate, over every workspace
        // whether or not its suite ran. A config that loses its threshold, or
        // drops it to 0 on every metric, is the failure mode jest cannot report.
        const suites = state.auditThresholds
          ? TEST_SUITES.map((suite) => ({ suite, total: null }))
          : state.runs;
        if (suites.length === 0) return { code: 0, output: 'no unit suite ran' };
        let output = state.auditThresholds
          ? 'coverage gate — declared thresholds (all seven workspaces)\n'
          : 'coverage gate — measured vs floor\n';
        const failures = [];
        for (const { suite, total } of suites) {
          const { floors, collect, error } = await readCoverageThreshold(suite.config);
          if (error) {
            failures.push(`${suite.id}: ${error}`);
            output += `${suite.id}: ${error}\n`;
            continue;
          }
          const collected = collect === false ? 'config off' : String(collect);
          output += `${suite.id} (${suite.workspace})  collectCoverage=${collected}\n`;
          for (const metric of COVERAGE_METRICS) {
            const measured = total?.[metric]?.pct;
            const floor = floors[metric];
            if (total && (typeof measured !== 'number' || Number.isNaN(measured))) {
              // A summary that cannot be read is a failed measurement, not an
              // absent one: reporting it as passing is exactly the silent skip
              // this gate exists to prevent.
              failures.push(`${suite.id}: no ${metric} figure in ${suite.summary}`);
              output += `  ${metric.padEnd(11)} ${formatMetric(measured).padStart(9)}  floor ${floor}%\n`;
              continue;
            }
            const short = typeof measured === 'number' && measured < floor;
            if (short) {
              failures.push(`${suite.id}: ${metric} ${formatMetric(measured)} < floor ${floor}%`);
            }
            output += `  ${metric.padEnd(11)} ${formatMetric(measured).padStart(9)}  floor ${floor}%\n`;
          }
        }
        process.stdout.write(`\n${output}`);
        if (failures.length > 0) {
          return {
            code: 1,
            output: `${output}\ncoverage gate failed:\n- ${failures.join('\n- ')}`,
          };
        }
        return { code: 0, output };
      },
    },
    {
      id: 'typecheck',
      title: 'Typecheck changed workspaces',
      run: async ({ projects }) => {
        const tsc = resolveTsc();
        let output = '';
        for (const project of projects) {
          process.stdout.write(`    tsc --noEmit -p ${project.project}\n`);
          const result = await runStreaming(
            tsc.command,
            [...tsc.args, '--noEmit', '-p', project.project],
            {
              shell: tsc.shell,
            },
          );
          output += result.output;
          if (result.code !== 0) {
            return { code: result.code, output: `tsc --noEmit -p ${project.project} failed` };
          }
        }
        return { code: 0, output };
      },
    },
    {
      id: 'static-checks',
      title: 'Static checks',
      // --full adds the tree-wide gates; typecheck and config-tests are their
      // own steps above, so skipping them here avoids running both twice.
      run: ({ base }) => {
        const args = [...staticArgs];
        if (base) args.push('--against', base);
        return runStreaming(NPM.command, ['run', 'static-checks', '--', ...args], {
          shell: NPM.shell,
        });
      },
    },
    { id: 'lint', title: 'Lint', run: npmStep('lint') },
    {
      id: 'audit',
      title: 'Dependency audit (high)',
      // Non-gating: high/critical advisories are frequently unfixable locally
      // (a patched release may not exist), so a fail here is reported but must
      // not stop the matrix or fail the run. --strict promotes it to gating.
      gating: false,
      // `--audit-level=high` makes the exit code fail on high/critical only.
      run: () => runStreaming(NPM.command, ['audit', '--audit-level=high'], { shell: NPM.shell }),
    },
  ];
}

// ------------------------------------------------------------------- options

const HELP = `Release validation harness (NEXTROUND.md P8).

Runs the full release matrix in order, stops at the first gating failure, and
prints a pass/fail summary for every step. The audit step is non-gating: it is
reported but does not stop the run or fail the exit code unless --strict.

Usage:
  node scripts/validate.mjs [options]

Options:
  --only <ids>     Run only these step ids (comma-separated).
  --skip <ids>     Run everything except these step ids (comma-separated).
  --skip-audit     Shorthand for --skip audit (no registry call).
  --coverage       Collect and enforce the per-workspace coverage thresholds
                   (the default; stated explicitly by every CI lane so the gate
                   does not depend on the default holding).
  --no-coverage    Fast path for local iteration: the harness stops requiring
                   the suites' reports and the coverage step stops gating. The
                   unit suites still run, so the matrix stays honest about what
                   it did not measure — the coverage step reports
                   "coverage off (--no-coverage)".
                   It is implemented as VALIDATE_NO_COVERAGE=1, which the seven
                   jest configs read, because the root test:* scripts delegate
                   through a nested "npm run" that rejects forwarded flags.
                   Caveat: packages/api, packages/data-provider and
                   packages/data-schemas run "jest --coverage" in their own
                   test:ci script and a command-line flag outranks the config,
                   so those three still collect and still enforce their own
                   thresholds. The other four skip collection.
  --audit-thresholds
                   Run only the cheap half of the coverage gate: read all seven
                   jest configs and fail if any lost its coverageThreshold or
                   dropped it to 0 on every metric. No suite runs, so this is
                   what the static CI lane uses to keep the gate from rotting
                   into a shape that measures nothing.
  --changed        Scope the build and unit suites to the workspaces the diff
                   touched; untouched suites report "no changes".
  --base <ref>     Diff base for the typecheck, static-checks and --changed
                   steps. Auto-detected from origin/dev, dev, origin/main,
                   main. --against is an alias (matches static-checks.mts).
  --strict         Treat non-gating steps (audit) as gating.
  --list           Print the matrix and exit without running anything.
  -h, --help       Print this help and exit.

Steps (in order):
  1. build                       npm run build:packages
  2. test:client                 npm run test:client
  3. test:api                    npm run test:api
  4. test:packages:api           npm run test:packages:api
  5. test:packages:client        npm run test:packages:client
  6. test:packages:data-provider npm run test:packages:data-provider
  7. test:packages:data-schemas  npm run test:packages:data-schemas
  8. test:config                 npm run test:config
  9. coverage                    re-check every suite's coverage/coverage-summary.json
                                 against the coverageThreshold.global in that
                                 workspace's jest config. A missing summary, a
                                 config with no threshold (or one that fell to
                                 0 on every metric), or a metric under its
                                 floor fails the run (gating). With
                                 --audit-thresholds only the config half runs,
                                 over all seven workspaces, with no suite.
 10. typecheck                   tsc --noEmit in each changed workspace
 11. static-checks               npm run static-checks -- --full --skip typecheck,config-tests
 12. lint                        npm run lint
 13. audit                       npm audit --audit-level=high (non-gating)

Exit codes:
  0  pass (non-gating failures allowed unless --strict)
  1  a gating step failed — including the coverage gate
  2  usage error (bad flag or step id)

Examples:
  node scripts/validate.mjs --list
  node scripts/validate.mjs --changed --against origin/dev
  node scripts/validate.mjs --only static-checks,lint --base main
  node scripts/validate.mjs --skip-audit
  node scripts/validate.mjs --no-coverage
  node scripts/validate.mjs --only coverage --audit-thresholds
`;

function fail(message) {
  console.error(`validate: ${message}`);
  process.exit(2);
}

function parseList(value) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const options = {
    only: [],
    skip: [],
    skipAudit: false,
    changed: false,
    strict: false,
    coverage: true,
    auditThresholds: false,
    base: undefined,
    list: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) fail(`${arg} requires a value`);
      index++;
      return next;
    };
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--list':
        options.list = true;
        break;
      case '--skip-audit':
        options.skipAudit = true;
        break;
      case '--changed':
        options.changed = true;
        break;
      case '--strict':
        options.strict = true;
        break;
      case '--coverage':
        options.coverage = true;
        break;
      case '--no-coverage':
        options.coverage = false;
        break;
      case '--audit-thresholds':
        options.auditThresholds = true;
        break;
      case '--only':
        options.only.push(...parseList(value()));
        break;
      case '--skip':
        options.skip.push(...parseList(value()));
        break;
      case '--base':
      case '--against':
        options.base = value();
        break;
      default:
        fail(`unknown option: ${arg}`);
    }
  }
  return options;
}

// -------------------------------------------------------------------- runner

const ID_WIDTH = 32;
const TITLE_WIDTH = 42;

/** The summary glyph for a step's final state. */
function statusMark(status) {
  if (status === 'passed') return '✓';
  if (status === 'failed' || status === 'failed (non-gating)') return '✗';
  if (status === 'skipped' || status === 'not selected' || status === 'no changes') return '–';
  return '·';
}

function report(mark, id, title, detail) {
  const label = `${mark} ${id}`.padEnd(ID_WIDTH);
  console.log(`  ${label}${title.padEnd(TITLE_WIDTH)}${detail}`);
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Each step's fate before anything runs: run it, or why it is not running. */
function planSteps(steps, options, skip, changed) {
  const touched = (step) => !options.changed || stepTouched(step, changed);
  const plan = new Map();
  for (const step of steps) {
    if (options.only.length > 0 && !options.only.includes(step.id)) {
      plan.set(step.id, 'not selected');
    } else if (skip.has(step.id)) {
      plan.set(step.id, 'skipped');
    } else if (!touched(step)) {
      plan.set(step.id, 'no changes');
    } else {
      plan.set(step.id, 'run');
    }
  }
  return plan;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(HELP);
    return;
  }

  const steps = buildSteps(options);
  const known = new Set(steps.map((step) => step.id));

  const skip = new Set(options.skip);
  if (options.skipAudit) skip.add('audit');

  for (const id of [...options.only, ...skip]) {
    if (!known.has(id)) {
      fail(`unknown step id: ${id} — run with --list to see the ids`);
    }
  }

  if (options.only.length > 0) {
    for (const id of options.only) {
      if (skip.has(id)) fail(`step ${id} is both --only and --skip`);
    }
  }

  const base = await resolveBase(options.base);
  if (options.changed && !base) {
    fail('--changed needs a diff base — pass --base/--against <ref>, or create dev/main');
  }
  const changed = base ? await changedFiles(base) : null;
  const projects = await selectTypecheckProjects(base, changed);
  const plan = planSteps(steps, options, skip, changed);

  if (options.list) {
    console.log('Release validation — steps (in order):');
    for (const step of steps) {
      const status = plan.get(step.id);
      report(
        status === 'run' ? '→' : '·',
        step.id,
        step.title,
        status === 'run' ? 'selected' : status,
      );
    }
    console.log('');
    console.log(
      options.coverage
        ? `Coverage: enforced — every suite collects coverage and the coverage step fails the run on a missing report or a metric under its floor.${options.auditThresholds ? ' Mode: --audit-thresholds, so only the declared thresholds are checked (no suite runs).' : ''}`
        : `Coverage: off (--no-coverage) — suites run without coverage and the coverage step checks nothing.`,
    );
    console.log('Suite coverage reports (each suite writes its own):');
    for (const suite of TEST_SUITES) {
      console.log(`  ${suite.id.padEnd(30)} ${suite.summary}`);
    }
    return;
  }

  console.log(
    `Release validation — ${[...plan.values()].filter((s) => s === 'run').length} step(s)`,
  );
  console.log(
    base
      ? `Base: ${base} · typecheck projects: ${projects.length}` +
          (options.changed ? ` · changed mode (${changed.size} file(s) in diff)` : '')
      : 'No base ref — typechecking every workspace, static checks read the working tree',
  );
  console.log(
    options.coverage
      ? `Coverage: enforced (per-workspace coverageThreshold, gating)${options.auditThresholds ? ' · --audit-thresholds: declared thresholds only' : ''}`
      : 'Coverage: off (--no-coverage) — the coverage gate measures nothing in this run',
  );
  if (!options.coverage) {
    const stillCollecting = [...CLI_COVERAGE_SUITES].join(', ');
    console.log(
      `Note: ${stillCollecting} pass --coverage in their own test:ci script, which outranks ` +
        'the config switch, so they still collect and still enforce their own thresholds.',
    );
  }
  console.log('');

  if (steps.some((step) => plan.get(step.id) === 'run' && step.id.startsWith('test'))) {
    prepareTestEnvironment();
  }

  const context = {
    base,
    projects,
    changed,
    coverage: { enabled: options.coverage, auditThresholds: options.auditThresholds, runs: [] },
  };
  const results = new Map();
  let gatingFailure = null;
  const nonGatingFailures = [];

  for (const step of steps) {
    if (plan.get(step.id) !== 'run') {
      results.set(step.id, { status: plan.get(step.id) });
      continue;
    }
    if (gatingFailure) {
      results.set(step.id, { status: 'not run' });
      continue;
    }

    process.stdout.write(`\n▶ ${step.id} — ${step.title}\n`);
    const started = Date.now();
    let result;
    try {
      result = await step.run(context);
    } catch (error) {
      result = { code: 1, output: `${step.id} threw: ${error?.stack ?? error}` };
    }
    const elapsed = Date.now() - started;

    if (result.code === 0) {
      results.set(step.id, { status: 'passed', elapsed });
      process.stdout.write(`\n✓ ${step.id} passed (${seconds(elapsed)})\n`);
      continue;
    }

    const gating = step.gating !== false || options.strict;
    if (gating) {
      gatingFailure = step.id;
      results.set(step.id, { status: 'failed', elapsed, output: result.output });
      process.stdout.write(`\n✗ ${step.id} failed (${seconds(elapsed)})\n`);
    } else {
      nonGatingFailures.push(step.id);
      results.set(step.id, { status: 'failed (non-gating)', elapsed, output: result.output });
      process.stdout.write(
        `\n✗ ${step.id} failed (non-gating — continuing) (${seconds(elapsed)})\n`,
      );
    }
  }

  console.log('\n── Summary ─────────────────────────────────────────────');
  for (const step of steps) {
    const result = results.get(step.id) ?? { status: 'not run' };
    const mark = statusMark(result.status);
    const detail =
      result.status === 'passed' || result.status.startsWith('failed')
        ? `${result.status} · ${seconds(result.elapsed)}`
        : result.status;
    report(mark, step.id, step.title, detail);
  }

  if (options.coverage && results.get('coverage')?.status === 'passed') {
    const suites = context.coverage.runs.length;
    if (options.auditThresholds) {
      console.log(
        `\nCoverage gate checked the declared thresholds of all ${TEST_SUITES.length} workspaces (--audit-thresholds; no suite ran).`,
      );
    } else if (suites === 0) {
      console.log(
        '\n⚠ No unit suite ran, so the coverage gate measured nothing in this run ' +
          '(pass --coverage, or drop the --skip/--only that excluded the suites).',
      );
    } else {
      console.log(`\nCoverage gate checked ${suites} suite(s) against their jest thresholds.`);
    }
  }

  if (gatingFailure) {
    console.log(`\nValidation FAILED at: ${gatingFailure}`);
    process.exitCode = 1;
    return;
  }

  if (nonGatingFailures.length > 0) {
    console.log(
      `\nValidation passed (${[...plan.values()].filter((s) => s === 'run').length} step(s)); ` +
        `non-gating failures: ${nonGatingFailures.join(', ')}`,
    );
    return;
  }

  console.log(
    `\nValidation passed (${[...plan.values()].filter((s) => s === 'run').length} step(s)).`,
  );
}

await main();
