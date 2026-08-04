import type { Clock } from '../../adapters/clock/clock-port.js';
import type { DbPort } from '../../adapters/db/db-port.js';
import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import { posixJoin, toPosix } from '../shared/posix-path.js';
import { ensureTemp } from '../shared/temp.js';
import type { HarnessAdapter, HarnessContext, HarnessSource } from './adapters/harness-adapter.js';
import {
  evaluateCaptureLiveness,
  type ResidueSession,
  readLivenessRecords,
  recordCaptureAttempt,
  sourceExtent,
} from './capture-liveness.js';
import { computeWindow, writeCapturedSegment } from './capture-service.js';
import {
  branchPathFor,
  cursorPathFor,
  readBranch,
  readCursor,
  telemetryDir,
  writeCursor,
} from './cursor.js';
import type { Event } from './events.js';
import { type Segment, serializeSegment } from './segment.js';

/**
 * Orphan-lane RECONCILIATION (plan 070, deliverable 3) — the recovery half of the
 * capture-liveness instrument.
 *
 * The defect it closes: a harness session's transcript is not always written as
 * the work happens. Today's `cursor-agent` writes in BATCHES, and the last batch
 * lands after the session's final harness command has already run. Every capture
 * attempt in that session was honest — "nothing new since last time" was TRUE
 * each time it was asked — and then the source grew with nobody left to read it.
 * The lane is ORPHANED: it holds unconsumed work, and by construction NO in-session
 * signal can ever recover it, because a finished session never runs another
 * command. Session `1a501a09` committed 2 of 56 lines this way: a confident wrong
 * number, ~27× under-count, with no gap for anyone to notice.
 *
 * So the recovery has to come from OUTSIDE the session — a later invocation, in a
 * different process, reading a marker the dead lane left behind. That is the only
 * shape that can work, and it is also the shape most able to lie. The rules below
 * are what keep it honest; each is enforced structurally, not by convention.
 *
 * 1. **It declares itself.** Every recovered segment carries
 *    `capture_mode: 'reconciled'` (schema 2.7, on the wire as
 *    `harness.capture_mode`) and the reserved {@link RECONCILE_COMMAND}. A
 *    consumer that has never heard of reconciliation sees an unknown schema
 *    version, not a late segment it mistakes for a live one.
 * 2. **It never fabricates work-time.** Event instants come ONLY from the
 *    source's own timestamps. The window's end anchor is the source file's
 *    MTIME — a real observed fact about when the work last touched disk — never
 *    the recovery clock. `timecode` is the recovery instant and is honestly
 *    labelled as such by `capture_mode`.
 * 3. **It is interval-grade.** Every recovered event is stamped
 *    `t_precision: 'interval'`, so the read path excludes it from active-time
 *    accrual (plan 068 item 2) and counts it in `provenance.interval_events`.
 *    The COUNTS are recovered; a clock is not invented. Recovering 54 lines of
 *    real tool calls while claiming zero measured duration is the honest trade.
 * 4. **It attributes only through the marker.** The lane's session id and source
 *    path come from its own liveness marker; the adapter is put in
 *    {@link HarnessSource.reconcile} mode so it CANNOT fall back to env — which
 *    at recovery time describes a different, live session.
 * 5. **It is a consumer, not a detector.** It acts only on lanes the residue
 *    detector already flagged. No marker ⇒ the lane is never touched, ever.
 * 6. **It cannot double-emit.** Two independent guards: the `.cursor` watermark
 *    is advanced to the recovered extent, and the marker is folded with a
 *    `captured` attempt (resetting both its cursor and its idle clock). Either
 *    alone makes the second pass a no-op.
 *
 * What it deliberately does NOT recover: the branch-change event, the flight-plan
 * flow/flow_log projection, the artifact-semantics snapshots, the triggering
 * harness-command marker, `captured_env`, and `product_commit`. Each of those is
 * a fact about the MOMENT OF CAPTURE — the live git branch, the plan file as it
 * reads now, the env of the running process. Re-reading them hours later and
 * attributing them to a past window would be exactly the fabrication this module
 * exists to avoid, so they are structurally absent here rather than switched off.
 *
 * ## Who owns the marker's lifetime
 *
 * NOT this module. Reconciliation is a LATER READER of a file whose deletion is
 * decided elsewhere: `pruneFlushedBuffer` (sync) is the sole deleter of a
 * `.liveness.json`, and it removes one when a session is fully flushed AND idle
 * past `AGE_OUT_MS`. Recovery is therefore only possible inside the window
 * `[LIVENESS_RESIDUE_IDLE_MS, AGE_OUT_MS)` — 6 hours to 14 days. That the window
 * is currently open is a CONTROL, not a demonstration: the ordering of the two
 * constants is pinned by a test, so a future prune policy that narrows past the
 * residue gate fails loudly instead of quietly making every orphaned lane
 * unrecoverable.
 *
 * ## Scope: one worktree (a decided limit, not an oversight)
 *
 * A lane lives in the `.harness/temp` of the worktree it ran in, and this pass
 * recovers lanes in ONE root — the one it is given. Sibling worktrees in the same
 * repo family are NOT swept, so a harness command here does not recover a lane
 * left in a worktree next door. That was considered and deliberately deferred:
 * doing it properly means sync learning to FLUSH other roots' buffers too (ref
 * naming, start-date sidecars and prune are all per-root today), which is a
 * separate capability with its own attribution surface — not something to smuggle
 * into a recovery pass. The `root` parameter exists so that follow-up is a change
 * of caller, not a rewrite.
 *
 * ## Known limit: the teardown tail
 *
 * A worktree that is DELETED takes its `.harness/temp` with it — markers, buffers
 * and watermarks together. Any residue that lane was holding is then gone before
 * anything can recover it, and no sweep can change that: the evidence is not
 * merely unreachable, it no longer exists. The exposure is precisely the last
 * session in a throwaway worktree, which is also the session most likely to end
 * with an unconsumed tail. Flushing before teardown (`harness telemetry sync`)
 * bounds the loss to whatever the transcript wrote after that command; nothing
 * bounds it to zero. This is stated as a limit rather than papered over.
 */

