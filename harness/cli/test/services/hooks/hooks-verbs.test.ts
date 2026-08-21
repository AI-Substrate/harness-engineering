import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { AGENT_MATRIX } from '../../../src/services/hooks/agent-matrix.js';
import {
  type HooksDeps,
  hooksDisabled,
  installHooks,
  listAgents,
  statusHooks,
  UNIMPLEMENTED_AGENTS,
} from '../../../src/services/hooks/hooks-verbs.js';

/** The verbs (plan 082 tk-0008). */

let home: string;
const fs = new NodeFs();
const BINARY = '"/usr/local/bin/harness"';

const deps = (over: Partial<HooksDeps> = {}): HooksDeps => ({
  fs,
  home,
  env: () => undefined,
  binary: BINARY,
  ...over,
});

/** Make an agent "present" by creating its marker directory. */
const present = (marker: string) => mkdirSync(join(home, marker), { recursive: true });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'harness-hooks-verbs-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('HARNESS_NO_HOOKS is honoured INSIDE the verb (dw-001e, dw-001f)', () => {
  it('writes NOTHING to the filesystem — asserted on disk, not on a message', () => {
    /*
    Test Doc:
    - Why: dw-001e. A guard that lives only at doctor's call site is bypassed the
      moment someone runs the verb directly, which is exactly what a user reaching
      for `harness hooks install` does.
    - Contract: the home is byte-for-byte unchanged. Asserting on a returned message
      would pass for an implementation that prints "skipped" and installs anyway.
    */
    present('.cursor');
    const before = readdirSync(join(home, '.cursor'));

    const report = installHooks(deps({ env: (n) => (n === 'HARNESS_NO_HOOKS' ? '1' : undefined) }));

    expect(report.optedOut).toBe(true);
    expect(report.installed).toEqual([]);
    expect(readdirSync(join(home, '.cursor'))).toEqual(before);
    expect(existsSync(join(home, '.cursor/hooks.json'))).toBe(false);
  });

  it.each([
    ['1', true],
    ['true', true],
    ['yes', true],
    ['0', true],
    ['false', true],
    ['anything', true],
    ['', false],
  ])('value %j opts out: %s (dw-001f)', (value, expected) => {
    /*
    Test Doc:
    - Why: dw-001f. If doctor's call site and the verb disagree about what "set"
      means, one of them silently does the opposite of what the user asked.
    - Contract: ANY non-empty value opts out; only unset or empty proceeds.
    - The `0` and `false` rows are the deliberate ones: someone exporting
      HARNESS_NO_HOOKS=0 is reaching for the off switch, and a variable named
      NO_HOOKS that INSTALLS when set to 0 is a trap.
    */
    expect(hooksDisabled((n) => (n === 'HARNESS_NO_HOOKS' ? value : undefined))).toBe(expected);
  });

  it('unset proceeds — the positive control', () => {
    // Without this, "opts out" would be satisfied by a verb that never installs.
    present('.cursor');
    const report = installHooks(deps());
    expect(report.optedOut).toBe(false);
    expect(report.installed.length).toBeGreaterThan(0);
    expect(existsSync(join(home, '.cursor/hooks.json'))).toBe(true);
  });
});

describe('`list` has a defined contract (dw-001c)', () => {
  it('reports detected / supported / installed for every known agent', () => {
    present('.cursor');
    const rows = listAgents(deps());

    const cursor = rows.find((r) => r.agent === 'cursor');
    expect(cursor).toEqual({ agent: 'cursor', detected: true, supported: true, installed: false });

    const gemini = rows.find((r) => r.agent === 'gemini');
    expect(gemini).toEqual({ agent: 'gemini', detected: false, supported: true, installed: false });
  });

  it('installed flips to true only after an install', () => {
    present('.cursor');
    expect(listAgents(deps()).find((r) => r.agent === 'cursor')?.installed).toBe(false);
    installHooks(deps());
    expect(listAgents(deps()).find((r) => r.agent === 'cursor')?.installed).toBe(true);
  });

  it('covers every matrix agent AND every unimplemented one — nothing omitted', () => {
    const listed = new Set(listAgents(deps()).map((r) => r.agent));
    for (const spec of AGENT_MATRIX) expect(listed.has(spec.agent)).toBe(true);
    for (const { agent } of UNIMPLEMENTED_AGENTS) expect(listed.has(agent)).toBe(true);
  });
});

