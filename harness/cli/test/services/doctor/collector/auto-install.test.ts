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
import { readCollectorHealth } from '../../../../src/services/doctor/collector/health.js';
import { GITAI_PIN } from '../../../../src/services/doctor/collector/pin.js';
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
    const state = healthyState();
    const fs = new FakeCollectorFs();
    fs.seedBytes(BINARY, PAYLOAD);
    fs.writeText(
      collectorStatePath(REPO),
      JSON.stringify({
        ...state,
        hooks: {
          status: 'skipped-trace2',
          at: NOW,
          agents: [],
          detail: 'a global trace2 config is present',
        },
      }),
    );
    const exec = new FakeSequencedExec({});

    const outcome = await autoInstallCollector(deps({ fs, exec }));

    expect(outcome.action).toBe('skipped-guard');
    expect(outcome.detail).toContain('trace2');
    expect(outcome.detail).toContain('machine-wide');
    // A guard is not verified until it has REFUSED: git-ai was never invoked.
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
