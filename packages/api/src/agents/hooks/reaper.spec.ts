import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createReaper } from './reaper';

let base: string;

const isWindows = process.platform === 'win32';
/**
 * POSIX reaping signals a whole process group; Windows walks the tree with
 * `taskkill`. The two are different mechanisms with different observable
 * behavior, so each is asserted through a scoped block rather than one
 * cross-platform test. `describe.skip` still declares the block, so the
 * skipped coverage stays visible in the reporter.
 */
const describePosix = isWindows ? describe.skip : describe;
const describeWindows = isWindows ? describe : describe.skip;

/** `sleep 30 & wait`, or the PowerShell spelling that holds a tree open. */
const HOLDING_TREE =
  'Start-Process powershell.exe -ArgumentList "-NoLogo","-NoProfile","-Command","Start-Sleep -Seconds 30" -PassThru | Out-Null; Start-Sleep -Seconds 30';

function run(command: string): ChildProcess {
  if (isWindows) {
    /** Windows children are not detached: `taskkill /t` walks the tree by
     *  parent id, so no separate process group exists to signal. */
    return spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', command], {
      detached: false,
      stdio: 'ignore',
      env: { PATH: process.env.PATH, PATHEXT: process.env.PATHEXT },
    });
  }
  return spawn('bash', ['-c', command], {
    detached: true,
    stdio: 'ignore',
    env: { PATH: process.env.PATH },
  });
}

/**
 * Liveness only. A POSIX signal to a group leaves a zombie until it is
 * reaped, and a zombie still answers signal 0 — `/proc` is what tells the two
 * apart — so the POSIX tests check for it and the Windows tests, where the
 * tree is walked rather than signalled, do not.
 */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isGone(pid: number): boolean {
  if (!isAlive(pid)) {
    return true;
  }
  if (isWindows) {
    return false;
  }
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) === 'Z';
  } catch {
    return true;
  }
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

beforeEach(async () => {
  base = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lc-reaper-'));
});

afterEach(async () => {
  await fs.promises.rm(base, { recursive: true, force: true });
});

describe('createReaper', () => {
  /**
   * A group signal reaches every member, so the SIGTERM pass alone reaps a
   * compliant tree. Windows has no group signal: `reap()` shells out to
   * `taskkill /t` without `/f`, which asks console processes to close and is
   * ignored by them, so the tree survives that pass and only dies on the
   * forced escalation. That difference is asserted separately below.
   */
  describePosix('process-group termination (POSIX)', () => {
    test('reap terminates a compliant process tree at SIGTERM', async () => {
      const child = run('sleep 30 & wait');
      await waitFor(() => typeof child.pid === 'number');
      const rootPid = child.pid as number;
      createReaper(child, 5_000).reap();
      await waitFor(() => isGone(rootPid));
      expect(isGone(rootPid)).toBe(true);
    });

    test('escalates to SIGKILL when the tree ignores SIGTERM', async () => {
      const pidFile = path.join(base, 'stubborn.pid');
      const child = run(`trap '' TERM; echo $$ > "${pidFile}"; sleep 30`);
      await waitFor(() => fs.existsSync(pidFile));
      const rootPid = Number((await fs.promises.readFile(pidFile, 'utf8')).trim());
      createReaper(child, 200).reap();
      /** SIGTERM alone leaves the trap-protected root running. */
      expect(isGone(rootPid)).toBe(false);
      await waitFor(() => isGone(rootPid));
      expect(isGone(rootPid)).toBe(true);
    });

    test('sweep reaps a group that outlived a clean root exit', async () => {
      const pidFile = path.join(base, 'worker.pid');
      const child = run(
        `bash -c 'trap "" TERM; echo $$ > "${pidFile}"; sleep 30' >/dev/null 2>&1 & exit 0`,
      );
      const reaper = createReaper(child, 200);
      const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
      await closed;
      await waitFor(() => fs.existsSync(pidFile));
      const workerPid = Number((await fs.promises.readFile(pidFile, 'utf8')).trim());
      expect(isGone(workerPid)).toBe(false);
      reaper.sweep();
      await waitFor(() => isGone(workerPid));
      expect(isGone(workerPid)).toBe(true);
    });
  });

  describeWindows('process-tree termination (Windows)', () => {
    test('reap terminates the tree on the forced escalation pass', async () => {
      const child = run(HOLDING_TREE);
      await waitFor(() => typeof child.pid === 'number');
      const rootPid = child.pid as number;
      /**
       * `taskkill /t` without `/f` only requests a close, which a console
       * process ignores — the same "ignores the graceful pass" situation the
       * POSIX escalation test stages with a TERM trap. The `/f` escalation
       * after the grace period is what must end the tree.
       */
      createReaper(child, 200).reap();
      expect(isAlive(rootPid)).toBe(true);
      await waitFor(() => !isAlive(rootPid));
      expect(isAlive(rootPid)).toBe(false);
    });

    test('sweep cancels the escalation once the root has exited', async () => {
      const child = run('Start-Sleep -Seconds 30');
      await waitFor(() => typeof child.pid === 'number');
      const rootPid = child.pid as number;
      const reaper = createReaper(child, 50);
      child.kill();
      const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
      reaper.reap();
      await closed;
      await waitFor(() => !isAlive(rootPid));
      /**
       * `escalationTargetAlive` reports false for a Windows root that has
       * exited, so the sweep drops the armed timer rather than letting a
       * later signal land on a pid the OS may have recycled.
       */
      expect(() => reaper.sweep()).not.toThrow();
      expect(isAlive(rootPid)).toBe(false);
    });
  });
});
