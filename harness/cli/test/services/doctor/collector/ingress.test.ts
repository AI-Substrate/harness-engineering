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
  TRACE2_TARGET_POLICY,
  trace2Policy,
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
    env: { get: (name: string) => over.env?.[name] },
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

  // F004: these all used to fall through as `{ kind: 'file' }`, which made
  // `harness commit` leave trace2 unoverridden and then tell the operator their
  // events were buffering in a file that will never exist. `unconfigured` sends
  // them to the buffered branch, where the harness controls a real, drainable file.
  it.each([
    ['0', 'git DISABLES trace2 entirely — no events at all'],
    ['false', 'git DISABLES trace2 entirely — no events at all'],
    ['3', 'a raw file DESCRIPTOR — no path to drain later'],
    ['9', 'a raw file DESCRIPTOR — no path to drain later'],
    ['trace2.jsonl', 'a RELATIVE path — git warns and disables trace2'],
    ['./events/trace2.jsonl', 'a RELATIVE path — git warns and disables trace2'],
  ])('%s is NOT a buffering file target (%s)', (raw) => {
    expect(resolveTrace2Target(raw)).toEqual({ kind: 'unconfigured' });
  });

  it.each([
    ['af_unix:/var/run/t.sock', '/var/run/t.sock'],
    ['af_unix:stream:/var/run/t.sock', '/var/run/t.sock'],
    ['af_unix:dgram:/var/run/t.sock', '/var/run/t.sock'],
  ])('%s is an af_unix target at %s', (raw, path) => {
    expect(resolveTrace2Target(raw)).toEqual({ kind: 'af_unix', path });
  });

  it.each([
    'af_unix:',
    'af_unix:stream:',
    'af_unix:dgram:',
    'af_unix:stream:   ',
  ])('an af_unix target with NO path is unconfigured, not a socket named "stream:" (%s)', (raw) => {
    /*
      Test Doc:
      - Why: the resolver used to read the path with
        `/^af_unix:(?:stream:|dgram:)?(.+)$/`. On `af_unix:stream:` the engine
        BACKTRACKS out of the optional keyword so `(.+)` has something to match,
        and returns the path `stream:`. That is a socket nobody configured, and
        plan 082 · F006 turned it live: once the tickler routes through this
        classifier, `{kind:'af_unix', path:'stream:'}` means a relay CONNECT to a
        relative path named `stream:`. Found by consolidating the two
        classifiers — the tickler's own regex had always refused it.
      - Contract: an af_unix target with no path is `unconfigured`, so it lands
        in the buffered branch where the harness controls a real file.
      - Quality Contribution: pins the regex's BACKTRACKING, which no test of the
        well-formed cases above can reach. Reverting to the capturing form fails
        the `stream:`/`dgram:` rows while every other row still passes.
      */
    expect(resolveTrace2Target(raw)).toEqual({ kind: 'unconfigured' });
  });

  it.each([
    ['af_unix:stream', 'no socket-type separator — "stream" IS the path, and it is relative'],
    ['af_unix:dgram', 'same, for the dgram keyword'],
    ['af_unix:relative', 'a bare relative name'],
    ['af_unix:stream:relative', 'a relative path behind a valid socket-type'],
    ['af_unix:dgram:relative', 'same, for dgram'],
    ['af_unix:./events/t.sock', 'a dot-relative path'],
  ])('a NON-ABSOLUTE af_unix path is unconfigured (%s — %s)', (raw) => {
    /*
      Test Doc:
      - Why: git's grammar is `af_unix:[<socket-type>:]<absolute-pathname>`, and
        git DISABLES trace2 on a non-absolute AF_UNIX path — nothing is ever
        delivered there. The resolver accepted these as `{kind:'af_unix'}`, which
        was inert while af_unix only selected a commit branch; F006 made every
        `connectable` target something the tickler and `readIngress` actually
        CONNECT to, so a malformed target became a connect to a relative name.
        Same class as the backtracking row above: calling it configured claims an
        ingress that cannot exist.
      - Contract: an af_unix target whose path is not absolute is `unconfigured`,
        matching git's own behaviour, so it lands in the buffered branch.
      - Quality Contribution: the well-formed rows above cannot reach this — they
        are all absolute. Removing the absoluteness check fails every row here
        while every other row in the file still passes.
      */
    expect(resolveTrace2Target(raw)).toEqual({ kind: 'unconfigured' });
  });

  it.each([
    '/tmp/trace2-events.jsonl',
    'C:\\Users\\dev\\trace2.jsonl',
    '//server/share/trace2.jsonl',
  ])('only an ABSOLUTE path is a FILE target: %s', (raw) => {
    expect(resolveTrace2Target(raw)).toEqual({ kind: 'file', path: raw });
  });
});

