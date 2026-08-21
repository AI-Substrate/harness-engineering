import type { SocketRelayPort } from '../../adapters/net/socket-probe-port.js';
import {
  resolveTrace2Target,
  trace2Policy,
  trace2TargetPath,
} from '../doctor/collector/ingress.js';
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

/**
 * The path of a LIVE ingress inside a git `trace2.eventTarget` value, or `null`
 * when the target is not something this relay can connect to at all.
 *
 * ONE CLASSIFIER, NOT TWO (plan 082 · F006). This delegates to plan 075's
 * {@link resolveTrace2Target} and its kind table rather than re-deriving the
 * shape from a private regex. The duplicate regex WAS the defect: it tested for
 * `af_unix:` and so returned `null` for `\\.\pipe\git-ai-<id>-trace2` — the only
 * trace2 transport git has on Windows, the one git-ai's own `install-hooks`
 * configures — after the hook had already paid its full Node-startup cost and
 * detected the commit. Full cost, zero function. Plan 075 had already fixed that
 * exact misclassification one layer down; this file re-made it in a new file.
 *
 * A plain FILE target (`/var/log/trace2.jsonl`, `C:\logs\trace.jsonl`, or a real
 * UNC share) stays `null`, and that half of the 075 split is not being widened:
 * writing our events into someone's log file is a side effect nobody asked for
 * that reaches no daemon.
 *
 * Because the table is `satisfies Record<Trace2TargetKind, …>`, a seventh target
 * kind cannot compile until someone decides whether this relay may speak to it.
 */
export function relayTargetPath(target: string | null): string | null {
  const resolved = resolveTrace2Target(target);
  if (!trace2Policy(resolved).connectable) return null;
  return trace2TargetPath(resolved);
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
 *
 * The relay is transport-agnostic by construction: its connect is
 * `net.createConnection({ path })`, and `{ path }` is the IDENTICAL Node option
 * for an af_unix socket and a Win32 named pipe. So F006 added no transport code,
 * no dependency and no new failure mode — only the gate that decides whether
 * {@link SocketRelayPort.send} is reached at all.
 *
 * EXPECTED-UNVERIFIED on Windows: no run on this codebase has put a byte into a
 * real named pipe or seen git-ai's Windows daemon accept these six synthetic
 * events. What is proven here is that a pipe target reaches `send()` with the
 * pipe path and the same bytes an af_unix target gets, instead of being
 * discarded after the hook has already paid for the work. Delivery is a claim
 * for Windows hardware to make, not this file.
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
    const socket = relayTargetPath(this.readTrace2Target());
    if (socket === null) {
      // No LIVE ingress configured — nothing set, a keyword/fd form, or a plain
      // FILE target we deliberately refuse to write into. Reported honestly: an
      // emit that never had anywhere to go is not a success, and it is not a
      // crash either.
      return { ok: false, detail: 'no relayable trace2 ingress configured' };
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
