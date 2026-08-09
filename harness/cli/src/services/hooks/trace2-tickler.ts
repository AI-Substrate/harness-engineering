import type { SocketRelayPort } from '../../adapters/net/socket-probe-port.js';
import type { CommitEmitter } from './commit-intercept.js';

/**
 * The trace2 tickler (plan 082 tk-0008) — six synthetic events, ONE send.
 *
 * WHY SIX SYNTHETIC EVENTS WORK AT ALL. A real `git commit` trace2 stream carries
 * NO sha; its argv is literally `["git","commit","-q","-m",…]`. The daemon
 * resolves the transition from a reflog cursor it already holds (git-ai ingestion
 * spec, ownership rule 1). So it does not need the real stream — it only needs to
 * be TOLD that a commit command ran in repository X. Measured: a commit with no
 * note gained a complete line-level one after these six events were sent.
 *
 * ONE `send()`, NOT SIX. {@link SocketRelayPort.send} opens a connection, writes,
 * and HALF-CLOSES per call. Six calls would give the daemon six connections and
 * therefore six sessions, for one commit. The six events are newline-joined into a
 * single payload sharing one `sid`, exactly as the proven POC does it.
 *
 * The ingress path is read from git's own GLOBAL `trace2.eventTarget` rather than
 * recomputed. git-ai derives its socket name from a sha256 of its internal
 * directory, and reimplementing that digest here would be a second source of truth
 * that silently diverges the moment git-ai changes it — the config already says
 * where the daemon listens, and `harness doctor` already reads it from there.
 */

/** The `af_unix:stream:` prefix git uses for a socket trace2 target. */
const AF_UNIX_PREFIX = /^af_unix:(?:stream:|dgram:)?/;

/**
 * The socket path inside a git `trace2.eventTarget` value, or `null` when the
 * target is not a socket at all.
 *
 * A plain FILE target (`/var/log/trace2.jsonl`) is deliberately `null`: writing
 * our events into someone's log file would be a side effect nobody asked for, and
 * it would not reach a daemon anyway. A Windows NAMED PIPE is also `null` here —
 * this relay speaks `af_unix`, and claiming otherwise would be claiming a delivery
 * that never happened.
 */
export function socketPathFromTrace2Target(target: string | null): string | null {
  if (target === null) return null;
  const trimmed = target.trim();
  if (!AF_UNIX_PREFIX.test(trimmed)) return null;
  const path = trimmed.replace(AF_UNIX_PREFIX, '');
  return path.length > 0 ? path : null;
}

/** Everything the payload needs that would otherwise be read from ambient state. */
export interface TicklerContext {
  /** Absolute worktree path — the `def_repo` event's `worktree`, git-ai's join key. */
  repoRoot: string;
  /** The commit subject, carried in `argv` exactly as a real `git commit` would. */
  message: string;
  /** ISO-8601 instant, from the clock port. */
  nowIso: string;
  /** This process's id — only ever used to make the `sid` unique. */
  pid: number;
}

/**
 * Build the six events, newline-joined, sharing ONE session id.
 *
 * Pure and exported so the payload's SHAPE is provable without a daemon: the
 * event names, their order and the single shared `sid` are the contract git-ai's
 * ingestion depends on, and none of that needs a socket to assert.
 */
export function buildTicklerPayload(context: TicklerContext): { payload: string; sid: string } {
  const stamp = context.nowIso.replace(/[-:]/g, '').replace(/\.(\d{3})Z$/, '.$1000Z');
  const sid = `${stamp}-Hharness-P${context.pid.toString(16).padStart(8, '0')}`;
  const time = context.nowIso.replace(/Z$/, '000Z');
  const base = { sid, thread: 'main', time };
  const events = [
    { event: 'version', ...base, evt: '4', exe: '2.51.0' },
    {
      event: 'start',
      ...base,
      t_abs: 0.001,
      argv: ['git', 'commit', '-q', '-m', context.message],
    },
    {
      event: 'def_repo',
      ...base,
      file: 'repository.c',
      line: 242,
      repo: 1,
      worktree: context.repoRoot,
    },
    { event: 'cmd_name', ...base, name: 'commit', hierarchy: 'commit' },
    { event: 'exit', ...base, t_abs: 0.02, code: 0 },
    { event: 'atexit', ...base, t_abs: 0.02, code: 0 },
  ];
  // Newline-DELIMITED, with a trailing newline: the daemon frames on lines, and a
  // final event without its terminator would sit unparsed in its buffer.
  return { payload: `${events.map((e) => JSON.stringify(e)).join('\n')}\n`, sid };
}

/**
 * Emit over the EXISTING socket relay (plan 074's `SocketRelayPort`) — never a
 * second socket implementation, and never `node:net` in a service.
 */
export class Trace2Tickler implements CommitEmitter {
  constructor(
    private readonly relay: SocketRelayPort,
    /** Reads git's global `trace2.eventTarget`. Injected, so no ambient config read. */
    private readonly readTrace2Target: () => string | null,
    private readonly nowIso: () => string,
    private readonly pid: number,
  ) {}

  async emit(input: { repoRoot: string; message: string }): Promise<{
    ok: boolean;
    detail: string;
  }> {
    const socket = socketPathFromTrace2Target(this.readTrace2Target());
    if (socket === null) {
      // No af_unix ingress configured. Reported honestly — an emit that never had
      // anywhere to go is not a success, and it is not a crash either.
      return { ok: false, detail: 'no af_unix trace2 ingress configured' };
    }
    const { payload, sid } = buildTicklerPayload({
      repoRoot: input.repoRoot,
      message: input.message,
      nowIso: this.nowIso(),
      pid: this.pid,
    });
    // EXACTLY ONE send: one connection, one half-close, one session.
    const result = await this.relay.send(socket, payload);
    return result.ok
      ? { ok: true, detail: `sid=${sid} bytes=${result.bytes}` }
      : { ok: false, detail: `${result.outcome} (sid=${sid})` };
  }
}
