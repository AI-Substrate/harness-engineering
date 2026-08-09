import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../../src/adapters/clock/fake-clock.js';
import { NodeHash } from '../../../../src/adapters/hash/node-hash.js';
import {
  AGENT_MARKERS,
  agentsMissingHooks,
  UNDETECTED_INSTALLERS,
} from '../../../../src/services/doctor/collector/agents.js';
import {
  autoInstallCollector,
  COLLECTOR_OPT_OUT_ENV,
} from '../../../../src/services/doctor/collector/auto-install.js';
import {
  autoInstallBlockPath,
  readAutoInstallBlock,
} from '../../../../src/services/doctor/collector/auto-install-block.js';
import { backupDirFor } from '../../../../src/services/doctor/collector/backup.js';
import { readCollectorHealth } from '../../../../src/services/doctor/collector/health.js';
import { recheckCollector } from '../../../../src/services/doctor/collector/install.js';
import { GITAI_PIN } from '../../../../src/services/doctor/collector/pin.js';
import { configPathFor } from '../../../../src/services/doctor/collector/platform.js';
import {
  type CollectorState,
  collectorStatePath,
  emptyCollectorState,
} from '../../../../src/services/doctor/collector/state.js';
import type { CollectorDeps } from '../../../../src/services/doctor/collector/types.js';
import {
  FakeCollectorFs,
  FakeDownload,
  FakeExecutableBit,
  FakePathKind,
  FakeSequencedExec,
} from '../../../support/collector-fakes.js';

/**
 * Plan 077 · packet §3a/§3b/§3c — a BARE `harness doctor` installs the collector.
 *
 * Everything here runs on fakes, and that is the deliberate instrument choice
 * rather than a convenience. These are DECISION-LOGIC cases — does the guard
 * refuse, does a failure stay warn-only, is a machine fact recorded machine-wide
 * — and every one of them is reachable without a real binary, a real HOME or a
 * real editor. The alternative instrument (a seeded fake HOME running a real
 * `install-hooks`) buys evidence about GIT-AI's behaviour, which is the one
 * class of evidence it cannot safely collect on a working machine: the vendor
 * command resets the global git trace2 section, rewrites agent configs with no
 * backups, and resolves VS Code through an ABSOLUTE `/Applications` path that no
 * HOME override can contain.
 *
 * So: our logic is proven here; git-ai's real behaviour is proven on a
 * disposable VM, and the two are not substitutes.
 */

const HOME = '/home/u';
const REPO = '/repo';
const NOW = '2026-08-09T00:00:00.000Z';
const BINARY = '/home/u/.git-ai/bin/git-ai';
const PAYLOAD = new TextEncoder().encode('#!/bin/sh\necho git-ai\n');
const DIGEST = new NodeHash().sha256Hex(PAYLOAD);

function pin() {
  return {
    ...GITAI_PIN,
    artifacts: {
      ...GITAI_PIN.artifacts,
      'macos-arm64': { file: 'git-ai-macos-arm64', sha256: DIGEST },
    },
  } as typeof GITAI_PIN;
}

function deps(over: Partial<CollectorDeps> = {}): CollectorDeps {
  return {
    fs: new FakeCollectorFs(),
    paths: new FakePathKind({}),
    hash: new NodeHash(),
    http: new FakeDownload({}),
    exec: new FakeSequencedExec({}),
    exe: new FakeExecutableBit(),
    clock: new FakeClock(NOW),
    host: { platform: 'darwin', arch: 'arm64', home: HOME },
    cwd: REPO,
    manifest: pin(),
    ...over,
  };
}

function healthyState(): CollectorState {
  const base = emptyCollectorState(NOW, GITAI_PIN);
  return {
    ...base,
    cli: {
      status: 'installed',
      path: BINARY,
      digest: DIGEST,
      verified_at: NOW,
      executable: true,
      detail: 'installed',
    },
    hooks: { status: 'installed', at: NOW, agents: ['claude'], detail: 'hooks installed' },
    trace2: [{ observed: 'empty', entries: [], at: NOW }],
    note_schema: { expected: 'authorship/3.0.0', observed: 'authorship/3.0.0', status: 'match' },
  };
}

