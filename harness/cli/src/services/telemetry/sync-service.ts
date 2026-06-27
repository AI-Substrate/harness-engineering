import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import {
  type GitWritePort,
  type TreeEntry,
  telemetryRefFor,
} from '../../adapters/git/git-write-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import { posixJoin, toPosix } from '../shared/posix-path.js';
import { KILL_SWITCH_ENV } from './capture-service.js';
import { telemetryDir } from './cursor.js';
import type { Segment } from './segment.js';

/**
 * The telemetry sync service (plan 034 Phase 4 · 4.3/4.4) — the durable half.
 * Capture writes a gitignored `.harness/temp/telemetry/<session>/<seq>.json`
 * buffer (Phase 1); sync flushes everything past each session's watermark into
 * per-(capture-date, session) SHARD refs via {@link GitWritePort} plumbing
 * ({@link telemetryRefFor} → `refs/harness-telemetry/<YYYY>/<MM>/<DD>/<session>`),
 * pushes each shard's single refspec, and only then advances the watermark
 * ("consumes" the buffer). Pure over injected ports (P2: no `node:*`).
 *
 * WHY SHARD (team scale): a single shared mutable ref is a distributed
 * write-contention problem — N engineers pushing from independent clones means
 * the 2nd..Nth pusher gets a non-fast-forward rejection. A per-(date,session) ref
 * is single-writer by construction, so every push is a clean create-or-ff — no
 * fetch, no merge, no retry across writers. A central scraper still collects
 * everything in ONE globbed fetch (`refs/harness-telemetry/*`); the date prefix
 * is the prune key. (Canonical git pattern: Gerrit `refs/changes/*`, GitHub
 * `refs/pull/*`.) Each shard's commit tree is flat OTLP signal files —
 * `<seq>.logs.jsonl` + `<seq>.metrics.jsonl` (the T010 spool; T011 publishes
 * these, not the segment buffer json) — the date+session hierarchy is in the ref
 * name. The local `<seq>.json` buffer stays the watermark key + reconstruction
 * oracle; it falls back into the tree only when its spool companions are absent.
 *
 * Offline-safe (AC-14): a failed shard push rolls that shard's local ref back and
 * leaves the buffer + watermark untouched, so the next sync retries it. The
 * "consumed" marker is a per-session `<session>.flushed` file — OUTSIDE the
 * segment, so the frozen schema is never touched (AC-12). Fail-safe: any error is
 * caught and returned as `{ ok:false }`, never thrown to the host.
 */

export interface SyncDeps {
  fs: FsPort;
  env: EnvPort;
  proc: ProcessPort;
  git: GitWritePort;
}

export interface SyncResult {
  /** True when the run completed cleanly (incl. "nothing to flush"). */
  ok: boolean;
  /** True when at least one shard was pushed this run. */
  pushed: boolean;
  /** Segments flushed (pushed) this run. */
  segments: number;
  /** Sessions that contributed at least one pushed shard this run. */
  sessions: number;
  /** Deduped, sorted plan links carried in the pushed shards (AC-08). */
  plans: string[];
  /** Set on a failure (a shard's push failed / ref-update exhausted). */
  message?: string;
}

const REF_UPDATE_RETRIES = 3;

/** Fallback ref date bucket when a segment's timecode can't be parsed (keeps ref depth uniform). */
const UNDATED = '0000/00/00';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** `<telemetryDir>/<session>.flushed` — the per-session high-water seq already flushed. */
function flushedPathFor(telDir: string, session: string): string {
  return posixJoin(telDir, `${session}.flushed`);
}

function readFlushed(fs: FsPort, path: string): number {
  const raw = fs.readText(path);
  if (raw === null) return 0;
  const t = raw.trim();
  return /^\d+$/.test(t) ? Number.parseInt(t, 10) : 0;
}

/** Advance the watermark crash-safely (temp + rename, mirroring the cursor). */
function writeFlushed(fs: FsPort, path: string, value: number): void {
  const tmp = `${path}.tmp`;
  fs.writeText(tmp, String(value));
  fs.rename(tmp, path);
}

/** `YYYY/MM/DD` from a segment's ISO timecode, or {@link UNDATED} when it can't be parsed. */
function refDatePath(timecode: unknown): string {
  if (typeof timecode !== 'string') return UNDATED;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(timecode);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : UNDATED;
}

function buildMessage(
  datePath: string,
  session: string,
  segments: number,
  plans: string[],
): string {
  const planLine = plans.length > 0 ? `plans: ${plans.join(',')}` : 'plans: (none)';
  return `telemetry: flush ${segments} segment(s) — ${datePath}/${session}\n\n${planLine}\n`;
}