describe('the CUT LINE is explicit, never a silent skip (dw-001d)', () => {
  it('an unimplemented strategy is reported NOT SUPPORTED, with a named reason', () => {
    /*
    Test Doc:
    - Why: dw-001d. If strategies C and D are cut, four matrix rows have no writer.
      `list` advertising them as installable, or `status` reporting them
      identically to not-installed, is this plan's own silent-failure class arriving
      from the installer side.
    - Contract: supported=false and a reason naming the strategy.
    */
    const rows = listAgents(deps());
    for (const { agent, strategy } of UNIMPLEMENTED_AGENTS) {
      const row = rows.find((r) => r.agent === agent);
      expect(row?.supported).toBe(false);
      expect(row?.unsupportedReason).toBe(`strategy ${strategy} is not implemented`);
    }
  });

  it('install REFUSES a detected-but-unsupported agent BY NAME', () => {
    /*
    Test Doc:
    - Why: silently skipping is the failure. The agent is present, we cannot serve
      it, and the user must be told which one and why.
    - Contract: it appears in `refused` with its reason, and nothing is written for it.
    */
    present('.amp');
    const report = installHooks(deps());

    expect(report.refused).toEqual([{ agent: 'amp', reason: 'strategy C is not implemented' }]);
    expect(existsSync(join(home, '.config'))).toBe(false);
  });

  it('an UNDETECTED agent is flagged as such — not merely absent', () => {
    // cline is editor-level, so marker detection cannot reach it. "Not detected" and
    // "not installed" are different facts and collapsing them makes a coverage hole
    // look like an empty machine.
    expect(listAgents(deps()).find((r) => r.agent === 'cline')?.undetectable).toBe(true);
  });

  it('a supported agent carries NO unsupportedReason — the discriminator', () => {
    // Without this, "reason is set for unsupported" would pass for an implementation
    // that sets a reason on everything.
    expect(listAgents(deps()).find((r) => r.agent === 'cursor')?.unsupportedReason).toBeUndefined();
  });
});

describe('THE READER SEES EVERY SHAPE THE WRITER WRITES (phase-5 review F1)', () => {
  /*
    Test Doc:
    - Why: F005 taught the writer both entry shapes and left the READER on one.
      `ourCommands` parsed `entry.command` only, so claude-code / gemini / droid
      reported `installed:false, binaryState:absent, commandState:absent`
      IMMEDIATELY AFTER A SUCCESSFUL INSTALL. That is the two-readers-disagree class
      again — this time both readers are OURS.
    - Why it stayed green: every `list`/`status` row in this suite used cursor, the
      one agent whose shape is flat. A per-agent surface tested on one agent proves
      one agent.
    - Contract: for EVERY installable agent, install then observe — `installed` is
      true, the binary is `resolves`, and the command's options are `accepted`.
    - Proven RED on 62b86e96: the three nested agents fail all three assertions.
    - Quality Contribution: driven from `AGENT_MATRIX`, so an eighth agent is
      covered by adding its row rather than by remembering to add a test.
  */
  const installable = AGENT_MATRIX.filter((spec) => spec.supported);

  it.each(
    installable.map((spec) => spec.agent),
  )('%s: list and status see the install, whatever shape it was written in', (agent) => {
    const spec = installable.find((s) => s.agent === agent) as (typeof installable)[number];
    present(spec.subdir);
    const binaryPath = join(home, 'bin', 'harness');
    mkdirSync(join(home, 'bin'), { recursive: true });
    writeFileSync(binaryPath, '#!/bin/sh\n');

    const report = installHooks(deps({ binary: `"${binaryPath}"` }));
    expect(report.failed).toEqual([]);

    expect(listAgents(deps()).find((r) => r.agent === agent)?.installed).toBe(true);

    const row = statusHooks(deps()).find((r) => r.agent === agent);
    expect(row?.binaryState).toBe('resolves');
    expect(row?.configuredBinary).toBe(binaryPath);
    expect(row?.commandState).toBe('accepted');
  });

  it('and still says NOT installed when the entry is somebody else\u2019s', () => {
    // The negative control. Without it, a reader that returned every command it
    // found — rather than every command of OURS — would pass every row above.
    present('.claude');
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(
      join(home, '.claude', 'settings.json'),
      `${JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              { matcher: '*', hooks: [{ type: 'command', command: 'git-ai checkpoint claude' }] },
            ],
          },
        },
        null,
        2,
      )}\n`,
    );

    expect(listAgents(deps()).find((r) => r.agent === 'claude-code')?.installed).toBe(false);
    expect(statusHooks(deps()).find((r) => r.agent === 'claude-code')?.binaryState).toBe('absent');
  });
});