/**
 * The reserved command name on a recovered segment. NOT a real verb any agent can
 * run: it names the mechanism that produced the segment, so a reconciled window
 * is visibly distinct in the `harness_command` rollup and the report timeline
 * instead of borrowing whatever verb the session last happened to run.
 */
export const RECONCILE_COMMAND = 'telemetry reconcile';

/** Ports the reconciler reads/writes through (P2: no `node:*`). */
export interface ReconcileDeps {
  fs: FsPort;
  env: EnvPort;
  clock: Clock;
  proc: ProcessPort;
  /** Read-only SQLite, for adapters whose timing/model signal lives in a local db. */
  db?: DbPort;
  /** The producing harness CLI version → the recovered segment's `harness_version`. */
  version?: string;
  /** Per-harness adapters. A lane whose harness has no adapter is left alone. */
  adapters?: HarnessAdapter[];
}

/** One lane the reconciler recovered — the caller's report line, not a side channel. */
export interface ReconciledLane {
  session: string;
  harness: string;
  /** The watermark it started from and the extent it recovered to. */
  from: number;
  to: number;
  /** Source units this pass recovered (`to - from`). */
  recovered: number;
  /** Events the recovered window actually carried (0 is legitimate: counts without a timeline). */
  events: number;
}

/** Why a flagged lane was NOT recovered — visible, so a skip is never silent. */
export interface SkippedLane {
  session: string;
  reason: 'no-adapter' | 'already-consumed' | 'source-unreadable' | 'no-signal' | 'error';
}

export interface ReconcileResult {
  reconciled: ReconciledLane[];
  skipped: SkippedLane[];
}

/**
 * Re-stamp an event as interval-grade. The instant `t` is PRESERVED exactly as the
 * source reported it (rule 2 — the work's own time is the only time we have), while
 * the precision is lowered to `interval` (rule 3) so no consumer can build an
 * active-time clock out of a window nobody watched being produced.
 */
function asInterval(event: Event): Event {
  return { ...event, t_precision: 'interval' } as Event;
}

