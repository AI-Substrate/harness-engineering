import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { GitReadPort } from '../../adapters/git/git-read-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import { posixJoin, toPosix } from '../shared/posix-path.js';
import { telemetryDir } from './cursor.js';
import type { ChecksStatus } from './events.js';
import { readRefSegments, telemetryRefsPresent } from './ref-source.js';
import type { Segment } from './segment.js';
import { type TokenEvidence, transcriptEvidenceReason } from './token-evidence.js';
import {
  reduceUsageEvents,
  tokenEvidenceFromLegacyTokens,
  tokenEvidenceFromObservation,
} from './usage-observation.js';

/**
 * `getSessionEvidence` (plan 041 Phase 1) — the deterministic read-by-session
 * telemetry verb the conformance scorer's telemetry lane consumes. Given a **pij
 * session id**, locate that session's telemetry buffer (worktree-safe), read every
 * segment, join the ones tagged with this pij id (`captured_env.PIJ_SESSION_ID`),
 * and fold them into a normalized {@link SessionEvidence}.
 *
 * READ-ONLY (never mutates the buffer / refs, never emits a capture event) and
 * FAIL-SAFE (never throws — absent / partial / corrupt data resolves to an empty
 * field, an explicit `gaps[]` marker, or a `null` return; never an exception).
 *
 * DERIVATION CONTRACT (the load-bearing v2 rule): skills / tools / flow_seams /
 * harness_verbs / checks / compactions are derived from the always-present
 * `event_stream`; `files.{written,edited}` is read from the segment's own `files`
 * FIELD (there is no `file` event kind). The v1 derived views (`skills`/`tools`/
 * `files`/`captured_env`) are OMITTED-when-empty in a segment, so absence means
 * zero — never an error.
 *
 * WORKTREE LOCATOR (Finding 02b — the spike): a pij session can run from a git
 * worktree, so the buffer must resolve cwd-independently. `pij path <id> --dir`
 * returns the peer's DATA dir (`~/.pij/<id>` — inbox/events, no telemetry); the
 * worktree key is the `folder` field of the peer STATE file (`~/.pij/<id>.json`,
 * == `pij path <id> --state`). We read it directly through {@link FsPort} (no
 * shell-out → stays `node:*`-free, P2). Candidate order: explicit `opts.worktree`
 * → pij `folder` → `proc.cwd()`.
 *
 * TWO SURFACES (FX001): the buffer is the live source, but the post-commit hook
 * flushes it to `refs/harness-telemetry/*` on EVERY commit — so any subject that
 * commits blinds its own telemetry lane before an orchestrator can score it. When the
 * buffer yields no segments for the session (absent OR flushed-markers-only), the read
 * falls back to the committed refs and folds them the same way, joined on the same
 * `PIJ_SESSION_ID` key. The evidence SAYS which surface answered (`source`) and
 * whether a ref namespace existed to check (`ref_checked`); `null` — the act's `E100`
 * — is reserved for BOTH surfaces being empty. Local refs only: never a fetch.
 *
 * NO CACHE — reads fresh on every call so a downstream fs resolver always observes
 * the latest buffer state.
 */

