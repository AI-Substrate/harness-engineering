import { describe, expect, it } from 'vitest';
import {
  CONVO_IDENTITY_UNRESOLVABLE_LINE,
  envelopeForConvoError,
  envelopeForIdentityUnresolvable,
  envelopeForSyncOutcome,
  FlowspaceCliAdapter,
  resolveConvoIdentity,
  runConvoSync,
  runConvoSyncSilently,
} from '../../src/acts/convo.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import { FakeBackground } from '../../src/adapters/exec/fake-background.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import { FakeFlowspace } from '../../src/services/convo/fake-flowspace.js';
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

  it('degrades when the detached ingest is dead on arrival', () => {
    const result = envelope({
      status: 'dispatch-failed',
      origin: 'repo',
      logPath: '/repo/.harness/temp/convo-sync.log',
    });
    expect(result).toMatchObject({
      command: 'convo sync',
      status: 'degraded',
      data: { status: 'dispatch-failed', logPath: '/repo/.harness/temp/convo-sync.log' },
    });
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

  it('resolves populated pij registry identity only to native harness and session', () => {
    expect(
      resolveConvoIdentity({}, '/repo', registry, new FakeEnv({ PIJ_SESSION_ID: 'pij-seat' })),
    ).toEqual({
      ok: true,
      args: { harness: 'omp', session: 'native-session', folder: '/repo' },
    });

    expect(
      resolveConvoIdentity(
        {},
        '/repo',
        registry,
        new FakeEnv({ PIJ_SESSION_ID: 'native-session' }),
      ),
    ).toEqual({
      ok: true,
      args: { harness: 'omp', session: 'native-session', folder: '/repo' },
    });
  });

  it('resolves a claude seat from its own exported session id with NO pij registry', () => {
    // The rs-generation pij store carries no inner session id and its seats are absent
    // from ~/.pij entirely (2026-09-02: 245 of 248 live seats). The harness's own env is
    // the ground truth pij only ever recorded, so it must be enough on its own.
    expect(
      resolveConvoIdentity(
        {},
        '/repo',
        { available: false, by_pij: new Map(), by_harness_session: new Map() },
        new FakeEnv({ CLAUDE_CODE_SESSION_ID: 'claude-native' }),
      ),
    ).toEqual({
      ok: true,
      args: { harness: 'claude', session: 'claude-native', folder: '/repo' },
    });
  });

  it('prefers the native env over a pij registry that disagrees, and explicit flags over both', () => {
    const env = new FakeEnv({
      CLAUDE_CODE_SESSION_ID: 'claude-native',
      PIJ_SESSION_ID: 'pij-seat',
    });
    expect(resolveConvoIdentity({}, '/repo', registry, env)).toEqual({
      ok: true,
      args: { harness: 'claude', session: 'claude-native', folder: '/repo' },
    });
    expect(
      resolveConvoIdentity({ harness: 'omp', session: 'explicit' }, '/repo', registry, env),
    ).toEqual({
      ok: true,
      args: { harness: 'omp', session: 'explicit', folder: '/repo' },
    });
  });

  it('treats an empty native env value as absent, not as a session', () => {
    expect(
      resolveConvoIdentity(
        {},
        '/repo',
        { available: false, by_pij: new Map(), by_harness_session: new Map() },
        new FakeEnv({ CLAUDE_CODE_SESSION_ID: '' }),
      ),
    ).toEqual({ ok: false, reason: 'identity-unresolvable' });
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
      clock: new FakeClock(),
      cwd: '/repo',
      logPath: '/repo/.harness/temp/convo-sync.log',
    });

    expect(adapter.detect()).toBe(true);
    expect(adapter.ping()).toBe(false);
    expect(detects).toBe(1);
    expect(pings).toBe(1);
    expect(background.calls).toEqual([]);
  });

  it('maps native identity to the accepted flowspace3 grammar without --pij', async () => {
    const background = new FakeBackground();
    const adapter = new FlowspaceCliAdapter({
      detect: () => true,
      ping: () => true,
      background,
      clock: new FakeClock(),
      cwd: '/repo',
      logPath: '/repo/.harness/temp/convo-sync.log',
    });

    await expect(adapter.ingest(ingest)).resolves.toEqual({ status: 'fired' });
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
        ],
        cwd: '/repo',
        logPath: '/repo/.harness/temp/convo-sync.log',
      },
    ]);
  });

  it('reports a nonzero child exit within the bounded grace period', async () => {
    const clock = new FakeClock();
    const adapter = new FlowspaceCliAdapter({
      detect: () => true,
      ping: () => true,
      background: {
        spawnDetached: () => ({ pid: 424242, exitCode: Promise.resolve(2) }),
      },
      clock,
      cwd: '/repo',
      logPath: '/repo/.harness/temp/convo-sync.log',
    });

    await expect(adapter.ingest(ingest)).resolves.toEqual({
      status: 'dispatch-failed',
      logPath: '/repo/.harness/temp/convo-sync.log',
    });
    expect(clock.sleeps).toEqual([250]);
  });

  it('keeps a fast successful child classified as fired', async () => {
    const clock = new FakeClock();
    const background = {
      calls: [] as unknown[],
      spawnDetached: () => ({
        pid: 424242,
        exitCode: clock.sleep(50).then(() => 0),
      }),
    };
    const adapter = new FlowspaceCliAdapter({
      detect: () => true,
      ping: () => true,
      background,
      clock,
      cwd: '/repo',
      logPath: '/repo/.harness/temp/convo-sync.log',
    });

    await expect(adapter.ingest(ingest)).resolves.toEqual({ status: 'fired' });
    expect(clock.sleeps).toEqual([50, 250]);
  });

  it('propagates DOA failure through a populated pij registry without passing pij identity', async () => {
    const home = '/home/test';
    const fs = new FakeFs(
      {
        '/repo/.harness/settings.json': JSON.stringify({
          schema_version: 1,
          flowspace: { ingest: { enabled: true } },
        }),
        [`${home}/.pij/pij-seat.json`]: JSON.stringify({
          harness: 'pi',
          harnessSessionId: 'native-session',
        }),
      },
      { [`${home}/.pij`]: ['pij-seat.json'] },
    );
    const env = new FakeEnv({ PIJ_SESSION_ID: 'pij-seat' }, home);
    const flowspace = new FakeFlowspace({
      dispatch: { status: 'dispatch-failed', logPath: '/repo/.harness/temp/convo-sync.log' },
    });
    const factoryArgCounts: number[] = [];

    const result = await runConvoSync(
      {},
      { fs, env, proc: new FakeProcess({}, '/repo') },
      (...args) => {
        factoryArgCounts.push(args.length);
        return flowspace;
      },
    );

    expect(factoryArgCounts).toEqual([0]);
    expect(result).toEqual({
      kind: 'outcome',
      outcome: {
        status: 'dispatch-failed',
        origin: 'repo',
        logPath: '/repo/.harness/temp/convo-sync.log',
      },
    });
  });
});