/**
 * The exact `git` invocation `readGlobalTrace2` makes, as the exec fake keys it.
 *
 * Spelled out rather than reconstructed so that a change to the read — a
 * different regexp, a `--list` form — makes these fixtures MISS and the tests go
 * red, instead of silently falling through to the fake's permissive default
 * (`{ code: 0 }`, empty stdout), which `readGlobalTrace2` reads as EMPTY. An
 * unscripted fake would open the guard, which is the wrong direction to fail.
 */
const TRACE2_READ = 'git config --global --get-regexp ^trace2\\.';
const TRACE2_PRESENT = {
  code: 0,
  stdout: 'trace2.eventtarget /Users/x/git-trace.log\ntrace2.eventnesting 3\n',
};

/** CLI installed and verified; the hook install refused by the trace2 guard. */
function skippedByTrace2(): CollectorState {
  return {
    ...healthyState(),
    hooks: {
      status: 'skipped-trace2',
      at: NOW,
      agents: [],
      detail: 'a global trace2 config is present',
    },
  };
}

describe('§3a — a healthy collector is left alone', () => {
  it('does nothing, and says nothing, when everything is already in place', async () => {
    const fs = new FakeCollectorFs();
    fs.seedBytes(BINARY, PAYLOAD);
    fs.mkdirp(`${HOME}/.claude`);
    fs.writeText(collectorStatePath(REPO), JSON.stringify(healthyState()));
    const http = new FakeDownload({});

    const outcome = await autoInstallCollector(deps({ fs, http }));

    expect(outcome.action).toBe('not-needed');
    expect(outcome.detail).toBe('');
    // The strongest form of "did nothing": the network port was never consulted.
    expect(http.calls).toEqual([]);
  });
});

