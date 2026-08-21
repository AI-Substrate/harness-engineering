import { spawnSync } from 'node:child_process';
import {
  constants,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { provenLabel, SYMLINK_CAPABLE, trySymlink } from '../../support/symlink-capability.js';

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
// ONE probe for the whole suite, and one convention for what to do about it —
// see `test/support/symlink-capability.ts`, which encodes the degrade-not-skip
// rule this very case argued for. The local copy that used to live here was the
// first of three; three copies of a capability answer is how two of them drift.
const SYMLINK_SWAP_STAGEABLE = SYMLINK_CAPABLE;

// Declared to STDERR, not only to the reporter, following the same pattern the
// win32 skip declarations in `exec-remote-telemetry-git.int.test.ts` use.
//
// The test name below already differs by which property was proven, which reaches
// the JSON reporter — but vitest's DEFAULT reporter does not print the names of
// PASSING tests, so on a run where nothing fails the distinction never appears in
// the log a human actually scans. It would sit in an artifact nobody downloads.
// Asymmetric on purpose: silence means the full property was proven, and this line
// means it was not, so a reader does not have to know the convention to notice the
// weaker one.
if (!SYMLINK_SWAP_STAGEABLE) {
  console.warn(
    'WEAKER PROPERTY ONLY — this host cannot create symlinks (no privilege; on Windows that means unelevated with Developer Mode off), so the no-follow control CANNOT stage its swap and does NOT prove that the post-open re-lstat catches a FOLLOWED symlink. What it still proves here: the read is refused and no foreign bytes reach the caller. On this host the regular-file swap case — which needs no privilege — is the ONLY half of the O_NOFOLLOW relaxation actually proven. A privileged host (our CI runner) proves the full property; that is where it is covered, and it is NOT covered here.',
  );
}

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

  it(
    provenLabel(
      'distinguishes missing, symlink, non-file, and oversize paths without following them',
      'distinguishes missing, non-file and oversize paths — the SYMLINK reason is NOT proven here',
    ),
    () => {
      withTempDir((dir) => {
        const fs = new NodeFs();
        const target = join(dir, 'target.jsonl');
        const link = join(dir, 'link.jsonl');
        const directory = join(dir, 'directory');
        const oversize = join(dir, 'oversize.jsonl');
        writeFileSync(target, '{}\n', 'utf8');
        // DEGRADES RATHER THAN DIES. Three of the four classifications need no
        // privilege; only `symlink` does. Staging failure used to take the whole row
        // down with an EPERM that looked like a product fault.
        const linked = trySymlink(target, link);
        mkdirSync(directory);
        writeFileSync(oversize, '12345', 'utf8');

        expect(fs.probeRegularFileNoFollow(dir, join(dir, 'missing.jsonl'), 4)).toEqual({
          status: 'unavailable',
          reason: 'missing',
        });
        if (linked) {
          expect(fs.probeRegularFileNoFollow(dir, link, 4)).toEqual({
            status: 'unavailable',
            reason: 'symlink',
          });
          expect(fs.readTextFileNoFollow(dir, link, 4)).toEqual({
            status: 'unavailable',
            reason: 'symlink',
          });
        }
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
    },
  );

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

  it(
    provenLabel(
      'rejects a regular transcript reached through an ancestor symlink outside its root',
      'rejects an out-of-root transcript — reached DIRECTLY, not through an ancestor symlink',
    ),
    () => {
      /*
       * DEGRADES, NEVER SKIPS — this is an exfiltration guard (CWE-59), and a
       * skipped security case proves nothing on the one platform nobody runs
       * locally.
       *
       * THE PROPERTY THAT MATTERS IS ASSERTED ON EVERY PATH: the ATTACKER'S BYTES
       * ARE NEVER RETURNED. `reason` is the richer signal and it is only available
       * where the ancestor symlink could actually be staged; the refusal itself,
       * and the absence of the outside file's contents, hold either way.
       */
      withTempDir((dir) => {
        const root = join(dir, 'selected-root');
        const outside = join(dir, 'outside');
        const projects = join(root, 'projects');
        mkdirSync(root);
        mkdirSync(outside);
        writeFileSync(join(outside, 'session.jsonl'), 'ATTACKER-BYTES\n', 'utf8');
        const staged = trySymlink(outside, projects, 'dir');
        // Where the ancestor symlink cannot be staged, the same OUTSIDE file is
        // reached by its real path: still out of root, still must be refused. That
        // is a weaker claim about HOW the escape was attempted, and the identical
        // claim about what came back.
        const path = staged ? join(projects, 'session.jsonl') : join(outside, 'session.jsonl');
        const fs = new NodeFs();

        const probed = fs.probeRegularFileNoFollow(root, path, 16);
        const read = fs.readTextFileNoFollow(root, path, 16);

        // TRUE ON EVERY PATH, staged or not, and the one that actually matters.
        expect(probed.status, 'an out-of-root transcript must be refused').toBe('unavailable');
        expect(read.status, 'an out-of-root transcript must be refused').toBe('unavailable');
        expect(JSON.stringify(read)).not.toContain('ATTACKER-BYTES');

        // The richer claim, only where the escape could actually be constructed.
        if (staged) {
          expect(probed).toEqual({ status: 'unavailable', reason: 'symlink' });
          expect(read).toEqual({ status: 'unavailable', reason: 'symlink' });
        }
      });
    },
  );

  it(
    provenLabel(
      'rejects every symlink component even when its target remains inside the root',
      'reads a plain in-root transcript — the INSIDE-THE-ROOT SYMLINK refusal is NOT proven here',
    ),
    () => {
      /*
       * THE ONE ROW WHOSE FULL PROPERTY IS GENUINELY ALL-OR-NOTHING, stated plainly
       * rather than disguised. Its subject is that a symlink component is refused
       * EVEN WHEN containment would have permitted it — so with no symlink there is
       * no weaker version of that claim: a plain in-root path is *supposed* to be
       * read, and asserting that proves nothing about the guard.
       *
       * What the degraded run still earns is a CONTROL: the same fixture minus the
       * symlink reads OK. That is what distinguishes "the guard did not fire because
       * there was nothing to fire on" from "this primitive cannot read anything on
       * this platform" — a real failure mode here, since `O_NOFOLLOW` does not exist
       * on Windows (see the flagless case below). The name says which one ran.
       */
      withTempDir((dir) => {
        const root = join(dir, 'selected-root');
        const targetDir = join(root, 'other-project');
        const projects = join(root, 'projects');
        mkdirSync(targetDir, { recursive: true });
        writeFileSync(join(targetDir, 'session.jsonl'), '{}\n', 'utf8');
        const staged = trySymlink(targetDir, projects, 'dir');

        if (staged) {
          expect(
            new NodeFs().readTextFileNoFollow(root, join(projects, 'session.jsonl'), 16),
          ).toEqual({ status: 'unavailable', reason: 'symlink' });
          return;
        }

        // The control described above: no symlink, so the read must SUCCEED.
        expect(
          new NodeFs().readTextFileNoFollow(root, join(targetDir, 'session.jsonl'), 16).status,
          'without a symlink to refuse, an in-root transcript must still be readable',
        ).toBe('ok');
      });
    },
  );

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
          // ONE staging mechanism, shared with the probe (plan 083). This used to
          // call `symlinkSync` directly while the probe above answered from
          // `test/support/symlink-capability.ts` — two mechanisms answering one
          // question, which is exactly what the assertion below exists to catch, so
          // they must not be able to disagree for a reason other than the host.
          // `trySymlink` swallows the error deliberately: letting it escape would
          // surface as `io-error` from the adapter's catch and be indistinguishable
          // from a real refusal.
          staged = trySymlink(target, path);
          if (!staged) stagingRefusal = 'EPERM';
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
