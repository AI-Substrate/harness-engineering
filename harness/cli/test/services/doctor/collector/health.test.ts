import { describe, expect, it } from 'vitest';
import { FakeGitAttribution } from '../../../../src/adapters/git/fake-git-attribution.js';
import { NodeHash } from '../../../../src/adapters/hash/node-hash.js';
import { FakeSocketProbe } from '../../../../src/adapters/net/fake-socket-probe.js';
import type { ProbeOutcome } from '../../../../src/adapters/net/socket-probe-port.js';
import {
  type CollectorHealth,
  readCollectorHealth,
} from '../../../../src/services/doctor/collector/health.js';
import { readIngress } from '../../../../src/services/doctor/collector/ingress.js';
import { GITAI_PIN } from '../../../../src/services/doctor/collector/pin.js';
import {
  type CollectorState,
  collectorStatePath,
  emptyCollectorState,
} from '../../../../src/services/doctor/collector/state.js';
import { FakeCollectorFs } from '../../../support/collector-fakes.js';

/**
 * Plan 073 · ac-000a, ac-000b, ac-000c, ac-0010, ac-0012, ac-0014 — the health
 * ladder.
 *
 * The three assertions that carry the design: `could-not-determine` is its own
 * rung and never reads as healthy; `cli-only-trace2` is its own rung and is
 * neither healthy nor a failed install; and the healthy rung explicitly declines
 * to claim collection is OCCURRING, because nothing available in v1 can prove
 * that (ac-0012).
 */

const HOME = '/home/u';
const REPO = '/repo';
const NOW = '2026-08-06T10:00:00.000Z';
const BINARY = '/home/u/.git-ai/bin/git-ai';
const DAEMON_PID = '/home/u/.git-ai/internal/daemon/daemon.pid.json';
const SOCKET = '/home/u/.git-ai/internal/daemon/trace2.sock';
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

function stateWith(over: Partial<CollectorState> = {}): CollectorState {
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
    note_schema: {
      expected: 'authorship/3.0.0',
      observed: 'authorship/3.0.0',
      status: 'match',
    },
    ...over,
  };
}

function health(
  over: {
    fs?: FakeCollectorFs;
    state?: CollectorState | null;
    hash?: boolean;
    platform?: string;
  } = {},
): CollectorHealth {
  const fs = over.fs ?? new FakeCollectorFs();
  if (over.state !== null) {
    fs.writeText(collectorStatePath(REPO), JSON.stringify(over.state ?? stateWith()));
  }
  return readCollectorHealth({
    fs,
    host: { platform: over.platform ?? 'darwin', arch: 'arm64', home: HOME },
    cwd: REPO,
    ...(over.hash === false ? {} : { hash: new NodeHash() }),
    manifest: pin(),
  });
}

function installedFs(): FakeCollectorFs {
  const fs = new FakeCollectorFs();
  fs.seedBytes(BINARY, PAYLOAD);
  fs.mkdirp(`${HOME}/.claude`);
  fs.writeText(DAEMON_PID, '{"pid":4242}');
  return fs;
}

describe('the healthy rung — configured, and honest that it is only configured', () => {
  it('reports healthy and explicitly does NOT claim collection is occurring (ac-0012)', () => {
    const result = health({ fs: installedFs() });

    expect(result.verdict).toBe('healthy');
    expect(result.binary).toMatchObject({ present: true, digest: 'match' });
    expect(result.hooks).toEqual({ status: 'installed', missing: [] });
    expect(result.daemon).toBe('pidfile-present');
    expect(result.detail).toContain('CONFIGURED');
    expect(result.detail).toContain('cannot prove it is occurring');
    expect(result.next_action).toBeUndefined();
  });
});

