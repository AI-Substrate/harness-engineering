import { describe, expect, it } from 'vitest';
import { FakeSocketProbe, FakeSocketRelay } from '../../../src/adapters/net/fake-socket-probe.js';
import {
  classifyProbeError,
  NodeSocketProbe,
  type ProbeSocket,
} from '../../../src/adapters/net/node-socket-probe.js';
import {
  PROBE_TIMEOUT_MS,
  type ProbeOutcome,
} from '../../../src/adapters/net/socket-probe-port.js';

/**
 * Plan 074 · ac-0001 — the socket probe, proven WITHOUT a daemon.
 *
 * Two layers, deliberately:
 *
 * 1. {@link classifyProbeError} is pure, so the mapping every downstream branch
 *    depends on is asserted directly rather than inferred from behaviour.
 * 2. {@link NodeSocketProbe} is driven through an INJECTED socket, so the real
 *    adapter's own wiring — timeout arming, destroy-on-settle, and the
 *    never-sends-a-byte guarantee — is covered with no real socket, no daemon,
 *    no sandbox and no network (ac-000a). The DEFAULT `net.createConnection`
 *    factory is never exercised here; that path is local manual verification.
 */

/** A scriptable stand-in for a `node:net` socket. Records everything it is asked to do. */
class ScriptedSocket implements ProbeSocket {
  destroyed = 0;
  written: string[] = [];
  timeoutMs: number | null = null;
  private onTimeout: (() => void) | null = null;
  private readonly listeners = new Map<string, (arg?: unknown) => void>();

  setTimeout(ms: number, onTimeout: () => void): unknown {
    this.timeoutMs = ms;
    this.onTimeout = onTimeout;
    return this;
  }

  on(event: 'connect' | 'error' | 'close', listener: (arg?: unknown) => void): unknown {
    this.listeners.set(event, listener);
    return this;
  }

  end(payload?: string, cb?: () => void): unknown {
    if (payload !== undefined) this.written.push(payload);
    cb?.();
    return this;
  }

  destroy(): unknown {
    this.destroyed += 1;
    return this;
  }

  fireConnect(): void {
    this.listeners.get('connect')?.();
  }

  fireError(code: string | undefined): void {
    this.listeners.get('error')?.(code === undefined ? new Error('boom') : { code });
  }

  fireTimeout(): void {
    this.onTimeout?.();
  }
}

describe('plan 074 · ac-0001 — probe classification', () => {
  it.each([
    ['EACCES', 'denied'],
    ['EPERM', 'denied'],
    ['ECONNREFUSED', 'refused'],
    ['ENOENT', 'absent'],
    ['EPIPE', 'error:EPIPE'],
    [undefined, 'error:unknown'],
  ] as const)('maps %s to %s', (code, expected) => {
    expect(classifyProbeError(code)).toBe(expected);
  });

  it('never flattens an unknown code into a known outcome', () => {
    // The whole point: an unrecognised failure must not silently read as
    // `absent` (daemon down) or, worse, as anything success-shaped.
    const outcome = classifyProbeError('ESOMETHINGNEW');
    expect(outcome).toBe('error:ESOMETHINGNEW');
    expect(outcome).not.toBe('connected');
  });
});

describe('plan 074 · ac-0001 — NodeSocketProbe driven through an injected socket', () => {
  function probeWith(drive: (sock: ScriptedSocket) => void) {
    const sock = new ScriptedSocket();
    const adapter = new NodeSocketProbe(() => sock);
    const promise = adapter.probe('/tmp/trace2.sock');
    drive(sock);
    return { promise, sock };
  }

  it('resolves connected and destroys the handle without sending a byte', async () => {
    const { promise, sock } = probeWith((s) => s.fireConnect());
    await expect(promise).resolves.toBe('connected');
    expect(sock.destroyed).toBe(1);
    expect(sock.written).toEqual([]);
  });

  it.each([
    ['EACCES', 'denied'],
    ['ECONNREFUSED', 'refused'],
    ['ENOENT', 'absent'],
    ['EHOSTDOWN', 'error:EHOSTDOWN'],
  ] as const)('classifies a %s error as %s and still destroys', async (code, expected) => {
    const { promise, sock } = probeWith((s) => s.fireError(code));
    await expect(promise).resolves.toBe(expected);
    expect(sock.destroyed).toBe(1);
    expect(sock.written).toEqual([]);
  });

  it('arms a bounded timeout at or under one second and resolves timeout', async () => {
    const { promise, sock } = probeWith((s) => s.fireTimeout());
    await expect(promise).resolves.toBe('timeout');
    expect(sock.timeoutMs).toBe(PROBE_TIMEOUT_MS);
    expect(PROBE_TIMEOUT_MS).toBeLessThanOrEqual(1000);
    expect(sock.destroyed).toBe(1);
  });

  it('settles exactly once — a late error after connect cannot rewrite the verdict', async () => {
    const { promise, sock } = probeWith((s) => {
      s.fireConnect();
      s.fireError('EACCES');
    });
    await expect(promise).resolves.toBe('connected');
    expect(sock.destroyed).toBe(1);
  });

  it('treats a synchronous connect throw as an outcome, never an exception', async () => {
    const adapter = new NodeSocketProbe(() => {
      throw Object.assign(new Error('nope'), { code: 'EACCES' });
    });
    await expect(adapter.probe('/tmp/x.sock')).resolves.toBe('denied');
  });
});

describe('plan 074 · ac-0006 — NodeSocketProbe.send is the only writing path', () => {
  it('writes the payload and reports its byte length', async () => {
    const sock = new ScriptedSocket();
    const adapter = new NodeSocketProbe(() => sock);
    const promise = adapter.send('/tmp/trace2.sock', 'event-one\nevent-two\n');
    sock.fireConnect();
    await expect(promise).resolves.toEqual({ ok: true, bytes: 20 });
    expect(sock.written).toEqual(['event-one\nevent-two\n']);
  });

  it('reports a denied connect as a failure carrying the probe vocabulary', async () => {
    const sock = new ScriptedSocket();
    const adapter = new NodeSocketProbe(() => sock);
    const promise = adapter.send('/tmp/trace2.sock', 'payload');
    sock.fireError('EACCES');
    await expect(promise).resolves.toEqual({ ok: false, outcome: 'denied' });
    expect(sock.written).toEqual([]);
  });
});

describe('plan 074 · ac-000a — the fakes cover every outcome with no daemon', () => {
  const every: ProbeOutcome[] = [
    'connected',
    'denied',
    'refused',
    'absent',
    'timeout',
    'error:EPIPE',
  ];

  it.each(every)('a fake probe can produce %s', async (outcome) => {
    const probe = new FakeSocketProbe({ '/s': outcome });
    await expect(probe.probe('/s')).resolves.toBe(outcome);
    expect(probe.calls).toEqual(['/s']);
  });

  it('a fake relay records every write so a read-only surface can be proven silent', async () => {
    const relay = new FakeSocketRelay();
    expect(relay.sends).toEqual([]);
    await relay.send('/s', 'abc');
    expect(relay.sends).toEqual([{ path: '/s', payload: 'abc' }]);
  });
});
