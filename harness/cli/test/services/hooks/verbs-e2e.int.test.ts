import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { backupAgentConfigs } from '../../../src/services/doctor/collector/backup.js';
import { HOOK_MARKER } from '../../../src/services/hooks/hook-marker.js';
import { hermeticGitEnv } from '../../support/hermetic-git.js';

/**
 * THE VERBS, THROUGH THE REAL BIN (plan 082).
 *
 * WHY THIS FILE EXISTS. A sweep of the phase asked of each checked task whether its
 * assertions test the DELIVERABLE or the layer beneath it. Three tasks failed that
 * question:
 *
 * - tk-0005 "Implement Strategy A" — asserted by calling `installStrategyA` directly;
 * - tk-0008 "Wire harness hooks install|status|uninstall|list" — asserted by calling
 *   `installHooks` / `listAgents` / `statusHooks` directly, and the subcommands were
 *   not registered AT ALL until it was found by accident;
 * - tk-0006 "Resolve the binary path absolutely… ALWAYS quote it" — the pure
 *   functions were asserted, but `hooksDeps` composes the binary from
 *   `process.argv[1]` and **that expression was asserted nowhere**. The path actually
 *   written into a user's config file had no test at all.
 *
 * A test that exercises the layer beneath a deliverable proves the layer, never the
 * delivery. These rows drive `harness hooks …` as a user does.
 */

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'bin', 'harness.js');

let home: string;

const run = (args: string[]): string =>
  execFileSync(process.execPath, [CLI, 'hooks', ...args], {
    encoding: 'utf8',
    env: { ...hermeticGitEnv(), HOME: home, USERPROFILE: home },
  });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'harness hooks e2e '));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('`harness hooks list` — the delivered surface', () => {
  it('emits JSON carrying detected / supported / installed per agent', () => {
    mkdirSync(join(home, '.cursor'), { recursive: true });
    const rows = JSON.parse(run(['list', '--json'])) as {
      agent: string;
      detected: boolean;
      supported: boolean;
      installed: boolean;
    }[];

    const cursor = rows.find((r) => r.agent === 'cursor');
    expect(cursor).toEqual({
      agent: 'cursor',
      detected: true,
      supported: true,
      installed: false,
    });
    // And the cut line is visible through the real surface, not only in the service.
    expect(rows.find((r) => r.agent === 'amp')?.supported).toBe(false);
  });
});

describe('`harness hooks install` — and the binary it actually writes', () => {
  it('writes a command whose binary path RESOLVES on disk', () => {
    /*
    Test Doc:
    - Why: `hooksDeps` composes the installed command from `process.argv[1]`, and
      that expression had no test. tk-0006 proved embed/extract as pure functions —
      it never proved the verb feeds them the right input. A hook naming a path that
      does not exist is inert, and because hooks exit 0 by design nothing reports it.
    - Contract: install through the real bin, then read the config the real bin
      wrote, and assert the path it named EXISTS.
    - Note the home directory contains SPACES (see beforeEach), so this also exercises
      the quoting end to end rather than in isolation.
    */
    mkdirSync(join(home, '.cursor'), { recursive: true });
    run(['install', '--json']);

    const config = JSON.parse(readFileSync(join(home, '.cursor/hooks.json'), 'utf8')) as {
      hooks: Record<string, { command: string }[]>;
    };
    const command = config.hooks.preToolUse[0].command;

    expect(command).toContain(HOOK_MARKER);
    // The binary is quoted, and what it names is a real file.
    expect(command.startsWith('"')).toBe(true);
    const binary = command.slice(1, command.indexOf('"', 1));
    expect(binary.length).toBeGreaterThan(0);
    expect(readFileSync(binary, 'utf8').length).toBeGreaterThan(0);
  });

  it('is idempotent through the REAL bin — a second install changes nothing', () => {
    mkdirSync(join(home, '.cursor'), { recursive: true });
    run(['install', '--json']);
    const first = readFileSync(join(home, '.cursor/hooks.json'), 'utf8');
    run(['install', '--json']);
    expect(readFileSync(join(home, '.cursor/hooks.json'), 'utf8')).toBe(first);
  });

  it('HARNESS_NO_HOOKS is honoured by the real verb, asserted on the filesystem', () => {
    mkdirSync(join(home, '.cursor'), { recursive: true });
    execFileSync(process.execPath, [CLI, 'hooks', 'install', '--json'], {
      encoding: 'utf8',
      env: { ...hermeticGitEnv(), HOME: home, USERPROFILE: home, HARNESS_NO_HOOKS: '1' },
    });
    expect(() => readFileSync(join(home, '.cursor/hooks.json'), 'utf8')).toThrow();
  });
});