describe('§3b — the ONE warn case: a pre-existing global trace2 config', () => {
  it('REFUSES to install hooks and names what install-hooks would have deleted', async () => {
    // CLI installed and verified, hooks skipped by the guard on a previous run.
    const fs = new FakeCollectorFs();
    fs.seedBytes(BINARY, PAYLOAD);
    fs.writeText(collectorStatePath(REPO), JSON.stringify(skippedByTrace2()));
    // The LIVE config still has the operator's keys — the record and the machine
    // agree, so the refusal stands.
    const exec = new FakeSequencedExec({ [TRACE2_READ]: TRACE2_PRESENT });

    const outcome = await autoInstallCollector(deps({ fs, exec }));

    expect(outcome.action).toBe('skipped-guard');
    expect(outcome.detail).toContain('trace2');
    expect(outcome.detail).toContain('machine-wide');
    // A guard is not verified until it has REFUSED: git-ai was never invoked.
    // The ONLY thing executed is the read-only config read this branch now takes.
    expect(exec.calls.map((c) => [c.command, ...c.args].join(' '))).toEqual([TRACE2_READ]);
  });

  it('names a command that WORKS from where the operator is standing', async () => {
    const fs = new FakeCollectorFs();
    fs.seedBytes(BINARY, PAYLOAD);
    fs.writeText(collectorStatePath(REPO), JSON.stringify(skippedByTrace2()));

    const outcome = await autoInstallCollector(
      deps({ fs, exec: new FakeSequencedExec({ [TRACE2_READ]: TRACE2_PRESENT }) }),
    );

    // The latch's operator-facing half: our advice led to a re-run, and the
    // re-run repeated the refusal without ever naming the way out.
    expect(outcome.detail).toContain('harness doctor');
    expect(outcome.detail).toContain('--install-collector');
    // NOT `--recheck-collector`: it returns early when no new agent is detected
    // (pinned by the test below), so it is not a remedy for this state.
    expect(outcome.detail).not.toContain('--recheck-collector');
  });

  it('UNLATCHES: the recorded refusal does not outlive the config that caused it', async () => {
    // THE REGRESSION. Recorded status is `skipped-trace2` — the state a previous
    // doctor run left behind — but the operator has since done exactly what our
    // next_action told them and removed the section. A guard that cannot stop
    // refusing is as broken as one that cannot start, and this one could not:
    // the verdict was read from the record, the record was only rewritten by an
    // attempt, and no attempt was made while the record said `skipped-trace2`.
    const fs = new FakeCollectorFs();
    fs.seedBytes(BINARY, PAYLOAD);
    fs.mkdirp(`${HOME}/.claude`);
    fs.writeText(collectorStatePath(REPO), JSON.stringify(skippedByTrace2()));
    const exec = new FakeSequencedExec({
      // THREE reads happen on this path, in order: the unlatch check added here,
      // `installHooks`' own guard, and the post-install verification that git-ai
      // wrote its key. The first two must report EMPTY (git exits 1 with no
      // output when the regexp matched nothing — the genuine empty answer); the
      // third must report git-ai's own key, or the install records `unverified`.
      [TRACE2_READ]: [
        { code: 1 },
        { code: 1 },
        { code: 0, stdout: 'trace2.eventtarget af_unix:/tmp/s\ntrace2.eventnesting 3\n' },
      ],
      [`${BINARY} install-hooks`]: { code: 0, stdout: 'hooks installed' },
    });

    const outcome = await autoInstallCollector(deps({ fs, exec }));

    expect(outcome.action).toBe('installed');
    // `action: 'installed'` alone is NOT the property — it reports the CLI
    // stage, and stays `installed` even when the hook stage was refused. The
    // first draft of this test passed on exactly that, with hooks still skipped.
    expect(outcome.detail).toContain('hooks: installed');
    // The proof it is not merely a nicer message: the vendor command RAN.
    expect(exec.calls.some((c) => c.args.includes('install-hooks'))).toBe(true);
    // And the record no longer says the thing that is no longer true.
    const health = readCollectorHealth({
      fs,
      host: { platform: 'darwin', arch: 'arm64', home: HOME },
      cwd: REPO,
      hash: new NodeHash(),
      manifest: pin(),
    });
    expect(health.verdict).not.toBe('cli-only-trace2');
  });

  it('fails CLOSED when the live config cannot be read — unknown is not empty', async () => {
    // The mirror of the unlatch: re-reading must not become a way to talk the
    // guard into opening. `mayInstallHooks` treats `unknown` as present, and
    // this branch uses that same predicate rather than its own comparison.
    const fs = new FakeCollectorFs();
    fs.seedBytes(BINARY, PAYLOAD);
    fs.writeText(collectorStatePath(REPO), JSON.stringify(skippedByTrace2()));
    const exec = new FakeSequencedExec({ [TRACE2_READ]: { code: 128, stderr: 'no git here' } });

    const outcome = await autoInstallCollector(deps({ fs, exec }));

    expect(outcome.action).toBe('skipped-guard');
    expect(exec.calls.some((c) => c.args.includes('install-hooks'))).toBe(false);
  });

  it('pins WHY the unlatch routes through install and not recheck', async () => {
    // `recheckCollector` short-circuits on "no new agents", which is precisely
    // the shape of an operator who changed only their trace2 config. Routing the
    // unlatch through it would have reported success having done nothing — so
    // this asserts the early return exists, rather than trusting the reading of
    // it. Callers: `acts/doctor.ts` (--recheck-collector) and nothing else.
    const fs = new FakeCollectorFs();
    fs.seedBytes(BINARY, PAYLOAD);
    fs.mkdirp(`${HOME}/.claude`);
    fs.writeText(
      collectorStatePath(REPO),
      JSON.stringify({
        ...skippedByTrace2(),
        hooks: { status: 'installed', at: NOW, agents: ['claude'], detail: 'hooks installed' },
      }),
    );
    const exec = new FakeSequencedExec({});

    const result = await recheckCollector(deps({ fs, exec }));

    expect(result.newAgents).toEqual([]);
    expect(exec.calls).toEqual([]);
  });
});