/** The normalized per-pij-session evidence object — the Phase 1 → Phase 2 contract. */
export interface SessionEvidence {
  /** The pij session id this evidence was joined on (echoed back). */
  pij_session_id: string;
  /**
   * The harness session id of the matched segments — the telemetry buffer subdir
   * `harness telemetry session save <id>` takes (F4). `null` when no segment
   * carried one (honest absence, never a fabricated id). Distinct from
   * {@link pij_session_id}: `--session` is a pij id, but the cost/export snapshot
   * verb is keyed by the HARNESS session id, and only the segment stream knows it.
   * Kept in LOCK-STEP with the flow-eval extension's re-declared `SessionEvidence`.
   */
  harness_session_id: string | null;
  /** The harness that produced the matched segments (e.g. `claude-code`). */
  harness: string;
  /** Number of telemetry segments joined into this evidence. */
  segments: number;
  /** Per-field token evidence; authoritative over compatibility totals. */
  token_evidence: TokenEvidence;
  /** Skill name → run count (derived from `skill` events). */
  skills: Record<string, number>;
  /** Distinct skill names in first-seen order across the joined segments. */
  skill_order: string[];
  /** Files touched, read from each segment's `files` field (NOT from events). */
  files: { written: string[]; edited: string[] };
  /** Ordered `"<flow>:<stage>"` for each `flow` event — the full traversal sequence. */
  flow_seams: string[];
  /** Harness verb → invocation count (derived from `harness` events). */
  harness_verbs: Record<string, number>;
  /** One entry per `checks` event, in order, carrying only its coarse verdict. */
  checks: Array<{ status: ChecksStatus }>;
  /** Count of `compaction` events across the joined segments. */
  compactions: number;
  /** Tool name → total invocation count (sum of each `tools` event's `count`). */
  tools: Record<string, number>;
  /**
   * Refusal E-code → count, from `command_exit` events that carried one
   * (plan 071 tk-7169).
   *
   * A gate refusal writes NOTHING to the flow — that is a pinned invariant, not
   * an oversight — so before this field a run that was correctly stopped and a
   * run that never met a gate produced identical evidence, and only a `--force`
   * left a durable trace. The record favoured the one outcome nobody wants.
   * Counting the codes makes the refusal provable without weakening the
   * nothing-written invariant by a single byte.
   *
   * Fixed vocabulary (`E###`), never message text. Kept in LOCK-STEP with the
   * flow-eval extension's re-declared `SessionEvidence`.
   */
  refusals: Record<string, number>;
  /** Field names that were absent / unknown (e.g. `subagent_tokens`, `plans_touched`). */
  gaps: string[];
  /**
   * Wall-span in seconds between the first + last telemetry event across the
   * joined segments (F13, plan 046 · AC-08); `null` when fewer than two
   * timestamped events exist (an honest "unknown", never a fabricated 0). This
   * is wall-clock span — distinct from the 047 export's idle-excluded
   * `active_time_s`. Kept in LOCK-STEP with the flow-eval extension's re-declared
   * `SessionEvidence` (`.harness/extensions/flow-eval/resolvers.ts`).
   */
  duration_s: number | null;
  /**
   * Which surface this evidence was read from (FX001 · T2).
   *
   * `buffer` — the live `.harness/temp/telemetry` spool alone. `ref` — the committed
   * `refs/harness-telemetry/*` rollup alone, which is where a session lives once a
   * commit has flushed it. `buffer+ref` — the durable union: the ref's flushed half
   * plus the buffer's unflushed delta, folded once.
   *
   * Provenance is stated, never inferred. A reader that silently merges two surfaces
   * is how the next debugging session gets lied to about which one was empty.
   */
  source: 'buffer' | 'ref' | 'buffer+ref';
  /**
   * Whether a `refs/harness-telemetry/*` namespace was visible locally to check.
   *
   * `false` means the ref surface could not contribute — no git read port, or a clone
   * that has never fetched the namespace. NOT the same as "the ref had nothing for
   * this session": that is an empty join, and it still reports `true`. Read-only —
   * this never triggers a network fetch.
   */
  ref_checked: boolean;
}

/** The two fs reads the evidence path uses — list buffer subdirs, read each segment. */
type EvidenceFs = Pick<FsPort, 'readText' | 'readdir'>;

/**
 * The injected ports `getSessionEvidence` reads through (P2: no `node:*` in
 * services). Only the *methods the read path actually exercises* are required —
 * `fs.readText`/`fs.readdir`, `env.home`, `proc.cwd` — declared as `Pick<…>` so
 * BOTH the real ports (the CLI act) AND a {@link getSessionEvidenceFromContext}
 * adapter satisfy it without fat stub methods. A full `FsPort`/`EnvPort`/
 * `ProcessPort` (or the test fakes) is still structurally assignable.
 */