/**
 * Plan 075 · ac-0001/ac-0002 — the WINDOWS NAMED PIPE split.
 *
 * The defect this pins: `ABSOLUTE_TARGET` (`/^([A-Za-z]:)?[\\/]/`) matches
 * `\\.\pipe\…` because a pipe path begins with a separator, so a LIVE INGRESS
 * was classified `{kind:'file'}` — a drainable buffer. `harness commit` then
 * told the operator their events were buffered to a pipe, wrote a `.shas`
 * sidecar beside it, and pointed at a nudge that refused with "is a plain file".
 *
 * **This is a SPLIT of an intentional case, not a gap being filled.** The
 * resolver deliberately admits UNC FILE targets, and a named pipe is
 * UNC-SHAPED. So both directions are pinned in the same table: excluding pipes
 * while breaking `\\server\share\trace.jsonl` would be its own defect, and one
 * only the other direction can catch.
 */
describe('plan 075 · ac-0001 — a Windows named pipe is an INGRESS, never a buffer', () => {
  it.each([
    ['\\\\.\\pipe\\git-ai', 'the documented git-ai pipe form'],
    ['\\\\?\\pipe\\git-ai', 'the \\\\?\\ (long-path) pipe prefix'],
    [
      '\\\\.\\PIPE\\Git-AI',
      'Windows pipe names are CASE-INSENSITIVE — EXPECTED-UNVERIFIED, read from Win32 docs, never run here',
    ],
    ['\\\\.\\pipe\\git-ai\\daemon\\trace2', 'a nested pipe name'],
    [
      '//./pipe/git-ai',
      'the forward-slash spelling Win32 accepts identically — EXPECTED-UNVERIFIED, same provenance',
    ],
    ['\\\\.\\pipe', 'the pipe NAMESPACE root is still not a drainable file'],
  ])('%s classifies as named_pipe (%s)', (raw) => {
    expect(resolveTrace2Target(raw)).toEqual({ kind: 'named_pipe', path: raw });
  });

  it('the regression guard, stated once and plainly', () => {
    // If this ever reads `file` again, `harness commit` is writing a `.shas`
    // sidecar beside a live pipe and calling an ingress a buffer.
    expect(resolveTrace2Target('\\\\.\\pipe\\git-ai').kind).not.toBe('file');
  });

  it.each([
    // PRIME CONSTRAINT, the other direction. These are the cases the split must
    // NOT take with it: a real UNC file share IS a legitimate trace2 file target
    // and git will happily write events into it.
    ['\\\\server\\share\\trace.jsonl', 'file'],
    ['//server/share/trace2.jsonl', 'file'],
    ['\\\\server\\share\\pipe\\trace.jsonl', 'file'],
    ['C:\\Users\\dev\\trace2.jsonl', 'file'],
    ['/tmp/trace2-events.jsonl', 'file'],
    ['\\\\.\\pipe\\git-ai', 'named_pipe'],
    ['\\\\?\\pipe\\git-ai', 'named_pipe'],
    ['af_unix:/var/run/t.sock', 'af_unix'],
    ['af_unix:stream:/var/run/t.sock', 'af_unix'],
    ['trace2.jsonl', 'unconfigured'],
    ['0', 'unconfigured'],
    ['2', 'unconfigured'],
    ['4', 'unconfigured'],
    ['', 'unconfigured'],
  ] as const)('%s → %s (both directions, one table)', (raw, kind) => {
    expect(resolveTrace2Target(raw).kind).toBe(kind);
  });
});

describe('plan 075 · ac-0003 — the classifier is proven by what it REFUSES', () => {
  /**
   * A classifier only ever run against inputs it handles has been DEMONSTRATED,
   * not tested. These are the known-bad fixtures: strings that LOOK like the
   * thing and must not be taken for it.
   */
  it.each([
    ['\\\\.\\pipexyz', 'no separator after `pipe` — a different device, not the pipe namespace'],
    ['\\\\.\\pipeline\\x', '`pipeline` merely STARTS with `pipe`'],
    ['\\\\.\\PhysicalDrive0', 'another `\\\\.\\` device that is emphatically not a pipe'],
    ['\\\\server\\pipe\\trace.jsonl', 'a share literally NAMED `pipe` on a real server'],
    ['pipe\\git-ai', 'the pipe name with no namespace prefix at all'],
    ['\\pipe\\git-ai', 'one leading separator, not two'],
  ])('%s is NOT a named_pipe (%s)', (raw) => {
    expect(resolveTrace2Target(raw).kind).not.toBe('named_pipe');
  });

  it.each([
    ['pipe\\git-ai', 'RELATIVE — git warns and disables trace2'],
    ['.\\pipe\\git-ai', 'RELATIVE — git warns and disables trace2'],
    ['0', 'git DISABLES trace2 entirely'],
    ['4', 'a raw file DESCRIPTOR — no path to drain later'],
  ])('%s is REFUSED outright (%s)', (raw) => {
    // The point is a refusal, not a reclassification: these reach neither the
    // pipe branch nor the file branch.
    expect(resolveTrace2Target(raw)).toEqual({ kind: 'unconfigured' });
  });

  it('a near-miss that is refused as a PIPE is still handled honestly as a path', () => {
    // `\\.\pipexyz` is absolute, so git would open it as a file. Refusing it as
    // a pipe must not also strand it: it stays in the branch git actually uses.
    expect(resolveTrace2Target('\\\\.\\pipexyz')).toEqual({
      kind: 'file',
      path: '\\\\.\\pipexyz',
    });
  });
});