/** A read-only snapshot of what `syncTelemetry` would flush right now. */
export interface PendingSummary {
  /** Buffered segments past their session watermark (i.e. not yet pushed). */
  segments: number;
  /** Sessions contributing at least one such segment. */
  sessions: number;
}

/**
 * Count buffered-but-unpushed telemetry WITHOUT touching git or the buffer — the
 * read-only probe the `boot`/`checks` housekeeping decorator uses to decide
 * whether to nudge. Fail-safe: any error → `{ segments:0, sessions:0 }` (a probe
 * must never disturb the host command).
 */
export function pendingTelemetry(deps: { fs: FsPort; proc: ProcessPort }): PendingSummary {
  try {
    const cwd = toPosix(deps.proc.cwd());
    const telDir = telemetryDir(cwd);
    const sessions = deps.fs.readdir(telDir).filter((n) => !n.includes('.'));
    let segments = 0;
    let withPending = 0;
    for (const session of sessions) {
      const already = readFlushed(deps.fs, flushedPathFor(telDir, session));
      const count = deps.fs
        .readdir(posixJoin(telDir, session))
        .map((n) => /^(\d+)\.json$/.exec(n))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => Number.parseInt(m[1], 10))
        .filter((seq) => seq > already).length;
      if (count > 0) {
        segments += count;
        withPending++;
      }
    }
    return { segments, sessions: withPending };
  } catch {
    return { segments: 0, sessions: 0 };
  }
}

/** One shard = one (capture-date, session) group → one ref → one commit. */
interface Shard {
  datePath: string;
  session: string;
  blobs: TreeEntry[];
  maxSeq: number;
  segments: number;
  plans: Set<string>;
}

interface ShardOutcome {
  ok: boolean;
  /** True when this run actually pushed; false for an idempotent no-op (already published). */
  pushed: boolean;
  message?: string;
}

/**
 * Flush the telemetry buffer to the orphan ref namespace. The named entry the
 * `telemetry sync` verb (T005) calls. Best-effort + fail-safe — never throws.
 */
export function syncTelemetry(deps: SyncDeps): SyncResult {
  const empty: SyncResult = { ok: true, pushed: false, segments: 0, sessions: 0, plans: [] };
  try {
    if (deps.env.get(KILL_SWITCH_ENV) === '1') return empty; // kill-switch → no-op (AC-05)
    return syncUnsafe(deps);
  } catch (err) {
    return { ...empty, ok: false, message: errMsg(err) };
  }
}

