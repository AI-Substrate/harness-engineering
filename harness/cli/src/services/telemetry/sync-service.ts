import type { Clock } from '../../adapters/clock/clock-port.js';
import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { GitReadPort } from '../../adapters/git/git-read-port.js';
import {
  type GitWritePort,
  TELEMETRY_REF_GLOB,
  telemetryRefFor,
} from '../../adapters/git/git-write-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import { posixJoin, toPosix } from '../shared/posix-path.js';
import { KILL_SWITCH_ENV } from './capture-service.js';
import { readFlushed, telemetryDir } from './cursor.js';
import {
  buildRolledEntries,
  type LooseBlob,
  parseManifest,
  ROLLED_LOGS_NAME,
  ROLLED_MANIFEST_NAME,
  ROLLED_METRICS_NAME,
  splitJsonl,
} from './rolled-shard.js';
import type { Segment } from './segment.js';

/**
 * The telemetry sync service (plan 034 Phase 4 → reworked in plan 049) — the durable
 * half. Capture writes a gitignored `.harness/temp/telemetry/<session>/<seq>.json`
 * buffer (+ its `<seq>.logs.jsonl`/`<seq>.metrics.jsonl` OTLP spool); sync ROLLS each
 * session up into ONE ref keyed at the session's START date
 * (`refs/harness-telemetry/<start-YYYY>/<MM>/<DD>/<session>`), whose single tree —
 * `session.logs.jsonl` + `session.metrics.jsonl` (every seq concatenated seq-ordered)
 * + `manifest.json` — is REBUILT FROM THE LOCAL ROLLED REF TREE (the flushed truth,
 * read fetch-free via `readRefTree`) UNIONED WITH THE UNFLUSHED BUFFER DELTA on every
 * sync. That prune-safe union (T007) is what lets the buffer drop its already-flushed
 * seqs while the tip tree still reconstructs the whole session. Each sync rewrites the
 * ref with a fresh orphan commit and FORCE-pushes the single refspec (`+ref:ref`).
 * Pure over injected ports (P2: no `node:*`).
 *
 * WHY ONE ROLLED REF (plan 049, reverses the former per-(date,session) shard): the
 * old shape published a commit per sync whose tree held ONLY that run's seqs, while
 * every reader peels only the tip tree — so a multi-sync ref silently hid earlier
 * segments (F-03 clobber). Rebuilding the tip tree from the ref's flushed truth plus
 * the buffer delta each sync makes "tip tree = the whole session" true BY
 * CONSTRUCTION, and a multi-day session costs exactly one ref at its start date
 * instead of a ref-per-day trail. Single writer per ref still holds (a session's
 * buffer lives in one clone), so the append stays fetch-free (AC-03): the rewrite
 * reads the LOCAL buffer + a LOCAL ref-tree peel for the union, never the remote. The
 * forced refspec is load-bearing — successive orphan commits are never ancestors, so
 * a plain push would non-fast-forward against any divergent-sha/equal-content remote
 * (e.g. after another clone's migration).
 *
 * Offline-safe (AC-14): a failed rolled push rolls that session's local ref back and
 * leaves the buffer + watermark untouched, so the next sync retries it. The
 * "consumed" marker is a per-session `<session>.flushed` file; the session's start
 * date is persisted beside it as `<session>.startdate` (both OUTSIDE the segment, so
 * the frozen schema is never touched). Fail-safe: any error is caught and returned as
 * `{ ok:false }`, never thrown to the host.
 */

export interface SyncDeps {
  fs: FsPort;
  env: EnvPort;
  proc: ProcessPort;
  git: GitWritePort;
  /**
   * OPTIONAL — a clock enables the one-time old-ref MIGRATION pass (needs "today" to
   * exclude refs dated today). Absent ⇒ steady-state flush only (the `checks`
   * auto-push path, which stays fast + fetch-free). Wired for the explicit
   * `harness telemetry sync` verb (plan 049 T004).
   */
  clock?: Clock;
  /**
   * OPTIONAL — the git READ port enables the migration union walk + start-date ref
   * scan. Absent ⇒ no migration; start date falls back to the buffer timecode.
   */
  gitRead?: GitReadPort;
}

export interface SyncResult {
  /** True when the run completed cleanly (incl. "nothing to flush"). */
  ok: boolean;
  /**
   * True when a FRESH commit was published this run. An idempotent re-push (the
   * ref already held the exact rolled tree — a lost-watermark re-run or a divergent
   * remote) still force-delivers the bytes but is NOT counted here, so those re-runs
   * never inflate the counter. False ⇒ nothing new was committed (clean no-op or
   * re-delivery only).
   */
  pushed: boolean;
  /** Segments flushed (newly pushed) this run. */
  segments: number;
  /** Sessions that contributed at least one pushed roll this run. */
  sessions: number;
  /** Deduped, sorted plan links carried in the pushed rolls (AC-08). */
  plans: string[];
  /** Present ONLY when the one-time old-ref migration pass ran this sync (plan 049 T004). */
  migration?: MigrationSummary;
  /** Set on a failure (a roll's push failed / ref-update exhausted / migration error). */
  message?: string;
}

