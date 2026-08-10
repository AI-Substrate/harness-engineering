import { describe, expect, it } from 'vitest';
import { FakeSocketRelay } from '../../../src/adapters/net/fake-socket-probe.js';
import {
  buildTicklerPayload,
  relayTargetPath,
  Trace2Tickler,
} from '../../../src/services/hooks/trace2-tickler.js';

const CONTEXT = {
  repoRoot: '/repo/alpha',
  message: 'the agent authored this',
  nowIso: '2026-06-08T07:20:00.000Z',
  pid: 4242,
};

describe('relayTargetPath — one classifier, two transports (F006)', () => {
  /*
  Test Doc:
  - Why: plan 075 split `named_pipe` out of `file` because a pipe is a LIVE
    ingress and a file is a buffer. Plan 082 re-collapsed that distinction in a
    private regex here, so the relay refused the only transport git has on
    Windows. Both halves of the 075 split are pinned in ONE table so a future
    tightening cannot fix one and break the other.
  - Contract: a connectable IPC endpoint (af_unix socket OR Win32 named pipe)
    yields its path; a plain FILE target — including a legitimate UNC file —
    yields null.
  - Quality Contribution: the UNC and near-miss rows are the mutation guard. A
    naive "starts with a separator" rule would pass the pipe rows and fail these.
  */
  it.each([
    [
      'an af_unix stream socket',
      'af_unix:stream:/Users/x/.git-ai/internal/daemon/trace2.sock',
      '/Users/x/.git-ai/internal/daemon/trace2.sock',
    ],
    ['a bare af_unix target', 'af_unix:/tmp/t.sock', '/tmp/t.sock'],
    ['a Windows named pipe', '\\\\.\\pipe\\git-ai-abc-trace2', '\\\\.\\pipe\\git-ai-abc-trace2'],
    ['the \\\\?\\ pipe namespace', '\\\\?\\pipe\\x', '\\\\?\\pipe\\x'],
    ['a forward-slash pipe spelling', '//./pipe/git-ai', '//./pipe/git-ai'],
  ])('relays to %s — a live endpoint the adapter can connect to', (_name, target, expected) => {
    expect(relayTargetPath(target)).toBe(expected);
  });

  it.each([
    ['unset', null],
    ['a POSIX FILE target', '/var/log/trace2.jsonl'],
    ['a Windows drive-rooted FILE target', 'C:\\path\\trace.jsonl'],
    ['a UNC FILE target on a real share', '\\\\server\\share\\trace.jsonl'],
    ['a share that merely happens to be named pipe', '\\\\server\\pipe\\trace.jsonl'],
    ['another device whose name starts with pipe', '\\\\.\\pipexyz'],
    ['an empty af_unix path', 'af_unix:stream:'],
    ["git's stderr form", '2'],
    ['a relative path git would refuse', 'trace.jsonl'],
  ])('refuses %s rather than writing somewhere it does not belong', (_name, target) => {
    // Writing our events into someone's log file is a side effect nobody asked
    // for that reaches no daemon. The 075 split must survive this change.
    expect(relayTargetPath(target)).toBeNull();
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

  it('relays to a Windows NAMED PIPE with a payload byte-identical to the af_unix case', async () => {
    /*
    Test Doc:
    - Why: on Windows a named pipe is the ONLY trace2 transport git has, and
      git-ai's own `install-hooks` configures it. Before F006 the tickler
      rejected it at a private regex, so the hook paid full Node-startup cost on
      every tool call, detected the commit, reached the emit stage and then
      discarded the payload. Full cost, zero function.
    - Contract: a pipe target reaches `send()` EXACTLY ONCE, with the pipe path
      verbatim, carrying the same bytes an af_unix target would.
    - Quality Contribution: asserts byte-equality against the af_unix payload
      rather than re-describing the six events, so a payload change cannot pass
      here by being mirrored into the assertion. EXPECTED-UNVERIFIED: this proves
      the relay is CALLED, not that a real Windows daemon accepts the bytes.
    */
    const PIPE = '\\\\.\\pipe\\git-ai-abc-trace2';
    const pipeRelay = new FakeSocketRelay();
    const unixRelay = new FakeSocketRelay();
    const build = (relay: FakeSocketRelay, target: string) =>
      new Trace2Tickler(
        relay,
        () => target,
        () => CONTEXT.nowIso,
        CONTEXT.pid,
      );

    const result = await build(pipeRelay, PIPE).emit({
      repoRoot: '/repo/alpha',
      message: 'a change',
    });
    await build(unixRelay, 'af_unix:stream:/tmp/trace2.sock').emit({
      repoRoot: '/repo/alpha',
      message: 'a change',
    });

    expect(result.ok).toBe(true);
    expect(pipeRelay.sends).toHaveLength(1);
    expect(pipeRelay.sends[0].path).toBe(PIPE);
    expect(pipeRelay.sends[0].payload).toBe(unixRelay.sends[0].payload);
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
    expect(result.detail).toContain('no relayable trace2 ingress');
    // And it did not write anywhere while deciding that.
    expect(relay.sends).toEqual([]);
  });

  it('refuses a plain FILE target without writing into it', async () => {
    /*
    Test Doc:
    - Why: the 075 split has two halves and F006 only widens ONE of them. A fix
      that made "absolute-shaped target" relayable would pass the pipe test and
      start writing synthetic events into an operator's log file.
    - Contract: a file target still reaches no send.
    - Quality Contribution: this is the mutation guard on the widening.
    */
    const relay = new FakeSocketRelay();
    const tickler = new Trace2Tickler(
      relay,
      () => '/var/log/trace2.jsonl',
      () => CONTEXT.nowIso,
      CONTEXT.pid,
    );

    const result = await tickler.emit({ repoRoot: '/repo/alpha', message: 'a change' });

    expect(result.ok).toBe(false);
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