export interface SessionEvidenceDeps {
  fs: EvidenceFs;
  env: Pick<EnvPort, 'home'>;
  proc: Pick<ProcessPort, 'cwd'>;
  gitRead?: GitReadPort;
}

/** Options for {@link getSessionEvidence} — the documented public surface (plan 041 contract). */
export interface SessionEvidenceOpts {
  /** Explicit worktree root override; the buffer is `<worktree>/.harness/temp/telemetry`. */
  worktree?: string;
}

/** The pij join key written into `captured_env` by the live capture (from `$PIJ_SESSION_ID`). */
const PIJ_SESSION_ENV = 'PIJ_SESSION_ID';

/** Read the pij peer's worktree `folder` from `~/.pij/<id>.json`, or null (never throws). */
function pijFolder(deps: SessionEvidenceDeps, id: string): string | null {
  const home = deps.env.home();
  if (!home) return null;
  const raw = deps.fs.readText(posixJoin(toPosix(home), '.pij', `${id}.json`));
  if (raw === null) return null;
  try {
    const folder = (JSON.parse(raw) as { folder?: unknown }).folder;
    return typeof folder === 'string' && folder.length > 0 ? folder : null;
  } catch {
    return null; // a corrupt state file falls through to the next candidate
  }
}

/**
 * Telemetry buffer dirs to try, in priority order (deduped): worktree → pij folder → cwd.
 * Exported (read-only) so the fleet-evidence service reuses the SAME worktree-safe
 * buffer-location logic instead of re-deriving it (plan 051 · T002).
 */
export function candidateRoots(
  id: string,
  deps: SessionEvidenceDeps,
  opts?: SessionEvidenceOpts,
): string[] {
  const roots: string[] = [];
  const add = (root: string | null | undefined): void => {
    if (!root) return;
    const dir = telemetryDir(root);
    if (!roots.includes(dir)) roots.push(dir);
  };
  add(opts?.worktree);
  add(pijFolder(deps, id));
  add(deps.proc.cwd());
  return roots;
}

/** A populated telemetry dir holds ≥1 session subdir (dot-free name; `.flushed`/`.cursor` skipped). */
function isPopulated(fs: EvidenceFs, telDir: string): boolean {
  return fs.readdir(telDir).some((n) => !n.includes('.'));
}

/**
 * Resolve the telemetry buffer ROOT for a pij session, worktree-safe and
 * cwd-independent — the first populated candidate dir, or null. Pure read; never
 * throws (AC-02; the T001 spike).
 */
export function locateSession(
  pijSessionId: string,
  deps: SessionEvidenceDeps,
  opts?: SessionEvidenceOpts,
): string | null {
  for (const dir of candidateRoots(pijSessionId, deps, opts)) {
    if (isPopulated(deps.fs, dir)) return dir;
  }
  return null;
}

/**
 * Read every buffered segment under a telemetry dir (sorted by subdir, then seq);
 * skip unreadable/corrupt. Exported (read-only) so the fleet-evidence service reads
 * the WHOLE buffer once and groups by pij session id, rather than re-scanning per
 * lane (plan 051 · T002).
 */
export function readSegments(fs: EvidenceFs, telDir: string): Segment[] {
  return readBufferedSegments(fs, telDir).map((entry) => entry.seg);
}

/** One buffered segment plus the coordinates the durability union needs. */
export interface BufferedSegment {
  seg: Segment;
  /** The buffer subdir name — the harness session id. */
  session: string;
  /** The `<seq>.json` ordinal, compared against the `<session>.flushed` watermark. */
  seq: number;
}