/** What the one-time migration pass did this run (surfaced in the sync summary). */
export interface MigrationSummary {
  /** Sessions rewritten to a rolled start-date ref. */
  rewritten: number;
  /** Old refs deleted (remote + local) after verify. */
  deleted: number;
  /** Total segments folded into the rolled refs (recovered + carried). */
  segments: number;
}

const REF_UPDATE_RETRIES = 3;

/** A fully-flushed session dir idle longer than this is forgotten whole (T007 age-out). */
const AGE_OUT_MS = 14 * 24 * 60 * 60 * 1000;

/** Fallback ref date bucket when a session's start timecode can't be parsed (keeps ref depth uniform). */
const UNDATED = '0000/00/00';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** `<telemetryDir>/<session>.flushed` — the per-session high-water seq already flushed. */
function flushedPathFor(telDir: string, session: string): string {
  return posixJoin(telDir, `${session}.flushed`);
}

/** `<telemetryDir>/<session>.startdate` — the session's stable start-date ref bucket. */
function startDatePathFor(telDir: string, session: string): string {
  return posixJoin(telDir, `${session}.startdate`);
}

/** `<telemetryDir>/<session>.cursor` — the capture watermark sidecar (removed on age-out). */
function cursorSidecarPathFor(telDir: string, session: string): string {
  return posixJoin(telDir, `${session}.cursor`);
}

/** Advance the watermark crash-safely (temp + rename, mirroring the cursor). */
function writeFlushed(fs: FsPort, path: string, value: number): void {
  const tmp = `${path}.tmp`;
  fs.writeText(tmp, String(value));
  fs.rename(tmp, path);
}

/** Persist the start-date sidecar crash-safely (temp + rename). */
function writeStartDate(fs: FsPort, path: string, value: string): void {
  const tmp = `${path}.tmp`;
  fs.writeText(tmp, value);
  fs.rename(tmp, path);
}

/** `YYYY/MM/DD` from an ISO timecode, or {@link UNDATED} when it can't be parsed. */
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
  return `telemetry: roll ${segments} segment(s) — ${datePath}/${session}\n\n${planLine}\n`;
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

/** The material a session's rolled tree is built from — read ONCE from the full buffer. */
interface SessionMaterial {
  /** Seq-ordered OTLP logs records (seqs with a complete spool pair). */
  logsLines: string[];
  /** Seq-ordered OTLP metrics records. */
  metricsLines: string[];
  /** Fallback loose `<seq>.json` blobs (partial/absent spool — AC-14). */
  looseJson: LooseBlob[];
  /** The highest buffer seq NUMBER present (the manifest watermark / advance target). */
  maxSeq: number;
  /** Deduped plan links across the whole session. */
  plans: Set<string>;
  /** The date of the lowest-seq parseable segment (start-date candidate). */
  lowestDate: string | null;
  /** The NEWEST (max) parseable segment timecode (ISO) — the age-out reference (T007). */
  newestTimecode: string | null;
}

/** The `<seq>` of every `<seq>.json` in a session dir, ascending. */
function bufferedSeqs(fs: FsPort, sessionDir: string): number[] {
  return fs
    .readdir(sessionDir)
    .map((n) => /^(\d+)\.json$/.exec(n))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number.parseInt(m[1], 10))
    .sort((a, b) => a - b);
}

/**
 * Read a session's WHOLE buffer into rolled material — the cumulative tip tree source.
 * Publishes each seq's OTLP spool PAIR when both companions are present (a partial
 * spool — a crash between the two atomic writes — falls back to the segment json so
 * the seq is never dropped, AC-14). Also derives the deduped plan set + the lowest-seq
 * start-date candidate in the same pass.
 */
function readSessionMaterial(
  fs: FsPort,
  sessionDir: string,
  seqs: readonly number[],
): SessionMaterial {
  const logsLines: string[] = [];
  const metricsLines: string[] = [];
  const looseJson: LooseBlob[] = [];
  const plans = new Set<string>();
  let maxSeq = 0;
  let lowestDate: string | null = null;
  let newestTimecode: string | null = null;
  let newestMs = Number.NEGATIVE_INFINITY;

  for (const seq of seqs) {
    maxSeq = Math.max(maxSeq, seq);
    const json = fs.readText(posixJoin(sessionDir, `${seq}.json`));
    if (json === null) continue; // vacuous (unreadable) — does not block the watermark
    try {
      const parsed = JSON.parse(json) as Segment;
      for (const p of parsed.plans_touched ?? []) plans.add(p);
      if (lowestDate === null) {
        const d = refDatePath(parsed.timecode);
        if (d !== UNDATED) lowestDate = d;
      }
      // Track the newest parseable timecode — the age-out reference (T007). A
      // stale backlog (all segments > 14 days old) is forgotten after it flushes.
      if (typeof parsed.timecode === 'string') {
        const ms = Date.parse(parsed.timecode);
        if (!Number.isNaN(ms) && ms > newestMs) {
          newestMs = ms;
          newestTimecode = parsed.timecode;
        }
      }
    } catch {
      // A corrupt buffer file still ships as bytes (below); only its parse is skipped.
    }
    const logs = fs.readText(posixJoin(sessionDir, `${seq}.logs.jsonl`));
    const metrics = fs.readText(posixJoin(sessionDir, `${seq}.metrics.jsonl`));
    if (logs !== null && metrics !== null) {
      logsLines.push(logs);
      metricsLines.push(metrics);
    } else {
      looseJson.push({ name: `${seq}.json`, content: json });
    }
  }
  return { logsLines, metricsLines, looseJson, maxSeq, plans, lowestDate, newestTimecode };
}

