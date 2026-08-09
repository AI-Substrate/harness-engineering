import { describe, expect, it } from 'vitest';
import { FakeSocketRelay } from '../../../src/adapters/net/fake-socket-probe.js';
import {
  buildTicklerPayload,
  socketPathFromTrace2Target,
  Trace2Tickler,
} from '../../../src/services/hooks/trace2-tickler.js';

const CONTEXT = {
  repoRoot: '/repo/alpha',
  message: 'the agent authored this',
  nowIso: '2026-06-08T07:20:00.000Z',
  pid: 4242,
};

describe("socketPathFromTrace2Target — reuse git's own declaration (tk-0008)", () => {
  it('reads the af_unix socket path git already records', () => {
    // The MEASURED value from this machine's global config. Recomputing git-ai's
    // sha256-of-internal-dir digest here would be a second source of truth that
    // diverges silently the moment git-ai changes it.
    expect(
      socketPathFromTrace2Target('af_unix:stream:/Users/x/.git-ai/internal/daemon/trace2.sock'),
    ).toBe('/Users/x/.git-ai/internal/daemon/trace2.sock');
    expect(socketPathFromTrace2Target('af_unix:/tmp/t.sock')).toBe('/tmp/t.sock');
  });

  it.each([
    ['unset', null],
    ['a plain FILE target', '/var/log/trace2.jsonl'],
    ['a Windows named pipe', '\\\\.\\pipe\\git-ai-abc-trace2'],
    ['an empty af_unix path', 'af_unix:stream:'],
  ])('refuses %s rather than writing somewhere it does not belong', (_name, target) => {
    // A file target would mean writing our events into someone's log file — a side
    // effect nobody asked for that reaches no daemon. A named pipe is a transport
    // this relay does not speak; claiming otherwise would claim a delivery that
    // never happened.
    expect(socketPathFromTrace2Target(target)).toBeNull();
  });
});

describe('buildTicklerPayload — the shape git-ai ingests (tk-0008)', () => {
  it('emits the six events, in order, sharing ONE session id', () => {
    const { payload, sid } = buildTicklerPayload(CONTEXT);
    const lines = payload.split('\n').filter((l) => l.length > 0);
    const events = lines.map((l) => JSON.parse(l) as Record<string, unknown>);

    expect(events.map((e) => e.event)).toEqual([
      'version',
      'start',
      'def_repo',
      'cmd_name',
      'exit',
      'atexit',
    ]);
    // ONE session. Six sids would be six sessions for one commit.
    expect(new Set(events.map((e) => e.sid))).toEqual(new Set([sid]));
  });

  it("carries the repo as def_repo.worktree — git-ai's join key — and the message in argv", () => {
    const { payload } = buildTicklerPayload(CONTEXT);
    const events = payload
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);

    expect(events[2].worktree).toBe('/repo/alpha');
    expect(events[1].argv).toEqual(['git', 'commit', '-q', '-m', 'the agent authored this']);
    expect(events[3]).toMatchObject({ name: 'commit', hierarchy: 'commit' });
  });

  it('terminates the LAST event with a newline, or the daemon never parses it', () => {
    // The daemon frames on lines. A final event without its terminator sits in the
    // buffer forever and the session is never completed.
    expect(buildTicklerPayload(CONTEXT).payload.endsWith('\n')).toBe(true);
  });

  it('gives different processes different session ids', () => {
    const a = buildTicklerPayload(CONTEXT).sid;
    const b = buildTicklerPayload({ ...CONTEXT, pid: 9999 }).sid;
    expect(a).not.toBe(b);
  });
});

describe('Trace2Tickler — exactly ONE send (dw-0013)', () => {
  it('sends all six events in a SINGLE call — six calls would be six sessions', async () => {
    /*
    Test Doc:
    - Why: SocketRelayPort.send() opens a connection and HALF-CLOSES per call. Six
      calls give the daemon six connections and therefore six sessions, for one
      commit. This is the single most important property of the tickler.
    - Contract: one send(), whose payload contains all six events.
    - Quality Contribution: asserts the CALL COUNT, not just the bytes — a loop
      that sent each event separately would produce the same total bytes.
    */
    const relay = new FakeSocketRelay();
    const tickler = new Trace2Tickler(
      relay,
      () => 'af_unix:stream:/tmp/trace2.sock',
      () => CONTEXT.nowIso,
      CONTEXT.pid,
    );

    const result = await tickler.emit({ repoRoot: '/repo/alpha', message: 'a change' });

    expect(relay.sends).toHaveLength(1);
    expect(relay.sends[0].path).toBe('/tmp/trace2.sock');
    expect(relay.sends[0].payload.split('\n').filter((l) => l.length > 0)).toHaveLength(6);
    expect(result.ok).toBe(true);
  });

  it('reports an unconfigured ingress as a FAILURE, never a silent success', async () => {
    const relay = new FakeSocketRelay();
    const tickler = new Trace2Tickler(
      relay,
      () => null,
      () => CONTEXT.nowIso,
      CONTEXT.pid,
    );

    const result = await tickler.emit({ repoRoot: '/repo/alpha', message: 'a change' });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('no af_unix trace2 ingress');
    // And it did not write anywhere while deciding that.
    expect(relay.sends).toEqual([]);
  });

  it('surfaces a relay failure with its outcome, so the journal records the CAUSE', async () => {
    const relay = new FakeSocketRelay({ ok: false, outcome: 'denied' });
    const tickler = new Trace2Tickler(
      relay,
      () => 'af_unix:stream:/tmp/trace2.sock',
      () => CONTEXT.nowIso,
      CONTEXT.pid,
    );

    const result = await tickler.emit({ repoRoot: '/repo/alpha', message: 'a change' });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('denied');
  });
});