describe('plan 075 · ac-0001 / plan 082 · F006 — a named pipe is an ingress, and IS probed', () => {
  it('readIngress classifies the pipe and makes NO connect attempt', async () => {
    const d = deps({ target: '\\\\.\\pipe\\git-ai' });
    const reading = await readIngress(d);
    expect(reading.target).toEqual({ kind: 'named_pipe', path: '\\\\.\\pipe\\git-ai' });
    // F006: the pipe IS probed now — it is a live endpoint the adapter can
    // connect to, and a doctor that never probes it can never say whether the
    // Windows ingress is reachable. `socketExists` stays false because there is
    // no file to stat: a pipe's existence is answered by the connect (ENOENT →
    // absent), never by a stat.
    expect(reading.outcome).toBe('absent');
    expect(d.probe.calls).toEqual(['\\\\.\\pipe\\git-ai']);
    expect(reading.socketExists).toBe(false);
  });

  it('a probed pipe that CONNECTS reaches and proves, exactly like a socket', async () => {
    /*
    Test Doc:
    - Why: plan 075 left the pipe unprobed and therefore unprovable, saying so
      by name ("this does NOT make replay work on Windows — that needs the
      transport question answered first"). F006 answers it: `{ path }` is the
      same Node option for a unix socket and a Win32 pipe, so the SAME probe
      applies. Without this, `harness doctor` on Windows can only ever report
      "could not tell".
    - Contract: a connected pipe reading reaches and proves.
    - Quality Contribution: pins the OUTCOME-driven predicates rather than the
      kind, so they cannot regress into an af_unix-only allowlist.
    */
    const d = deps({
      target: '\\\\.\\pipe\\git-ai',
      probe: new FakeSocketProbe({ '\\\\.\\pipe\\git-ai': 'connected' }, 'absent'),
    });
    const reading = await readIngress(d);
    expect(ingressProves(reading)).toBe(true);
    expect(ingressReaches(reading)).toBe(true);
  });

  it('a DENIED pipe is blocked without a stat — the connect is the existence test', async () => {
    /*
    Test Doc:
    - Why: `ingressBlocked` requires `socketExists` because a denial on a path
      with no socket is a duller fact than a socket that is right there and
      refuses. A pipe has no path to stat — `existsSync('\\\\.\\pipe\\…')` is not
      a liveness test — but its connect already separates the two cases: ENOENT
      is `absent`, EACCES is `denied`. So `denied` on a pipe IS the signature.
    - Contract: a denied pipe reads as blocked; an absent pipe does not.
    - Quality Contribution: guards against "just set socketExists = true for
      pipes", which would fabricate an unmeasured filesystem fact.
    */
    const denied = await readIngress(
      deps({
        target: '\\\\.\\pipe\\git-ai',
        probe: new FakeSocketProbe({ '\\\\.\\pipe\\git-ai': 'denied' }, 'absent'),
      }),
    );
    expect(ingressBlocked(denied)).toBe(true);

    const absent = await readIngress(deps({ target: '\\\\.\\pipe\\git-ai' }));
    expect(ingressBlocked(absent)).toBe(false);
  });
});

describe('plan 075 · ac-0006 — the kind table is exhaustive by CONSTRUCTION', () => {
  it('every Trace2Target kind declares a policy', () => {
    // The compile-time guarantee is `satisfies Record<Trace2TargetKind, …>` in
    // `ingress.ts` — this only pins the VALUES. A new kind added to the union
    // fails `tsc`, not this test (plan 074 F011: a contract in a test file
    // compiles nowhere CI looks).
    expect(Object.keys(TRACE2_TARGET_POLICY).sort()).toEqual([
      'af_unix',
      'file',
      'named_pipe',
      'unconfigured',
    ]);
  });

  it('a named pipe is a LIVE ingress that is neither drainable nor replayable', () => {
    const policy = trace2Policy({ kind: 'named_pipe', path: '\\\\.\\pipe\\git-ai' });
    expect(policy.receives).toBe('always');
    expect(policy.drainable).toBe(false);
    expect(policy.replayInto).toBe(false);
  });

  it('a file target is drainable; an af_unix socket is replayable', () => {
    expect(trace2Policy({ kind: 'file', path: '/tmp/b.jsonl' }).drainable).toBe(true);
    expect(trace2Policy({ kind: 'af_unix', path: SOCK }).replayInto).toBe(true);
    expect(trace2Policy({ kind: 'af_unix', path: SOCK }).receives).toBe('when-probe-connected');
    expect(trace2Policy({ kind: 'unconfigured' }).receives).toBe('never');
  });

  it('the description of a pipe never uses the word buffer', () => {
    const detail = trace2Policy({ kind: 'named_pipe', path: '\\\\.\\pipe\\git-ai' }).describe(
      '\\\\.\\pipe\\git-ai',
    );
    expect(detail).toContain('NAMED PIPE');
    expect(detail).not.toMatch(/buffer/i);
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
