import { describe, expect, it } from 'vitest';
import {
  envelopeForConvoError,
  envelopeForIdentityUnresolvable,
  envelopeForSyncOutcome,
  FlowspaceCliAdapter,
  resolveConvoIdentity,
} from '../../src/acts/convo.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import { FakeBackground } from '../../src/adapters/exec/fake-background.js';
import type { IngestArgs } from '../../src/services/convo/flowspace-port.js';
import type { SyncOutcome } from '../../src/services/convo/sync-service.js';
import type { PijDescriptor, PijRegistry } from '../../src/services/telemetry/pij-registry.js';

const clock = new FakeClock('2026-08-30T01:02:03.000Z');
const SENTINEL_PATH = '/Users/private/customer/transcripts/secret-session.jsonl';

function envelope(outcome: SyncOutcome) {
  return envelopeForSyncOutcome(outcome, clock);
}

describe('convo sync envelope', () => {
  it('distinguishes unconfigured consent from the absolute kill switch', () => {
    const defaultOff = envelope({ status: 'disabled', origin: 'default' });
    const killed = envelope({ status: 'disabled', origin: 'kill-switch' });

    expect(defaultOff.status).toBe('ok');
    expect(JSON.stringify(defaultOff)).toMatch(/not configured/i);
    expect(JSON.stringify(killed)).toMatch(/HARNESS_NO_TELEMETRY/);
    expect(defaultOff).not.toEqual(killed);
  });

  it('reports an enabled installation with no binary as undetected', () => {
    const result = envelope({ status: 'undetected', origin: 'repo' });
    expect(result).toMatchObject({ command: 'convo sync', status: 'degraded' });
    expect(result.next_action).toMatch(/flowspace3/i);
  });

  it('reports daemon unreachability exactly once', () => {
    const rendered = JSON.stringify(envelope({ status: 'unreachable', origin: 'repo' }));
    expect(rendered.match(/daemon is unreachable/gi)).toHaveLength(1);
    expect(rendered).toMatch(/flowspace3 ping/);
  });

  it('claims dispatch only when fire-and-forget was invoked', () => {
    const rendered = JSON.stringify(envelope({ status: 'fired', origin: 'repo' }));
    expect(rendered).toMatch(/dispatched/i);
    expect(rendered).not.toMatch(/\b(?:synced|ingested)\b/i);
  });

  it('never renders a transcript path from a caught failure', () => {
    const rendered = JSON.stringify(envelopeForConvoError(new Error(SENTINEL_PATH), clock));
    expect(rendered).not.toContain(SENTINEL_PATH);
  });
});

describe('convo identity', () => {
  const descriptor: PijDescriptor = {
    pij_id: 'pij-seat',
    harness: 'pi',
    harness_session_id: 'native-session',
    transcript_path: SENTINEL_PATH,
    spawned_by: null,
    model: null,
    relay: false,
  };
  const registry: PijRegistry = {
    available: true,
    by_pij: new Map([['pij-seat', descriptor]]),
    by_harness_session: new Map([['native-session', 'pij-seat']]),
  };

  it('uses complete explicit identity without a pij registry', () => {
    expect(
      resolveConvoIdentity(
        { harness: 'claude', session: 'explicit-session', folder: '/explicit' },
        '/repo',
        { available: false, by_pij: new Map(), by_harness_session: new Map() },
        new FakeEnv(),
      ),
    ).toEqual({
      ok: true,
      args: { harness: 'claude', session: 'explicit-session', folder: '/explicit' },
    });
  });

  it('defaults through PIJ_SESSION_ID without lifting transcript_path', () => {
    expect(
      resolveConvoIdentity({}, '/repo', registry, new FakeEnv({ PIJ_SESSION_ID: 'pij-seat' })),
    ).toEqual({
      ok: true,
      args: { harness: 'omp', session: 'native-session', folder: '/repo' },
      pijId: 'pij-seat',
    });
  });

  it('also resolves PIJ_SESSION_ID through the reverse native-session join', () => {
    expect(
      resolveConvoIdentity(
        {},
        '/repo',
        registry,
        new FakeEnv({ PIJ_SESSION_ID: 'native-session' }),
      ),
    ).toMatchObject({ ok: true, pijId: 'pij-seat' });
  });

  it('returns an honest act-level miss when enabled identity cannot resolve', () => {
    const missing = resolveConvoIdentity(
      {},
      '/repo',
      { available: false, by_pij: new Map(), by_harness_session: new Map() },
      new FakeEnv(),
    );
    expect(missing).toEqual({ ok: false, reason: 'identity-unresolvable' });

    const rendered = JSON.stringify(envelopeForIdentityUnresolvable('repo', clock));
    expect(rendered).toMatch(/cannot resolve session identity/i);
    expect(rendered).toMatch(/--harness/);
    expect(rendered).toMatch(/--session/);
    expect(rendered).not.toContain(SENTINEL_PATH);
  });
});

describe('FlowspaceCliAdapter', () => {
  const ingest: IngestArgs = { harness: 'omp', session: 'session-123', folder: '/repo' };

  it('delegates the cheap detect and ping gates', () => {
    const background = new FakeBackground();
    let detects = 0;
    let pings = 0;
    const adapter = new FlowspaceCliAdapter({
      detect: () => {
        detects++;
        return true;
      },
      ping: () => {
        pings++;
        return false;
      },
      background,
      cwd: '/repo',
      logPath: '/repo/.harness/temp/convo-sync.log',
    });

    expect(adapter.detect()).toBe(true);
    expect(adapter.ping()).toBe(false);
    expect(detects).toBe(1);
    expect(pings).toBe(1);
    expect(background.calls).toEqual([]);
  });

  it('maps IngestArgs to an injection-safe detached flowspace3 invocation', () => {
    const background = new FakeBackground();
    const adapter = new FlowspaceCliAdapter({
      detect: () => true,
      ping: () => true,
      background,
      cwd: '/repo',
      logPath: '/repo/.harness/temp/convo-sync.log',
      pijId: 'pij-seat',
    });

    expect(adapter.ingest(ingest)).toBeUndefined();
    expect(background.calls).toEqual([
      {
        command: 'flowspace3',
        args: [
          'conversation',
          'ingest',
          '--harness',
          'omp',
          '--session',
          'session-123',
          '--folder',
          '/repo',
          '--pij',
          'pij-seat',
        ],
        cwd: '/repo',
        logPath: '/repo/.harness/temp/convo-sync.log',
      },
    ]);
  });
});