/**
 * Resolve a session's STABLE start-date ref bucket: the `.startdate` sidecar (the
 * authority, once written) → the lowest-seq parseable buffer timecode → an existing
 * local `*​/<session>` telemetry ref's date (survives a fully-corrupt/emptied buffer)
 * → {@link UNDATED}. Persists the resolved value to the sidecar so the ref never
 * drifts. The lowest-timecode read is LAZY — skipped entirely once the sidecar
 * exists, so a pruned buffer (no low seqs left) never re-derives a wrong date.
 */
function resolveStartDate(
  deps: SyncDeps,
  telDir: string,
  sessionDir: string,
  session: string,
  seqs: readonly number[],
): string {
  const path = startDatePathFor(telDir, session);
  const existing = deps.fs.readText(path);
  if (existing !== null) {
    const t = existing.trim();
    if (/^\d{4}\/\d{2}\/\d{2}$/.test(t)) return t;
  }
  const date =
    lowestBufferDate(deps.fs, sessionDir, seqs) ?? scanLocalRefDate(deps, session) ?? UNDATED;
  writeStartDate(deps.fs, path, date);
  return date;
}

/** The `YYYY/MM/DD` of the lowest-seq buffer segment with a parseable timecode, or null. */
function lowestBufferDate(fs: FsPort, sessionDir: string, seqs: readonly number[]): string | null {
  for (const seq of seqs) {
    const json = fs.readText(posixJoin(sessionDir, `${seq}.json`));
    if (json === null) continue;
    try {
      const parsed = JSON.parse(json) as Segment;
      const d = refDatePath(parsed.timecode);
      if (d !== UNDATED) return d;
    } catch {
      // Corrupt segment — skip; a lower/higher seq may still date the session.
    }
  }
  return null;
}

/**
 * Read a rolled ref's tip tree (LOCAL, fetch-free) into its union material — the
 * FLUSHED half of the rebuild (plan 049 T007). Splits `session.logs.jsonl` /
 * `session.metrics.jsonl` back into their seq-ordered records, carries every loose
 * `<seq>.json` fallback, and lifts the watermark from the manifest. Null when the
 * ref does not exist yet (a fresh session — nothing flushed).
 */
function readRolledRef(git: GitWritePort, ref: string): SessionMaterial | null {
  const blobs = git.readRefTree(ref);
  if (blobs === null) return null;
  let logsLines: string[] = [];
  let metricsLines: string[] = [];
  const looseJson: LooseBlob[] = [];
  let maxSeq = 0;
  for (const b of blobs) {
    if (b.name === ROLLED_LOGS_NAME) logsLines = splitJsonl(b.content);
    else if (b.name === ROLLED_METRICS_NAME) metricsLines = splitJsonl(b.content);
    else if (b.name === ROLLED_MANIFEST_NAME) maxSeq = parseManifest(b.content)?.max_seq ?? 0;
    else if (/^\d+\.json$/.test(b.name)) looseJson.push({ name: b.name, content: b.content });
  }
  return {
    logsLines,
    metricsLines,
    looseJson,
    maxSeq,
    plans: new Set(),
    lowestDate: null,
    newestTimecode: null,
  };
}

/**
 * The rolled ref's watermark, read MANIFEST-ONLY (plan 049 DL-001). The steady-state
 * no-op decision needs ONLY `manifest.json`'s `max_seq` to answer "is anything new?";
 * the full {@link readRolledRef} (a `readRefTree` that `cat-file`s EVERY blob, incl.
 * the multi-MB `session.logs.jsonl`) is pure waste on that path. So the loop reads the
 * one manifest blob here — fetch-free + fail-closed via {@link GitWritePort.readRefBlob}
 * — and only pays for the full union read once a rewrite is certain. 0 when the ref (or
 * its manifest) is absent, identical to the null-ref case {@link readRolledRef} returns.
 */
function readRefMaxSeq(git: GitWritePort, ref: string): number {
  const manifest = git.readRefBlob(ref, ROLLED_MANIFEST_NAME);
  if (manifest === null) return 0;
  return parseManifest(manifest)?.max_seq ?? 0;
}

/** The date bucket of an existing local telemetry ref for `session`, or null. */
function scanLocalRefDate(deps: SyncDeps, session: string): string | null {
  if (deps.gitRead === undefined) return null;
  const suffix = `/${session}`;
  const prefix = 'refs/harness-telemetry/';
  for (const ref of deps.gitRead.listTelemetryRefs(TELEMETRY_REF_GLOB)) {
    if (!ref.endsWith(suffix) || !ref.startsWith(prefix)) continue;
    const rest = ref.slice(prefix.length).split('/');
    if (rest.length >= 4) return `${rest[0]}/${rest[1]}/${rest[2]}`;
  }
  return null;
}

