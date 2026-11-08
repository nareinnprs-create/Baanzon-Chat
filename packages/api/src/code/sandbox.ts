import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

/**
 * Code-execution sandbox capability.
 *
 * Two modes share one `Sandbox` seam:
 *
 * - `attached` (default) delegates to the existing attached execution path —
 *   the Code API / paired-worker bridge that `executeWorkspaceTool` and the
 *   programmatic Bash tool already use — through a caller-supplied callback.
 *   This module owns no part of that path; it only forwards `run` to it.
 * - `managed` runs code through a deployment-supplied sandbox binary. This
 *   module creates a fresh working directory, writes the code to a file inside
 *   it, invokes the injected executor, enforces a timeout by aborting the run,
 *   caps output, and passes only an allowlisted environment.
 *
 * `managed` does NOT contain the code. Kernel-level isolation — namespaces,
 * seccomp, gVisor, a microVM, whatever the operator chose — is provided by the
 * executable the deployment supplies, and only that binary can be trusted for
 * containment. This JavaScript layer is a convenience and resource-bounding
 * wrapper around it: it bounds time, output, environment and where the code is
 * written, nothing more.
 */

/** Selects the execution capability. Mirrors `sandbox.mode` in the config schema. */
export type SandboxMode = 'attached' | 'managed';

/** Default mode; reproduces the pre-existing attached behavior when unset. */
export const DEFAULT_SANDBOX_MODE: SandboxMode = 'attached';

const MANAGED_DEFAULT_CODE_FILE_NAME = 'main.py';
const MANAGED_DEFAULT_TIMEOUT_MS = 30_000;
const MANAGED_MAX_TIMEOUT_MS = 5 * 60_000;
const MANAGED_DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;
const MANAGED_MAX_OUTPUT_BYTES = 1024 * 1024;
/** Conventions borrowed from coreutils `timeout` so callers can branch on it. */
const MANAGED_TIMEOUT_EXIT_CODE = 124;
const MANAGED_WORKDIR_PREFIX = 'librechat-managed-sandbox-';

/**
 * Environment forwarded to the managed sandbox. Everything else — tokens,
 * connection strings, provider keys — is withheld; the deployment binary may
 * set its own environment beyond this.
 */
export const MANAGED_SANDBOX_ENV_ALLOWLIST: readonly string[] = ['PATH', 'LANG', 'LC_ALL', 'TZ'];

/** Execution options passed to a {@link ManagedSandboxExecutor}. */
export interface ManagedSandboxExecutorOptions {
  /** Working directory created for this run; removed afterwards. */
  cwd: string;
  /** Environment restricted to the allowlist. */
  env: Record<string, string>;
  /** Aborted when the run exceeds its timeout or the caller cancels. */
  signal: AbortSignal;
}

/** Result of a single managed process invocation. */
export interface ManagedSandboxExecutorResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Injected process executor. The shape mirrors `child_process.execFile` (a
 * program plus argv) so a deployment can back it with an `nsjail`/`gVisor`
 * `runsc` binary wrapper without this module depending on a process library.
 */
export interface ManagedSandboxExecutor {
  run(
    command: string,
    args: string[],
    options: ManagedSandboxExecutorOptions,
  ): Promise<ManagedSandboxExecutorResult>;
}

/** Per-run bounds, resolved against the factory defaults. */
export interface SandboxRunOptions {
  /** Wall-clock budget in milliseconds before the executor is aborted. */
  timeoutMs?: number;
  /** Cap on combined `stdout` + `stderr` byte length. */
  maxOutputBytes?: number;
  /** Caller cancellation; aborting rejects `run` with the caller's reason. */
  signal?: AbortSignal;
}

/** Normalized result returned by every sandbox mode. */
export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  truncated: boolean;
}

/** Runs code through the existing attached execution path. */
export type AttachedSandboxRunner = (
  code: string,
  options?: SandboxRunOptions,
) => Promise<SandboxResult>;

/** The injected seam both modes satisfy. */
export interface Sandbox {
  run(code: string, options?: SandboxRunOptions): Promise<SandboxResult>;
}

