import type { GitAttributionPort } from '../../../adapters/git/git-attribution-port.js';
import type { ProbeOutcome, SocketProbePort } from '../../../adapters/net/socket-probe-port.js';
import type { CollectorFsPort } from './types.js';

/**
 * The INGRESS read (plan 074 · ac-0001, ac-0002) — the layer that turns "where
 * is git-ai listening, and can we reach it?" into a value the rest of the plan
 * branches on.
 *
 * Two stages, and the split is the point:
 *
 * 1. **Resolve** — read the GLOBAL `trace2.eventTarget` and classify the target
 *    shape. `unconfigured` (nothing set) and `file` (a plain path) are decided
 *    HERE, WITHOUT probing, because there is no socket to probe: probing them
 *    would be a connect attempt against something that was never a socket, and
 *    whatever it returned would be noise.
 * 2. **Probe** — only a CONNECTABLE target reaches {@link SocketProbePort}, and
 *    which kinds those are is the kind table's answer, not a local `if`. Both
 *    an `af_unix` socket and a Windows `named_pipe` qualify (plan 082 · F006):
 *    they are reached by the identical `net.createConnection({ path })` call, so
 *    treating the pipe as unprobeable left doctor unable to say anything at all
 *    about the Windows ingress.
 *
 * ENV MARKERS NEVER DECIDE. `CURSOR_SANDBOX` and friends may be reported to
 * EXPLAIN a blocked probe in operator-facing text, and that is their entire
 * role. The evidence is F-11: the socket was observed REACHABLE from inside a
 * sandbox with `CURSOR_SANDBOX=seatbelt` set. A marker-driven verdict would have
 * called that healthy session blocked. Only the probe outcome decides — asserted
 * by a test (markers present + probe `connected` → no warning).
 */

/** What the configured trace2 target actually is. */
export type Trace2Target =
  | { kind: 'unconfigured' }
  | { kind: 'file'; path: string }
  | { kind: 'af_unix'; path: string }
  /**
   * A Windows NAMED PIPE — `\\.\pipe\…`. A LIVE INGRESS, and the reason this
   * arm exists (plan 075 · ac-0001): the pipe path begins with a separator, so
   * it matched {@link ABSOLUTE_TARGET} and was classified `file` — a drainable
   * buffer. Calling a live ingress a buffer is the one thing this feature must
   * never do: it made `harness commit` tell the operator their events were
   * buffered to a pipe, write a `.shas` sidecar beside it, and point at a nudge
   * that then refused with "is a plain file".
   */
  | { kind: 'named_pipe'; path: string };

/** Every arm of {@link Trace2Target}, as the key set the exhaustive tables use. */
export type Trace2TargetKind = Trace2Target['kind'];

/**
 * A path git will actually open as a trace2 FILE target: absolute, POSIX (`/…`),
 * Windows drive-rooted (`C:\…`), or UNC. git's own rule is explicit — a trace2
 * target that is not one of its keyword/fd forms is used as a file ONLY when it
 * is absolute; anything else disables trace2 with a warning.
 *
 * NOTE the UNC admission is DELIBERATE — `\\server\share\trace.jsonl` is a real
 * file target — which is precisely why {@link WINDOWS_NAMED_PIPE} is a SPLIT of
 * this case rather than a narrowing of it. Excluding pipes by tightening this
 * expression would break legitimate UNC file targets, and that is the failure
 * mode plan 075 pins in both directions.
 */
const ABSOLUTE_TARGET = /^([A-Za-z]:)?[\\/]/;

/**
 * The Win32 named-pipe NAMESPACE: `\\.\pipe\…` and `\\?\pipe\…`, either
 * separator, case-insensitive (Windows pipe names are).
 *
 * Anchored on the whole `pipe` segment — `(?:[\\/]|$)` — so the near misses are
 * refused rather than swept in: `\\.\pipexyz` and `\\.\pipeline\x` are OTHER
 * devices, and `\\server\pipe\trace.jsonl` is an ordinary share that happens to
 * be named `pipe`. Those stay FILE targets, because that is what git does with
 * them.
 */
const WINDOWS_NAMED_PIPE = /^[\\/]{2}[.?][\\/]pipe(?:[\\/]|$)/i;