interface RollOutcome {
  ok: boolean;
  /** True when this run actually pushed a fresh commit; false for an idempotent re-push. */
  pushed: boolean;
  message?: string;
}

/**
 * Flush the telemetry buffer to the rolled ref namespace. The named entry the
 * `telemetry sync` verb calls. Best-effort + fail-safe — never throws.
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

  // One-time old-ref migration FIRST (plan 049 T004) — its own fail-safe, and a pure
  // no-op unless a local old-shape ref dated < today exists with no `.migrated`
  // sentinel. Steady-state keeps its fetch-free promise (AC-03).
  const migration = maybeMigrate(deps, telDir);

  // Session dirs have sanitized (dot-free) names; `.cursor`/`.flushed`/`.startdate`/
  // `.gitignore`/`.migrated` are metadata files — skip anything with a dot. Missing dir → [].
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
    const seqs = bufferedSeqs(deps.fs, sessionDir);

    // Resolve the STABLE start date (sidecar authority; else the buffer's lowest
    // timecode, persisted). Needed to name the ref, and it survives a pruned buffer.
    const startDate = resolveStartDate(deps, telDir, sessionDir, session, seqs);
    const ref = telemetryRefFor(startDate, session);

    // The rolled ref is the FLUSHED truth; the buffer holds only the UNFLUSHED delta
    // (T007 prunes the rest). The no-op decision needs ONLY the ref's watermark, so
    // read it MANIFEST-ONLY (a LOCAL, fetch-free single-blob read — AC-03; plan 049
    // DL-001) rather than cat-file'ing the whole (multi-MB) tree just to skip.
    const refMaxSeq = readRefMaxSeq(deps.git, ref);

    // The additions are the buffer seqs BEYOND the ref's watermark; seqs ≤ refMaxSeq
    // are already published (skip them — no double-count, no duplicate blob).
    const newBufferSeqs = seqs.filter((s) => s > refMaxSeq);

    // Steady-state no-op: nothing new AND the local watermark already reflects the ref
    // (no lost watermark to repair). A lost watermark (already < refMaxSeq) still
    // reconstructs from the ref below and idempotently re-pushes (AC-04). Reaching here
    // paid for ONE manifest blob, never the full tree read.
    if (newBufferSeqs.length === 0 && already >= refMaxSeq) continue;

    // A rewrite WILL happen (new seqs, or a lost watermark to repair) → NOW read the
    // full ref tip tree for the union base. This is the expensive whole-tree read the
    // no-op path above avoided; it is the flushed half of the T007 union.
    const refState = readRolledRef(deps.git, ref);

    // Union = the ref's flushed content ++ the new (unflushed) buffer seqs. This is
    // the F-03 fix (tip tree = whole session), now sourced from ref+buffer so the
    // buffer can be pruned. New seqs are all > refMaxSeq, so appending keeps seq order.
    const bufferMat = readSessionMaterial(deps.fs, sessionDir, newBufferSeqs);
    // Loose blobs are deduped BY NAME (buffer bytes win): an OLD-shape (pre-rollup)
    // ref tip at the same path — e.g. a v0.6.0 CLI auto-pushing from a worktree —
    // has no manifest, so refMaxSeq=0 makes every buffered seq "new" while the ref
    // ALSO carries those seqs as loose blobs; concatenating both would emit a tree
    // with duplicate entries, which remote fsck rejects (duplicateEntries).
    const bufferLooseNames = new Set(bufferMat.looseJson.map((b) => b.name));
    const material: SessionMaterial = {
      logsLines: [...(refState?.logsLines ?? []), ...bufferMat.logsLines],
      metricsLines: [...(refState?.metricsLines ?? []), ...bufferMat.metricsLines],
      looseJson: [
        ...(refState?.looseJson ?? []).filter((b) => !bufferLooseNames.has(b.name)),
        ...bufferMat.looseJson,
      ],
      maxSeq: Math.max(refMaxSeq, bufferMat.maxSeq),
      plans: bufferMat.plans,
      lowestDate: bufferMat.lowestDate,
      newestTimecode: bufferMat.newestTimecode,
    };

    const outcome = flushSession(deps, session, startDate, material, newBufferSeqs.length);
    if (!outcome.ok) {
      anyFailure = true;
      failMessage = outcome.message;
      continue; // leave this session's buffer + watermark intact; try the next session
    }
    // A fresh push contributes to the run totals; an idempotent re-push (already
    // published — H5/H-04) re-delivers the same tree but counts as neither a push nor
    // a fresh flush, so a re-run after a lost watermark double-counts nothing.
    if (outcome.pushed) {
      pushedAny = true;
      totalSegments += newBufferSeqs.length;
      flushedSessions.add(session);
      for (const p of material.plans) planSet.add(p);
    }
    // The whole session flushes in ONE atomic commit, so on success the watermark
    // advances to the union's highest seq (no interleaving to strand a lower seq).
    if (material.maxSeq > already) writeFlushed(deps.fs, flushedPath, material.maxSeq);

    // Buffer prune (T007) — ONLY after the push succeeded AND the watermark durably
    // advanced (above) AND the `.startdate` sidecar was persisted (resolveStartDate).
    // It re-reads the DURABLE watermark from disk, so moving this call above the
    // writeFlushed leaves the just-flushed seqs on disk (the ordering mutation).
    // Fail-safe: prune never fails a sync (its own try/catch).
    pruneFlushedBuffer(deps, telDir, session, material.newestTimecode);
  }

  const migFailed = migration.attempted && !migration.ok;
  return {
    ok: !anyFailure && !migFailed,
    pushed: pushedAny,
    segments: totalSegments,
    sessions: flushedSessions.size,
    plans: [...planSet].sort(),
    ...(migration.attempted && {
      migration: {
        rewritten: migration.rewritten,
        deleted: migration.deleted,
        segments: migration.segments,
      },
    }),
    ...((anyFailure || migFailed) && { message: failMessage ?? migration.message }),
  };
}

/**
 * Flush ONE session's rolled tree to its start-date ref: rebuild the tree from the
 * full buffer, and — if the ref ALREADY holds that exact (content-addressed) tree —
 * skip the duplicate commit but STILL FORCE-re-push (`+ref:ref`), because a local
 * tree match does NOT prove the remote received it (a crash between `updateRef` and
 * `push`, or a divergent remote after another clone's migration, both need the forced
 * re-delivery; H-04). Otherwise write a fresh ORPHAN commit (a full rewrite — the tip
 * tree is always the whole session) and force-push. On push failure the local ref is
 * rolled back (delete an orphan create / CAS back to the prior tip) for the next retry.
 */