export interface CreateSandboxOptions {
  /** Defaults to {@link DEFAULT_SANDBOX_MODE} (`attached`). */
  mode?: SandboxMode;
  /** Existing attached runner. Required for `attached` mode. */
  attached?: AttachedSandboxRunner;
  /** Process executor. Required for `managed` mode. */
  executor?: ManagedSandboxExecutor;
  /** Deployment-supplied sandbox binary. Required for `managed` mode. */
  executable?: string;
  /** Fixed arguments placed before the code file path. */
  args?: readonly string[];
  /** Code file name written inside the per-run working directory. */
  codeFileName?: string;
  /** Base directory for per-run working directories. Defaults to the OS temp dir. */
  cwdRoot?: string;
  /** Factory default timeout; overridable per run. */
  timeoutMs?: number;
  /** Factory default combined output cap; overridable per run. */
  maxOutputBytes?: number;
  /** Environment keys forwarded to the sandbox. Defaults to the built-in allowlist. */
  envAllowlist?: readonly string[];
}

export class SandboxConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxConfigurationError';
  }
}

export class SandboxExecutableNotFoundError extends Error {
  constructor(
    public readonly executable: string,
    public readonly originalError?: unknown,
  ) {
    super(
      `Managed sandbox executable "${executable}" was not found; the deployment must provide the sandbox binary.`,
    );
    this.name = 'SandboxExecutableNotFoundError';
  }
}

/**
 * Config-side default resolver. Mirrors `sandbox.mode` in
 * `librechat-data-provider`'s `configSchema`: anything that is not the literal
 * `managed` keeps today's attached behavior.
 */
export function resolveSandboxMode(mode: unknown): SandboxMode {
  return mode === 'managed' ? 'managed' : DEFAULT_SANDBOX_MODE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null;
}

function resolveTimeout(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new RangeError('sandbox timeoutMs must be a positive integer');
  }
  if (value > MANAGED_MAX_TIMEOUT_MS) {
    throw new RangeError(`sandbox timeoutMs must not exceed ${MANAGED_MAX_TIMEOUT_MS}`);
  }
  return value;
}

function resolveMaxOutputBytes(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new RangeError('sandbox maxOutputBytes must be a positive integer');
  }
  if (value > MANAGED_MAX_OUTPUT_BYTES) {
    throw new RangeError(`sandbox maxOutputBytes must not exceed ${MANAGED_MAX_OUTPUT_BYTES}`);
  }
  return value;
}

/** Cuts a string to at most `maxBytes` UTF-8 bytes; a split multi-byte character is replaced. */
function truncateToBytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  return Buffer.from(value, 'utf8').subarray(0, maxBytes).toString('utf8');
}

/**
 * Caps the combined `stdout` + `stderr` byte length at `maxOutputBytes`, in
 * that priority order: `stdout` is kept first and `stderr` receives the
 * remainder, so a run that floods stdout drops diagnostics before payload.
 */
function capOutput(
  stdout: string,
  stderr: string,
  maxOutputBytes: number,
): Pick<SandboxResult, 'stdout' | 'stderr' | 'truncated'> {
  const stdoutBytes = Buffer.byteLength(stdout, 'utf8');
  if (stdoutBytes > maxOutputBytes) {
    return { stdout: truncateToBytes(stdout, maxOutputBytes), stderr: '', truncated: true };
  }
  const stderrBytes = Buffer.byteLength(stderr, 'utf8');
  if (stdoutBytes + stderrBytes <= maxOutputBytes) {
    return { stdout, stderr, truncated: false };
  }
  return {
    stdout,
    stderr: truncateToBytes(stderr, maxOutputBytes - stdoutBytes),
    truncated: true,
  };
}

function buildSandboxEnv(allowlist: readonly string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of allowlist) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function isExecutableMissingError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

function isSafeCodeFileName(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 255 &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('\0') &&
    !value.includes('/') &&
    !value.includes('\\') &&
    basename(value) === value
  );
}

