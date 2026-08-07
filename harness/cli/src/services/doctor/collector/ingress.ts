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
 * 2. **Probe** — only an `af_unix` target reaches {@link SocketProbePort}.
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
  | { kind: 'af_unix'; path: string };

/**
 * A path git will actually open as a trace2 FILE target: absolute, POSIX (`/…`),
 * Windows drive-rooted (`C:\…`), or UNC. git's own rule is explicit — a trace2
 * target that is not one of its keyword/fd forms is used as a file ONLY when it
 * is absolute; anything else disables trace2 with a warning.
 */
const ABSOLUTE_TARGET = /^([A-Za-z]:)?[\\/]/;

/**
 * Classify a raw `trace2.eventTarget` value. PURE — no probe, no filesystem.
 *
 * git accepts `af_unix:<path>`, `af_unix:stream:<path>` and `af_unix:dgram:<path>`.
 * Only an ABSOLUTE path is a plain FILE target (the buffering shape from F-07).
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
export function resolveTrace2Target(raw: string | null | undefined): Trace2Target {
  const value = (raw ?? '').trim();
  if (value === '') return { kind: 'unconfigured' };
  const unix = /^af_unix:(?:stream:|dgram:)?(.+)$/.exec(value);
  if (unix?.[1] !== undefined && unix[1].trim() !== '') {
    return { kind: 'af_unix', path: unix[1].trim() };
  }
  // Keyword + fd forms: a destination (or none at all), never a drainable buffer.
  if (/^(?:0|1|2|true|false|[3-9])$/.test(value)) return { kind: 'unconfigured' };
  // A relative path is not a file target — git warns and disables trace2.
  if (!ABSOLUTE_TARGET.test(value)) return { kind: 'unconfigured' };
  return { kind: 'file', path: value };
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

/** Resolve, then probe an `af_unix` target only. Never throws. */
export async function readIngress(deps: IngressDeps): Promise<IngressReading> {
  const target = resolveTrace2Target(deps.git.globalTrace2Target());
  const markers = SANDBOX_MARKER_ENV.filter((name) => {
    const value = deps.env.get(name);
    return value !== undefined && value.trim() !== '';
  });
  if (target.kind !== 'af_unix') {
    return { target, outcome: null, socketExists: false, markers: [...markers] };
  }
  const socketExists = deps.fs.exists(target.path);
  const outcome = await deps.probe.probe(target.path);
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
 */
export function ingressBlocked(reading: IngressReading): boolean {
  return reading.outcome === 'denied' && reading.socketExists;
}