function flushSession(
  deps: SyncDeps,
  session: string,
  startDate: string,
  material: SessionMaterial,
  newSegments: number,
): RollOutcome {
  const ref = telemetryRefFor(startDate, session);
  const forcedSpec = `+${ref}:${ref}`;
  const { treeSha } = buildRolledEntries(deps.git, {
    session,
    startDate,
    logsLines: material.logsLines,
    metricsLines: material.metricsLines,
    looseJson: material.looseJson,
    maxSeq: material.maxSeq,
  });

  if (deps.git.refTree(ref) === treeSha) {
    try {
      deps.git.push(forcedSpec);
    } catch (err) {
      return { ok: false, pushed: false, message: `re-push failed: ${errMsg(err)}` };
    }
    return { ok: true, pushed: false };
  }

  const message = buildMessage(startDate, session, newSegments, [...material.plans].sort());
  let oldTip: string | null = null;
  let commit: string | null = null;
  for (let attempt = 0; attempt <= REF_UPDATE_RETRIES; attempt++) {
    oldTip = deps.git.refTip(ref);
    commit = deps.git.commitTree(treeSha, null, message); // orphan rewrite — tip tree = whole session
    if (deps.git.updateRef(ref, commit, oldTip)) break;
    commit = null; // tip moved under us — re-read + retry
  }
  if (commit === null) {
    return { ok: false, pushed: false, message: `ref update failed after retries: ${ref}` };
  }

  try {
    deps.git.push(forcedSpec);
  } catch (err) {
    if (oldTip === null) deps.git.deleteRef(ref);
    else deps.git.updateRef(ref, oldTip, commit);
    return { ok: false, pushed: false, message: `push failed: ${errMsg(err)}` };
  }
  return { ok: true, pushed: true };
}

// ── Post-flush buffer prune (plan 049 T007) ──────────────────────────────────────

/** A buffer companion file name for a seq: `<seq>.json` / `<seq>.logs.jsonl` / `<seq>.metrics.jsonl`. */
const SEQ_FILE_RE = /^(\d+)\.(?:json|logs\.jsonl|metrics\.jsonl)$/;

/**
 * Prune a session's buffer AFTER a successful flush (T007) — the fix for the
 * unbounded `.harness/temp/telemetry` growth (sync's "consume" was watermark-only,
 * never deleting bytes). SAFETY BY CONSTRUCTION:
 *
 *   • It re-reads the DURABLE watermark from `<session>.flushed` on disk (not the
 *     in-memory maxSeq), so it can only run to effect AFTER {@link writeFlushed}
 *     advanced it. Moving the call above that write leaves the just-flushed seqs
 *     on disk — the ordering mutation the T007 test names.
 *   • It deletes ONLY seq files with `seq <= watermark`; anything above (a seq
 *     captured concurrently after the flush read) is unflushed and SURVIVES.
 *   • Age-out: when the clock is present, EVERY buffered seq is flushed (none left
 *     above the watermark), and the newest segment is older than {@link AGE_OUT_MS},
 *     the whole session is forgotten — dir removed first, then the sidecars
 *     (`.flushed`/`.startdate`/`.cursor`) LAST, so the start-date authority is never
 *     destroyed while the session is still live.
 *   • Any error is swallowed — a prune must NEVER fail a sync (it is best-effort
 *     housekeeping; the bytes are already durably pushed).
 */
