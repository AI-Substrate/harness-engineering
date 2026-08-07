/**
 * Socket ports (plan 074 · ac-0001, ac-0006) — the ONE capability harness needs
 * to answer a question no filesystem read can: *can this process actually reach
 * git-ai's ingress socket?*
 *
 * git-ai has exactly one ingress — git's trace2 events over an `af_unix` stream
 * (research dossier F-01). An agent command sandbox (Cursor/Seatbelt today; any
 * sandbox that treats a unix-socket `connect()` as a network operation by the
 * same mechanism) denies that connect, git silently disables trace2, and the
 * commit lands with NO attribution — after which git-ai's recovery ladder
 * attests the lines as known-HUMAN (F-03). A wrong answer, not a gap, and
 * invisible to every filesystem-level health signal.
 *
 * So the probe is the only ground truth, and it is deliberately two interfaces:
 *
 * - {@link SocketProbePort} CONNECTS AND DESTROYS. It never writes a byte, so a
 *   probe can never be mistaken by the daemon for traffic and can never corrupt
 *   a stream. Read-only by construction — that is what lets `doctor` and
 *   `checks` probe on every run without violating their read-only contract
 *   (ac-0007).
 * - {@link SocketRelayPort} WRITES. It exists only for the explicitly-invoked
 *   `harness doctor telemetry-nudge` replay (ac-0006). Keeping it a separate
 *   interface means a caller that holds only a probe *cannot* mutate the
 *   collector even by accident, and a test can assert that separation.
 *
 * Both are ports, so every CI test drives a fake: no daemon, no real socket, no
 * sandbox, no network (ac-000a). `node:net` is a Node builtin — no dependency.
 */

/**
 * Every outcome a connect attempt can produce — the COMPLETE partition, matching
 * the proven prototype (`assets/research/cursor-runs/relay.mjs.txt`) exactly.
 *
 * The distinctions are load-bearing, because each one prescribes a different
 * response:
 *
 * - `connected` — the ingress is reachable. Commit normally; trace2 flows.
 * - `denied` — `EACCES`/`EPERM`: something (a sandbox) refused the connect while
 *   the socket itself exists. THE sandbox signature.
 * - `refused` — `ECONNREFUSED`: a stale socket file with nothing listening.
 * - `absent` — no socket file at all: the daemon is not running.
 * - `timeout` — the connect neither settled nor failed inside the bound.
 * - `error:<code>` — anything else, reported with its code rather than
 *   flattened into a lie. An unknown failure is never quietly a success.
 */
export type ProbeOutcome =
  | 'connected'
  | 'denied'
  | 'refused'
  | 'absent'
  | 'timeout'
  | `error:${string}`;

/**
 * The probe's wall-clock ceiling. ac-0001 caps it at 1s and this sits under it:
 * a doctor run must never hang on a socket, and a sandbox's denial is immediate
 * anyway — the bound exists for the pathological case, not the normal one.
 */
export const PROBE_TIMEOUT_MS = 750;

/**
 * Ask whether a unix socket can be connected to. NEVER sends a byte, never
 * reads one, and always destroys the handle before resolving.
 */
export interface SocketProbePort {
  /** Connect, classify, destroy. Never throws — every failure is an outcome. */
  probe(path: string): Promise<ProbeOutcome>;
}

/** The result of a replay write. A failure carries the same classification vocabulary. */
export type RelayResult =
  | { ok: true; bytes: number }
  | { ok: false; outcome: Exclude<ProbeOutcome, 'connected'> };

/**
 * Write a payload into a unix socket and close it — the nudge's delivery
 * mechanism (ac-0006). Separate from {@link SocketProbePort} on purpose: this is
 * the ONLY interface in the CLI that can mutate the collector's view of the
 * world, so it is handed out only to the explicitly-invoked nudge.
 */
export interface SocketRelayPort {
  /** Connect, write `payload`, end. Never throws — failures come back as `ok:false`. */
  send(path: string, payload: string): Promise<RelayResult>;
}
