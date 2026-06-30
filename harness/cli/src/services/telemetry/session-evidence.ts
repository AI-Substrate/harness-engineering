import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import { posixJoin, toPosix } from '../shared/posix-path.js';
import { telemetryDir } from './cursor.js';
import type { ChecksStatus } from './events.js';
import type { Segment } from './segment.js';

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
 * → pij `folder` → `proc.cwd()`. (A published-refs scan — `refs/harness-telemetry/**`
 * — is a deferred second tier; the buffer is the live source the scorer reads.)
 *
 * NO CACHE — reads fresh on every call so a downstream fs resolver always observes
 * the latest buffer state.
 */

/** The normalized per-pij-session evidence object — the Phase 1 → Phase 2 contract. */
export interface SessionEvidence {
  /** The pij session id this evidence was joined on (echoed back). */
  pij_session_id: string;
  /** The harness that produced the matched segments (e.g. `claude-code`). */
  harness: string;
  /** Number of telemetry segments joined into this evidence. */
  segments: number;
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
  /** Field names that were absent / unknown (e.g. `subagent_tokens`, `plans_touched`). */
  gaps: string[];
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

/** Telemetry buffer dirs to try, in priority order (deduped): worktree → pij folder → cwd. */
function candidateRoots(
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

/** Read every buffered segment under a telemetry dir (sorted by subdir, then seq); skip unreadable/corrupt. */
function readSegments(fs: EvidenceFs, telDir: string): Segment[] {
  const out: Segment[] = [];
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
        out.push(JSON.parse(raw) as Segment);
      } catch {
        // a corrupt buffer file is skipped, never fatal (fail-safe; AC-03)
      }
    }
  }
  return out;
}

/** Fold the matched segments into normalized evidence (the derivation contract). */
function fold(pijSessionId: string, segments: readonly Segment[]): SessionEvidence {
  const skills: Record<string, number> = {};
  const skillOrder: string[] = [];
  const tools: Record<string, number> = {};
  const flowSeams: string[] = [];
  const harnessVerbs: Record<string, number> = {};
  const checks: Array<{ status: ChecksStatus }> = [];
  const written: string[] = [];
  const edited: string[] = [];
  let compactions = 0;
  let subagentTokensKnown = true;
  let anyPlans = false;

  for (const seg of segments) {
    for (const ev of seg.event_stream ?? []) {
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

  return {
    pij_session_id: pijSessionId,
    harness: segments[0]?.harness ?? 'unknown',
    segments: segments.length,
    skills,
    skill_order: skillOrder,
    files: { written, edited },
    flow_seams: flowSeams,
    harness_verbs: harnessVerbs,
    checks,
    compactions,
    tools,
    gaps,
  };
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
    for (const telDir of candidateRoots(pijSessionId, deps, opts)) {
      const matched = readSegments(deps.fs, telDir).filter(
        (s) => s.captured_env?.[PIJ_SESSION_ENV] === pijSessionId,
      );
      if (matched.length > 0) return fold(pijSessionId, matched);
    }
    return null;
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