describe('`harness hooks status` — the delivered surface', () => {
  it('reports the binary as RESOLVES after a real install', () => {
    mkdirSync(join(home, '.cursor'), { recursive: true });
    run(['install', '--json']);

    const out = JSON.parse(run(['status', '--json'])) as {
      agents: { agent: string; binaryState: string }[];
      fires: { recorded: boolean; total: number };
    };

    expect(out.agents.find((a) => a.agent === 'cursor')?.binaryState).toBe('resolves');
    // And the journal summary is present in the delivered payload, which is what
    // ac-000b actually requires — not merely that a function returns it.
    expect(out.fires).toEqual(expect.objectContaining({ recorded: false, total: 0 }));
  });

  it('reports ABSENT before any install — distinct from resolves', () => {
    mkdirSync(join(home, '.cursor'), { recursive: true });
    const out = JSON.parse(run(['status', '--json'])) as {
      agents: { agent: string; binaryState: string }[];
    };
    expect(out.agents.find((a) => a.agent === 'cursor')?.binaryState).toBe('absent');
  });
});

describe('`harness hooks restore` — the recovery verb, through the real bin', () => {
  /*
   * WHY THESE ROWS EXIST. `restoreAgentConfigs` landed with six rows and six red
   * mutations and was STILL not delivered: nobody at a terminal could run it. That
   * is the phase-2 unwired-verb finding wearing different clothes — the finding that
   * produced the registration guard in `app.test.ts`, which this verb is also in.
   *
   * The audience decides the contract. Everyone who reaches for a restore already
   * has a problem, so a refusal must be LOUD: non-zero exit and a named reason,
   * never a clean restore of zero files.
   */

  /** Restore may exit non-zero, so the shared `run` helper (which throws) will not do. */
  const runRestore = (args: string[]): { code: number; stdout: string } => {
    const result = spawnSync(process.execPath, [CLI, 'hooks', 'restore', ...args], {
      encoding: 'utf8',
      env: { ...hermeticGitEnv(), HOME: home, USERPROFILE: home },
    });
    return { code: result.status ?? -1, stdout: result.stdout };
  };

  /** A real backup, written by the real backup code — never a hand-built fixture. */
  const takeBackup = (): string => {
    const backup = backupAgentConfigs({
      fs: new NodeFs(),
      clock: { nowIso: () => '2026-08-10T01:02:03.000Z', now: () => 0 },
      host: { platform: 'darwin', arch: 'arm64', home, envOverrides: {} },
    } as never);
    return backup.dir ?? `${home}/.git-ai/harness-backups/2026-08-10T01-02-03-000Z`;
  };

  it('restores a real backup end to end, chosen as the NEWEST with no --from', () => {
    /*
    Test Doc:
    - Why: the delivered capability. The library round trip was already proven; this
      asserts a person can invoke it, and that the default (newest backup) resolves
      without the operator knowing the directory naming scheme — which is exactly
      what they will not know at three in the morning.
    - Contract: the file on disk is byte-identical to what it was before the damage,
      asserted on the filesystem rather than on the report.
    */
    mkdirSync(join(home, '.cursor'), { recursive: true });
    const config = join(home, '.cursor', 'hooks.json');
    const original = Buffer.from('// keep me\r\n{ "hooks": { "afterFileEdit": [] } }  ', 'utf8');
    writeFileSync(config, original);

    takeBackup();
    writeFileSync(config, '{"clobbered":true}');

    const { code, stdout } = runRestore(['--json']);
    const report = JSON.parse(stdout) as { ok: boolean; restored: string[]; from: string };

    expect(code).toBe(0);
    expect(report.ok).toBe(true);
    expect(report.restored).toContain(config);
    expect(readFileSync(config).equals(original)).toBe(true);
  });

  it('REFUSES a directory with no manifest — non-zero, with the reason named', () => {
    /*
    Test Doc:
    - Why: the assertion the PM added to tk-0001 when the verb was ruled in. The
      library already refuses this (mutation M5 was red), but a refusal the CLI
      swallows is not a refusal — the operator sees a report and walks away. The
      exit-0-and-silent contract binds `fire` ALONE, and this is the verb where
      breaking it would do the most harm.
    - Contract: exit 1 AND the reason in the payload. Both, because either alone is
      survivable by the wrong implementation — a non-zero exit with no reason leaves
      the operator guessing, and a reason with exit 0 is invisible to a script.
    */
    const empty = join(home, 'not-a-backup');
    mkdirSync(empty, { recursive: true });

    const { code, stdout } = runRestore(['--from', empty, '--json']);
    const report = JSON.parse(stdout) as { ok: boolean; failed: string[]; detail: string };

    expect(code).toBe(1);
    expect(report.ok).toBe(false);
    expect(report.failed.join(' ')).toContain('manifest.json');
    expect(report.detail).toContain('refused');
  });

  it('REFUSES when there is no backup at all rather than reporting a clean restore', () => {
    /*
    Test Doc:
    - Why: the empty-success shape this module's own doc names as the harm — an
      operator told their configs are back stops looking for them. A machine that
      has never run an install has no backups, and "restored 0 files, ok" is the
      most dangerous thing this verb could say.
    - Contract: exit 1, and the message names the directory that was searched so the
      operator can check for themselves.
    */
    const { code, stdout } = runRestore(['--json']);
    const report = JSON.parse(stdout) as { ok: boolean; from: string | null; detail: string };

    expect(code).toBe(1);
    expect(report.ok).toBe(false);
    expect(report.from).toBeNull();
    expect(report.detail).toContain('harness-backups');
  });
});