function syncUnsafe(deps: SyncDeps): SyncResult {
  const cwd = toPosix(deps.proc.cwd());
  const telDir = telemetryDir(cwd);

  // Session dirs have sanitized (dot-free) names; `.cursor`/`.flushed`/`.gitignore`
  // are metadata files — skip anything with a dot. A missing dir → [] (no-op).
  const sessions = deps.fs.readdir(telDir).filter((n) => !n.includes('.'));

  let totalSegments = 0;
  let pushedAny = false;
  let anyFailure = false;
  let failMessage: string | undefined;
  const flushedSessions = new Set<string>();
  const planSet = new Set<string>();

  for (const session of [...sessions].sort()) {
    const sessionDir = posixJoin(telDir, session);
    const flushedPath = flushedPathFor(telDir, session);
    const already = readFlushed(deps.fs, flushedPath);

    const pending = deps.fs
      .readdir(sessionDir)
      .map((n) => /^(\d+)\.json$/.exec(n))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ name: m[0], seq: Number.parseInt(m[1], 10) }))
      .filter((s) => s.seq > already)
      .sort((a, b) => a.seq - b.seq);
    if (pending.length === 0) continue;

    // Group this session's pending segments by capture date → one shard per
    // (date, session). Time advances with seq, so date buckets are contiguous
    // ascending seq ranges.
    const shardByDate = new Map<string, Shard>();
    for (const s of pending) {
      const content = deps.fs.readText(posixJoin(sessionDir, s.name));
      if (content === null) continue;
      let datePath = UNDATED;
      let segPlans: string[] = [];
      try {
        const parsed = JSON.parse(content) as Segment;
        datePath = refDatePath(parsed.timecode);
        segPlans = parsed.plans_touched ?? [];
      } catch {
        // A corrupt buffer file still flushes as bytes (under UNDATED); its plan read is skipped.
      }
      let shard = shardByDate.get(datePath);
      if (!shard) {
        shard = { datePath, session, blobs: [], maxSeq: already, segments: 0, plans: new Set() };
        shardByDate.set(datePath, shard);
      }
      // T011: publish the OTLP signal spool (T010) — `<seq>.logs.jsonl` +
      // `<seq>.metrics.jsonl` — as the shard's tree, NOT the segment buffer json.
      // The buffer json stays LOCAL: it remains the watermark key, the datePath +
      // plans source above, and the reconstruction oracle. Fall back to the json
      // only when the spool is absent (a pre-spool / crash-interrupted buffer
      // entry), so AC-14 never drops a buffered segment.
      const base = s.name.slice(0, -'.json'.length);
      const signals: { name: string; content: string }[] = [];
      for (const suffix of ['logs', 'metrics'] as const) {
        const sig = deps.fs.readText(posixJoin(sessionDir, `${base}.${suffix}.jsonl`));
        if (sig !== null) signals.push({ name: `${base}.${suffix}.jsonl`, content: sig });
      }
      const toPublish = signals.length > 0 ? signals : [{ name: s.name, content }];
      for (const blob of toPublish) {
        shard.blobs.push({
          mode: '100644',
          type: 'blob',
          sha: deps.git.hashObject(blob.content),
          name: blob.name,
        });
      }
      shard.maxSeq = Math.max(shard.maxSeq, s.seq);
      shard.segments++;
      for (const p of segPlans) shard.plans.add(p);
    }

    // Push shards in ascending seq order; advance the single per-session watermark
    // to the last CONSECUTIVELY-successful shard's maxSeq, stopping at the first
    // failure (its segments + all later ones stay buffered for the next sync, AC-14).
    const shards = [...shardByDate.values()]
      .filter((s) => s.blobs.length > 0)
      .sort((a, b) => a.maxSeq - b.maxSeq);
    let advancedTo = already;
    for (const shard of shards) {
      const outcome = flushShard(deps, shard);
      if (!outcome.ok) {
        anyFailure = true;
        failMessage = outcome.message;
        break;
      }
      // An idempotent no-op (the shard was already published — H5) consumes the
      // buffer (advance the watermark) but counts as neither a push nor a fresh
      // flush, so a re-run after a lost watermark double-counts nothing.
      if (outcome.pushed) {
        pushedAny = true;
        totalSegments += shard.segments;
        flushedSessions.add(session);
        for (const p of shard.plans) planSet.add(p);
      }
      advancedTo = shard.maxSeq;
    }
    if (advancedTo > already) writeFlushed(deps.fs, flushedPath, advancedTo);
  }

  if (totalSegments === 0 && !anyFailure) {
    return { ok: true, pushed: false, segments: 0, sessions: 0, plans: [] };
  }

  const plans = [...planSet].sort();
  return {
    ok: !anyFailure,
    pushed: pushedAny,
    segments: totalSegments,
    sessions: flushedSessions.size,
    plans,
    ...(anyFailure && { message: failMessage }),
  };
}

/**
 * Flush ONE shard to its own dated ref: build the commit on the ref's current tip
 * (compare-and-set with ff-retry — only meaningful if the same session re-syncs;
 * across writers shards never collide), push the single refspec, and on a push
 * failure roll the local ref back (delete an orphan create / CAS back an append).
 */
function flushShard(deps: SyncDeps, shard: Shard): ShardOutcome {
  const ref = telemetryRefFor(shard.datePath, shard.session);
  const message = buildMessage(
    shard.datePath,
    shard.session,
    shard.segments,
    [...shard.plans].sort(),
  );

  // The tree is content-addressed, so build it once. H5 (idempotent re-push): if
  // the ref ALREADY holds this exact tree (a prior flush whose watermark was lost,
  // or a stale-buffer re-run), the shard is already durable — skip the commit +
  // push entirely. A LOCAL ref peel, never a remote fetch, so single-writer-per-ref
  // holds and a re-push can never become a non-fast-forward loss.
  const tree = deps.git.mktree(shard.blobs);
  if (deps.git.refTree(ref) === tree) return { ok: true, pushed: false };

  let parent: string | null = null;
  let commit: string | null = null;
  for (let attempt = 0; attempt <= REF_UPDATE_RETRIES; attempt++) {
    parent = deps.git.refTip(ref);
    commit = deps.git.commitTree(tree, parent, message);
    if (deps.git.updateRef(ref, commit, parent)) break;
    commit = null; // tip moved under us — re-read + retry
  }
  if (commit === null) {
    return { ok: false, pushed: false, message: `ref update failed after retries: ${ref}` };
  }

  try {
    deps.git.push(`${ref}:${ref}`);
  } catch (err) {
    if (parent === null) deps.git.deleteRef(ref);
    else deps.git.updateRef(ref, parent, commit);
    return { ok: false, pushed: false, message: `push failed: ${errMsg(err)}` };
  }
  return { ok: true, pushed: true };
}