describe('`could not determine` is a distinct state, never folded in (ac-000b)', () => {
  it('a binary with no harness record is undetermined, NOT healthy and NOT not-installed', () => {
    const fs = new FakeCollectorFs();
    fs.seedBytes(BINARY, PAYLOAD);

    const result = readCollectorHealth({
      fs,
      host: { platform: 'darwin', arch: 'arm64', home: HOME },
      cwd: REPO,
      hash: new NodeHash(),
      manifest: pin(),
    });

    expect(result.verdict).toBe('could-not-determine');
    expect(result.detail).toContain('no record');
    expect(result.next_action).toBeDefined();
  });

  it('a recorded install whose binary has vanished is undetermined, not "not installed"', () => {
    const result = health({ fs: new FakeCollectorFs() });

    expect(result.verdict).toBe('could-not-determine');
    expect(result.detail).toContain('moved or removed');
  });

  it('a malformed state file reads as undetermined rather than as absence', () => {
    const fs = installedFs();
    fs.writeText(collectorStatePath(REPO), '{ not json');

    const result = readCollectorHealth({
      fs,
      host: { platform: 'darwin', arch: 'arm64', home: HOME },
      cwd: REPO,
      hash: new NodeHash(),
      manifest: pin(),
    });

    expect(result.verdict).toBe('could-not-determine');
  });

  it('an unverifiable digest cannot be upgraded to healthy', () => {
    const fs = installedFs();
    // No hash port wired AND no recorded digest: the read cannot prove the bytes.
    const result = health({
      fs,
      hash: false,
      state: stateWith({
        cli: {
          status: 'installed',
          path: BINARY,
          digest: null,
          verified_at: NOW,
          executable: true,
          detail: 'installed',
        },
      }),
    });

    expect(result.binary.digest).toBe('unknown');
    expect(result.verdict).toBe('could-not-determine');
  });
});

describe('`CLI installed, hooks not installed (trace2 present)` is its own rung (ac-0014)', () => {
  it('is not healthy, not a failed install, and not could-not-determine', () => {
    const result = health({
      fs: installedFs(),
      state: stateWith({
        hooks: {
          status: 'skipped-trace2',
          at: NOW,
          agents: [],
          detail: 'global trace2 config is PRESENT',
        },
        trace2: [{ observed: 'present', entries: ['trace2.eventTarget /t'], at: NOW }],
      }),
    });

    expect(result.verdict).toBe('cli-only-trace2');
    expect(result.binary.digest).toBe('match');
    expect(result.detail).toContain('no AI attribution is being collected');
    expect(result.next_action).toContain('install-hooks');
    expect(result.trace2).toEqual({ observed: 'present', at: NOW });
  });
});

describe('the degraded rungs name their cause', () => {
  it('a binary that no longer matches the pin is degraded, not healthy', () => {
    const fs = installedFs();
    fs.seedBytes(BINARY, new TextEncoder().encode('a newer git-ai'));

    const result = health({ fs });

    expect(result.verdict).toBe('degraded');
    expect(result.binary.digest).toBe('mismatch');
    expect(result.detail).toContain('does NOT match the pinned');
  });

  it('a note-schema mismatch is degraded and points at the pin', () => {
    const result = health({
      fs: installedFs(),
      state: stateWith({
        note_schema: {
          expected: 'authorship/3.0.0',
          observed: 'authorship/4.0.0',
          status: 'mismatch',
        },
      }),
    });

    expect(result.verdict).toBe('degraded');
    expect(result.detail).toContain('authorship/4.0.0');
  });

  it('an unsupported platform reports not-installed with an honest reason (ac-0017)', () => {
    const result = health({ platform: 'freebsd' });

    expect(result.verdict).toBe('not-installed');
    expect(result.detail).toContain('freebsd');
  });

  it('a machine with nothing installed says so plainly', () => {
    const result = health({ fs: new FakeCollectorFs(), state: null });

    expect(result.verdict).toBe('not-installed');
    expect(result.next_action).toContain('--install-collector');
  });
});

describe('a NEW coding harness is surfaced by the health read (ac-0010)', () => {
  it('reports hooks-incomplete when an agent appeared after the hooks went on', () => {
    const fs = installedFs();
    fs.mkdirp(`${HOME}/.cursor`); // installed later; hooks only cover claude

    const result = health({ fs });

    expect(result.verdict).toBe('hooks-incomplete');
    expect(result.hooks.missing).toEqual(['cursor']);
    expect(result.detail).toContain('Cursor');
    expect(result.next_action).toContain('trace2 guard runs again');
  });
});

