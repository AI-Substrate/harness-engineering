import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import {
  type GitWritePort,
  TELEMETRY_REF,
  type TreeEntry,
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
 * ONE commit on the orphan ref {@link TELEMETRY_REF} via {@link GitWritePort}
 * plumbing, pushes a single refspec, and only then advances the watermark
 * ("consumes" the buffer). Pure over injected ports (P2: no `node:*`).
 *
 * Offline-safe (AC-14): a failed push rolls the local ref back and leaves the
 * buffer + watermark untouched, so the next sync retries the same segments. The
 * "consumed" marker is a per-session `<session>.flushed` file — OUTSIDE the
 * segment, so the frozen schema is never touched (AC-12). Fail-safe: any error
 * is caught and returned as `{ ok:false }`, never thrown to the host.
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
  /** True when a commit was pushed this run. */
  pushed: boolean;
  /** Segments flushed this run. */
  segments: number;
  /** Sessions contributing this run. */
  sessions: number;
  /** Deduped, sorted plan links carried in the flushed commit (AC-08). */
  plans: string[];
  /** Set on a failure (push failed / ref-update exhausted). */
  message?: string;
}

const REF_UPDATE_RETRIES = 3;

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

function buildMessage(segments: number, sessions: number, plans: string[]): string {
  const planLine = plans.length > 0 ? `plans: ${plans.join(',')}` : 'plans: (none)';
  return `telemetry: flush ${segments} segment(s) across ${sessions} session(s)\n\n${planLine}\n`;
}

/**
 * Flush the telemetry buffer to the orphan ref. The named entry the
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

  const topEntries: TreeEntry[] = [];
  const planSet = new Set<string>();
  const watermarks: { path: string; seq: number }[] = [];
  let segments = 0;

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

    const blobs: TreeEntry[] = [];
    let maxSeq = already;
    for (const s of pending) {
      const content = deps.fs.readText(posixJoin(sessionDir, s.name));
      if (content === null) continue;
      try {
        const parsed = JSON.parse(content) as Segment;
        for (const p of parsed.plans_touched ?? []) planSet.add(p);
      } catch {
        // A corrupt buffer file still flushes as bytes; only its plan-link read is skipped.
      }
      blobs.push({ mode: '100644', type: 'blob', sha: deps.git.hashObject(content), name: s.name });
      maxSeq = Math.max(maxSeq, s.seq);
      segments++;
    }
    if (blobs.length === 0) continue;

    topEntries.push({
      mode: '040000',
      type: 'tree',
      sha: deps.git.mktree(blobs),
      name: session,
    });
    watermarks.push({ path: flushedPath, seq: maxSeq });
  }

  if (topEntries.length === 0) {
    return { ok: true, pushed: false, segments: 0, sessions: 0, plans: [] };
  }

  const plans = [...planSet].sort();
  const message = buildMessage(segments, watermarks.length, plans);

  // Build the commit on the current tip; compare-and-set with ff-retry.
  let parent: string | null = null;
  let commit: string | null = null;
  for (let attempt = 0; attempt <= REF_UPDATE_RETRIES; attempt++) {
    parent = deps.git.refTip(TELEMETRY_REF);
    const top = deps.git.mktree(topEntries);
    commit = deps.git.commitTree(top, parent, message);
    if (deps.git.updateRef(TELEMETRY_REF, commit, parent)) break;
    commit = null; // a concurrent writer moved the tip — re-read + retry
  }
  if (commit === null) {
    return {
      ok: false,
      pushed: false,
      segments: 0,
      sessions: 0,
      plans,
      message: 'ref update failed after retries',
    };
  }

  // Push best-effort. On failure: roll the local ref back and LEAVE the buffer
  // (no watermark advance) so the next sync retries the same segments (AC-14).
  try {
    deps.git.push(`${TELEMETRY_REF}:${TELEMETRY_REF}`);
  } catch (err) {
    if (parent === null) deps.git.deleteRef(TELEMETRY_REF);
    else deps.git.updateRef(TELEMETRY_REF, parent, commit);
    return {
      ok: false,
      pushed: false,
      segments: 0,
      sessions: 0,
      plans,
      message: `push failed: ${errMsg(err)}`,
    };
  }

  // Pushed → consume the buffer by advancing each session's watermark.
  for (const w of watermarks) writeFlushed(deps.fs, w.path, w.seq);
  return { ok: true, pushed: true, segments, sessions: watermarks.length, plans };
}
