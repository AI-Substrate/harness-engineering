import { spawnSync } from 'node:child_process';
import {
  constants,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';

function withTempDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'harness-bounded-read-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Can this host actually STAGE a symlink swap? Probed once, by doing it.
 *
 * Not inferred from `platform()`: the question is not "is this Windows" but "does
 * this process hold symlink privilege", and those differ — an elevated Windows box
 * or one with Developer Mode on can stage the swap, an ordinary user account cannot
 * (EPERM). Probing the capability keeps the answer true for the host we are actually
 * on rather than for the one we assumed.
 *
 * This drives the TEST NAME, so which property was proven travels into the JSON
 * reporter and any CI summary. Two greens that prove different things must not look
 * identical to someone scanning a run — that indistinguishability is the defect this
 * whole case exists to correct (plan 077 · #108).
 */
function canStageSymlinkSwap(): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'harness-symlink-probe-'));
  try {
    const target = join(dir, 'target');
    writeFileSync(target, 'x', 'utf8');
    symlinkSync(target, join(dir, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SYMLINK_SWAP_STAGEABLE = canStageSymlinkSwap();

describe('NodeFs — bounded no-follow text reads (P063 T003)', () => {
  it('probes and reads a regular file using its UTF-8 byte length', () => {
    withTempDir((dir) => {
      const path = join(dir, 'session.jsonl');
      writeFileSync(path, 'é\n', 'utf8');
      const fs = new NodeFs();

      expect(fs.probeRegularFileNoFollow(dir, path, 3)).toEqual({ status: 'ok', bytes: 3 });
      expect(fs.readTextFileNoFollow(dir, path, 3)).toEqual({
        status: 'ok',
        bytes: 3,
        text: 'é\n',
      });
    });
  });

  it('distinguishes missing, symlink, non-file, and oversize paths without following them', () => {
    withTempDir((dir) => {
      const fs = new NodeFs();
      const target = join(dir, 'target.jsonl');
      const link = join(dir, 'link.jsonl');
      const directory = join(dir, 'directory');
      const oversize = join(dir, 'oversize.jsonl');
      writeFileSync(target, '{}\n', 'utf8');
      symlinkSync(target, link);
      mkdirSync(directory);
      writeFileSync(oversize, '12345', 'utf8');

      expect(fs.probeRegularFileNoFollow(dir, join(dir, 'missing.jsonl'), 4)).toEqual({
        status: 'unavailable',
        reason: 'missing',
      });
      expect(fs.probeRegularFileNoFollow(dir, link, 4)).toEqual({
        status: 'unavailable',
        reason: 'symlink',
      });
      expect(fs.readTextFileNoFollow(dir, link, 4)).toEqual({
        status: 'unavailable',
        reason: 'symlink',
      });
      expect(fs.probeRegularFileNoFollow(dir, directory, 4)).toEqual({
        status: 'unavailable',
        reason: 'non-file',
      });
      expect(fs.readTextFileNoFollow(dir, directory, 4)).toEqual({
        status: 'unavailable',
        reason: 'non-file',
      });
      expect(fs.probeRegularFileNoFollow(dir, oversize, 4)).toEqual({
        status: 'unavailable',
        reason: 'oversize',
      });
    });
  });

  it('rejects a sparse oversized file from metadata before content allocation', () => {
    withTempDir((dir) => {
      const path = join(dir, 'sparse.jsonl');
      writeFileSync(path, '', 'utf8');
      truncateSync(path, 3 * 1024 * 1024 * 1024);

      expect(new NodeFs().readTextFileNoFollow(dir, path, 1024)).toEqual({
        status: 'unavailable',
        reason: 'oversize',
      });
    });
  });

  it('rejects a regular transcript reached through an ancestor symlink outside its root', () => {
    withTempDir((dir) => {
      const root = join(dir, 'selected-root');
      const outside = join(dir, 'outside');
      const projects = join(root, 'projects');
      mkdirSync(root);
      mkdirSync(outside);
      writeFileSync(join(outside, 'session.jsonl'), '{}\n', 'utf8');
      symlinkSync(outside, projects, 'dir');
      const path = join(projects, 'session.jsonl');
      const fs = new NodeFs();

      expect(fs.probeRegularFileNoFollow(root, path, 16)).toEqual({
        status: 'unavailable',
        reason: 'symlink',
      });
      expect(fs.readTextFileNoFollow(root, path, 16)).toEqual({
        status: 'unavailable',
        reason: 'symlink',
      });
    });
  });

  it('rejects every symlink component even when its target remains inside the root', () => {
    withTempDir((dir) => {
      const root = join(dir, 'selected-root');
      const targetDir = join(root, 'other-project');
      const projects = join(root, 'projects');
      mkdirSync(targetDir, { recursive: true });
      writeFileSync(join(targetDir, 'session.jsonl'), '{}\n', 'utf8');
      symlinkSync(targetDir, projects, 'dir');
      const path = join(projects, 'session.jsonl');

      expect(new NodeFs().readTextFileNoFollow(root, path, 16)).toEqual({
        status: 'unavailable',
        reason: 'symlink',
      });
    });
  });

  it('reads without the flag when the platform has no no-follow open flag', () => {
    // CONTRACT CHANGED BY DECISION (plan 077 · #108), not by accident.
    //
    // This case previously asserted the opposite: with no `O_NOFOLLOW` the read
    // failed closed with `io-error`, refusing to open anything. That was
    // deliberate — but `fs.constants.O_NOFOLLOW` does not exist on Windows, so the
    // consequence was that this primitive could never read ANY file there, and
    // every consumer of it (`claude-adapter`, `copilot-adapter`,
    // `copilot-vscode-adapter`) was silently blind on that platform: null
    // capabilities, empty file lists, three red suites on the Windows runner.
    //
    // The fail-closed was consciously RELAXED, because the alternative was not a
    // stronger guarantee — it was a feature that did not work at all. What carries
    // the protection instead is the `dev`/`ino` cross-check, and the two controls
    // below are what make that claim checkable rather than asserted.
    withTempDir((dir) => {
      const path = join(dir, 'session.jsonl');
      writeFileSync(path, '{}\n', 'utf8');

      expect(new NodeFs(null).readTextFileNoFollow(dir, path, 16)).toEqual({
        status: 'ok',
        bytes: 3,
        text: '{}\n',
      });
    });
  });

  it(
    SYMLINK_SWAP_STAGEABLE
      ? 'WITHOUT the flag, refuses a FOLLOWED symlink swapped in before the open [FULL PROPERTY — swap staged, symlink privilege present]'
      : 'WITHOUT the flag, refuses the read when a symlink swap CANNOT BE STAGED [WEAKER PROPERTY ONLY — no symlink privilege; the followed-symlink property is NOT proven on this host]',
    () => {
      // THE LOAD-BEARING CONTROL for the relaxation above — and it is only load-bearing
      // WHERE IT CAN ACTUALLY STAGE THE SWAP. That caveat is the whole reason this case
      // is shaped the way it is (plan 077 · #108, found by the downstream consumer on an
      // unelevated Windows box with Developer Mode disabled).
      //
      // `symlinkSync` REQUIRES PRIVILEGE ON WINDOWS. Unelevated it throws EPERM, so the
      // hook below never creates a symlink and there is nothing to follow. Previously the
      // hook let that EPERM escape, which the adapter caught and mapped to `io-error` —
      // so the case failed on the staging step while LOOKING like a failure of the
      // property under test, and vitest's truncation printed `unavailable` against
      // `unavailable`, disguising it further.
      //
      // The trap that matters is the other direction: on a PRIVILEGED box — our CI runner
      // — the swap stages, the case passes, and nothing anywhere reports that the same
      // case is incapable of running on the machines the relaxation was made for. A
      // control that depends on privilege passes where privilege exists and cannot run
      // where it does not, which makes the runner blindest exactly where this security
      // relaxation needs the most proof. A `skipIf` would have bought the same silence in
      // a different coat: green here, mute there.
      //
      // So the case DETECTS whether it could stage, and reports what it actually proved:
      // the full property where the swap is real, and the weaker property that still
      // holds where it is not. `reason` is never the only signal — **the attacker's bytes
      // being absent is the property that matters**, and that is asserted on every path.
      withTempDir((dir) => {
        const path = join(dir, 'session.jsonl');
        const target = join(dir, 'target.jsonl');
        writeFileSync(path, 'safe\n', 'utf8');
        writeFileSync(target, 'attacker\n', 'utf8');

        let staged = false;
        let stagingRefusal = '';
        const fs = new NodeFs(null, () => {
          rmSync(path);
          try {
            symlinkSync(target, path);
            staged = true;
          } catch (error) {
            // SWALLOWED DELIBERATELY. Letting it escape would surface as `io-error`
            // from the adapter's catch and be indistinguishable from a real refusal.
            stagingRefusal = (error as NodeJS.ErrnoException).code ?? String(error);
          }
        });

        const result = fs.readTextFileNoFollow(dir, path, 32);

        // The NAME above came from the capability probe; `staged` is what actually
        // happened. If those ever disagree the row is MISLABELLED — a green whose name
        // claims a property it did not prove, which is precisely the failure this case
        // exists to correct. Assert they agree rather than let a lying name pass.
        expect(
          staged,
          'the symlink capability probe and the actual staging disagree — the test name is lying about which property was proven',
        ).toBe(SYMLINK_SWAP_STAGEABLE);

        // TRUE ON EVERY PLATFORM, staged or not, and the one that actually matters.
        expect(result.status, 'the read must be refused, however the swap resolved').toBe(
          'unavailable',
        );
        expect(
          JSON.stringify(result),
          "the attacker's bytes must never reach the caller",
        ).not.toContain('attacker');

        if (staged) {
          // The swap was real: the open FOLLOWED the symlink, so only the post-open
          // re-`lstat` refused it. This is the branch that proves the relaxation.
          expect(result).toEqual({ status: 'unavailable', reason: 'symlink' });
        } else {
          // Could not stage. Say so loudly rather than pass quietly: this row proved
          // only "a vanished path is refused", NOT that a followed symlink is caught.
          expect(
            { proved: 'refusal-only', symlinkPrivilege: false, stagingRefusal },
            `SYMLINK SWAP NOT STAGED (${stagingRefusal}) — no symlink privilege on this host, so this row does NOT prove the post-open re-lstat catches a followed symlink. It proves only that the read is refused and no foreign bytes are returned. On such a host the sibling case ('refuses a regular file swapped in before the open', which needs no privilege) is the ONLY half of the O_NOFOLLOW relaxation actually proven.`,
          ).toMatchObject({ proved: 'refusal-only' });
        }
      });
    },
  );

  it('WITHOUT the flag, still refuses a regular file swapped in before the open', () => {
    // The sibling swap: not a symlink, a different REGULAR file. `O_NOFOLLOW` never
    // caught this one — `dev`/`ino` always did — so this pins that the identity
    // check is independent of the flag rather than incidental to it.
    //
    // It needs NO PRIVILEGE, which makes it the load-bearing one on the platform this
    // whole relaxation was made for: on an unelevated Windows box, where the symlink
    // case above cannot stage its swap, THIS is the only half of the relaxation that is
    // actually proven. Measured by the downstream consumer at 93ms there. Do not let it
    // acquire a privileged dependency.
    withTempDir((dir) => {
      const path = join(dir, 'session.jsonl');
      const replacement = join(dir, 'replacement.jsonl');
      writeFileSync(path, 'safe\n', 'utf8');
      writeFileSync(replacement, 'replacement\n', 'utf8');
      const fs = new NodeFs(null, () => renameSync(replacement, path));

      const result = fs.readTextFileNoFollow(dir, path, 32);
      expect(result).toEqual({ status: 'unavailable', reason: 'io-error' });
      expect(JSON.stringify(result), 'the swapped file\u2019s bytes must not leak').not.toContain(
        'replacement',
      );
    });
  });

  it.skipIf(platform() === 'win32')('classifies a FIFO without blocking', () => {
    withTempDir((dir) => {
      const path = join(dir, 'session.fifo');
      const made = spawnSync('mkfifo', [path]);
      expect(made.status).toBe(0);

      expect(new NodeFs().readTextFileNoFollow(dir, path, 16)).toEqual({
        status: 'unavailable',
        reason: 'non-file',
      });
    });
  });

  it('rejects a file swapped between resolution and opened-handle validation', () => {
    withTempDir((dir) => {
      const path = join(dir, 'session.jsonl');
      const replacement = join(dir, 'replacement.jsonl');
      writeFileSync(path, 'safe\n', 'utf8');
      writeFileSync(replacement, 'replacement\n', 'utf8');
      const fs = new NodeFs(constants.O_NOFOLLOW, () => renameSync(replacement, path));

      expect(fs.readTextFileNoFollow(dir, path, 32)).toEqual({
        status: 'unavailable',
        reason: 'io-error',
      });
    });
  });
});