/**
 * Classify a raw `trace2.eventTarget` value. PURE — no probe, no filesystem.
 *
 * git accepts `af_unix:<path>`, `af_unix:stream:<path>` and `af_unix:dgram:<path>`.
 * A Windows named pipe (`\\.\pipe\…`) is its own kind — a LIVE ingress, split
 * out BEFORE the absolute test (plan 075). Of what remains, only an ABSOLUTE
 * path is a plain FILE target (the buffering shape from F-07).
 * EVERYTHING else reads as `unconfigured`, and the set is wider than it looks —
 * this is the ac-0001 correction the review caught, and the reason it matters is
 * that `unconfigured` and `file` drive OPPOSITE commit branches:
 *
 * - `0` / `false` — git's DISABLED forms. Nothing is emitted at all. Reading
 *   these as `file` would make `harness commit` leave trace2 unoverridden and
 *   then tell the operator their events are buffering in a file that will never
 *   exist: a confident wrong answer about recoverable attribution.
 * - `1` / `2` / `true` — git's stderr/fd-1/fd-2 forms. A destination, but not an
 *   ingress and not a buffer.
 * - `3`–`9` — git's raw file-DESCRIPTOR forms. Events go to an already-open fd
 *   inherited from the parent; there is no path to drain later.
 * - a RELATIVE path — git refuses it (it warns and disables trace2), so treating
 *   it as a buffer would name a file git never writes.
 *
 * Every one of those lands in the buffered branch instead, where `harness commit`
 * points `GIT_TRACE2_EVENT` at a buffer it controls and can actually replay.
 */
/**
 * The `af_unix:` prefix and its optional transport keyword, as ONE unit.
 *
 * Stripped rather than captured, deliberately (plan 082 · F006). The capturing
 * form `/^af_unix:(?:stream:|dgram:)?(.+)$/` looks equivalent and is not: given
 * the empty target `af_unix:stream:` the engine backtracks out of the optional
 * keyword so that `(.+)` has something to match, and yields the "path"
 * `stream:` — a socket name nobody configured, which a caller would then
 * cheerfully try to connect to. Stripping cannot backtrack, so an empty
 * remainder stays empty and is refused below.
 */
const AF_UNIX_PREFIX = /^af_unix:(?:stream:|dgram:)?/;

export function resolveTrace2Target(raw: string | null | undefined): Trace2Target {
  const value = (raw ?? '').trim();
  if (value === '') return { kind: 'unconfigured' };
  if (AF_UNIX_PREFIX.test(value)) {
    const path = value.replace(AF_UNIX_PREFIX, '').trim();
    // Git's grammar is `af_unix:[<socket-type>:]<absolute-pathname>`, and git
    // DISABLES trace2 on an af_unix target whose path is not absolute — nothing
    // is ever delivered there. So an empty path (`af_unix:stream:`) and a
    // relative one (`af_unix:stream:relative`, or the bare-keyword form
    // `af_unix:stream`) are the same fact: no socket exists to receive events.
    // `unconfigured` routes both to the buffered branch, where the harness
    // controls a real file it can replay. Calling them `af_unix` would claim an
    // ingress that cannot exist — and since plan 082 · F006 every `connectable`
    // target is something the relay and `readIngress` actually CONNECT to, so
    // the claim would become a connect to a name git never opened.
    //
    // Absoluteness is the POSIX leading `/`, deliberately: af_unix is a POSIX
    // transport and inventing Windows semantics for it would be a guess.
    return path.startsWith('/') ? { kind: 'af_unix', path } : { kind: 'unconfigured' };
  }
  // Keyword + fd forms: a destination (or none at all), never a drainable buffer.
  if (/^(?:0|1|2|true|false|[3-9])$/.test(value)) return { kind: 'unconfigured' };
  // BEFORE the absolute test, and the ORDER is the whole fix (plan 075 · ac-0001):
  // a pipe path is absolute-shaped, so anything downstream of `ABSOLUTE_TARGET`
  // would already have called this live ingress a file.
  if (WINDOWS_NAMED_PIPE.test(value)) return { kind: 'named_pipe', path: value };
  // A relative path is not a file target — git warns and disables trace2.
  if (!ABSOLUTE_TARGET.test(value)) return { kind: 'unconfigured' };
  return { kind: 'file', path: value };
}

/**
 * What a target kind IS — the vocabulary every consumer branches on, in ONE
 * place, so "is this a buffer or an ingress?" is answered once rather than
 * re-derived at each call site (that re-derivation is how a pipe came to be
 * treated as a file in three different verbs).
 */
