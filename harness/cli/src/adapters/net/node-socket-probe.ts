import net from 'node:net';
import {
  PROBE_TIMEOUT_MS,
  type ProbeOutcome,
  type RelayResult,
  type SocketProbePort,
  type SocketRelayPort,
} from './socket-probe-port.js';

/**
 * The real `node:net` socket adapter (plan 074 · ac-0001, ac-0006) — a direct
 * port of the proven prototype (`assets/research/cursor-runs/relay.mjs.txt`),
 * which drained a buffered trace2 stream into a live git-ai daemon and produced
 * a full, correct authorship note the daemon could not tell from live traffic.
 *
 * `node:net` is a Node BUILTIN. No dependency is added, and named-pipe support
 * means the same code path is at least structurally viable on Windows — where
 * git's `af_unix` trace2 target does not exist, so the resolver above simply
 * never yields a socket to probe (U-5: Windows is must-not-break, not must-work).
 *
 * The connection factory is INJECTABLE, and that is the whole testing story: a
 * unit test hands in a fake socket and drives {@link classifyProbeError}'s
 * mapping through every error code with no daemon, no real socket and no
 * network. The DEFAULT factory — the only line that touches a real socket — is
 * never exercised in CI (ac-0001).
 */

/** A connect handle, narrowed to exactly what this adapter uses. */
export interface ProbeSocket {
  setTimeout(ms: number, onTimeout: () => void): unknown;
  on(event: 'connect' | 'error' | 'close', listener: (arg?: unknown) => void): unknown;
  end(payload?: string, cb?: () => void): unknown;
  destroy(): unknown;
}

/** How a socket is opened. Defaults to `net.createConnection`; injected in tests. */
export type ConnectFactory = (path: string) => ProbeSocket;

const defaultConnect: ConnectFactory = (path) => net.createConnection({ path }) as ProbeSocket;

/**
 * Map a connect failure onto the outcome vocabulary. Pure, exported, and unit
 * tested directly — the classification is the part that carries meaning, so it
 * is separable from the socket that produced it.
 *
 * `EACCES`/`EPERM` is the sandbox signature: the socket file is right there and
 * the kernel refused the connect anyway. `ENOENT` means the path itself is gone,
 * which is a daemon that is not running rather than a sandbox. Anything
 * unrecognised keeps its code (`error:<code>`) instead of being flattened —
 * an unknown failure must never read as one of the known ones, and must never
 * read as success.
 */
export function classifyProbeError(code: string | undefined): ProbeOutcome {
  if (code === 'EACCES' || code === 'EPERM') return 'denied';
  if (code === 'ECONNREFUSED') return 'refused';
  if (code === 'ENOENT') return 'absent';
  return `error:${code ?? 'unknown'}`;
}

/** Extract an error's `code` without assuming it is an `Error` at all. */
function errorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

/**
 * The real probe + relay. One class implements both ports because they share one
 * mechanism, but the INTERFACES stay separate so a read-only caller can be
 * handed a value it structurally cannot write through (ac-0007).
 */
export class NodeSocketProbe implements SocketProbePort, SocketRelayPort {
  constructor(
    private readonly connect: ConnectFactory = defaultConnect,
    private readonly timeoutMs: number = PROBE_TIMEOUT_MS,
  ) {}

  /**
   * Connect and classify. NEVER writes a byte — the handle is destroyed the
   * instant the outcome is known, so a probe cannot be mistaken for traffic and
   * cannot corrupt a stream. Never throws: a connect that blows up synchronously
   * is an `error:` outcome like any other.
   */
  probe(path: string): Promise<ProbeOutcome> {
    return new Promise<ProbeOutcome>((resolve) => {
      let settled = false;
      let sock: ProbeSocket | undefined;
      const done = (outcome: ProbeOutcome) => {
        if (settled) return;
        settled = true;
        try {
          sock?.destroy();
        } catch {
          // Destroying an already-dead handle must never change the verdict.
        }
        resolve(outcome);
      };
      try {
        sock = this.connect(path);
      } catch (err) {
        done(classifyProbeError(errorCode(err)));
        return;
      }
      sock.setTimeout(this.timeoutMs, () => done('timeout'));
      sock.on('connect', () => done('connected'));
      sock.on('error', (err) => done(classifyProbeError(errorCode(err))));
    });
  }

  /**
   * Replay a payload into the socket and close it. Used ONLY by the explicitly
   * invoked `harness doctor telemetry-nudge` (ac-0006) — never by doctor or
   * checks, which hold the probe port alone.
   */
  send(path: string, payload: string): Promise<RelayResult> {
    return new Promise<RelayResult>((resolve) => {
      let settled = false;
      let sock: ProbeSocket | undefined;
      const fail = (outcome: ProbeOutcome) => {
        if (settled) return;
        settled = true;
        try {
          sock?.destroy();
        } catch {
          // See probe(): teardown never rewrites the outcome.
        }
        // `connected` is not a failure, so it can never reach here; the cast is
        // narrowing, not widening.
        resolve({ ok: false, outcome: outcome as Exclude<ProbeOutcome, 'connected'> });
      };
      try {
        sock = this.connect(path);
      } catch (err) {
        fail(classifyProbeError(errorCode(err)));
        return;
      }
      sock.setTimeout(this.timeoutMs, () => fail('timeout'));
      sock.on('error', (err) => fail(classifyProbeError(errorCode(err))));
      sock.on('connect', () => {
        sock?.end(payload, () => {
          if (settled) return;
          settled = true;
          resolve({ ok: true, bytes: Buffer.byteLength(payload, 'utf8') });
        });
      });
    });
  }
}