/**
 * {@link readSegments} with each segment's buffer coordinates retained, so a reader can
 * tell the UNFLUSHED delta (seq > watermark) from seqs the prune has not got to yet
 * (seq <= watermark, whose bytes the committed ref already owns). Same scan, same
 * fail-safe skips.
 */
export function readBufferedSegments(fs: EvidenceFs, telDir: string): BufferedSegment[] {
  const out: BufferedSegment[] = [];
  const subs = fs
    .readdir(telDir)
    .filter((n) => !n.includes('.'))
    .sort();
  for (const sub of subs) {
    const subDir = posixJoin(telDir, sub);
    const seqs = fs
      .readdir(subDir)
      .map((n) => /^(\d+)\.json$/.exec(n))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ name: m[0], seq: Number.parseInt(m[1], 10) }))
      .sort((a, b) => a.seq - b.seq);
    for (const f of seqs) {
      const raw = fs.readText(posixJoin(subDir, f.name));
      if (raw === null) continue;
      try {
        out.push({ seg: JSON.parse(raw) as Segment, session: sub, seq: f.seq });
      } catch {
        // a corrupt buffer file is skipped, never fatal (fail-safe; AC-03)
      }
    }
  }
  return out;
}

/**
 * The `<session>.flushed` high-water seq — how much of this session the sync has
 * already pushed to its ref and the prune is entitled to delete. `0` when absent
 * (nothing flushed yet) or unreadable.
 */