/** ISO instant of a file's last write, or `null` when the fs cannot say. */
function mtimeIso(fs: FsPort, path: string): string | null {
  const ms = fs.mtimeMs(path);
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return null;
  const iso = new Date(ms).toISOString();
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/**
 * Recover ONE flagged lane, or explain why not. Pure of the outer loop's
 * bookkeeping; throws are caught by {@link reconcileOrphanLanes}.
 */
function reconcileLane(
  deps: ReconcileDeps,
  cwd: string,
  lane: ResidueSession,
): ReconciledLane | SkippedLane {
  const adapter = (deps.adapters ?? []).find((a) => a.handles(lane.harness));
  // No adapter ⇒ nothing can read this harness's source, so there is nothing to
  // recover. The null-default is deliberately NOT used as a fallback here: it would
  // emit an all-null segment that says "we recovered this window" while carrying no
  // evidence at all.
  if (adapter === undefined) return { session: lane.session, reason: 'no-adapter' };

  // The `.cursor` sidecar is the AUTHORITY on what was consumed; the marker's copy
  // can only be equal or staler. Taking the higher of the two means a lane that was
  // consumed after its last recorded attempt (or by an earlier reconcile pass) can
  // never be re-emitted — the first of the two idempotence guards.
  const cursorPath = cursorPathFor(cwd, lane.session);
  const durable = readCursor(deps.fs, cursorPath);
  const from = Math.max(lane.cursor, durable ?? 0);
  if (from >= lane.extent) return { session: lane.session, reason: 'already-consumed' };

  // The window's END anchor: when the source last changed on disk. A REAL observed
  // fact bounding the work, and the only defensible stamp for an event whose source
  // carries no timestamp of its own. The recovery clock is never used for this —
  // it would place work hours after it happened. No mtime ⇒ no anchor is offered,
  // and untimed events are dropped by the adapter rather than invented.
  const capturedAt = mtimeIso(deps.fs, lane.source);

  const source: HarnessSource = {
    env: deps.env,
    fs: deps.fs,
    db: deps.db,
    repoRoot: cwd,
    harness: lane.harness,
    sessionId: lane.session,
    // Rule 4: the adapter may resolve NEITHER the source nor the session from env.
    reconcile: { sourcePath: lane.source, sessionId: lane.session },
  };
  const window = computeWindow(from, lane.extent);
  const ctx: HarnessContext = {
    ...source,
    window,
    ...(capturedAt !== null ? { capturedAt } : {}),
  };
  const caps = adapter.extract(ctx);

  const events = (caps.event_stream ?? []).map(asInterval);
  const files = caps.files ?? { written: [], edited: [] };
  const hasEvidence =
    events.length > 0 ||
    files.written.length > 0 ||
    files.edited.length > 0 ||
    Object.keys(caps.tools ?? {}).length > 0 ||
    Object.keys(caps.skills ?? {}).length > 0 ||
    (caps.user_prompts ?? []).length > 0;
  // The source was measurably longer than the watermark, yet the adapter found
  // nothing in it. Emitting an empty segment would assert "we looked and this
  // window was empty" — a claim we cannot support — and would burn the residue by
  // advancing the cursor past evidence a future adapter might read. Leave it.
  if (!hasEvidence) return { session: lane.session, reason: 'no-signal' };

  const segment: Segment = serializeSegment(
    {
      command: RECONCILE_COMMAND,
      harness: lane.harness,
      harness_version: deps.version ?? 'unknown',
      harness_session_id: lane.session,
      // Capture-time is capture-time: this segment was produced NOW. What it
      // describes happened earlier, which is precisely what `capture_mode` says.
      timecode: deps.clock.nowIso(),
      window,
      // The branch RECORDED for this lane while it was alive — never the branch
      // the reconciling process happens to be on.
      branch: readBranch(deps.fs, branchPathFor(cwd, lane.session)),
      tokens: caps.tokens ?? null,
      token_unavailable_reason: caps.token_unavailable_reason ?? null,
      models: caps.models ?? {},
      effort: caps.effort ?? null,
      skills: caps.skills ?? {},
      tools: caps.tools ?? {},
      user_prompts: caps.user_prompts ?? [],
      subagents: caps.subagents ?? [],
      files,
      // Derived PURELY from the recovered window's own touched paths — no new I/O,
      // no env, no cwd. The one plan-identity source that is a fact about the work
      // rather than about the moment of recovery.
      plans_touched: plansFromFiles(files),
      events: {
        compactions: caps.compactions ?? [],
        api_errors: caps.api_errors ?? 0,
        local_commands: caps.local_commands ?? 0,
      },
      thinking: caps.thinking ?? null,
      event_stream: events,
      capture_mode: 'reconciled',
    },
    cwd,
  );

  writeCapturedSegment(deps, cwd, lane.session, segment);
  // Guard one: the durable watermark now covers everything recovered.
  writeCursor(deps.fs, cursorPath, lane.extent);
  // Guard two: the marker itself records a real capture, which resets both its
  // cursor and its idle clock — so the residue detector stops flagging the lane
  // even if the `.cursor` sidecar is later removed. The attempt is recorded under
  // the reconcile command, so the marker reads as the honest history it is: a lane
  // that went dark and was recovered from outside.
  recordCaptureAttempt(deps, cwd, {
    session: lane.session,
    harness: lane.harness,
    command: RECONCILE_COMMAND,
    at: deps.clock.nowIso(),
    outcome: 'captured',
    cursor: lane.extent,
    position: lane.extent,
    sourcePath: lane.source,
  });

  return {
    session: lane.session,
    harness: lane.harness,
    from,
    to: lane.extent,
    recovered: lane.extent - from,
    events: events.length,
  };
}

/** The distinct `docs/plans/<id>/` prefixes among a recovered window's touched paths. */
function plansFromFiles(files: { written: string[]; edited: string[] }): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of [...files.written, ...files.edited]) {
    const id = /(?:^|\/)docs\/plans\/([^/]+)/.exec(toPosix(p))?.[1];
    if (id !== undefined && id.length > 0 && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * How long a repo goes between reconciliation sweeps. The sweep itself is cheap
 * in the common case (one `readdir` of the marker dir), but measuring residue
 * means re-reading the SOURCE of every lane that is past the idle gate — and a
 * marker lives until age-out, so that set grows with the number of sessions in
 * the last fortnight. Un-debounced, a repo with a dozen idle lanes would re-read
 * a dozen transcripts on every commit to learn nothing new.
 *
 * An hour is far below the 6-hour idle gate, so debouncing cannot delay a
 * recovery past the point it becomes possible: a lane that qualifies stays
 * qualified, and the next sweep takes it.
 */
export const RECONCILE_DEBOUNCE_MS = 60 * 60 * 1000;

/** The durable last-swept stamp — a sibling of the markers, inside the ignored temp tree. */
export const RECONCILE_STAMP = '.reconciled';

/** Path of the last-swept stamp for a repo root. */
export function reconcileStampPath(cwd: string): string {
  return posixJoin(telemetryDir(cwd), RECONCILE_STAMP);
}

/**
 * True when a sweep is due. A missing, unreadable or unparseable stamp reads as
 * DUE — the failure mode of a corrupt stamp must be "sweep once more", never
 * "never sweep again", because the second is silent and permanent.
 */
function sweepDue(fs: FsPort, cwd: string, nowIso: string): boolean {
  const text = fs.readText(reconcileStampPath(cwd));
  if (text === null) return true;
  const last = Date.parse(text.trim());
  const now = Date.parse(nowIso);
  if (!Number.isFinite(last) || !Number.isFinite(now)) return true;
  return now - last >= RECONCILE_DEBOUNCE_MS;
}

/** Stamp the sweep time (best-effort — a failed stamp only costs an extra sweep). */
function stampSweep(deps: ReconcileDeps, cwd: string, nowIso: string): void {
  try {
    ensureTemp({ fs: deps.fs, proc: deps.proc });
    deps.fs.mkdirp(telemetryDir(cwd));
    deps.fs.writeText(reconcileStampPath(cwd), `${nowIso}\n`);
  } catch {
    // Best-effort: without a stamp the next sync simply sweeps again.
  }
}

/**
 * Recover every orphaned lane this repo's liveness markers flag as holding
 * residue. NEVER THROWS: like capture itself, reconciliation is subject to the
 * zero-host-impact contract — it can slow a command down, but it can never change
 * its behaviour or exit code, and one poisoned lane can never stop the others.
 *
 * Nothing here searches for lanes: {@link evaluateCaptureLiveness} is the sole
 * source of candidates, and it only ever yields lanes that have a marker, a
 * recorded source, and have been idle past {@link LIVENESS_RESIDUE_IDLE_MS}. That
 * idle gate is also what makes the reconciler safe against a BATCHED writer: a
 * session whose transcript jumps from 2 to 36 lines mid-flight is holding a large
 * residue too, but it is minutes idle, not hours — it will consume its own window
 * on its next command, and the reconciler never sees it. (Observed live: a lane
 * sat at 2 lines for 11 minutes, flushed to 36, and the very NEXT harness command
 * consumed all 35 in one capture, cursor 2→37. Only a flush landing after the
 * session's LAST command leaves residue — which is exactly the tail this pass
 * exists for, and nothing else.)
 *
 * `root` names the worktree whose lanes are recovered; it defaults to the process
 * cwd. See the module note on scope — one root per call, by decision.
 */
export function reconcileOrphanLanes(deps: ReconcileDeps, root?: string): ReconcileResult {
  const result: ReconcileResult = { reconciled: [], skipped: [] };
  try {
    const cwd = toPosix(root ?? deps.proc.cwd());
    const now = deps.clock.nowIso();
    if (!sweepDue(deps.fs, cwd, now)) return result;
    const records = readLivenessRecords(deps.fs, cwd);
    if (records.length === 0) return result;
    stampSweep(deps, cwd, now);
    const verdict = evaluateCaptureLiveness(records, (path) => sourceExtent(deps.fs, path), now);
    for (const lane of verdict.residue) {
      try {
        const outcome = reconcileLane(deps, cwd, lane);
        if ('reason' in outcome) result.skipped.push(outcome);
        else result.reconciled.push(outcome);
      } catch {
        result.skipped.push({ session: lane.session, reason: 'error' });
      }
    }
  } catch {
    // Marker dir unreadable / clock unusable — nothing to recover, nothing to say.
  }
  return result;
}
