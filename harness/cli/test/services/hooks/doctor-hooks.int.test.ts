import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOOK_MARKER } from '../../../src/services/hooks/hook-marker.js';
import { hermeticGitEnv } from '../../support/hermetic-git.js';

/*
File Doc — plan 082 phase 3, tk-0002. DOCTOR INSTALLS OUR HOOKS, AND SURVIVES US.

THE FAILURE POSTURE IS THE TASK, NOT THE INSTALL. A doctor that dies on our
optional step is worse than one that never had it: the operator ran doctor to
diagnose something else, and every other row is what they came for. So a hook
install failure is a WARNING, doctor still exits 0, and every other row still
prints.

BUT IT IS NEVER SILENT. A swallowed failure means the machine now differs from
what the operator believes and nothing said so. That is the defect, not the safe
default — which is why every row here asserts on the OUTPUT and not on the exit
code alone. An exit code cannot distinguish "installed" from "failed quietly".

DRIVEN THROUGH THE REAL BIN. `harness doctor` is how a user reaches this; a test
that called `autoInstallHooks` directly would prove the service and not the
delivery — the distinction that produced this plan's tenth instance and the
phase-2 review's F001/F002.

HERMETIC: `HARNESS_NO_COLLECTOR=1` keeps git-ai's own auto-install (which
downloads a binary) out of these rows. It is the collector's opt-out, NOT ours —
the two are separate variables on purpose, so declining telemetry collection and
declining editor-config writes are separate decisions.
*/

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'bin', 'harness.js');

let home: string;

/**
 * Run the bin, TOLERATING a non-zero exit so the exit code can be asserted rather
 * than assumed. `execFileSync` throws on non-zero, which would turn the very
 * assertion these rows exist to make into an unhandled error.
 */
function spawn(args: string[], extraEnv: Record<string, string> = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    cwd: home,
    env: {
      ...hermeticGitEnv(),
      HOME: home,
      USERPROFILE: home,
      HARNESS_NO_COLLECTOR: '1',
      ...extraEnv,
    },
  });
}

/** The same, against an explicit home — for control runs that must not share state. */
function spawnIn(where: string, args: string[], extraEnv: Record<string, string> = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    cwd: where,
    env: {
      ...hermeticGitEnv(),
      HOME: where,
      USERPROFILE: where,
      HARNESS_NO_COLLECTOR: '1',
      ...extraEnv,
    },
  });
}

/** Doctor writes its report to stderr and its verdict to stdout; rows read both. */
const doctorRaw = (extraEnv: Record<string, string> = {}) => spawn(['doctor'], extraEnv);

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'harness-doctor-hooks-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('`harness doctor` installs our agent hooks on first run (tk-0002)', () => {
  it('installs for a detected agent, and says so', () => {
    mkdirSync(join(home, '.cursor'), { recursive: true });

    const result = doctorRaw();
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(0);
    expect(output).toContain('agent hooks installed');
    const config = join(home, '.cursor', 'hooks.json');
    expect(existsSync(config)).toBe(true);
    expect(readFileSync(config, 'utf8')).toContain(HOOK_MARKER);
  });
});

describe('a hook-install failure is a WARNING, never a broken doctor (dw-0005, dw-0006)', () => {
  /**
   * Force a REAL write failure: the config path is a DIRECTORY.
   *
   * Chosen over a chmod because it fails on every platform including Windows, and
   * because a permission bit is bypassed by running as root — which CI containers
   * routinely do, so a chmod-based row would silently stop failing there and pass
   * for the wrong reason.
   */
  const breakCursor = () => {
    mkdirSync(join(home, '.cursor', 'hooks.json'), { recursive: true });
  };

  it('doctor still EXITS 0 and its rows are UNCHANGED by our failure', () => {
    /*
    Test Doc:
    - Why: dw-0005. Asserted on the OUTPUT, never on the exit code alone — an exit
      of 0 is equally consistent with "installed fine" and "gave up silently", so it
      cannot carry this claim by itself.
    - THE ASSERTION IS A COMPARISON, not a spot-check for a header. "Every other row
      still printed" is a claim about the WHOLE report, and a row list that happens
      to contain `git` would satisfy a doctor that dropped three others. So the same
      doctor is run with and without the broken config and the layers must match
      exactly, name and verdict — which also proves our step cannot silently DEGRADE
      a layer, not merely that it cannot remove one.
    - Note the surface: with no TTY the bin emits the JSON envelope, so the rows are
      `data.layers`. That IS the delivered report here, not a proxy for it.
    - TWO INDEPENDENT HOMES, and that was MEASURED, not foreseen: comparing two runs
      in ONE home reported 13 layers against 12, because doctor's first run changes
      the machine it is reporting on — it installs, writes state, and the second run
      legitimately sees more. The difference had nothing to do with the hook failure.
      A control has to differ from its subject in ONE respect, and sequential runs in
      a shared home differ in two.
    */
    const layersOf = (out: string) =>
      (JSON.parse(out) as { data: { layers: { name: string; ok: boolean }[] } }).data.layers.map(
        (l) => `${l.name}:${l.ok}`,
      );

    const control = mkdtempSync(join(tmpdir(), 'harness-doctor-control-'));
    mkdirSync(join(control, '.cursor'), { recursive: true });
    const healthy = spawnIn(control, ['doctor', '--json']);
    expect(healthy.status).toBe(0);

    breakCursor();
    const broken = spawn(['doctor', '--json']);

    expect(broken.status).toBe(0);
    expect(layersOf(broken.stdout)).toEqual(layersOf(healthy.stdout));
    expect(layersOf(broken.stdout).length).toBeGreaterThan(3);
    rmSync(control, { recursive: true, force: true });
  });

  it('the failure is VISIBLE, and names the agent — a silent success is the defect', () => {
    /*
    Test Doc:
    - Why: dw-0006. The whole value of warn-only is lost if the warning is not
      emitted: the operator believes hooks are installed, and the runtime that
      exits 0 by design will never tell them otherwise.
    - Contract: the agent is named in the output. Named, not merely counted — an
      operator cannot act on "1 agent failed".
    */
    breakCursor();

    const result = doctorRaw();
    const output = `${result.stdout}${result.stderr}`;
    expect(output).toContain('agent hooks');
    expect(output).toContain('cursor');
  });

  it('the JSON surface carries it too — the reader most likely to act on it', () => {
    /*
    Test Doc:
    - Why: an agent reads `doctor --json`. A warning that exists only in the text
      render is swallowed for exactly that reader, which is the same silence the
      row above rejects, wearing a different surface.
    - Contract: `agentHooks` carries the action and the warning in the envelope.
    */
    breakCursor();

    const result = spawn(['doctor', '--json']);
    const envelope = JSON.parse(result.stdout) as {
      data: { agentHooks?: { action: string; warnings: string[] } };
    };

    expect(result.status).toBe(0);
    expect(envelope.data.agentHooks?.action).toBe('failed');
    expect(envelope.data.agentHooks?.warnings.join(' ')).toContain('cursor');
  });
});