export function readFlushedWatermark(fs: EvidenceFs, telDir: string, session: string): number {
  const raw = fs.readText(posixJoin(telDir, `${session}.flushed`));
  if (raw === null) return 0;
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * One segment's token buckets summed off its TURN events, or `null` when no turn event
 * carries any.
 *
 * A segment recovered from its committed ref has NO scalar `tokens` projection — the
 * OTLP round trip carries the buckets on the turn events instead — so any legacy
 * (pre-typed-usage) fold that reads only `seg.tokens` counts every ref-recovered
 * segment as MISSING and drops the whole flushed half of a post-prune union
 * (finding 02). Exported so the fleet's lane fold applies the same rule as the session
 * reader: two readers, one number for one session (R3-01).
 */
export function turnBuckets(
  segment: Segment,
): { input: number; output: number; cache_read: number; cache_create: number } | null {
  const sum = { input: 0, output: 0, cache_read: 0, cache_create: 0 };
  let present = false;
  for (const event of segment.event_stream ?? []) {
    if (event.kind !== 'turn') continue;
    if (
      event.in === undefined &&
      event.out === undefined &&
      event.cache_read === undefined &&
      event.cache_create === undefined
    ) {
      continue;
    }
    present = true;
    sum.input += event.in ?? 0;
    sum.output += event.out ?? 0;
    sum.cache_read += event.cache_read ?? 0;
    sum.cache_create += event.cache_create ?? 0;
  }
  return present ? sum : null;
}

/**
 * Fold the matched segments into normalized evidence (the derivation contract).
 * Exported (read-only) so the fleet-evidence merge reuses the exact per-session
 * fold instead of reimplementing it (plan 051 · T002; dossier F-05 "reuse, don't
 * reimplement"). `pijSessionId` is echoed into `SessionEvidence.pij_session_id`.
 */
export function fold(
  pijSessionId: string,
  segments: readonly Segment[],
  /**
   * Where these segments came from. `ref` stamps the token evidence `ref` and marks
   * the legacy sum whole-session — a rolled ref holds every seq of the session in ONE
   * tree by construction, which is the same rule `readRefLanes` (ref-source.ts)
   * applies. Two readers, one number for one session.
   */
  origin: 'live' | 'ref' = 'live',
): SessionEvidence {
  const skills: Record<string, number> = {};
  const skillOrder: string[] = [];
  const tools: Record<string, number> = {};
  const flowSeams: string[] = [];
  const harnessVerbs: Record<string, number> = {};
  const checks: Array<{ status: ChecksStatus }> = [];
  const written: string[] = [];
  const edited: string[] = [];
  let compactions = 0;
  const refusals: Record<string, number> = {};
  let subagentTokensKnown = true;
  let anyPlans = false;
  // F13 (plan 046 · AC-08): the run's wall-span, tracked as min/max event epoch.
  // Only parseable `ev.t` count; a span needs ≥ 2 timestamped events (else null).
  let minT = Number.POSITIVE_INFINITY;
  let maxT = Number.NEGATIVE_INFINITY;
  let timestamped = 0;

  for (const seg of segments) {
    for (const ev of seg.event_stream ?? []) {
      const ms = Date.parse(ev.t);
      if (!Number.isNaN(ms)) {
        timestamped += 1;
        if (ms < minT) minT = ms;
        if (ms > maxT) maxT = ms;
      }
      switch (ev.kind) {
        case 'skill':
          skills[ev.name] = (skills[ev.name] ?? 0) + 1;
          if (!skillOrder.includes(ev.name)) skillOrder.push(ev.name);
          break;
        case 'tools':
          tools[ev.name] = (tools[ev.name] ?? 0) + ev.count;
          break;
        case 'flow':
          flowSeams.push(`${ev.flow}:${ev.stage}`);
          break;
        case 'harness':
          harnessVerbs[ev.verb] = (harnessVerbs[ev.verb] ?? 0) + 1;
          break;
        case 'checks':
          checks.push({ status: ev.status });
          break;
        case 'compaction':
          compactions += 1;
          break;
        case 'command_exit':
          // Only a code-carrying exit is evidence of a REFUSAL. A plain non-zero
          // exit is a failure of some other kind, and conflating the two would
          // make "the gate stopped me" unprovable all over again.
          if (typeof ev.code === 'string' && ev.code.length > 0) {
            refusals[ev.code] = (refusals[ev.code] ?? 0) + 1;
          }
          break;
        default:
          break; // other kinds are not part of the evidence surface
      }
    }
    // Files come from the segment FIELD (no file event kind); duplicates preserved.
    if (seg.files) {
      written.push(...seg.files.written);
      edited.push(...seg.files.edited);
    }
    if (seg.tokens == null || seg.tokens.subagent_tokens == null) subagentTokensKnown = false;
    if ((seg.plans_touched ?? []).length > 0) anyPlans = true;
  }

  // Gaps: known-absent telemetry resolves to an explicit marker, never a throw (Finding 03).
  const gaps: string[] = [];
  if (!subagentTokensKnown) gaps.push('subagent_tokens');
  if (!anyPlans) gaps.push('plans_touched');
  // Skill/seam NAMES uncaptured (e.g. the copilot harness): skills run as anonymous
  // `tools.skill` invocations + `subagent`/`harness` events, but NO `kind:"skill"`/
  // `kind:"flow"` NAME events are emitted — so `skills`/`skill_order`/`flow_seams` are
  // structurally empty even though skills ran. Mark it so name-based resolvers fall
  // back to verb signatures (or resolve `unknown`), never a false `fail` — a capture
  // gap is not a conformance failure (the determinism boundary, plan 041 / F8).
  if (Object.keys(skills).length === 0 && (tools.skill ?? 0) > 0) {
    gaps.push('skill_name_capture');
  }

  const usageObservation = reduceUsageEvents(
    segments.flatMap((segment) => segment.event_stream ?? []),
  );
  let legacyMeasured = false;
  let legacyMissing = false;
  const legacy = { input: 0, output: 0, cache_read: 0, cache_create: 0 };
  if (usageObservation === null) {
    for (const segment of segments) {
      // A segment recovered from its committed ref has no scalar `tokens` projection
      // (the OTLP round trip carries the buckets on the turn events instead), so fall
      // back to the turn sums — the same measured data `ref-source` already trusts.
      // Without this a post-prune union would drop the whole flushed half (finding 02).
      const buckets = segment.tokens ?? turnBuckets(segment);
      if (buckets === null) {
        legacyMissing = true;
        continue;
      }
      legacyMeasured = true;
      legacy.input += buckets.input;
      legacy.output += buckets.output;
      legacy.cache_read += buckets.cache_read;
      legacy.cache_create += buckets.cache_create;
    }
  }
  const tokenEvidence =
    usageObservation !== null
      ? tokenEvidenceFromObservation(usageObservation, origin)
      : tokenEvidenceFromLegacyTokens(
          legacyMeasured ? legacy : null,
          origin,
          origin === 'ref' ? { wholeSession: true } : undefined,
        );
  if (usageObservation === null && legacyMeasured && legacyMissing) {
    tokenEvidence.coverage = 'partial';
    tokenEvidence.reason = 'source_unavailable';
  }
  // Finding 07: when the harness said WHY it could not read tokens, say so instead of
  // the generic `no_observation` — that is the difference between a diagnosable silent
  // zero and one that persists.
  if (tokenEvidence.coverage === 'unavailable') {
    const declared = segments
      .map((segment) => transcriptEvidenceReason(segment.token_unavailable_reason))
      .find((reason) => reason !== null);
    if (declared != null) tokenEvidence.reason = declared;
  }
  return {
    pij_session_id: pijSessionId,
    // The matched segments all belong to this pij session; take the first one's
    // harness session id (honest `null` when none carried a non-empty id) — the
    // key `telemetry session save` needs (F4).
    harness_session_id:
      segments.find((s) => (s.harness_session_id ?? '').length > 0)?.harness_session_id ?? null,
    harness: segments[0]?.harness ?? 'unknown',
    segments: segments.length,
    token_evidence: tokenEvidence,
    skills,
    skill_order: skillOrder,
    files: { written, edited },
    flow_seams: flowSeams,
    harness_verbs: harnessVerbs,
    checks,
    compactions,
    tools,
    refusals,
    gaps,
    // A span needs ≥ 2 timestamped events; otherwise the duration is honestly
    // unknown (null), never 0. Rounded to whole seconds.
    duration_s: timestamped >= 2 && maxT > minT ? Math.round((maxT - minT) / 1000) : null,
    // Provenance the CALLER owns — `fold` only knows which segments it was handed,
    // not whether a ref surface existed to check. Both are overwritten by the read
    // path below; these are the honest defaults for a bare fold.
    source: origin === 'ref' ? 'ref' : 'buffer',
    ref_checked: origin === 'ref',
  };
}

/**
 * Fold a buffer match into evidence that still speaks for the WHOLE session after a
 * mid-session sync/prune (finding 02).
 *
 * The post-commit flush hook syncs and prunes constantly, so the buffer usually holds
 * only the delta captured SINCE the last commit. Folding that alone reported the subset
 * as fully `measured` — a silent under-report that scales with how early the first
 * commit lands. Recovery is the union `sync` itself performs: the committed ref's
 * segments (the flushed truth) ++ the buffer's unflushed delta, folded ONCE so unlike
 * observation kinds are never added. Seqs at or below the watermark are dropped from
 * the buffer side — the ref already owns those bytes, so a lagging prune cannot
 * double-count them (ref shadows temp).
 *
 * When the flushed half cannot be reached (no git read port, or no ref for this
 * session) the values that remain are real but partial, and say so with
 * `flushed_segments_unreadable` rather than passing as measured.
 */
export interface DurableSegments {
  /** The whole session: committed ref segments ++ the buffer's unflushed delta. */
  segments: Segment[];
  /** `true` when a prune happened but the flushed half could not be recovered. */
  flushedUnreachable: boolean;
  /**
   * The subset of `segments` recovered FROM THE REF — the flushed half, by identity.
   * Provenance a consumer cannot recover from content: an OTLP round trip strips a
   * segment's scalar `tokens` projection, and a live segment that never had one is a
   * genuinely unmeasured lane (AC-02). Same shape, opposite meaning (R3-01).
   */
  refRecovered: readonly Segment[];
}

/**
 * Reconstruct the WHOLE session behind a buffer read, undoing the mid-session prune.
 * Shared by the session reader and the fleet's live lanes so both answer the same
 * number for the same session.
 */
export function durableSegments(
  buffered: readonly BufferedSegment[],
  telDir: string,
  deps: Pick<SessionEvidenceDeps, 'fs' | 'gitRead'>,
): DurableSegments {
  const sessions = [...new Set(buffered.map((e) => e.session))];
  const watermarks = new Map(
    sessions.map((s) => [s, readFlushedWatermark(deps.fs, telDir, s)] as const),
  );
  const pruned = sessions.filter((s) => (watermarks.get(s) ?? 0) > 0);
  if (pruned.length === 0) {
    return { segments: buffered.map((e) => e.seg), flushedUnreachable: false, refRecovered: [] };
  }

  const refSegments =
    deps.gitRead === undefined ? new Map<string, Segment[]>() : readRefSegments(deps.gitRead);
  const flushed = pruned.flatMap((s) => refSegments.get(s) ?? []);
  if (flushed.length === 0) {
    return { segments: buffered.map((e) => e.seg), flushedUnreachable: true, refRecovered: [] };
  }
  // Seqs at/below the watermark are already owned by the ref — drop them from the
  // buffer side so a lagging prune cannot double-count (ref shadows temp). The save
  // path enforces the same rule through the ROLLED MANIFEST's `max_seq` (with this
  // watermark as its fallback), not through this file: two readers, one rule, two
  // different statements of which seqs the ref owns.
  const unflushed = buffered.filter((e) => e.seq > (watermarks.get(e.session) ?? 0));
  return {
    segments: [...flushed, ...unflushed.map((e) => e.seg)],
    flushedUnreachable: false,
    refRecovered: flushed,
  };
}

function foldDurable(
  pijSessionId: string,
  matched: readonly BufferedSegment[],
  telDir: string,
  deps: SessionEvidenceDeps,
): SessionEvidence {
  const { segments, flushedUnreachable, refRecovered } = durableSegments(matched, telDir, deps);
  const evidence = fold(
    pijSessionId,
    segments.filter((s) => s.captured_env?.[PIJ_SESSION_ENV] === pijSessionId),
  );
  if (flushedUnreachable && evidence.token_evidence.coverage !== 'unavailable') {
    evidence.token_evidence.coverage = 'partial';
    evidence.token_evidence.reason = 'flushed_segments_unreadable';
  }
  // The union really did read both surfaces — say so rather than let `buffer` imply
  // the ref contributed nothing.
  evidence.source = refRecovered.length > 0 ? 'buffer+ref' : 'buffer';
  return evidence;
}

/**
 * Tier 2 — the session as its COMMITTED ref knows it (FX001 · T1).
 *
 * The post-commit hook flushes on every commit, so a subject that commits blinds its
 * own telemetry lane: the buffer keeps markers and the segments live only on
 * `refs/harness-telemetry/*`. This joins those rolled segments by the SAME key the
 * buffer read uses — `captured_env.PIJ_SESSION_ID` — so a ref belonging to another
 * session can never satisfy the join. `null` when the ref surface holds nothing for
 * this pij id, which is what keeps `E100` meaning something.
 */
function foldFromRefs(pijSessionId: string, gitRead: GitReadPort): SessionEvidence | null {
  const matched = [...readRefSegments(gitRead).values()]
    .flat()
    .filter((s) => s.captured_env?.[PIJ_SESSION_ENV] === pijSessionId);
  return matched.length > 0 ? fold(pijSessionId, matched, 'ref') : null;
}

/**
 * Read + join + fold a pij session's telemetry into normalized {@link SessionEvidence},
 * or `null` when no segment carries this pij id. Scans the candidate buffer roots
 * (worktree → pij folder → cwd) and uses the FIRST that yields a match — the
 * dual-tree fallback. Fail-safe: any unexpected error resolves to `null` (a read
 * service never throws to its caller). No cache.
 */
export async function getSessionEvidence(
  pijSessionId: string,
  deps: SessionEvidenceDeps,
  opts?: SessionEvidenceOpts,
): Promise<SessionEvidence | null> {
  try {
    // Is there a ref namespace at all? Answered once, up front, so the provenance is
    // the same statement whichever tier ends up answering.
    const refChecked = deps.gitRead !== undefined && telemetryRefsPresent(deps.gitRead);

    for (const telDir of candidateRoots(pijSessionId, deps, opts)) {
      const matched = readBufferedSegments(deps.fs, telDir).filter(
        (e) => e.seg.captured_env?.[PIJ_SESSION_ENV] === pijSessionId,
      );
      if (matched.length > 0) {
        const evidence = foldDurable(pijSessionId, matched, telDir, deps);
        evidence.ref_checked = refChecked;
        return evidence;
      }
    }

    // The buffer is absent or flushed-markers-only. The ref is not a consolation
    // prize here — after the first commit it is the ONLY place the session exists.
    if (deps.gitRead !== undefined) {
      const evidence = foldFromRefs(pijSessionId, deps.gitRead);
      if (evidence !== null) {
        evidence.ref_checked = refChecked;
        return evidence;
      }
    }
    return null; // both surfaces empty — E100 keeps its meaning
  } catch {
    return null;
  }
}

/**
 * The subset of an extension `VerbContext` (`services/extensions/contract.ts`)
 * that the telemetry read path needs. A real `VerbContext` is structurally
 * assignable to this — so a Phase 2 flow-eval extension can call
 * {@link getSessionEvidenceFromContext} directly, with no ad-hoc port shims.
 *
 * NOTE: the read path needs `fs.readdir` to list the buffer's session subdirs
 * (not just `readText`); the real `VerbContext.fs` exposes it, so the contract
 * stays consumable — a facade with only `readText` could never locate a segment.
 */
export interface SessionEvidenceContext {
  /** The developer-repo cwd (a string — NOT a `proc.cwd()` method). */
  cwd: string;
  /** Read-only fs surface — a subset of `VerbContext.fs`. */
  fs: { readText(path: string): string | null; readdir(path: string): string[] };
  /** Env reads via `get` only (no `.home()`); HOME is resolved through it. */
  env: { get(name: string): string | undefined };
}

/**
 * Phase2-facing facade (plan 041 Finding 1) — call the session-evidence read
 * path from an extension {@link SessionEvidenceContext} instead of the raw
 * port-injected {@link SessionEvidenceDeps}. Adapts ctx → deps: `cwd` (a string)
 * → `proc.cwd()`; `env.get('HOME')` (falling back to `USERPROFILE` on Windows) →
 * `env.home()`; `fs.readText`/`fs.readdir` pass through. Stays `node:*`-free —
 * HOME comes from `ctx.env.get`, never `node:os`. The deps form is retained for
 * the CLI act (it has real ports) and unit tests.
 */
export function getSessionEvidenceFromContext(
  pijSessionId: string,
  ctx: SessionEvidenceContext,
  opts?: SessionEvidenceOpts,
): Promise<SessionEvidence | null> {
  const deps: SessionEvidenceDeps = {
    fs: { readText: (p) => ctx.fs.readText(p), readdir: (p) => ctx.fs.readdir(p) },
    env: { home: () => ctx.env.get('HOME') ?? ctx.env.get('USERPROFILE') },
    proc: { cwd: () => ctx.cwd },
  };
  return getSessionEvidence(pijSessionId, deps, opts);
}
