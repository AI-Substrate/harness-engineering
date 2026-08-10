import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../../src/adapters/clock/fake-clock.js';
import { NodeHash } from '../../../../src/adapters/hash/node-hash.js';
import {
  installCollector,
  recheckCollector,
} from '../../../../src/services/doctor/collector/install.js';
import { GITAI_PIN } from '../../../../src/services/doctor/collector/pin.js';
import { readCollectorState } from '../../../../src/services/doctor/collector/state.js';
import {
  type CollectorDeps,
  VIABILITY_TIMEOUT_MS,
} from '../../../../src/services/doctor/collector/types.js';
import {
  FakeCollectorFs,
  FakeDownload,
  FakeExecutableBit,
  FakePathKind,
  FakeSequencedExec,
  ok200,
} from '../../../support/collector-fakes.js';

/**
 * Plan 082 · F007 — A VERIFIED DIGEST IS NOT A RUNNABLE BINARY.
 *
 * Measured on a Windows 11 guest, 2026-08-10, against the pinned git-ai release:
 *
 *     git-ai CLI: already-current
 *     git-ai hooks: failed
 *     warnings:
 *       install-hooks exited 3221225781
 *
 * Both lines were true and together they were nonsense. `already-current` is a
 * claim about BYTES ON DISK — we fetched the pinned artifact, SHA-256 verified
 * it, recorded it — and then handed those bytes the most destructive command in
 * the flow without ever asking the binary to do anything at all. A digest proves
 * PROVENANCE; it does not prove VIABILITY. `3221225781` is `0xC0000135`,
 * STATUS_DLL_NOT_FOUND: the Windows loader killed the process before a line of
 * its own code ran, which is why its stderr was empty and our message degenerated
 * to a ten-digit integer with no next action.
 *
 * These rows are CI-safe on any platform: the "broken binary" is a fake exec port
 * returning an exit code, not a real one. Nothing here has been run on Windows by
 * the author of this file — see the EXPECTED-UNVERIFIED notes on the rows that
 * describe Windows behaviour.
 */

const HOME = '/home/u';
const REPO = '/repo';
const NOW = '2026-08-10T10:00:00.000Z';
const BINARY = '/home/u/.git-ai/bin/git-ai';
const TRACE2_GET = 'git config --global --get-regexp ^trace2\\.';
const GITAI_TRACE2 =
  'trace2.eventtarget af_unix:/home/u/.git-ai/internal/daemon/trace2.sock\ntrace2.eventnesting 5';
const TRACE2_EMPTY_THEN_INSTALLED = [
  { code: 1, stdout: '' },
  { code: 0, stdout: `${GITAI_TRACE2}\n` },
];
const PAYLOAD = new TextEncoder().encode('#!/bin/sh\necho git-ai\n');
const ARTIFACT_URL = `${GITAI_PIN.release_base_url}/${GITAI_PIN.version}/git-ai-macos-arm64`;

/** STATUS_DLL_NOT_FOUND, as the Windows 11 guest reported it on 2026-08-10. */
const DLL_NOT_FOUND = 3_221_225_781;

function testPin() {
  const digest = new NodeHash().sha256Hex(PAYLOAD);
  return {
    ...GITAI_PIN,
    artifacts: {
      ...GITAI_PIN.artifacts,
      'macos-arm64': { file: 'git-ai-macos-arm64', sha256: digest },
    },
  } as typeof GITAI_PIN;
}

/**
 * The happy-path script, with ONE knob: what the binary says when asked to
 * identify itself. Everything else models a machine where the install works.
 */
function script(version: { code: number; stdout?: string; stderr?: string }) {
  return {
    [TRACE2_GET]: TRACE2_EMPTY_THEN_INSTALLED,
    [`${BINARY} --version`]: version,
    [`${BINARY} install-hooks`]: {
      code: 0,
      stdout: 'Claude Code: Hooks updated\nCodex: Hooks updated\n',
    },
    [`${BINARY} status --json`]: { code: 0, stdout: '{"schema_version":"authorship/3.0.0"}' },
  };
}