describe('silent seam identity warning', () => {
  const enabledRepo = () => {
    const fs = new FakeFs({
      '/repo/.harness/settings.json': JSON.stringify({
        schema_version: 1,
        flowspace: { ingest: { enabled: true } },
      }),
    });
    return { fs, proc: new FakeProcess({ cwd: '/repo' }) };
  };

  it('warns exactly once, on stderr only, when consent is on but identity is unresolvable', () => {
    const lines: string[] = [];
    const flowspace = new FakeFlowspace();
    runConvoSyncSilently(
      { ...enabledRepo(), env: new FakeEnv({ HOME: '/nowhere' }, '/nowhere') },
      () => flowspace,
      (line) => lines.push(line),
    );
    expect(lines).toEqual([CONVO_IDENTITY_UNRESOLVABLE_LINE]);
    expect(flowspace.ingests).toHaveLength(0);
  });

  it('carries no seat name, session id or path in the warning', () => {
    expect(CONVO_IDENTITY_UNRESOLVABLE_LINE).not.toMatch(/pij-[a-z]+-[a-z]+/);
    expect(CONVO_IDENTITY_UNRESOLVABLE_LINE).not.toMatch(/\/Users\//);
  });

  it('stays silent when ingest is disabled or when identity resolves', () => {
    const lines: string[] = [];
    runConvoSyncSilently(
      { fs: new FakeFs({}), proc: new FakeProcess({ cwd: '/repo' }), env: new FakeEnv() },
      () => new FakeFlowspace(),
      (line) => lines.push(line),
    );
    const resolved = new FakeFlowspace();
    runConvoSyncSilently(
      {
        ...enabledRepo(),
        env: new FakeEnv({ CLAUDE_CODE_SESSION_ID: 'claude-native' }, '/nowhere'),
      },
      () => resolved,
      (line) => lines.push(line),
    );
    expect(lines).toEqual([]);
  });

  it('never throws even when the warn sink throws', () => {
    expect(() =>
      runConvoSyncSilently(
        { ...enabledRepo(), env: new FakeEnv({}, '/nowhere') },
        () => new FakeFlowspace(),
        () => {
          throw new Error('closed stderr');
        },
      ),
    ).not.toThrow();
  });
});