describe('`status` proves its target RESOLVES, not merely that an entry exists', () => {
  it('reports the configured binary and whether it resolves', () => {
    /*
    Test Doc:
    - Why: MEASURED on this machine — the live Cursor hook points into untracked
      scratch/. A config entry can exist while its target does not, and because a
      hook exits 0 by design that is indistinguishable from a working hook. A status
      that only confirms the entry exists reintroduces this plan's own silent-failure
      class from the installer side.
    - Contract: the binary path is extracted back out and stat'ed.
    */
    present('.cursor');
    const binaryPath = join(home, 'bin', 'harness');
    mkdirSync(join(home, 'bin'), { recursive: true });
    writeFileSync(binaryPath, '#!/bin/sh\n');

    installHooks(deps({ binary: `"${binaryPath}"` }));
    const cursor = statusHooks(deps()).find((r) => r.agent === 'cursor');

    expect(cursor?.configuredBinary).toBe(binaryPath);
    expect(cursor?.binaryResolves).toBe(true);
  });

  it('reports binaryResolves FALSE when the target is gone — the row that matters', () => {
    present('.cursor');
    const binaryPath = join(home, 'bin', 'harness');
    mkdirSync(join(home, 'bin'), { recursive: true });
    writeFileSync(binaryPath, '#!/bin/sh\n');

    installHooks(deps({ binary: `"${binaryPath}"` }));
    rmSync(binaryPath); // the scratch directory gets cleaned

    const cursor = statusHooks(deps()).find((r) => r.agent === 'cursor');
    expect(cursor?.configuredBinary).toBe(binaryPath);
    expect(cursor?.binaryResolves).toBe(false);
  });

  it('lists the config files it would write, and whether each exists', () => {
    present('.codeium');
    const windsurf = statusHooks(deps()).find((r) => r.agent === 'windsurf');
    expect(windsurf?.files.map((f) => f.exists)).toEqual([false, false]);

    installHooks(deps());
    const after = statusHooks(deps()).find((r) => r.agent === 'windsurf');
    expect(after?.files.map((f) => f.exists)).toEqual([true, true]);
  });
});

describe('the record write fails AFTER the probe passed (phase-3 review F001)', () => {
  /*
   * THE PROBE ANSWERS FOR THE INSTANT IT RAN. `ensureRecordWritable` closes the
   * reproducible case — an occupied `~/.harness` — by asking before anything is
   * written, so the refusal costs nothing and the machine is left exactly as it was.
   * It cannot close the race: a disk can fill, or a directory be removed, between the
   * probe and the real write.
   *
   * This row drives the branch the probe cannot reach, and it is the reason the
   * return value of `recordInstall` is checked as well as the probe. Without it the
   * compensation path would be code nothing exercises — which is the shape that
   * produced F002 one finding earlier.
   *
   * WHY THE FAKE WRAPS NodeFs RATHER THAN REPLACING IT: everything except the one
   * failing write must behave exactly as it does in production, including the config
   * write we then have to undo. A fake filesystem would be asserting the fake.
   */
  it('rolls the config back and reports the agent as FAILED', () => {
    present('.cursor');
    const config = join(home, '.cursor', 'hooks.json');

    let recordWrites = 0;
    const flaky = {
      ...fs,
      exists: (p: string) => fs.exists(p),
      readText: (p: string) => fs.readText(p),
      mkdirp: (p: string) => fs.mkdirp(p),
      deleteFile: (p: string) => fs.deleteFile(p),
      writeText: (p: string, text: string) => {
        if (p.endsWith('install-record.json')) {
          recordWrites += 1;
          // The probe's round trip is the first write and must succeed, or this row
          // would be re-testing the refusal instead of the compensation.
          if (recordWrites > 1) throw new Error('ENOSPC: no space left on device');
        }
        fs.writeText(p, text);
      },
    } as typeof fs;

    const report = installHooks(deps({ fs: flaky }));

    expect(report.installed).toEqual([]);
    const cursor = report.failed.find((f) => f.agent === 'cursor');
    expect(cursor?.reason).toContain('rolled back');
    // The compensation ran through the real uninstall path: a file we created is
    // deleted, so the filesystem is back where it started.
    expect(existsSync(config)).toBe(false);
  });
});

