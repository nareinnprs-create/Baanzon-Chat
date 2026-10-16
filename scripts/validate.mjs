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
 *   3. tsc --noEmit in each changed workspace           (npx tsc, direct)
 *   4. static-checks:full minus typecheck & config-tests (npm script)
 *   5. lint                                             (npm script)
 *   6. npm audit --audit-level=high                     (npm)
 *
 * The npm-backed steps are delegations, not reimplementations: the matrix must
 * exercise the same scripts CI and a developer run by hand, or a green harness
 * says nothing about either. Only the TypeScript step is invoked directly,
 * because there is no root `typecheck` script and the step is defined as
 * `tsc --noEmit` per changed workspace.
 *
 * The diff-scoped steps need a base ref to compare against. One is resolved
 * automatically from `origin/dev`, `dev`, `origin/main`, `main` (in that order)
 * unless `--base <ref>` overrides it. With no base — or a clean tree — the
 * harness falls back to the safest reading: typecheck every workspace, and let
 * `static-checks` read the working tree.
 *
 * Usage:
 *   node scripts/validate.mjs                       # full matrix
 *   node scripts/validate.mjs --list                # show steps, run nothing
 *   node scripts/validate.mjs --only static-checks  # one step
 *   node scripts/validate.mjs --skip test:api,lint  # all but two
 *   node scripts/validate.mjs --skip-audit          # skip the registry call
 *   node scripts/validate.mjs --base main           # explicit diff base
 *
 * Flags: --help/-h, --list, --only <ids>, --skip <ids>, --skip-audit,
 * --base <ref>. Step ids are the labels in `--list`.
 *
 * Exit codes: 0 pass, 1 a step failed, 2 usage error (bad flag or step id).
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';
const require = createRequire(import.meta.url);

/** `npm.cmd` is only reachable through a shell on Windows. */
const NPM = { command: WIN ? 'npm.cmd' : 'npm', shell: WIN };

// ------------------------------------------------------------------- process

/**
 * Runs a command with its output streamed live (the suites take minutes; a
 * silent wait is indistinguishable from a hang) while accumulating it for the
 * end-of-run report.
 */
