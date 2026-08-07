import { describe, expect, it } from 'vitest';
import { FakeGitAttribution } from '../../../../src/adapters/git/fake-git-attribution.js';
import { FakeSocketProbe } from '../../../../src/adapters/net/fake-socket-probe.js';
import {
  ingressBlocked,
  ingressProves,
  ingressReaches,
  markerExplanation,
  readIngress,
  resolveTrace2Target,
} from '../../../../src/services/doctor/collector/ingress.js';
import { FakeCollectorFs } from '../../../support/collector-fakes.js';

/**
 * Plan 074 · ac-0001 (resolver half) and ac-0002 (markers explain, never decide).
 *
 * The resolver's job is to keep the probe from being asked meaningless
 * questions: a target that is not a socket is classified WITHOUT a connect
 * attempt, so `unconfigured` and `file` are decisions about configuration rather
 * than about reachability.
 */

const SOCK = '/home/u/.git-ai/internal/daemon/trace2.sock';

function deps(over: {
  target?: string | null;
  outcome?: Parameters<FakeSocketProbe['probe']> extends never ? never : string;
  probe?: FakeSocketProbe;
  files?: string[];
  env?: Record<string, string>;
}) {
  const fs = new FakeCollectorFs();
  for (const file of over.files ?? []) fs.writeText(file, '');
  const probe = over.probe ?? new FakeSocketProbe({}, 'absent');
  return {
    fs,
    probe,
    git: new FakeGitAttribution({ trace2Target: over.target ?? null }),
    env: { get: (name: string) => (over.env ?? {})[name] },
  };
}

describe('plan 074 · ac-0001 — resolveTrace2Target classifies without probing', () => {
  it.each([
    [null, 'unconfigured'],
    ['', 'unconfigured'],
    ['   ', 'unconfigured'],
    ['1', 'unconfigured'],
    ['2', 'unconfigured'],
    ['true', 'unconfigured'],
  ] as const)('%s reads as %s', (raw, kind) => {
    expect(resolveTrace2Target(raw).kind).toBe(kind);
  });

  it.each([
    ['af_unix:/var/run/t.sock', '/var/run/t.sock'],
    ['af_unix:stream:/var/run/t.sock', '/var/run/t.sock'],
    ['af_unix:dgram:/var/run/t.sock', '/var/run/t.sock'],
  ])('%s is an af_unix target at %s', (raw, path) => {
    expect(resolveTrace2Target(raw)).toEqual({ kind: 'af_unix', path });
  });

  it('a plain path is a FILE target — the buffering shape, not an ingress', () => {
    expect(resolveTrace2Target('/tmp/trace2-events.jsonl')).toEqual({
      kind: 'file',
      path: '/tmp/trace2-events.jsonl',
    });
  });
});

describe('plan 074 · ac-0001 — readIngress probes only an af_unix target', () => {
  it('never probes when nothing is configured', async () => {
    const d = deps({ target: null });
    const reading = await readIngress(d);
    expect(reading.target.kind).toBe('unconfigured');
    expect(reading.outcome).toBeNull();
    expect(d.probe.calls).toEqual([]);
  });

  it('never probes a plain file target', async () => {
    const d = deps({ target: '/tmp/buffer.jsonl' });
    const reading = await readIngress(d);
    expect(reading.target).toEqual({ kind: 'file', path: '/tmp/buffer.jsonl' });
    expect(reading.outcome).toBeNull();
    expect(d.probe.calls).toEqual([]);
  });

  it('probes an af_unix target and reports whether the socket file exists', async () => {
    const d = deps({
      target: `af_unix:stream:${SOCK}`,
      probe: new FakeSocketProbe({ [SOCK]: 'denied' }),
      files: [SOCK],
    });
    const reading = await readIngress(d);
    expect(reading.outcome).toBe('denied');
    expect(reading.socketExists).toBe(true);
    expect(d.probe.calls).toEqual([SOCK]);
  });
});

describe('plan 074 · ac-0002 — markers EXPLAIN, they never decide', () => {
  it('a blocked probe is blocked whether or not any marker is set', async () => {
    const withMarkers = await readIngress(
      deps({
        target: `af_unix:${SOCK}`,
        probe: new FakeSocketProbe({ [SOCK]: 'denied' }),
        files: [SOCK],
        env: { CURSOR_SANDBOX: 'seatbelt' },
      }),
    );
    const withoutMarkers = await readIngress(
      deps({
        target: `af_unix:${SOCK}`,
        probe: new FakeSocketProbe({ [SOCK]: 'denied' }),
        files: [SOCK],
      }),
    );
    expect(ingressBlocked(withMarkers)).toBe(true);
    expect(ingressBlocked(withoutMarkers)).toBe(true);
    expect(withMarkers.markers).toEqual(['CURSOR_SANDBOX']);
    expect(withoutMarkers.markers).toEqual([]);
  });

  it('markers present + probe CONNECTED is not blocked (dossier F-11)', async () => {
    // The observed session that kills every marker-driven verdict: the socket
    // was reachable from inside a sandbox with CURSOR_SANDBOX set.
    const reading = await readIngress(
      deps({
        target: `af_unix:${SOCK}`,
        probe: new FakeSocketProbe({ [SOCK]: 'connected' }),
        files: [SOCK],
        env: { CURSOR_SANDBOX: 'seatbelt', SANDBOX_TYPE: 'seatbelt' },
      }),
    );
    expect(reading.markers).toEqual(['CURSOR_SANDBOX', 'SANDBOX_TYPE']);
    expect(ingressBlocked(reading)).toBe(false);
    expect(ingressReaches(reading)).toBe(true);
    expect(ingressProves(reading)).toBe(true);
  });

  it('denied WITHOUT the socket file on disk is not the sandbox signature', async () => {
    const reading = await readIngress(
      deps({ target: `af_unix:${SOCK}`, probe: new FakeSocketProbe({ [SOCK]: 'denied' }) }),
    );
    expect(reading.socketExists).toBe(false);
    expect(ingressBlocked(reading)).toBe(false);
  });

  it('the marker explanation names markers as explanatory, never causal', async () => {
    const reading = await readIngress(
      deps({
        target: `af_unix:${SOCK}`,
        probe: new FakeSocketProbe({ [SOCK]: 'denied' }),
        files: [SOCK],
        env: { CURSOR_SANDBOX: 'seatbelt' },
      }),
    );
    expect(markerExplanation(reading)).toContain('CURSOR_SANDBOX');
    expect(markerExplanation(reading)).toContain('did not decide it');
  });

  it('an empty marker value is not a marker', async () => {
    const reading = await readIngress(
      deps({
        target: `af_unix:${SOCK}`,
        probe: new FakeSocketProbe({ [SOCK]: 'connected' }),
        files: [SOCK],
        env: { CURSOR_SANDBOX: '  ' },
      }),
    );
    expect(reading.markers).toEqual([]);
  });
});

describe('plan 074 · ac-0003 — only a connected ingress PROVES anything', () => {
  it.each([
    'denied',
    'refused',
    'absent',
    'timeout',
    'error:EPIPE',
  ] as const)('%s cannot prove an empty at-risk list is clean', async (outcome) => {
    const reading = await readIngress(
      deps({
        target: `af_unix:${SOCK}`,
        probe: new FakeSocketProbe({ [SOCK]: outcome }),
        files: [SOCK],
      }),
    );
    expect(ingressProves(reading)).toBe(false);
  });

  it('an unconfigured ingress proves nothing either', async () => {
    const reading = await readIngress(deps({ target: null }));
    expect(ingressProves(reading)).toBe(false);
  });
});
