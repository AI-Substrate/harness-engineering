import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canRunShellScript, hasBinary, incapableBinaryReason } from './external-binary.js';

/**
 * The regression control for a defect THIS SUITE SHIPPED (plan 077 · tk-0103).
 *
 * PR #118 guarded `post-commit-hook.test.ts` on `hasBinary('bash')`. The
 * downstream consumer of #108 then ran it on Windows, where `bash` resolves to
 * `C:\Windows\system32\bash.exe` — WSL bash, a Linux binary. It answered
 * `--version` fine, so the guard passed; it then ate the backslashes in the
 * Windows temp path and exited 127, and the file stayed red.
 *
 * That is the failure mode worth a permanent test, and it is not "a guard was
 * missing". It is that a guard which reports PRESENCE while the caller needs
 * CAPABILITY is worse than no guard at all: the red gets read as handled.
 *
 * So these cases build a shell that is deliberately PRESENT-BUT-INCAPABLE — the
 * WSL shape, reduced to its essentials — and assert that the two probes DISAGREE
 * about it. If someone ever "simplifies" `canRunShellScript` back into a `which`,
 * this is what fails.
 */

let root: string;
/** A fake shell: answers `--version` like a healthy binary, runs nothing. */
let liar: string;
/** A fake shell that genuinely executes the script it is handed. */
let honest: string;

/** POSIX-only: these fixtures rely on shebang+mode-bit execution. */
const POSIX = process.platform !== 'win32';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'harness-probe-control-'));
  mkdirSync(root, { recursive: true });

  liar = join(root, 'liar-shell');
  writeFileSync(
    liar,
    // Exit 0 for `--version`, 127 for anything else — `command not found`,
    // exactly what WSL bash returns for a mangled Windows path.
    '#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then echo "liar 1.0"; exit 0; fi\nexit 127\n',
  );
  chmodSync(liar, 0o755);

  honest = join(root, 'honest-shell');
  writeFileSync(
    honest,
    '#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then echo "honest 1.0"; exit 0; fi\nexec bash "$@"\n',
  );
  chmodSync(honest, 0o755);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!POSIX)('external-binary probes — presence is not capability (tk-0103)', () => {
  it('the OLD probe passes a shell that cannot run a script — the shipped defect, reproduced', () => {
    // Non-vacuous by construction: if this ever goes false the case below proves
    // nothing, because the two probes would agree for the boring reason.
    expect(hasBinary(liar)).toBe(true);
  });

  it('the CAPABILITY probe fails that same shell — the two disagree, and that is the point', () => {
    expect(canRunShellScript(liar)).toBe(false);
  });

  it('and it still says YES to a shell that genuinely works (not merely strict)', () => {
    // The positive control. A probe that answered "no" to everything would make
    // every case above pass while skipping the entire suite on every host.
    expect(canRunShellScript(honest)).toBe(true);
  });

  it('it proves PATH resolution too, not only that the script was found', () => {
    // The second half of the consumer's finding: `which node` inside WSL bash
    // also failed, so even a correctly-passed path would have died at the hook's
    // `node "$bin"` line. A shell handed an unusable PATH must read as incapable.
    const blind = join(root, 'blind-shell');
    writeFileSync(
      blind,
      // Runs the script, but with PATH emptied — the shim becomes unresolvable.
      '#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then exit 0; fi\nPATH=/nonexistent exec bash "$@"\n',
    );
    chmodSync(blind, 0o755);

    expect(hasBinary(blind)).toBe(true);
    expect(canRunShellScript(blind)).toBe(false);
  });

  it('an absent shell is incapable, not an exception', () => {
    const absent = join(root, 'no-such-shell-anywhere');
    expect(hasBinary(absent)).toBe(false);
    expect(canRunShellScript(absent)).toBe(false);
  });

  it('the probe leaves nothing behind — it runs on every suite start', () => {
    canRunShellScript(join(root, 'uncached-shell-for-cleanup-check'));
    // The probe's own temp roots are `harness-shell-probe-*`; none may survive.
    const leaked = readdirSync(tmpdir()).filter((n) => n.startsWith('harness-shell-probe-'));
    expect(leaked).toEqual([]);
  });
});

describe('the skip WORDING distinguishes absent from incapable', () => {
  it('names the capability, the known cause, and what stopped being checked', () => {
    // A reader told "not found" about a binary `which` reports is a reader who
    // loses an hour. The two reasons must not be confusable.
    const reason = incapableBinaryReason(
      'bash',
      'run a script at a native path',
      'that the hook fires once per commit',
    );
    expect(reason).toContain('IS present');
    expect(reason).toContain('not CAPABLE');
    expect(reason).toContain('run a script at a native path');
    expect(reason).toContain('that the hook fires once per commit');
    expect(reason).not.toContain('is not on PATH');
  });
});
