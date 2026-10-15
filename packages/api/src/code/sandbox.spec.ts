import { existsSync, readFileSync } from 'node:fs';
import type {
  ManagedSandboxExecutor,
  SandboxResult,
  SandboxRunOptions,
} from './sandbox';
import {
  createSandbox,
  DEFAULT_SANDBOX_MODE,
  MANAGED_SANDBOX_ENV_ALLOWLIST,
  resolveSandboxMode,
  SandboxConfigurationError,
  SandboxExecutableNotFoundError,
} from './sandbox';

describe('sandbox', () => {
  beforeEach(() => {
    // Keep test environment isolated from parent values.
    delete process.env.MANAGED_SANDBOX_TEST_SECRET;
  });

  afterEach(() => {
    delete process.env.MANAGED_SANDBOX_TEST_SECRET;
  });

  test('managed: writes code to a temporary working directory and runs through the injected executor', async () => {
    process.env.MANAGED_SANDBOX_TEST_SECRET = 'should_not_be_forwarded';
    const captured: {
      command?: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string>;
      codeDuringRun?: string;
    } = {};
    const executor: ManagedSandboxExecutor = {
      run: jest.fn(async (command, args, options) => {
        captured.command = command;
        captured.args = [...args];
        captured.cwd = options.cwd;
        captured.env = { ...options.env };
        const codePath = args[args.length - 1];
        if (codePath) {
          captured.codeDuringRun = readFileSync(codePath, 'utf8');
        }
        return { stdout: 'ok\n', stderr: '', exitCode: 0 };
      }),
    };

    const sandbox = createSandbox({
      mode: 'managed',
      executor,
      executable: '/usr/local/bin/baanzon-sandbox',
    });
    const result = await sandbox.run('print("hi")');

    expect(result).toEqual({
      stdout: 'ok\n',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      truncated: false,
    });
    expect(captured.command).toBe('/usr/local/bin/baanzon-sandbox');
    expect(captured.args).toBeDefined();
    expect(captured.args?.[captured.args.length - 1]).toContain('librechat-managed-sandbox-');
    expect(captured.codeDuringRun).toBe('print("hi")');
    expect(captured.cwd).toBeDefined();
    expect(existsSync(captured.cwd ?? '')).toBe(false);
    const env = captured.env ?? {};
    expect(env).not.toHaveProperty('MANAGED_SANDBOX_TEST_SECRET');
    for (const key of Object.keys(env)) {
      expect(MANAGED_SANDBOX_ENV_ALLOWLIST).toContain(key);
    }
    expect((executor.run as jest.Mock).mock.calls.length).toBe(1);
  });

  test('managed: aborts the executor and reports a timeout when the run exceeds its budget', async () => {
    let aborted = false;
    const executor: ManagedSandboxExecutor = {
      run: (_command, _args, options) => {
        return new Promise((_resolve, reject) => {
          if (options.signal.aborted) {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
            return;
          }
          options.signal.addEventListener('abort', () => {
            aborted = true;
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      },
    };

    const sandbox = createSandbox({
      mode: 'managed',
      executor,
      executable: 'fake-sandbox',
      timeoutMs: 50,
    });
    const result = await sandbox.run('while True: pass', { timeoutMs: 25 });

    expect(aborted).toBe(true);
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(124);
    expect(result.stdout).toBe('');
    expect(result.truncated).toBe(false);
  });

  test('managed: truncates combined output to the configured cap', async () => {
    const executor: ManagedSandboxExecutor = {
      run: async () => ({
        stdout: 'a'.repeat(64),
        stderr: 'b'.repeat(64),
        exitCode: 0,
      }),
    };

    const sandbox = createSandbox({
      mode: 'managed',
      executor,
      executable: 'fake-sandbox',
    });
    const result = await sandbox.run('print()', { maxOutputBytes: 100 });

    expect(result.truncated).toBe(true);
    expect(result.stdout).toHaveLength(64);
    expect(result.stderr).toHaveLength(36);
    expect(Buffer.byteLength(result.stdout, 'utf8') + Buffer.byteLength(result.stderr, 'utf8')).toBe(
      100,
    );
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  test('managed: surfaces a missing deployment sandbox binary as a distinct error', async () => {
    const executor: ManagedSandboxExecutor = {
      run: async () => {
        const error = new Error('spawn fake-sandbox ENOENT') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      },
    };

    const sandbox = createSandbox({
      mode: 'managed',
      executor,
      executable: 'fake-sandbox',
    });
    await expect(sandbox.run('print()')).rejects.toBeInstanceOf(SandboxExecutableNotFoundError);
    const error = await sandbox.run('print()').catch((e) => e);
    expect(error).toBeInstanceOf(SandboxExecutableNotFoundError);
    expect(error.executable).toBe('fake-sandbox');
    expect(error.message).toContain('fake-sandbox');
  });

  test('defaults to attached mode and delegates to the injected runner', async () => {
    const attached = jest.fn(
      async (code: string, options?: SandboxRunOptions): Promise<SandboxResult> => ({
        stdout: `attached:${code}`,
        stderr: '',
        exitCode: 0,
        timedOut: false,
        truncated: false,
      }),
    );
    const executor: ManagedSandboxExecutor = {
      run: jest.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    };

    const sandbox = createSandbox({ attached, executor });
    expect(createSandbox({ attached, executor }).run).toBeDefined();
    const result = await sandbox.run('print(1)', { timeoutMs: 5 });

    expect(result.stdout).toBe('attached:print(1)');
    expect(attached).toHaveBeenCalledWith('print(1)', { timeoutMs: 5 });
    expect((executor.run as jest.Mock).mock.calls.length).toBe(0);
  });

  test('attached mode without a runner fails fast at construction', () => {
    expect(() => createSandbox()).toThrow(SandboxConfigurationError);
    expect(() => createSandbox()).toThrow(
      /Sandbox mode 'attached' requires an 'attached' runner callback/,
    );
  });

  test('resolveSandboxMode defaults unknown or absent values to attached', () => {
    expect(resolveSandboxMode(undefined)).toBe(DEFAULT_SANDBOX_MODE);
    expect(resolveSandboxMode(null)).toBe(DEFAULT_SANDBOX_MODE);
    expect(resolveSandboxMode('attached')).toBe('attached');
    expect(resolveSandboxMode('managed')).toBe('managed');
    expect(resolveSandboxMode('nonsense')).toBe(DEFAULT_SANDBOX_MODE);
  });
});