export function pruneFlushedBuffer(
  deps: SyncDeps,
  telDir: string,
  session: string,
  newestTimecode: string | null,
): void {
  try {
    const sessionDir = posixJoin(telDir, session);
    const watermark = readFlushed(deps.fs, flushedPathFor(telDir, session));
    let anyUnflushed = false;
    let anyFilePresent = false;
    for (const name of deps.fs.readdir(sessionDir)) {
      const m = SEQ_FILE_RE.exec(name);
      if (m === null) continue;
      anyFilePresent = true;
      const seq = Number.parseInt(m[1], 10);
      if (seq <= watermark) {
        deps.fs.deleteFile(posixJoin(sessionDir, name));
      } else {
        anyUnflushed = true; // above the durable watermark → NEVER pruned
      }
    }
    // Age-out the whole session only when nothing is left unflushed and it has been
    // idle past the window (needs the clock — the checks auto-push path skips it).
    if (
      anyFilePresent &&
      !anyUnflushed &&
      deps.clock !== undefined &&
      isAgedOut(deps.clock, newestTimecode)
    ) {
      deps.fs.removeDir(sessionDir); // seq files already gone above; drop the (empty) dir
      // Sidecars LAST — only now is the start-date authority safe to destroy.
      deps.fs.deleteFile(flushedPathFor(telDir, session));
      deps.fs.deleteFile(startDatePathFor(telDir, session));
      deps.fs.deleteFile(cursorSidecarPathFor(telDir, session));
    }
  } catch {
    // Best-effort: a prune failure never fails the sync (the bytes are pushed).
  }
}

/** True when `newestTimecode` is a parseable instant older than {@link AGE_OUT_MS} vs the clock. */
function isAgedOut(clock: Clock, newestTimecode: string | null): boolean {
  if (newestTimecode === null) return false; // no reference → can't prove idle → keep
  const newest = Date.parse(newestTimecode);
  const now = Date.parse(clock.nowIso());
  if (Number.isNaN(newest) || Number.isNaN(now)) return false;
  return now - newest > AGE_OUT_MS;
}

/** The durable per-clone completion sentinel — once written, the migration pass is skipped. */
const MIGRATED_SENTINEL = '.migrated';

/** `YYYY/MM/DD` from an ISO `YYYY-MM-DD…` instant (the migration's "today"). */
function datePathFromIso(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : UNDATED;
}

/** The `YYYY/MM/DD` date bucket of a telemetry ref, or null when it does not parse. */
function refDateOf(ref: string): string | null {
  const prefix = 'refs/harness-telemetry/';
  if (!ref.startsWith(prefix)) return null;
  const rest = ref.slice(prefix.length).split('/');
  if (rest.length < 4) return null;
  if (!/^\d{4}$/.test(rest[0]) || !/^\d{2}$/.test(rest[1]) || !/^\d{2}$/.test(rest[2])) return null;
  return `${rest[0]}/${rest[1]}/${rest[2]}`;
}

/** The session id (final segment) of a telemetry ref. */
function sessionOf(ref: string): string {
  const prefix = 'refs/harness-telemetry/';
  const rest = ref.slice(prefix.length).split('/');
  return rest.slice(3).join('/');
}

/** True when a ref's TIP tree carries a rollup `manifest.json` (⇒ already rolled, not old-shape). */
function isRolledShape(gitRead: GitReadPort, ref: string): boolean {
  return gitRead.readShardTree(ref).some((b) => b.name === ROLLED_MANIFEST_NAME);
}

interface MigrationOutcome {
  attempted: boolean;
  ok: boolean;
  rewritten: number;
  deleted: number;
  segments: number;
  message?: string;
}

const NO_MIGRATION: MigrationOutcome = {
  attempted: false,
  ok: true,
  rewritten: 0,
  deleted: 0,
  segments: 0,
};

/**
 * The migration TRIGGER (local-only, AC-03-compatible): fires only when a clock + read
 * port are wired (the explicit `telemetry sync` verb), the `.migrated` sentinel is
 * absent, AND a LOCAL old-shape ref dated < today exists. The trigger scan uses only
 * `for-each-ref` + `cat-file` (no network), so steady state never pulls. Never throws.
 */
function maybeMigrate(deps: SyncDeps, telDir: string): MigrationOutcome {
  const { clock, gitRead } = deps;
  if (clock === undefined || gitRead === undefined) return NO_MIGRATION;
  try {
    const sentinelPath = posixJoin(telDir, MIGRATED_SENTINEL);
    if (deps.fs.readText(sentinelPath) !== null) return NO_MIGRATION; // already migrated

    const todayPath = datePathFromIso(clock.nowIso());
    const localRefs = gitRead.listTelemetryRefs(TELEMETRY_REF_GLOB);
    const hasLocalOld = localRefs.some((ref) => {
      const d = refDateOf(ref);
      return d !== null && d < todayPath && !isRolledShape(gitRead, ref);
    });
    if (!hasLocalOld) return NO_MIGRATION; // no old-shape ref → nothing to migrate

    return runMigration(deps, gitRead, telDir, todayPath, sentinelPath, localRefs);
  } catch (err) {
    return {
      attempted: true,
      ok: false,
      rewritten: 0,
      deleted: 0,
      segments: 0,
      message: errMsg(err),
    };
  }
}