export interface Trace2TargetPolicy {
  /**
   * Is something ALREADY receiving this commit's events?
   *
   * - `always` — a file that git is writing into, or a live pipe git can talk
   *   to. `harness commit` must NOT redirect: overriding `GIT_TRACE2_EVENT`
   *   REPLACES the configured target, so it would DIVERT events rather than
   *   duplicate them.
   * - `when-probe-connected` — a socket, and only the probe can say.
   * - `never` — nothing is listening; the harness buffers.
   */
  readonly receives: 'always' | 'when-probe-connected' | 'never';
  /**
   * Is this a LIVE IPC endpoint that a `connect()` can mean something against?
   *
   * The one question every writer and every prober asks, answered ONCE (plan
   * 082 · F006). It is `true` for an `af_unix` socket and for a Windows
   * `named_pipe`, and the reason they share an answer is that they share a
   * mechanism: `net.createConnection({ path })` is the IDENTICAL Node call for
   * both (`adapters/net/node-socket-probe.ts`), so a caller that can reach one
   * can structurally reach the other.
   *
   * It is `false` for a `file`, and that split is the whole point. Writing
   * synthetic events into an operator's log file is an unasked-for side effect
   * that reaches no daemon; connecting to a pipe git-ai is listening on is
   * delivery. Plan 082 originally collapsed both into "not af_unix" and so
   * refused the only transport git has on Windows — the exact misclassification
   * plan 075 fixed one layer down.
   *
   * EXPECTED-UNVERIFIED for `named_pipe`: no test in this repo, and no machine
   * this code has run on, has delivered a byte into a real Win32 named pipe or
   * seen git-ai's Windows daemon accept it. What is proven is that the relay is
   * now CALLED with the pipe path instead of discarding the payload. The
   * delivery claim waits on Windows hardware.
   */
  readonly connectable: boolean;
  /** May the drain path rotate, replay and delete this path as a buffer of PAST events? */
  readonly drainable: boolean;
  /** Can `telemetry-nudge` replay a buffer INTO this transport today? */
  readonly replayInto: boolean;
  /** Operator-facing description of the target, given its path. */
  readonly describe: (path: string) => string;
}

/**
 * The EXHAUSTIVE kind table (plan 075 · ac-0006, applying plan 074's F011
 * lesson: a guarantee about FUTURE code needs the type system, not a test).
 *
 * `satisfies Record<Trace2TargetKind, …>` is the guard. Add an arm to
 * {@link Trace2Target} and `tsc` refuses this object until the new kind
 * declares whether it is a buffer or an ingress — which is exactly the question
 * that went unanswered for `named_pipe`. It lives in `src` because the
 * typecheck `include` is `["src"]`: the same contract in a test file compiles
 * nowhere CI looks.
 */
export const TRACE2_TARGET_POLICY = {
  unconfigured: {
    receives: 'never',
    connectable: false,
    drainable: false,
    replayInto: false,
    describe: () => 'is not configured (no trace2 target)',
  },
  file: {
    receives: 'always',
    connectable: false,
    drainable: true,
    replayInto: false,
    describe: (path: string) =>
      `is a plain FILE target (${path}) — events buffer there rather than reaching the collector`,
  },
  af_unix: {
    receives: 'when-probe-connected',
    connectable: true,
    drainable: false,
    replayInto: true,
    describe: (path: string) => `is an af_unix socket (${path})`,
  },
  named_pipe: {
    receives: 'always',
    connectable: true,
    drainable: false,
    replayInto: false,
    describe: (path: string) =>
      `is a Windows NAMED PIPE (${path}) — a LIVE collector ingress, not a drainable file`,
  },
} as const satisfies Record<Trace2TargetKind, Trace2TargetPolicy>;

/** The policy for a resolved target. */
export function trace2Policy(target: Trace2Target): Trace2TargetPolicy {
  return TRACE2_TARGET_POLICY[target.kind];
}

/** The target's path, or `null` for the one kind that has none. */
export function trace2TargetPath(target: Trace2Target): string | null {
  return target.kind === 'unconfigured' ? null : target.path;
}

/**
 * Environment variables that a SANDBOX sets. Reported to explain, never to
 * decide (F-11). Kept as data so the explanation can grow without the verdict
 * logic acquiring a single new branch.
 */
export const SANDBOX_MARKER_ENV = ['CURSOR_SANDBOX', 'SANDBOX_TYPE', 'SEATBELT_PROFILE'] as const;