function createManagedSandbox({
  executor,
  executable,
  args,
  codeFileName,
  cwdRoot,
  timeoutMs,
  maxOutputBytes,
  envAllowlist,
}: CreateSandboxOptions): Sandbox {
  if (executor == null) {
    throw new SandboxConfigurationError("Sandbox mode 'managed' requires an 'executor'");
  }
  if (executable == null || executable.trim().length === 0) {
    throw new SandboxConfigurationError("Sandbox mode 'managed' requires a non-empty 'executable'");
  }
  const resolvedCodeFileName = codeFileName ?? MANAGED_DEFAULT_CODE_FILE_NAME;
  if (!isSafeCodeFileName(resolvedCodeFileName)) {
    throw new SandboxConfigurationError('Sandbox codeFileName must be a plain file name');
  }
  const resolvedArgs = [...(args ?? [])];
  const resolvedCwdRoot = cwdRoot ?? tmpdir();
  const resolvedEnvAllowlist = envAllowlist ?? MANAGED_SANDBOX_ENV_ALLOWLIST;
  const defaultTimeoutMs = resolveTimeout(timeoutMs, MANAGED_DEFAULT_TIMEOUT_MS);
  const defaultMaxOutputBytes = resolveMaxOutputBytes(
    maxOutputBytes,
    MANAGED_DEFAULT_MAX_OUTPUT_BYTES,
  );

  const timeoutResult = (timeout: number): SandboxResult => ({
    stdout: '',
    stderr: `Managed sandbox timed out after ${timeout}ms`,
    exitCode: MANAGED_TIMEOUT_EXIT_CODE,
    timedOut: true,
    truncated: false,
  });

  return {
    async run(code: string, options: SandboxRunOptions = {}): Promise<SandboxResult> {
      options.signal?.throwIfAborted();
      const timeout = resolveTimeout(options.timeoutMs, defaultTimeoutMs);
      const maxBytes = resolveMaxOutputBytes(options.maxOutputBytes, defaultMaxOutputBytes);

      const workdir = await mkdtemp(join(resolvedCwdRoot, MANAGED_WORKDIR_PREFIX));
      const codePath = join(workdir, resolvedCodeFileName);
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error(`Managed sandbox timed out after ${timeout}ms`));
      }, timeout);
      const onExternalAbort = (): void => controller.abort(options.signal?.reason);
      options.signal?.addEventListener('abort', onExternalAbort, { once: true });

      try {
        await writeFile(codePath, code, { encoding: 'utf8', mode: 0o600 });
        const result = await executor.run(executable, [...resolvedArgs, codePath], {
          cwd: workdir,
          env: buildSandboxEnv(resolvedEnvAllowlist),
          signal: controller.signal,
        });
        if (timedOut) return timeoutResult(timeout);
        const capped = capOutput(result.stdout, result.stderr, maxBytes);
        return { ...capped, exitCode: result.exitCode, timedOut: false };
      } catch (error) {
        if (timedOut) return timeoutResult(timeout);
        if (options.signal?.aborted === true) {
          throw options.signal.reason ?? error;
        }
        if (isExecutableMissingError(error)) {
          throw new SandboxExecutableNotFoundError(executable, error);
        }
        throw error;
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onExternalAbort);
        await rm(workdir, { recursive: true, force: true });
      }
    },
  };
}

/**
 * Builds a {@link Sandbox}. `attached` (the default) requires an `attached`
 * callback and delegates straight to it; `managed` requires an `executor` and
 * the deployment `executable`. Every dependency is injected, so the caller
 * chooses and can test both modes.
 */
export function createSandbox(options: CreateSandboxOptions = {}): Sandbox {
  if ((options.mode ?? DEFAULT_SANDBOX_MODE) === 'managed') {
    return createManagedSandbox(options);
  }
  const { attached } = options;
  if (attached == null) {
    throw new SandboxConfigurationError(
      "Sandbox mode 'attached' requires an 'attached' runner callback",
    );
  }
  return {
    run(code: string, runOptions?: SandboxRunOptions): Promise<SandboxResult> {
      return attached(code, runOptions);
    },
  };
}