describe('the compensation does not over-reach (phase-3 review F002, applied to F001)', () => {
  /*
   * F002 WAS A STATED INVARIANT WITH NO ASSERTION. The compensation added for F001
   * carries one of exactly the same kind — "only what THIS run wrote" — written down
   * in a doc comment, and it would be silently lost the moment somebody simplified
   * the filter away. So it gets its row here rather than a sentence there.
   *
   * The case: a good install already exists, a second install finds our entry present
   * and writes nothing, and THEN the record write fails. There is nothing of this
   * run's to undo, and undoing the earlier run's entry would remove a working install
   * to compensate for a bookkeeping failure — a strictly worse outcome than the one
   * being compensated for.
   */
  it('leaves an EARLIER install alone when this run wrote nothing', () => {
    present('.cursor');
    const config = join(home, '.cursor', 'hooks.json');

    installHooks(deps());
    const afterFirst = readFileSync(config, 'utf8');
    expect(afterFirst).toContain('hooks fire cursor');

    let recordWrites = 0;
    const flaky = {
      ...fs,
      exists: (p: string) => fs.exists(p),
      readText: (p: string) => fs.readText(p),
      mkdirp: (p: string) => fs.mkdirp(p),
      deleteFile: (p: string) => fs.deleteFile(p),
      writeText: (p: string, text: string) => {
        if (p.endsWith('install-record.json')) {
          recordWrites += 1;
          if (recordWrites > 1) throw new Error('ENOSPC: no space left on device');
        }
        fs.writeText(p, text);
      },
    } as typeof fs;

    const report = installHooks(deps({ fs: flaky }));

    // Reported honestly — the failure is real and named — but nothing was undone.
    expect(report.failed.find((f) => f.agent === 'cursor')?.reason).toContain('left alone');
    expect(readFileSync(config, 'utf8')).toBe(afterFirst);
  });
});

describe('the probe is NOT the compensation (phase-3 review F001)', () => {
  /*
   * WITHOUT THIS ROW THE PROBE IS UNPINNED, and I found that by asking what would
   * still pass if it were deleted. Remove `ensureRecordWritable` and the real-bin F001
   * row STILL passes: the install writes the config, the record write fails, the
   * compensation undoes it, and the observable end state — named failure, config
   * absent — is identical. Two mechanisms, one visible outcome, and the review's own
   * finding was a mechanism nothing could distinguish.
   *
   * They are not the same guarantee. "Never written" and "written, then un-written"
   * differ for exactly the reason this plan cares about: the second has a window. A
   * process killed between the config write and the compensation leaves the orphan
   * F001 is about, and the compensation itself can fail — that is why the report has
   * a `stranded` ending at all.
   *
   * So the assertion is on the WRITES ATTEMPTED, which is the only place the two
   * differ. This row keeps the probe honest; the flaky-write row keeps the
   * compensation honest; neither substitutes for the other.
   */
  it('attempts NO config write at all when provenance is unwritable', () => {
    present('.cursor');
    present('.claude');

    const attempted: string[] = [];
    const blocked = {
      ...fs,
      exists: (p: string) => fs.exists(p),
      readText: (p: string) => fs.readText(p),
      deleteFile: (p: string) => fs.deleteFile(p),
      mkdirp: (p: string) => {
        if (p.includes('.harness')) throw new Error('ENOTDIR: not a directory');
        fs.mkdirp(p);
      },
      writeText: (p: string, text: string) => {
        attempted.push(p);
        if (p.endsWith('install-record.json')) throw new Error('ENOTDIR: not a directory');
        fs.writeText(p, text);
      },
    } as typeof fs;

    const report = installHooks(deps({ fs: blocked }));

    expect(report.installed).toEqual([]);
    expect(report.failed.map((f) => f.agent).sort()).toEqual(['claude-code', 'cursor']);
    // The only write ever attempted was the record probe. No agent config was touched,
    // so there is no window in which an orphan exists.
    expect(attempted.filter((p) => !p.endsWith('install-record.json'))).toEqual([]);
  });
});