/**
 * Plan 077 — the probe reading must SURVIVE the verdict that outranks it.
 *
 * Every one of these rungs returns before the `ingress-blocked` rung, and each
 * one used to drop `deps.ingress` on the floor: `undetermined()` never set the
 * field, so the key came back ABSENT. That made a reading we took and discarded
 * indistinguishable from one we never took — and `null` on this field exists
 * precisely to mean "nobody probed".
 *
 * The verdict is deliberately NOT promoted to `ingress-blocked`. "We cannot
 * determine whether git-ai is installed" stays the answer to the question it
 * answers, because `ingress-blocked`'s own detail asserts git-ai "is installed
 * and hooked up" — which is the one thing these rungs could not establish. Two
 * independent facts, one row, neither stated as the other.
 */
describe('plan 077 — a blocked ingress is not lost to a could-not-determine verdict', () => {
  async function blockedIngress(outcome: ProbeOutcome = 'denied') {
    const cfs = new FakeCollectorFs();
    cfs.writeText(SOCKET, '');
    return readIngress({
      fs: cfs,
      probe: new FakeSocketProbe({ [SOCKET]: outcome }),
      git: new FakeGitAttribution({ trace2Target: `af_unix:stream:${SOCKET}` }),
      env: { get: () => undefined },
    });
  }

  it('carries the reading AND names the blockage when the install is unrecorded', async () => {
    const fs = new FakeCollectorFs();
    fs.seedBytes(BINARY, PAYLOAD);

    const result = readCollectorHealth({
      fs,
      host: { platform: 'darwin', arch: 'arm64', home: HOME },
      cwd: REPO,
      hash: new NodeHash(),
      manifest: pin(),
      ingress: await blockedIngress(),
    });

    // The verdict still answers its own question honestly…
    expect(result.verdict).toBe('could-not-determine');
    expect(result.detail).toContain('no record');
    // …and the evidence is neither dropped nor downgraded to "nobody probed".
    expect(result.ingress).not.toBeUndefined();
    expect(result.ingress).not.toBeNull();
    // …and the operator is TOLD, because this is the actionable half.
    expect(result.detail).toContain('NO attribution');
    expect(result.next_action).toContain('harness doctor telemetry-nudge');
  });

  it('carries the reading when the recorded binary has vanished', async () => {
    // A RECORDED install with nothing on disk — distinct from "no binary and no
    // record", which is `not-installed` and is a different rung entirely.
    const fs = new FakeCollectorFs();
    fs.writeText(collectorStatePath(REPO), JSON.stringify(stateWith()));

    const result = readCollectorHealth({
      fs,
      host: { platform: 'darwin', arch: 'arm64', home: HOME },
      cwd: REPO,
      hash: new NodeHash(),
      manifest: pin(),
      ingress: await blockedIngress(),
    });

    expect(result.verdict).toBe('could-not-determine');
    expect(result.ingress).not.toBeUndefined();
    expect(result.detail).toContain('NO attribution');
  });

  it('a REACHABLE ingress adds no warning — the row must not cry wolf', async () => {
    const fs = new FakeCollectorFs();
    fs.seedBytes(BINARY, PAYLOAD);

    const result = readCollectorHealth({
      fs,
      host: { platform: 'darwin', arch: 'arm64', home: HOME },
      cwd: REPO,
      hash: new NodeHash(),
      manifest: pin(),
      ingress: await blockedIngress('connected'),
    });

    expect(result.verdict).toBe('could-not-determine');
    // Still carried — a clean probe is evidence too…
    expect(result.ingress).not.toBeUndefined();
    // …but it is NOT narrated, or the warning stops meaning anything.
    expect(result.detail).not.toContain('NO attribution');
    expect(result.next_action).not.toContain('telemetry-nudge');
  });

  it('an UNPROBED read still reports null, and never invents a blockage', () => {
    const fs = new FakeCollectorFs();
    fs.seedBytes(BINARY, PAYLOAD);

    const result = readCollectorHealth({
      fs,
      host: { platform: 'darwin', arch: 'arm64', home: HOME },
      cwd: REPO,
      hash: new NodeHash(),
      manifest: pin(),
    });

    expect(result.verdict).toBe('could-not-determine');
    expect(result.ingress).toBeNull();
    expect(result.detail).not.toContain('NO attribution');
  });
});