function deps(
  over: { versionResult?: { code: number; stdout?: string; stderr?: string } } = {},
  scripts?: Record<string, unknown>,
): CollectorDeps & { fs: FakeCollectorFs; exec: FakeSequencedExec } {
  const fs = new FakeCollectorFs();
  fs.mkdirp(`${HOME}/.claude`);
  fs.mkdirp(`${HOME}/.codex`);
  const exec = new FakeSequencedExec(
    (scripts ?? script(over.versionResult ?? { code: 0, stdout: 'git-ai 1.6.22\n' })) as never,
    {
      [`${BINARY} install-hooks`]: {
        [`${HOME}/.claude/settings.json`]: '{"hooks":{"git-ai":true}}',
        [`${HOME}/.codex/config.toml`]: 'hooks = ["git-ai"]\n',
      },
    },
    fs,
  );
  return {
    fs,
    exec,
    hash: new NodeHash(),
    paths: new FakePathKind(),
    http: new FakeDownload({ [ARTIFACT_URL]: ok200(PAYLOAD) }),
    exe: new FakeExecutableBit(),
    clock: new FakeClock(NOW),
    host: { platform: 'darwin', arch: 'arm64', home: HOME },
    cwd: REPO,
    manifest: testPin(),
  };
}

const hookCalls = (d: { exec: FakeSequencedExec }) =>
  d.exec.calls.filter((call) => call.args[0] === 'install-hooks');

describe('F007a — the binary must PROVE it can run before it is handed install-hooks', () => {
  /**
   * ROW 1, and the whole point of the feature: the assertion is on the CALL LOG,
   * not on the returned status. A test that only checked the status would pass
   * while `install-hooks` still ran — and `install-hooks` resets the global git
   * trace2 section, restarts the daemon and rewrites every agent config on the
   * machine. NOT ATTEMPTING it is the behaviour being bought here.
   */
  it('a binary that cannot execute NEVER reaches install-hooks', async () => {
    const d = deps({ versionResult: { code: DLL_NOT_FOUND, stdout: '', stderr: '' } });

    const result = await installCollector(d);

    expect(hookCalls(d)).toEqual([]);
    expect(result.hooks).toBe('binary-unusable');
    // Stage 1 still stands, and says so: the bytes ARE placed and verified. The
    // defect was never the download.
    expect(result.cli).toBe('installed');
    expect(d.fs.exists(BINARY)).toBe(true);
  });

  /**
   * ROW 2 — the counter-row. Without it, "never invoke install-hooks" is
   * trivially satisfied by never invoking it at all, and every row above would
   * still be green with the feature bricked.
   */
  it('a binary that identifies itself proceeds to install-hooks exactly as before', async () => {
    const d = deps();

    const result = await installCollector(d);

    expect(hookCalls(d)).toHaveLength(1);
    expect(hookCalls(d)[0]?.args).toEqual(['install-hooks']);
    expect(result.hooks).toBe('installed');
  });

  it('asks the binary the CHEAPEST self-identifying question, under a short timeout', async () => {
    const d = deps();

    await installCollector(d);

    const probe = d.exec.calls.find((call) => call.args[0] === '--version');
    expect(probe?.command).toBe(BINARY);
    expect(probe?.args).toEqual(['--version']);
    // A viability probe that can hang for the install-hooks ceiling (120s) is not
    // a probe, it is a second way to wedge doctor.
    expect(probe?.timeoutMs).toBeLessThanOrEqual(15_000);
    // And it is asked BEFORE the destructive command, not alongside it.
    const order = d.exec.calls.map((call) => call.args[0]);
    expect(order.indexOf('--version')).toBeLessThan(order.indexOf('install-hooks'));
  });

  it('exits 0 but says NOTHING ⇒ still refused: a silent probe is not evidence it ran', async () => {
    const d = deps({ versionResult: { code: 0, stdout: '', stderr: '' } });

    const result = await installCollector(d);

    expect(hookCalls(d)).toEqual([]);
    expect(result.hooks).toBe('binary-unusable');
  });

  it('a probe that cannot be spawned at all is binary-unusable, not a crash', async () => {
    const d = deps();
    const throwing = {
      run: async (command: string, args: string[], opts: { cwd: string; timeoutMs?: number }) => {
        if (command === BINARY && args[0] === '--version') throw new Error('spawn ENOENT');
        return d.exec.run(command, args, opts);
      },
    };

    const result = await installCollector({ ...d, exec: throwing });

    expect(hookCalls(d)).toEqual([]);
    expect(result.hooks).toBe('binary-unusable');
    expect(result.warnings.join(' ')).toContain('spawn ENOENT');
  });

  /**
   * The SECOND DOOR. `recheckCollector` invokes the same `installHooks`, so a
   * guard that only ran on first install would protect the first run and hand a
   * broken binary the destructive command on every re-check afterwards.
   */
  it('the re-check goes through the same guard — a new agent does not buy an unusable binary a run', async () => {
    // A machine that installed cleanly earlier…
    const good = deps();
    await installCollector(good);

    // …then a new coding harness appears, and the binary no longer loads.
    const broken = deps({ versionResult: { code: DLL_NOT_FOUND } });
    for (const [path, bytes] of good.fs.files) broken.fs.seedBytes(path, bytes);
    broken.fs.mkdirp(`${HOME}/.cursor`);

    const result = await recheckCollector(broken);

    expect(result.newAgents).toContain('cursor');
    expect(hookCalls(broken)).toEqual([]);
    expect(result.hooks).toBe('binary-unusable');
    // The gap is still reported, and the coverage that exists is untouched.
    expect(result.coverage.status).toBe('installed');
    expect(result.coverage.agents).toEqual(['claude', 'codex']);
  });

  /**
   * Nothing was invoked, so nothing on the machine changed — the same rule the
   * trace2 and skills guards already follow. Hooks proven installed earlier are
   * still installed and still collecting, and overwriting that with `agents: []`
   * would announce that attribution had stopped when it had not.
   */
  it('refusing changes NOTHING on the machine — prior coverage survives, the attempt is recorded', async () => {
    const good = deps();
    await installCollector(good);
    expect(readCollectorState(good.fs, REPO)?.hooks.status).toBe('installed');

    // Same machine, same state file, a binary that has since stopped loading.
    const broken = deps({ versionResult: { code: DLL_NOT_FOUND } });
    for (const [path, bytes] of good.fs.files) broken.fs.seedBytes(path, bytes);

    const result = await installCollector(broken);

    expect(result.hooks).toBe('binary-unusable');
    const state = readCollectorState(broken.fs, REPO);
    expect(state?.hooks.status).toBe('installed');
    expect(state?.hooks.agents).toEqual(['claude', 'codex']);
    expect(state?.last_attempt?.status).toBe('binary-unusable');
  });
});