describe('HARNESS_NO_HOOKS through DOCTOR (dw-0007, dw-0008)', () => {
  it('writes NOTHING — asserted on the filesystem, not on a message', () => {
    /*
    Test Doc:
    - Why: dw-0007. A message is what a broken implementation prints while writing
      anyway. The only assertion that cannot be satisfied by a lie is the absence
      of the file.
    - Contract: the config the installer would have created does not exist.
    */
    mkdirSync(join(home, '.cursor'), { recursive: true });

    const result = doctorRaw({ HARNESS_NO_HOOKS: '1' });

    expect(result.status).toBe(0);
    expect(existsSync(join(home, '.cursor', 'hooks.json'))).toBe(false);
    // `1` is the unsurprising value, so it gets the plain notice and NOT the
    // corrective one — otherwise every declining user reads a warning aimed at a
    // mistake they did not make, which is how a message stops being read.
    const output = `${result.stdout}${result.stderr}`;
    expect(output).toContain('HARNESS_NO_HOOKS');
    expect(output).not.toContain('UNSET');
  });

  it('HARNESS_NO_HOOKS=0 ALSO declines — doctor and the verb agree (dw-0008)', () => {
    /*
    Test Doc:
    - Why: dw-0008, and `0` is the value that proves it rather than `1`. Any
      non-empty value opts out, because someone exporting `HARNESS_NO_HOOKS=0` is
      reaching for the off switch and a variable named NO_HOOKS that INSTALLS when
      set to `0` is a trap.
    - Why it is a live risk and not a hypothetical: the neighbouring collector
      opt-out in this very file's call site tests `=== '1'`. A hooks call site
      copying that pattern would install for someone who declined. Doctor calls the
      verb's own `hooksDisabled`, so there is one predicate and one answer — and
      this row is what proves the call site did not grow a second copy.
    - Contract: `0` writes nothing through DOCTOR, and writes nothing through the
      VERB. The same string, both surfaces, asserted rather than assumed.
    */
    mkdirSync(join(home, '.cursor'), { recursive: true });

    const viaDoctor = doctorRaw({ HARNESS_NO_HOOKS: '0' });
    expect(viaDoctor.status).toBe(0);
    expect(existsSync(join(home, '.cursor', 'hooks.json'))).toBe(false);

    // AND THE DECLINE IS ANNOUNCED, naming the variable and the value. Presence-based
    // semantics are kept — declining is the recoverable direction — but a user who
    // wrote `0` MEANING "do not disable" would otherwise never find out: hooks simply
    // never install and the machine looks configured. Safe thing, made observable.
    const announced = `${viaDoctor.stdout}${viaDoctor.stderr}`;
    expect(announced).toContain('HARNESS_NO_HOOKS');
    expect(announced).toContain('UNSET');

    const viaVerb = spawn(['hooks', 'install', '--json'], { HARNESS_NO_HOOKS: '0' });
    const report = JSON.parse(viaVerb.stdout) as {
      optedOut: boolean;
      optedOutDetail?: string;
      installed: unknown[];
    };
    expect(report.optedOut).toBe(true);
    expect(report.installed).toEqual([]);
    // Same words from the verb: a decline must be visible wherever it was reached for.
    expect(report.optedOutDetail).toContain('UNSET');
    expect(existsSync(join(home, '.cursor', 'hooks.json'))).toBe(false);
  });

  it('the opt-out is OURS alone — declining the collector still installs hooks', () => {
    /*
    Test Doc:
    - Why: the discriminator. Every row above runs with `HARNESS_NO_COLLECTOR=1`
      for hermeticity, so without this row "nothing was written" could be satisfied
      by the collector opt-out disabling our step too — and every assertion would
      pass for a reason that has nothing to do with HARNESS_NO_HOOKS.
    - Contract: collector declined, hooks installed anyway.
    */
    mkdirSync(join(home, '.cursor'), { recursive: true });

    const result = doctorRaw();
    expect(result.status).toBe(0);
    expect(existsSync(join(home, '.cursor', 'hooks.json'))).toBe(true);
  });
});