/** One ingress reading: what was configured, what the probe said, and what exists. */
export interface IngressReading {
  target: Trace2Target;
  /** `null` when no probe was performed — an `unconfigured` or `file` target. */
  outcome: ProbeOutcome | null;
  /** Whether the socket FILE is on disk. Meaningless (and `false`) for non-socket targets. */
  socketExists: boolean;
  /** Sandbox marker env names that were set at read time. EXPLANATORY ONLY. */
  markers: string[];
}

export interface IngressDeps {
  git: Pick<GitAttributionPort, 'globalTrace2Target'>;
  probe: SocketProbePort;
  fs: Pick<CollectorFsPort, 'exists'>;
  /** Env reader for the explanatory markers. Never consulted for the verdict. */
  env: { get(name: string): string | undefined };
}

/** Resolve, then probe any CONNECTABLE target. Never throws. */
export async function readIngress(deps: IngressDeps): Promise<IngressReading> {
  const target = resolveTrace2Target(deps.git.globalTrace2Target());
  const markers = SANDBOX_MARKER_ENV.filter((name) => {
    const value = deps.env.get(name);
    return value !== undefined && value.trim() !== '';
  });
  // Driven by the kind table, not by `kind === 'af_unix'` (plan 082 · F006). A
  // pipe is a live endpoint reached by the same `net.createConnection({ path })`
  // call, so refusing to probe it left doctor permanently unable to say whether
  // the Windows ingress was reachable — "could not tell" as a permanent verdict.
  const path = trace2TargetPath(target);
  if (path === null || !trace2Policy(target).connectable) {
    return { target, outcome: null, socketExists: false, markers: [...markers] };
  }
  // The stat is for a SOCKET FILE only. `existsSync('\\.\pipe\…')` is not a
  // liveness test for a pipe, and answering it with a fabricated `true` would
  // put an unmeasured filesystem fact into the reading. The connect answers it:
  // ENOENT → `absent`, EACCES → `denied`.
  const socketExists = target.kind === 'af_unix' ? deps.fs.exists(path) : false;
  const outcome = await deps.probe.probe(path);
  return { target, outcome, socketExists, markers: [...markers] };
}

/**
 * Is this reading one where a commit's trace2 event will actually reach the
 * daemon? `connected` alone — every other outcome means the event goes nowhere
 * (or, for a `file` target, into a buffer rather than the collector).
 */
export function ingressReaches(reading: IngressReading): boolean {
  return reading.outcome === 'connected';
}

/**
 * Can this reading PROVE anything about attribution? `false` for every outcome
 * where a missing note is unexplained rather than meaningful — the difference
 * between "no unattributed commits" and "we could not tell" (ac-0003).
 */
export function ingressProves(reading: IngressReading): boolean {
  return reading.outcome === 'connected';
}

/** Human phrasing of the markers clause — empty string when there is nothing to explain. */
export function markerExplanation(reading: IngressReading): string {
  if (reading.markers.length === 0) return '';
  return ` (sandbox markers set: ${reading.markers.join(', ')} — these EXPLAIN the blocked probe, they did not decide it)`;
}

/**
 * The ac-0002 verdict input: a blocked ingress is `denied` WHILE THE SOCKET FILE
 * EXISTS. Both halves matter — a `denied` on a path with no socket is a
 * different and less interesting fact than a socket that is right there and
 * refuses to be connected to, which is the sandbox signature.
 *
 * A NAMED PIPE has no second half, and needs none (plan 082 · F006): there is no
 * file to stat, and the connect is expected to separate the two cases the stat
 * exists to separate — a pipe that is not there answering `ENOENT` (`absent`),
 * and a pipe that is there and refuses answering `EACCES` (`denied`). So
 * `denied` on a pipe IS the signature, and requiring `socketExists` would make
 * it permanently unreportable.
 *
 * EXPECTED-UNVERIFIED: that ENOENT/EACCES partition is read from Win32 named-pipe
 * semantics and Node's error mapping, not from a run. No machine this code has
 * executed on has connected to a real named pipe, absent or denied. If Windows
 * answers some third code, it arrives as `error:<code>` — which is the point of
 * that arm, and is honest rather than silently mistaken.
 */
export function ingressBlocked(reading: IngressReading): boolean {
  if (reading.outcome !== 'denied') return false;
  return reading.target.kind === 'named_pipe' ? true : reading.socketExists;
}