describe('F007b — a process the OS killed produced no output, and we say which OS and why', () => {
  /**
   * EXPECTED-UNVERIFIED as to Windows behaviour of THIS code; the exit code and
   * the empty stderr are MEASURED (Windows 11 guest, 2026-08-10, pinned git-ai
   * release). The cause is measured too: installing
   * `Microsoft.VCRedist.2015+.x64` turned this exact failure into
   * `git-ai hooks: installed` with no other change.
   */
  it('names the class, prints the hex, and names the redistributable for 0xC0000135', async () => {
    const d = deps({ versionResult: { code: DLL_NOT_FOUND, stdout: '', stderr: '' } });

    const result = await installCollector(d);
    const said = result.warnings.join(' ');

    expect(said).toContain('3221225781');
    // `3221225781` is un-Googleable in a way `0xC0000135` is not.
    expect(said).toContain('0xC0000135');
    expect(said).toContain('STATUS_DLL_NOT_FOUND');
    expect(said).toContain('Visual C++ Redistributable');
    expect(readCollectorState(d.fs, REPO)?.last_attempt?.detail).toContain('0xC0000135');
  });

  it('translates the two other named codes, and falls back honestly on the rest', async () => {
    const initFailed = deps({ versionResult: { code: 3_221_225_794 } });
    expect((await installCollector(initFailed)).warnings.join(' ')).toContain(
      'STATUS_DLL_INIT_FAILED',
    );

    const crashed = deps({ versionResult: { code: 3_221_225_477 } });
    expect((await installCollector(crashed)).warnings.join(' ')).toContain(
      'STATUS_ACCESS_VIOLATION',
    );

    // An NTSTATUS we have NOT named must still be legible: the hex, the class,
    // and the one fact that always follows — no output was produced because the
    // process never got to produce any. No invented cause.
    const unknown = deps({ versionResult: { code: 3_221_225_600 } });
    const said = (await installCollector(unknown)).warnings.join(' ');
    expect(said).toContain('0xC0000080');
    expect(said).toContain('NTSTATUS');
    expect(said).not.toContain('STATUS_DLL_NOT_FOUND');
  });

  /**
   * ROW 4 — the row that stops this becoming a blanket rewrite. An ordinary
   * vendor failure (non-zero, not an NTSTATUS, with something to say) must be
   * reported exactly as it was before F007 existed.
   */
  it('an ORDINARY non-zero exit with stderr is reported unchanged — no hex, no NTSTATUS', async () => {
    const d = deps(
      {},
      {
        ...script({ code: 0, stdout: 'git-ai 1.6.22\n' }),
        [`${BINARY} install-hooks`]: { code: 3, stderr: 'error: could not write settings.json\n' },
      },
    );

    const result = await installCollector(d);

    expect(result.hooks).toBe('failed');
    expect(result.warnings.join(' ')).toContain(
      'install-hooks exited 3: error: could not write settings.json',
    );
    expect(result.warnings.join(' ')).not.toContain('NTSTATUS');
    expect(result.warnings.join(' ')).not.toContain('0x');
  });

  /**
   * ROW 5 — we are adding context, never replacing evidence. A process that
   * printed something was not killed before it could speak, so the "terminated
   * before it produced output" sentence would be FALSE here. The vendor's own
   * words lead; the hex is annotation.
   */
  it('an NTSTATUS code WITH vendor output keeps the vendor’s words and only annotates the hex', async () => {
    const d = deps(
      {},
      {
        ...script({ code: 0, stdout: 'git-ai 1.6.22\n' }),
        [`${BINARY} install-hooks`]: {
          code: DLL_NOT_FOUND,
          stderr: 'error: daemon refused the socket\n',
        },
      },
    );

    const result = await installCollector(d);
    const said = result.warnings.join(' ');

    expect(result.hooks).toBe('failed');
    expect(said).toContain('error: daemon refused the socket');
    expect(said).toContain('0xC0000135');
    expect(said).not.toContain('terminated by the');
    expect(said).not.toContain('Visual C++ Redistributable');
  });
});