interface SessionGroup {
  oldRefs: string[];
  rolledRefs: string[];
}

/**
 * Run the migration pass. Discovers ALL old refs (the ONE sanctioned `ls-remote`
 * ∪ the local set), fetches any that are remote-only, groups by session, and for each
 * session with an old-shape ref: unions every old ref's FULL commit history (recovering
 * F-03-clobbered segments) ∪ any existing rolled ref's tree, rewrites the union to the
 * session's start-date rolled ref (forced), VERIFIES the write landed, and only then
 * deletes each other old/rolled ref — re-checking (TOCTOU) that the rolled ref still
 * holds our exact tree immediately before each delete. The `.migrated` sentinel is
 * written ONLY after a fully clean pass (any deferral ⇒ retry next run).
 */
function runMigration(
  deps: SyncDeps,
  gitRead: GitReadPort,
  telDir: string,
  todayPath: string,
  sentinelPath: string,
  localRefs: readonly string[],
): MigrationOutcome {
  const remoteRefs = deps.git.lsRemoteTelemetryRefs(); // throws → outer catch defers (no sentinel)
  const localSet = new Set(localRefs);
  const candidates = [...new Set([...remoteRefs, ...localRefs])].filter((ref) => {
    const d = refDateOf(ref);
    return d !== null && d < todayPath; // exclude today/future/unparseable (old-CLI protection)
  });

  // Fetch every remote-only candidate so its full history is locally walkable.
  for (const ref of candidates) {
    if (!localSet.has(ref)) deps.git.fetchRef(ref);
  }

  // Group by session; classify each candidate as rolled (manifest) vs old-shape.
  const groups = new Map<string, SessionGroup>();
  for (const ref of candidates) {
    const session = sessionOf(ref);
    const g = groups.get(session) ?? { oldRefs: [], rolledRefs: [] };
    if (isRolledShape(gitRead, ref)) g.rolledRefs.push(ref);
    else g.oldRefs.push(ref);
    groups.set(session, g);
  }

  let rewritten = 0;
  let deleted = 0;
  let segments = 0;
  let allClean = true;

  for (const [session, group] of groups) {
    if (group.oldRefs.length === 0) continue; // only a rolled ref → already migrated

    const dates = [...group.oldRefs, ...group.rolledRefs]
      .map(refDateOf)
      .filter((d): d is string => d !== null);
    const startDate = dates.length > 0 ? dates.slice().sort()[0] : UNDATED;
    const target = telemetryRefFor(startDate, session);

    const material = unionSessionMaterial(gitRead, group.oldRefs, group.rolledRefs);
    const { treeSha, ourCommit } = writeMigratedRoll(deps, target, session, startDate, material);
    if (ourCommit === null) {
      allClean = false;
      continue; // write failed → leave everything for the next run
    }
    rewritten++;
    segments += material.logsLines.length + material.looseJson.length;

    // Verify the write landed as OUR commit (a racer that beat our updateRef would
    // have moved the tip); if not, defer the deletes.
    if (deps.git.refTip(target) !== ourCommit) {
      allClean = false;
      continue;
    }

    // Delete every OTHER ref for this session (the start-date ref itself is now the
    // rolled ref — overwritten, never deleted). TOCTOU: re-verify the rolled ref still
    // holds our exact tree immediately before each delete.
    for (const ref of [...group.oldRefs, ...group.rolledRefs]) {
      if (ref === target) continue;
      if (deps.git.refTree(target) !== treeSha) {
        allClean = false; // a racing forced push changed the rolled ref → skip this delete
        continue;
      }
      try {
        deps.git.deleteRemoteRef(ref);
      } catch {
        allClean = false;
        continue; // remote delete failed → retry next run
      }
      deps.git.deleteRef(ref); // local cleanup (best-effort)
      deleted++;
    }
  }

  if (allClean && deps.clock !== undefined) {
    deps.fs.mkdirp(telDir);
    deps.fs.writeText(sentinelPath, `${deps.clock.nowIso()}\n`);
  }
  return { attempted: true, ok: allClean, rewritten, deleted, segments };
}

/** Trim a JSONL record to a single line (drop trailing newline) for stable dedupe/concat. */
function trimRecord(s: string): string {
  return s.replace(/\n+$/, '');
}

/**
 * Union a session's segments across every old ref's FULL commit history (the F-03
 * recovery walk) ∪ any existing rolled ref's tree, into rolled material. Logs/metrics
 * records are deduped by content (a segment present in both old + rolled appears once),
 * ordered old-ref-seq-ascending then rolled-only extras; loose `<seq>.json` fallbacks
 * are carried for seqs that never had a logs record (AC-14 parity with the writer).
 */