describe('`harness hooks status` carries a REAL failed fire (phase-2 review F002)', () => {
  /*
   * WHY THIS ROW EXISTS, and it is the sharpest finding of the phase-2 review.
   *
   * The reviewer replaced `fires: fireSummary(d)` in the status command with a
   * constant healthy summary — anchored, so the patch demonstrably applied — rebuilt,
   * and ran all 71 target tests. EVERY ONE STAYED GREEN. The test that creates a real
   * failed fire called `fireSummary()` directly rather than driving
   * `harness hooks status --json`.
   *
   * So the compensating control that the plan's G2 gate granted the exit-0-and-silent
   * deviation FOR could be deleted from the delivered payload and nothing noticed —
   * in the one task whose entire purpose is to be the thing that notices. Because a
   * fire exits 0 and prints nothing by design, this surface is the ONLY way a failing
   * runtime is distinguishable from a working one.
   *
   * It is also a fourth instance of the deliverable-vs-layer shape that my own sweep
   * of the checked tasks did not reach — which is worth knowing about the sweep as
   * much as about the code: the sweep asked whether a task's rows called an internal
   * function, and this row DOES drive the real bin (for the fire) while reading the
   * result through the layer beneath (for the status).
   */
  it('a real failed fire is visible in the DELIVERED status payload, with its cause', () => {
    /*
    Test Doc:
    - Why: F002. Asserted through `harness hooks status --json` from the real bin, so
      deleting the `fires` mapping from the delivered command turns it red.
    - Contract: failed >= 1 AND the cause the RUNTIME wrote — never a cause this test
      supplied, and never a fabricated journal entry.
    */
    const repo = join(home, 'repo');
    const git = (args: string[]) =>
      execFileSync('git', args, { cwd: repo, env: { ...hermeticGitEnv(), HOME: home } });

    mkdirSync(repo, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', repo], { env: hermeticGitEnv() });
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    git(['add', 'a.txt']);
    git(['commit', '-qm', 'base']);

    const payload = JSON.stringify({
      tool_name: 'Shell',
      tool_input: { cwd: repo, command: 'git commit -am x' },
    });
    const fire = (phase: string) =>
      execFileSync(
        process.execPath,
        [CLI, 'hooks', 'fire', 'cursor', '--phase', phase, '--hook-input', 'stdin'],
        { cwd: repo, input: payload, env: { ...hermeticGitEnv(), HOME: home, USERPROFILE: home } },
      );

    // A REAL agent-authored commit between the two fires: without it the post fire is
    // silent (head-unchanged) and never reaches the emit that fails.
    fire('pre');
    writeFileSync(join(repo, 'a.txt'), 'b\n');
    git(['commit', '-qam', 'x']);
    fire('post');

    const payloadOut = JSON.parse(run(['status', '--json'])) as {
      fires: { recorded: boolean; total: number; failed: number; failures: { cause: string }[] };
    };

    expect(payloadOut.fires.recorded).toBe(true);
    expect(payloadOut.fires.failed).toBeGreaterThanOrEqual(1);
    // The CAUSE, not just the count. `relayable` rather than `af_unix` since
    // F006: the tickler refuses on "nothing I can connect to", which now spans
    // an af_unix socket AND a Windows named pipe.
    expect(payloadOut.fires.failures.map((f) => f.cause).join(' ')).toContain(
      'no relayable trace2 ingress',
    );
  });
});

describe('`harness hooks uninstall` — the verb the review found missing (F001)', () => {
  /*
   * The registration guard in `app.test.ts` proves the subcommand EXISTS. That is not
   * the same claim as "it works", and the distinction is the whole of this plan's
   * tenth instance: the guard that was supposed to catch this carried a deliberate
   * exclusion for `uninstall`, the exception outlived its reason, and the guard then
   * certified the exact gap it was built to catch.
   *
   * These rows drive install and uninstall as separate OS PROCESSES, which is also
   * the only place the F003 provenance record is exercised the way it really runs:
   * one process writes `install-record.json`, a different one reads it. An in-process
   * test passes a Map and proves nothing about that hand-off.
   */
  const cursorConfig = () => join(home, '.cursor', 'hooks.json');

  it('install then uninstall, as separate processes, leaves a PRE-EXISTING file clean', () => {
    /*
    Test Doc:
    - Why: F001 asks for the verb through the real bin. This is the round trip a user
      performs, across two invocations, with the provenance crossing between them on
      disk rather than in a variable.
    - Contract: our marker is gone, the user's own entry survives byte-identical, and
      the empty array the USER had is still there — the F003 property, proven through
      the delivered surface rather than through the strategy function.
    */
    mkdirSync(join(home, '.cursor'), { recursive: true });
    const before = `${JSON.stringify(
      {
        version: 1,
        hooks: { beforeShellExecution: [{ command: 'their-tool run' }], afterFileEdit: [] },
      },
      null,
      2,
    )}\n`;
    writeFileSync(cursorConfig(), before);

    run(['install', '--json']);
    expect(readFileSync(cursorConfig(), 'utf8')).toContain(HOOK_MARKER);

    const report = JSON.parse(run(['uninstall', '--json'])) as {
      removed: { agent: string; entries: number }[];
      failed: unknown[];
    };
    expect(report.failed).toEqual([]);
    expect(report.removed.some((r) => r.agent === 'cursor' && r.entries > 0)).toBe(true);

    const after = readFileSync(cursorConfig(), 'utf8');
    expect(after).not.toContain(HOOK_MARKER);
    const doc = JSON.parse(after) as { version: number; hooks: Record<string, unknown[]> };
    expect(doc.version).toBe(1);
    expect(doc.hooks.beforeShellExecution).toEqual([{ command: 'their-tool run' }]);
    // The user's own empty array — never ours to remove.
    expect(doc.hooks.afterFileEdit).toEqual([]);
  });

  it('names a DETECTED but UNSUPPORTED agent rather than skipping it (FT-001)', () => {
    /*
    Test Doc:
    - Why: the review's fix task asks uninstall to report unsupported strategies
      explicitly. It matters more on the way out than on the way in: an operator
      removing our hook and seeing no mention of `pi` will believe the machine is
      clean. A silent skip is the declared Strategy C/D cut turning into an omission.
    - Contract: the agent is named with its reason, through the delivered payload.
    */
    mkdirSync(join(home, '.pi'), { recursive: true }); // detected, strategy C — not built
    mkdirSync(join(home, '.cursor'), { recursive: true });

    const report = JSON.parse(run(['uninstall', '--json'])) as {
      unsupported: { agent: string; reason: string }[];
    };
    const pi = report.unsupported.find((u) => u.agent === 'pi');
    expect(pi).toBeDefined();
    expect(pi?.reason).toContain('strategy C');
  });

  it('a file WE created is DELETED by uninstall — provenance crossing two processes', () => {
    /*
    Test Doc:
    - Why: the created-file branch reads `createdFile` from the install record, so it
      is the one that cannot work unless the record survives the process boundary. In
      phase 2 this was proven only by handing `createdFiles` to the strategy in the
      same process, which asserts the branch and not the hand-off.
    - Contract: the file install created is gone, asserted on the filesystem.
    */
    mkdirSync(join(home, '.cursor'), { recursive: true }); // detected, no config yet
    expect(existsSync(cursorConfig())).toBe(false);

    run(['install', '--json']);
    expect(existsSync(cursorConfig())).toBe(true);

    const report = JSON.parse(run(['uninstall', '--json'])) as {
      removed: { agent: string; deleted: boolean }[];
    };
    expect(report.removed.some((r) => r.agent === 'cursor' && r.deleted)).toBe(true);
    expect(existsSync(cursorConfig())).toBe(false);
  });
});

describe('one broken agent config does not cost you the others', () => {
  it('reports the failure BY NAME and still installs for every other agent', () => {
    /*
    Test Doc:
    - Why: `installStrategyA` throws on a write failure, so before this a single
      agent with an unwritable config path aborted every agent after it in the loop —
      silently, since the loop order is the matrix order and nobody would know which
      agents never got their turn. Doctor calls install on first run (tk-0002), where
      that would mean one damaged config quietly costing a user everything else.
    - How the failure is forced: `~/.cursor/hooks.json` is made a DIRECTORY. That
      fails the write on every platform including Windows, and unlike a chmod it is
      not bypassed by running as root — which CI containers do.
    - Contract: cursor is named in `failed` with a reason, AND claude-code is still
      installed. Both halves: naming the failure without continuing is the old
      behaviour with better reporting, and continuing without naming it is worse.
    */
    mkdirSync(join(home, '.cursor', 'hooks.json'), { recursive: true });
    mkdirSync(join(home, '.claude'), { recursive: true });

    const report = JSON.parse(run(['install', '--json'])) as {
      installed: { agent: string }[];
      failed: { agent: string; reason: string }[];
    };

    expect(report.failed.map((f) => f.agent)).toContain('cursor');
    expect(report.failed.find((f) => f.agent === 'cursor')?.reason).not.toBe('');
    expect(report.installed.map((i) => i.agent)).toContain('claude-code');
    expect(existsSync(join(home, '.claude', 'settings.json'))).toBe(true);
  });
});

describe('provenance is pruned on NO-LONGER-OURS, not on WE-REMOVED-IT', () => {
  /*
   * MEASURED DURING A REAL RECOVERY, by a route nobody predicted.
   *
   * After the doctor escape wrote to a real machine, one config was restored BY HAND
   * from a byte snapshot and the rest were cleaned with `harness hooks uninstall`.
   * Uninstall correctly found no marker in the hand-restored file, reported it
   * untouched — and KEPT ITS PROVENANCE ENTRY, because pruning was keyed on whether
   * we removed something rather than on whether the file is still ours.
   *
   * The stale direction is safe (a stale entry can only ever make us remove a key we
   * DID create), which is why this is a correctness fix rather than an incident. But
   * `unmarked` is the positive statement that the file carries nothing of ours, and
   * that is exactly the condition under which our record of it is obsolete.
   */
  it('a config cleaned OUT-OF-BAND has its record entry dropped', () => {
    mkdirSync(join(home, '.cursor'), { recursive: true });
    const config = join(home, '.cursor', 'hooks.json');
    const before = `${JSON.stringify({ hooks: { beforeShellExecution: [] } }, null, 2)}\n`;
    writeFileSync(config, before);

    run(['install', '--json']);
    const recordPath = join(home, '.harness', 'hooks', 'install-record.json');
    const entriesOf = () =>
      (JSON.parse(readFileSync(recordPath, 'utf8')) as { entries: { path: string }[] }).entries.map(
        (e) => e.path,
      );
    expect(entriesOf()).toContain(config);

    // Out of band: the user (or a recovery) puts the file back by hand.
    writeFileSync(config, before);

    const report = JSON.parse(run(['uninstall', '--json'])) as {
      untouched: { path: string }[];
      removed: unknown[];
    };
    expect(report.untouched.map((u) => u.path)).toContain(config);
    expect(report.removed).toEqual([]);
    // The record no longer claims a file that carries nothing of ours.
    expect(entriesOf()).not.toContain(config);
  });
});

describe('a stated invariant with no assertion (phase-3 review F002)', () => {
  /*
   * THE PROPERTY WAS DESCRIBED PRECISELY, IMPLEMENTED CORRECTLY, AND NEVER ASSERTED.
   *
   * "Provenance recorded before the first write, persisted, MERGED rather than
   * replaced — installing twice must not forget that the FIRST install created the
   * key" was written down as a deliverable. The reviewer replaced the union in
   * `recordInstall` with a plain replacement and ALL 383 tests in the targeted hooks
   * suite stayed green, then reproduced the consequence on the real bin: install,
   * install, uninstall, and a config we created survives.
   *
   * That is not the deliverable-vs-layer shape the earlier sweep was built to catch.
   * It is narrower and worse — there was no row at all. The existing second-install
   * row asserts the CONFIG BYTES do not change, which is idempotency; the provenance
   * lives in a different file and was never read.
   *
   * WHY THE SECOND INSTALL IS THE DANGEROUS ONE: it finds our entry already present,
   * so it creates nothing and its own outcome is honestly empty. Only the merge with
   * what the FIRST install recorded remembers that the file is ours. An overwrite is
   * invisible in every artifact except the one nobody was reading.
   *
   * Both rows run install twice as SEPARATE PROCESSES, because the record only
   * round-trips through the filesystem that way.
   */
  const cursorConfig = () => join(home, '.cursor', 'hooks.json');

  it('install, install, uninstall — a file WE created is still deleted', () => {
    /*
    Test Doc:
    - Contract: with no config to begin with, two installs and one uninstall leave the
      filesystem as it started. Asserted on the filesystem, and on `deleted` in the
      delivered payload so a silent no-op cannot pass.
    */
    mkdirSync(join(home, '.cursor'), { recursive: true });
    expect(existsSync(cursorConfig())).toBe(false);

    run(['install', '--json']);
    run(['install', '--json']);
    expect(existsSync(cursorConfig())).toBe(true);

    const report = JSON.parse(run(['uninstall', '--json'])) as {
      removed: { agent: string; deleted: boolean }[];
    };
    expect(report.removed.find((r) => r.agent === 'cursor')?.deleted).toBe(true);
    expect(existsSync(cursorConfig())).toBe(false);
  });

  it('install, install, uninstall — event keys WE created still disappear', () => {
    /*
    Test Doc:
    - Why: the createdKeys half of the same guarantee, and the one with a user's file
      underneath it. A config that exists but carries no event keys is the ordinary
      state of a `settings.json` holding only `model` — install creates both arrays,
      and only the first install knows it did.
    - Contract: after two installs and an uninstall the keys we created are GONE and
      the file is byte-identical to the one the user had.
    */
    mkdirSync(join(home, '.cursor'), { recursive: true });
    const before = `${JSON.stringify({ version: 1, hooks: {} }, null, 2)}\n`;
    writeFileSync(cursorConfig(), before);

    run(['install', '--json']);
    run(['install', '--json']);
    const afterInstall = JSON.parse(readFileSync(cursorConfig(), 'utf8')) as {
      hooks: Record<string, unknown>;
    };
    expect(Object.keys(afterInstall.hooks).sort()).toEqual(['postToolUse', 'preToolUse']);

    run(['uninstall', '--json']);
    const after = readFileSync(cursorConfig(), 'utf8');
    // Not "the arrays are empty" — the keys we created are not there AT ALL, and the
    // user's own document is otherwise the one they wrote.
    expect(JSON.parse(after)).toEqual(JSON.parse(before));
    expect(Object.keys((JSON.parse(after) as { hooks: object }).hooks)).toEqual([]);

    /*
     * MEASURED WHILE WRITING THIS ROW, and stated rather than hidden: the file is NOT
     * byte-identical. Removing the last key from `hooks` leaves the surgical writer's
     * `{\n  }` where the user had `{}`. That is whitespace inside a container we
     * legitimately edited — the writer is deliberately textual so it preserves
     * comments and every byte it did not touch, and collapsing that brace would mean
     * reformatting a region on the user's behalf.
     *
     * So the claim is narrowed to what is true: no key of ours survives, the document
     * parses equal, and the only residue is whitespace. Asserting it here means a
     * future change that starts rewriting real bytes cannot pass as "cosmetic".
     */
    expect(after.replace(/\s+/g, '')).toBe(before.replace(/\s+/g, ''));
  });
});

describe('an install we cannot RECORD is an install we do not CLAIM (phase-3 review F001)', () => {
  /*
   * THE INSTALL REPORTED SUCCESS FOR A WRITE THAT DID NOT HAPPEN.
   *
   * `recordInstall` has always returned false when it could not persist, and the
   * caller discarded it. The review reproduced the consequence on the real bin with
   * `~/.harness` occupied by a regular file: `hooks install --json` reported cursor
   * `created: true` and `failed: []`, and the config it created then survived
   * `hooks uninstall` — because the record uninstall reads to know the file is ours
   * was never written.
   *
   * The record is the SINGLE POINT OF TRUTH for what uninstall may delete, so every
   * failure to write it degrades cleanup, and it degrades it silently: a missing
   * record is indistinguishable from "we created nothing". That direction is the safe
   * one and was chosen deliberately — but safe-direction is not the same as correct,
   * and reversibility is the guarantee the live install was authorised on.
   *
   * A REGULAR FILE AT `~/.harness` is the instrument for the same reason a DIRECTORY
   * at the config path is: platform-independent, and not bypassed by running as root.
   */
  it('refuses BY NAME and leaves the config exactly as it found it', () => {
    mkdirSync(join(home, '.cursor'), { recursive: true });
    writeFileSync(join(home, '.harness'), 'occupied');
    const config = join(home, '.cursor', 'hooks.json');
    expect(existsSync(config)).toBe(false);

    const report = JSON.parse(run(['install', '--json'])) as {
      installed: { agent: string }[];
      failed: { agent: string; reason: string }[];
    };

    // Named, with the path that has to be fixed — not a silent skip.
    const cursor = report.failed.find((f) => f.agent === 'cursor');
    expect(cursor).toBeDefined();
    expect(cursor?.reason).toContain('install-record.json');
    expect(report.installed).toEqual([]);
    // And the machine is as it was: no orphan to find later.
    expect(existsSync(config)).toBe(false);
  });
});