/**
 * F1 (review round 2) — BOUNDING THE STAGE YOU ADDED IS NOT BOUNDING THE PIPELINE.
 *
 * The first cut of F007 gave the `--version` probe its own short constant and
 * stopped there. It never asked what runs AFTER the refusal: `installCollector`
 * called `assertNoteSchema` unconditionally, which invokes the SAME dead binary
 * as `status --json` on a separate 15s budget. So a carefully-bounded 5s guard
 * cost 20s end to end — and because `binary-unusable` is deliberately not
 * latched, a broken box paid it again on every bare `harness doctor`.
 *
 * THE INSTRUMENT. The exec fake converts the timeout BUDGET each call is handed
 * into an observable, by sleeping it on the fake clock. That models a binary
 * that HANGS rather than one that fails fast — the observed Windows failure
 * returns instantly, but a probe on a path nobody opted into has to survive the
 * other failure modes too, which is exactly what condition A was about.
 */
describe('F1 — the whole pipeline is bounded, not just the stage that was added', () => {
  /** A binary that never answers: every call burns its full budget. */
  function hanging(base: ReturnType<typeof deps>, clock: FakeClock) {
    const binaryCalls: string[][] = [];
    return {
      binaryCalls,
      exec: {
        run: async (command: string, args: string[], opts: { cwd: string; timeoutMs?: number }) => {
          if (command !== BINARY) return base.exec.run(command, args, opts);
          binaryCalls.push(args);
          await clock.sleep(opts.timeoutMs ?? 0);
          return { code: 124, stdout: '', stderr: '', ok: false };
        },
      },
    };
  }

  it('a refusal ENDS the run: the dead binary is invoked ONCE, for the probe alone', async () => {
    const clock = new FakeClock(NOW);
    const base = deps();
    const { exec, binaryCalls } = hanging(base, clock);

    const result = await installCollector({ ...base, clock, exec });

    expect(result.hooks).toBe('binary-unusable');
    // NOT `install-hooks`, and NOT `status --json`. One question was asked, it
    // was not answered, and the pipeline stopped.
    expect(binaryCalls).toEqual([['--version']]);
  });

  it('the END-TO-END ceiling is the probe timeout, not the probe timeout PLUS the schema probe', async () => {
    const clock = new FakeClock(NOW);
    const base = deps();
    const { exec } = hanging(base, clock);

    await installCollector({ ...base, clock, exec });

    // The assertion the first round did not make. Asserting the `--version`
    // call's own timeoutMs passed while the run cost 20s.
    expect(clock.sleeps).toEqual([VIABILITY_TIMEOUT_MS]);
  });

  /**
   * THE COUNTER-ROW. "Skip the schema probe" is trivially satisfied by never
   * running it at all — which would silently delete ac-000f's note-schema drift
   * check for every healthy machine. The skip is conditional on the refusal.
   */
  it('a binary that RUNS still gets its post-install schema probe, exactly as before', async () => {
    const d = deps();

    await installCollector(d);

    expect(d.exec.calls.filter((c) => c.args[0] === 'status')).toHaveLength(1);
    expect(readCollectorState(d.fs, REPO)?.note_schema.status).toBe('match');
  });
});