function unionSessionMaterial(
  gitRead: GitReadPort,
  oldRefs: readonly string[],
  rolledRefs: readonly string[],
): { logsLines: string[]; metricsLines: string[]; looseJson: LooseBlob[]; maxSeq: number } {
  const logsBySeq = new Map<number, string>();
  const metricsBySeq = new Map<number, string>();
  const jsonBySeq = new Map<number, string>();
  const extraLogs: string[] = [];
  const extraMetrics: string[] = [];
  let maxSeq = 0;

  // Old-shape refs: walk EVERY commit's tree (recovers clobbered non-tip segments).
  for (const ref of oldRefs) {
    for (const commit of gitRead.listRefHistory(ref)) {
      for (const b of gitRead.readTreeAtCommit(commit)) {
        const mLogs = /^(\d+)\.logs\.jsonl$/.exec(b.name);
        const mMetrics = /^(\d+)\.metrics\.jsonl$/.exec(b.name);
        const mJson = /^(\d+)\.json$/.exec(b.name);
        if (mLogs) {
          const s = Number.parseInt(mLogs[1], 10);
          logsBySeq.set(s, trimRecord(b.content));
          maxSeq = Math.max(maxSeq, s);
        } else if (mMetrics) {
          const s = Number.parseInt(mMetrics[1], 10);
          metricsBySeq.set(s, trimRecord(b.content));
          maxSeq = Math.max(maxSeq, s);
        } else if (mJson) {
          const s = Number.parseInt(mJson[1], 10);
          if (!jsonBySeq.has(s)) jsonBySeq.set(s, b.content);
          maxSeq = Math.max(maxSeq, s);
        }
      }
    }
  }

  // Existing rolled refs: fold in their tip tree so a straggler segment survives.
  for (const ref of rolledRefs) {
    for (const b of gitRead.readShardTree(ref)) {
      if (b.name === ROLLED_LOGS_NAME) extraLogs.push(...splitJsonl(b.content));
      else if (b.name === ROLLED_METRICS_NAME) extraMetrics.push(...splitJsonl(b.content));
      else if (b.name === ROLLED_MANIFEST_NAME) {
        const m = parseManifest(b.content);
        if (m) maxSeq = Math.max(maxSeq, m.max_seq);
      } else {
        const mJson = /^(\d+)\.json$/.exec(b.name);
        if (mJson) {
          const s = Number.parseInt(mJson[1], 10);
          if (!jsonBySeq.has(s)) jsonBySeq.set(s, b.content);
          maxSeq = Math.max(maxSeq, s);
        }
      }
    }
  }

  const logsLines = orderedUnique(seqAscending(logsBySeq), extraLogs);
  const metricsLines = orderedUnique(seqAscending(metricsBySeq), extraMetrics);
  const looseJson: LooseBlob[] = [...jsonBySeq.keys()]
    .filter((s) => !logsBySeq.has(s)) // a seq with a logs record is carried there, not loose
    .sort((a, b) => a - b)
    .map((s) => ({ name: `${s}.json`, content: jsonBySeq.get(s) as string }));
  return { logsLines, metricsLines, looseJson, maxSeq };
}

/** A map's values in ascending-key order. */
function seqAscending(m: Map<number, string>): string[] {
  return [...m.keys()].sort((a, b) => a - b).map((k) => m.get(k) as string);
}

/** Base records first, then extras not already present — content-deduped, order-stable. */
function orderedUnique(base: readonly string[], extras: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of [...base, ...extras]) {
    if (seen.has(r)) continue;
    seen.add(r);
    out.push(r);
  }
  return out;
}

/**
 * Write the migrated union to the session's start-date rolled ref: a fresh ORPHAN
 * commit + forced push (`+ref:ref`), CAS-retried against a concurrent writer. Returns
 * the built tree sha + our commit (or `ourCommit:null` on a write/push failure, rolled
 * back). Uses `refTip` for the CAS (never `refTree`), so the migration verify/TOCTOU
 * checks are independent of the write path.
 */
function writeMigratedRoll(
  deps: SyncDeps,
  target: string,
  session: string,
  startDate: string,
  material: { logsLines: string[]; metricsLines: string[]; looseJson: LooseBlob[]; maxSeq: number },
): { treeSha: string; ourCommit: string | null } {
  const { treeSha } = buildRolledEntries(deps.git, {
    session,
    startDate,
    logsLines: material.logsLines,
    metricsLines: material.metricsLines,
    looseJson: material.looseJson,
    maxSeq: material.maxSeq,
  });
  const forcedSpec = `+${target}:${target}`;
  const message = `telemetry: migrate roll — ${startDate}/${session}\n`;

  let oldTip: string | null = null;
  let commit: string | null = null;
  for (let attempt = 0; attempt <= REF_UPDATE_RETRIES; attempt++) {
    oldTip = deps.git.refTip(target);
    commit = deps.git.commitTree(treeSha, null, message);
    if (deps.git.updateRef(target, commit, oldTip)) break;
    commit = null;
  }
  if (commit === null) return { treeSha, ourCommit: null };

  try {
    deps.git.push(forcedSpec);
  } catch {
    if (oldTip === null) deps.git.deleteRef(target);
    else deps.git.updateRef(target, oldTip, commit);
    return { treeSha, ourCommit: null };
  }
  return { treeSha, ourCommit: commit };
}