function runStreaming(command, args, { shell = false, cwd = ROOT } = {}) {
  // A `shell: true` spawn that is handed an args array is deprecated (DEP0190),
  // so fold the command line into a single string instead; nothing here carries
  // a character the shell would reinterpret.
  const line = shell ? [command, ...args].join(' ') : command;
  const spawnArgs = shell ? [] : args;
  return new Promise((resolveRun) => {
    let output = '';
    const child = spawn(line, spawnArgs, { cwd, shell, env: process.env, windowsHide: true });

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
function npmStep(script, extraArgs = []) {
  const args = ['run', script];
  if (extraArgs.length > 0) args.push('--', ...extraArgs);
  return () => runStreaming(NPM.command, args, { shell: NPM.shell });
}

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
async function selectTypecheckProjects(base) {
  if (!base) return TYPECHECK_PROJECTS;
  const changed = await changedFiles(base);
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
 * Step bodies receive the run context ({ base, projects }) and return
 * `{ code, output }`. `code === 0` is the only pass.
 */
function buildSteps() {
  const staticArgs = ['--full', '--skip', 'typecheck,config-tests'];

  return [
    { id: 'build', title: 'Build workspace packages', run: npmStep('build:packages') },
    { id: 'test:client', title: 'Unit suite — client', run: npmStep('test:client') },
    { id: 'test:api', title: 'Unit suite — api', run: npmStep('test:api') },
    {
      id: 'test:packages:api',
      title: 'Unit suite — packages/api',
      run: npmStep('test:packages:api'),
    },
    {
      id: 'test:packages:client',
      title: 'Unit suite — packages/client',
      run: npmStep('test:packages:client'),
    },
    {
      id: 'test:packages:data-provider',
      title: 'Unit suite — packages/data-provider',
      run: npmStep('test:packages:data-provider'),
    },
    {
      id: 'test:packages:data-schemas',
      title: 'Unit suite — packages/data-schemas',
      run: npmStep('test:packages:data-schemas'),
    },
    { id: 'test:config', title: 'Unit suite — config', run: npmStep('test:config') },
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
      // `--audit-level=high` makes the exit code fail on high/critical only.
      run: () => runStreaming(NPM.command, ['audit', '--audit-level=high'], { shell: NPM.shell }),
    },
  ];
}

// ------------------------------------------------------------------- options

const HELP = `Release validation harness (NEXTROUND.md P8).

Runs the full release matrix in order, stops at the first failure, and prints a
pass/fail summary for every step.

Usage:
  node scripts/validate.mjs [options]

Options:
  --only <ids>     Run only these step ids (comma-separated).
  --skip <ids>     Run everything except these step ids (comma-separated).
  --skip-audit     Shorthand for --skip audit (no registry call).
  --base <ref>     Diff base for the typecheck and static-checks steps.
                   Auto-detected from origin/dev, dev, origin/main, main.
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
  9. typecheck                   tsc --noEmit in each changed workspace
 10. static-checks               npm run static-checks:full (minus typecheck/config-tests)
 11. lint                        npm run lint
 12. audit                       npm audit --audit-level=high

Examples:
  node scripts/validate.mjs --list
  node scripts/validate.mjs --only static-checks,lint --base main
  node scripts/validate.mjs --skip-audit
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
      case '--only':
        options.only.push(...parseList(value()));
        break;
      case '--skip':
        options.skip.push(...parseList(value()));
        break;
      case '--base':
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
const TITLE_WIDTH = 40;

function report(mark, id, title, detail) {
  const label = `${mark} ${id}`.padEnd(ID_WIDTH);
  console.log(`  ${label}${title.padEnd(TITLE_WIDTH)}${detail}`);
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(HELP);
    return;
  }

  const steps = buildSteps();
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

  const selected = steps.filter((step) => {
    if (options.only.length > 0) return options.only.includes(step.id);
    return !skip.has(step.id);
  });

  if (options.list) {
    console.log('Release validation — steps (in order):');
    for (const step of steps) {
      const chosen = selected.includes(step);
      const reason = chosen ? 'selected' : skip.has(step.id) ? 'skipped' : 'not selected';
      report(chosen ? '→' : '·', step.id, step.title, reason);
    }
    return;
  }

  const base = await resolveBase(options.base);
  const projects = await selectTypecheckProjects(base);

  console.log(`Release validation — ${selected.length} step(s)`);
  console.log(
    base
      ? `Base: ${base} · typecheck projects: ${projects.length}`
      : 'No base ref — typechecking every workspace, static checks read the working tree',
  );
  console.log('');

  const results = new Map();
  let failed = null;

  for (const step of steps) {
    if (!selected.includes(step)) {
      results.set(step.id, { status: skip.has(step.id) ? 'skipped' : 'not selected' });
      continue;
    }
    if (failed) {
      results.set(step.id, { status: 'not run' });
      continue;
    }

    process.stdout.write(`\n▶ ${step.id} — ${step.title}\n`);
    const started = Date.now();
    let result;
    try {
      result = await step.run({ base, projects });
    } catch (error) {
      result = { code: 1, output: `${step.id} threw: ${error?.stack ?? error}` };
    }
    const elapsed = Date.now() - started;

    if (result.code === 0) {
      results.set(step.id, { status: 'passed', elapsed });
      process.stdout.write(`\n✓ ${step.id} passed (${seconds(elapsed)})\n`);
      continue;
    }

    failed = step.id;
    results.set(step.id, { status: 'failed', elapsed, output: result.output });
    process.stdout.write(`\n✗ ${step.id} failed (${seconds(elapsed)})\n`);
  }

  console.log('\n── Summary ─────────────────────────────────────────────');
  for (const step of steps) {
    const result = results.get(step.id) ?? { status: 'not run' };
    const mark =
      result.status === 'passed'
        ? '✓'
        : result.status === 'failed'
          ? '✗'
          : result.status === 'skipped' || result.status === 'not selected'
            ? '–'
            : '·';
    const detail =
      result.status === 'passed' || result.status === 'failed'
        ? `${result.status} · ${seconds(result.elapsed)}`
        : result.status;
    report(mark, step.id, step.title, detail);
  }

  if (failed) {
    console.log(`\nValidation FAILED at: ${failed}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nValidation passed (${selected.length} step(s)).`);
}

await main();