describe('§3c — failure is warn-only, and is not retried on every run', () => {
  it('records the failure MACHINE-WIDE and points at the explicit retry', async () => {
    const fs = new FakeCollectorFs();
    const http = new FakeDownload({}); // no script ⇒ every download fails

    const outcome = await autoInstallCollector(deps({ fs, http }));

    expect(outcome.action).toBe('failed');
    expect(outcome.detail).toContain('--install-collector');
    expect(outcome.detail).toContain('NOT be retried');

    // Recorded against HOME, not the repo: the fact is about the machine, so a
    // developer with ten repos must not get ten failed downloads.
    const written = readAutoInstallBlock(fs, {
      platform: 'darwin',
      arch: 'arm64',
      home: HOME,
    });
    expect(written).not.toBeNull();
    expect(autoInstallBlockPath(HOME)).toBe('/home/u/.git-ai/harness-autoinstall.json');
  });

  it('a SECOND run does not download again — it reports the recorded failure', async () => {
    const fs = new FakeCollectorFs();
    await autoInstallCollector(deps({ fs, http: new FakeDownload({}) }));

    const second = new FakeDownload({});
    const outcome = await autoInstallCollector(deps({ fs, http: second }));

    expect(outcome.action).toBe('skipped-blocked');
    // The assertion that makes the first one mean something.
    expect(second.calls).toEqual([]);
  });

  it('a throw from a DOWNSTREAM port is handled without escaping', async () => {
    const fs = new FakeCollectorFs();
    const exploding = {
      ...new FakeDownload({}),
      get: () => {
        throw new Error('boom');
      },
    } as unknown as CollectorDeps['http'];

    const outcome = await autoInstallCollector(deps({ fs, http: exploding }));

    // Handled by `downloadAndVerify`, so it never reaches the outer catch — worth
    // asserting separately from the case below, because a test that only covers
    // this one would claim the outer guard works while never exercising it.
    expect(outcome.action).toBe('failed');
    expect(outcome.detail).toContain('Doctor continued');
  });

  it('an UNEXPECTED throw that escapes every inner handler is still caught', async () => {
    // The hard requirement: this now runs on every doctor invocation, so an
    // escaping error would break a command nobody opted into. `fs.exists` throws
    // during the very first health read, which is upstream of every try/catch in
    // the install path — so only the outer guard can catch it.
    const hostile = new FakeCollectorFs();
    const fs = new Proxy(hostile, {
      get(target, prop, receiver) {
        if (prop === 'exists') {
          return () => {
            throw new Error('fs exploded');
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const outcome = await autoInstallCollector(deps({ fs }));

    expect(outcome.action).toBe('failed');
    expect(outcome.detail).toContain('fs exploded');
    expect(outcome.detail).toContain('doctor continued');
  });
});

describe('§3a — an unsupported platform is never retried and never guessed at', () => {
  it('reports rather than handing an unsupported host some other arch’s binary', async () => {
    const outcome = await autoInstallCollector(
      deps({ host: { platform: 'sunos', arch: 'sparc', home: HOME } }),
    );

    expect(outcome.action).toBe('skipped-unsupported');
    expect(outcome.detail).toContain('publishes no');
  });
});

describe('HARNESS_NO_COLLECTOR=1 — a different consent from HARNESS_NO_TELEMETRY', () => {
  it('installs NOTHING and never consults the network', async () => {
    const http = new FakeDownload({});
    const exec = new FakeSequencedExec({});

    const outcome = await autoInstallCollector(deps({ http, exec }), true);

    expect(outcome.action).toBe('skipped-opt-out');
    expect(outcome.detail).toContain(COLLECTOR_OPT_OUT_ENV);
    // Nothing downloaded, nothing executed, no agent config rewritten.
    expect(http.calls).toEqual([]);
    expect(exec.calls).toEqual([]);
  });

  it('is honoured BEFORE any filesystem read — a hostile fs cannot even be reached', async () => {
    // Proves the opt-out is a true short-circuit rather than a late branch: if
    // anything touched the disk first, this throwing fs would surface as a
    // `failed` outcome instead.
    const hostile = new Proxy(new FakeCollectorFs(), {
      get(target, prop, receiver) {
        if (prop === 'exists') {
          return () => {
            throw new Error('should never be called');
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const outcome = await autoInstallCollector(deps({ fs: hostile }), true);

    expect(outcome.action).toBe('skipped-opt-out');
  });

  it('the doctor ROW says opted-out, not could-not-determine (the honesty rule)', async () => {
    // Same on-disk facts as a machine where the install silently failed. The
    // only difference is that we know WHY — and a row that cannot express the
    // difference sends a developer debugging a choice they made on purpose.
    const fs = new FakeCollectorFs();
    fs.seedBytes(BINARY, PAYLOAD); // binary present, no harness record

    const optedOut = readCollectorHealth({
      fs,
      host: { platform: 'darwin', arch: 'arm64', home: HOME },
      cwd: REPO,
      hash: new NodeHash(),
      manifest: pin(),
      optedOut: true,
    });
    const notOptedOut = readCollectorHealth({
      fs,
      host: { platform: 'darwin', arch: 'arm64', home: HOME },
      cwd: REPO,
      hash: new NodeHash(),
      manifest: pin(),
    });

    expect(optedOut.detail).toContain('DELIBERATE opt-out');
    expect(optedOut.next_action).not.toContain('re-run doctor');
    // The control that makes the assertion mean something: the SAME fs without
    // the opt-out must NOT say that.
    expect(notOptedOut.detail).not.toContain('DELIBERATE opt-out');
  });
});

describe('agents — the one-directional diff is a DECLARED non-goal, pinned here', () => {
  it('reports detected-but-not-covered (the real gap)', () => {
    const missing = agentsMissingHooks(
      [
        { id: 'claude', label: 'Claude Code', marker: '.claude', configs: [] },
        { id: 'cursor', label: 'Cursor', marker: '.cursor', configs: [] },
      ],
      ['claude'],
    );

    expect(missing.map((a) => a.id)).toEqual(['cursor']);
  });

  it('stays SILENT on covered-but-not-detected, on purpose', () => {
    // git-ai hooked `vscode`, which we have no marker for. That means MORE is
    // instrumented than we can see — never bad news about the machine, and it
    // would fire on every box with VS Code installed, forever.
    //
    // This test exists so the asymmetry cannot be "fixed" by accident: if a
    // future change starts reporting the reverse direction, this fails and the
    // reasoning in `agents.ts` has to be revisited deliberately.
    const missing = agentsMissingHooks(
      [{ id: 'claude', label: 'Claude Code', marker: '.claude', configs: [] }],
      ['claude', 'vscode', 'cline', 'jetbrains'],
    );

    expect(missing).toEqual([]);
  });

  it('names the measured registry gap as a constant a reader can check', () => {
    // MEASURED from git-ai's `get_all_installers` (src/mdm/agents/mod.rs:38-59):
    // 14 installers on POSIX, 15 on Windows. We detect 11.
    expect(UNDETECTED_INSTALLERS).toContain('Cline');
    expect(UNDETECTED_INSTALLERS).toContain('VSCode');
    expect(UNDETECTED_INSTALLERS).toContain('JetBrains');
    expect(AGENT_MARKERS.length + UNDETECTED_INSTALLERS.length).toBe(15);
  });
});

/**
 * The three P1s from the cross-model review (pij-assistant-asp / gpt-5.6-terra,
 * 2026-08-09). Every one of them was reachable through the shipped code and
 * NONE of them turned a test red — the 358-test doctor suite stayed green with
 * all three defects live, which is why they are pinned here rather than only
 * fixed.
 */
describe('P1-A — a failing HOOK stage is recorded, not repeated forever', () => {
  /** CLI already placed and current; the hook stage is what we drive. */
  function readyToHook(): { fs: FakeCollectorFs } {
    const fs = new FakeCollectorFs();
    fs.seedBytes(BINARY, PAYLOAD);
    fs.mkdirp(`${HOME}/.claude`);
    fs.writeText(collectorStatePath(REPO), JSON.stringify(skippedByTrace2()));
    return { fs };
  }

  it('BLOCKS after install-hooks fails — the repeat rewrote agent configs every run', async () => {
    // The defect: only `cli === 'failed'` wrote the block, so a successful CLI
    // with a failed hook stage returned `installed`, recorded nothing, and left a
    // `degraded` reading that routed straight back here on the next bare doctor.
    // Each repeat re-ran a command that rewrites every detected agent's config in
    // place and discards its JSONC comments.
    const { fs } = readyToHook();
    const exec = new FakeSequencedExec({
      [TRACE2_READ]: { code: 1 },
      [`${BINARY} install-hooks`]: { code: 3, stderr: 'boom' },
    });

    const first = await autoInstallCollector(deps({ fs, exec }));

    expect(first.action).toBe('failed');
    expect(
      readAutoInstallBlock(fs, { platform: 'darwin', arch: 'arm64', home: HOME }),
    ).not.toBeNull();

    // THE PROPERTY, and it is the one the old code failed: a second bare doctor
    // does not run the destructive command again.
    const second = new FakeSequencedExec({
      [TRACE2_READ]: { code: 1 },
      [`${BINARY} install-hooks`]: { code: 3, stderr: 'boom' },
    });
    const repeat = await autoInstallCollector(deps({ fs, exec: second }));

    expect(repeat.action).toBe('skipped-blocked');
    expect(second.calls).toEqual([]);
  });

  it('BLOCKS on `unverified` too — a zero exit that hooked nothing is not success', async () => {
    // git-ai's arg parser ends in `_ => {}`, so it exits 0 for invocations it
    // never understood. `unverified` is that outcome, and it re-entered the loop
    // exactly like `failed` did.
    const { fs } = readyToHook();
    const exec = new FakeSequencedExec({
      // Guard reads EMPTY; the post-install read finds git-ai's key ABSENT.
      [TRACE2_READ]: [{ code: 1 }, { code: 1 }],
      [`${BINARY} install-hooks`]: { code: 0, stdout: 'ok' },
    });

    const outcome = await autoInstallCollector(deps({ fs, exec }));

    expect(outcome.action).toBe('failed');
    expect(
      readAutoInstallBlock(fs, { platform: 'darwin', arch: 'arm64', home: HOME }),
    ).not.toBeNull();
  });

  it('does NOT block on a guard refusal — the exclusion the unlatch depends on', async () => {
    // The load-bearing half. `skipped-trace2` and `skipped-skills` are recoverable
    // by an operator action, so they must be re-attempted on EVERY run. Blocking
    // them would reintroduce the latch through a second door: the operator clears
    // their trace2 config and the machine-wide record refuses anyway.
    const { fs } = readyToHook();
    const exec = new FakeSequencedExec({ [TRACE2_READ]: TRACE2_PRESENT });

    const outcome = await autoInstallCollector(deps({ fs, exec }));

    expect(outcome.action).toBe('skipped-guard');
    expect(readAutoInstallBlock(fs, { platform: 'darwin', arch: 'arm64', home: HOME })).toBeNull();
  });

  it('does NOT block when the LIFECYCLE itself returns a guard refusal', async () => {
    // A SECOND, DIFFERENT EXCLUSION, and the test above does not cover it — a
    // mutation that added `skipped-trace2` to HOOK_STAGE_FAILURES survived the
    // whole suite, because the case above never reaches that set at all: it is
    // refused earlier, in `decide`. The set is only consulted once the lifecycle
    // has actually run.
    //
    // Reaching it needs the TOCTOU window that is inherent to re-reading: the
    // unlatch check observes EMPTY, and `installHooks`' own guard — a separate
    // read, moments later — observes PRESENT because the operator (or another
    // process) put it back. That returns hooks: 'skipped-trace2' FROM the
    // lifecycle. Blocking there would make a transient config restore
    // permanently suppress the automatic install.
    const fs = new FakeCollectorFs();
    fs.seedBytes(BINARY, PAYLOAD);
    fs.mkdirp(`${HOME}/.claude`);
    fs.writeText(collectorStatePath(REPO), JSON.stringify(skippedByTrace2()));
    const exec = new FakeSequencedExec({
      [TRACE2_READ]: [{ code: 1 }, TRACE2_PRESENT],
    });

    const outcome = await autoInstallCollector(deps({ fs, exec }));

    // The lifecycle ran and its hook stage refused — not the same thing as the
    // early refusal above, which never runs the lifecycle at all.
    expect(outcome.detail).toContain('hooks: skipped-trace2');
    expect(exec.calls.some((c) => c.args.includes('install-hooks'))).toBe(false);
    // AND NO BLOCK: the next bare doctor must be free to try again.
    expect(readAutoInstallBlock(fs, { platform: 'darwin', arch: 'arm64', home: HOME })).toBeNull();
  });
});

describe('P1-B — a pin that could not be written stops the first execution', () => {
  it('never invokes the binary when auto-update could not be disabled', async () => {
    // The ordering ac-0007 protects is "config BEFORE first execution", because
    // git-ai's updater runs on invocation. The old code pushed a warning and ran
    // it anyway — which does not preserve the ordering, it narrates its loss.
    const fs = new FakeCollectorFs();
    fs.seedBytes(BINARY, PAYLOAD);
    fs.mkdirp(`${HOME}/.claude`);
    fs.writeText(collectorStatePath(REPO), JSON.stringify(skippedByTrace2()));
    fs.failWrites.add(configPathFor(HOME));
    const exec = new FakeSequencedExec({ [TRACE2_READ]: { code: 1 } });

    const outcome = await autoInstallCollector(deps({ fs, exec }));

    // The whole assertion: the digest-verified artifact was NOT run — not
    // `install-hooks`, and not the `status --json` schema probe either.
    expect(exec.calls.filter((c) => c.command === BINARY)).toEqual([]);
    expect(outcome.action).toBe('failed');
  });
});

describe('P1-C — a backup we could not take blocks the step it protects', () => {
  it('never invokes install-hooks when an agent config could not be copied', async () => {
    // The harm is the CLAIM, not the loss: because the copy is non-blocking, the
    // success line could name a backup directory to an operator whose config had
    // just been rewritten and NOT copied. Someone told their originals are safe
    // stops looking for them.
    const fs = new FakeCollectorFs();
    fs.seedBytes(BINARY, PAYLOAD);
    fs.mkdirp(`${HOME}/.claude`);
    fs.writeText(`${HOME}/.claude/settings.json`, '{ /* keep me */ }');
    // The copy DESTINATION is unwritable — a full disk or a read-only mount.
    fs.failWrites.add(`${backupDirFor(HOME, NOW)}/.claude__settings.json`);
    fs.writeText(collectorStatePath(REPO), JSON.stringify(skippedByTrace2()));
    const exec = new FakeSequencedExec({ [TRACE2_READ]: { code: 1 } });

    const outcome = await autoInstallCollector(deps({ fs, exec }));

    expect(exec.calls.some((c) => c.args.includes('install-hooks'))).toBe(false);
    // And the original is still exactly what the operator wrote, comments intact.
    expect(fs.readText(`${HOME}/.claude/settings.json`)).toBe('{ /* keep me */ }');
    expect(outcome.action).toBe('failed');
  });

  it('proceeds when there is genuinely nothing to copy — absence is not failure', async () => {
    // The mirror, and it covers BOTH shapes of "nothing copied", which are not
    // the same fact:
    //
    //   - `.claude` — a declared config path with no file at it yet. Most first
    //     installs. Blocking here would refuse on the commonest machine there is.
    //   - `.codeium` (Windsurf) — DETECTED, and we declare no config path for it
    //     at all. That is the honest denominator gap, not a failure, and it is
    //     permanent: blocking on it would refuse forever on every Windsurf box,
    //     with nothing the operator could do about it.
    //
    // The second half is here because a mutation that added `undeclared` to the
    // blocking condition survived the whole suite without it.
    const fs = new FakeCollectorFs();
    fs.seedBytes(BINARY, PAYLOAD);
    fs.mkdirp(`${HOME}/.claude`);
    fs.mkdirp(`${HOME}/.codeium`);
    // NOTE: `.codeium` (Windsurf) NO LONGER produces an `undeclared` entry — it
    // used to declare no config path at all, and now declares the two files
    // git-ai actually writes. See the invariant test below, which pins that
    // NOTHING is undeclared any more; this fixture stays as the regression guard
    // for the day a new agent is added without measuring its paths.
    fs.writeText(collectorStatePath(REPO), JSON.stringify(skippedByTrace2()));
    const exec = new FakeSequencedExec({
      [TRACE2_READ]: [
        { code: 1 },
        { code: 1 },
        { code: 0, stdout: 'trace2.eventtarget af_unix:/tmp/s\n' },
      ],
      [`${BINARY} install-hooks`]: { code: 0, stdout: 'hooks installed' },
    });

    const outcome = await autoInstallCollector(deps({ fs, exec }));

    expect(outcome.detail).toContain('hooks: installed');
  });

  it('EVERY declared agent now has a measured config path — nothing is undeclared', async () => {
    // The invariant that replaced the windsurf assertion above, and it is a
    // stronger statement than the one it replaced.
    //
    // `undeclared` means "we detected this agent and do not know where git-ai
    // writes for it", which is an evidence hole in both directions: nothing is
    // backed up, and nothing can be evidenced. It used to fire for Windsurf. Now
    // that every path has been read from git-ai's own source, it fires for
    // nobody — and this test is what makes adding a twelfth agent without doing
    // that reading go red instead of quietly reopening the hole.
    const undeclared = AGENT_MARKERS.filter((agent) => agent.configs.length === 0);

    expect(undeclared.map((agent) => agent.id)).toEqual([]);
  });
});
