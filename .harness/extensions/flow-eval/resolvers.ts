/**
 * `flow-eval` resolver registry (plan 041 Phase 2, T003) — the core contract.
 *
 * One entry per assertion `type`, each declaring its **lane** and a `resolve`
 * fn that turns the assertion into a THREE-VALUED verdict (`pass`/`fail`/
 * `unknown`). The scorer dispatches purely by `type`; this module is the only
 * place that knows HOW each is proven (workshop §3).
 *
 * Lanes:
 *  - **telemetry** — reads the already-fetched {@link SessionEvidence} (the
 *    Phase-1 `harness telemetry get --json` payload). A missing/errored
 *    evidence object (or a known gap) → `unknown`, NEVER `fail` (a capability
 *    gap is not a subject failure — the determinism boundary).
 *  - **fs** — reads the subject's worktree via the injected fs surface; the
 *    real-behaviour `command-succeeds` runs in the worktree via `exec`.
 *  - **fs+telemetry** — an AND of both lanes (fail dominates, then unknown).
 *
 * Node-free: only string ops + the injected ports (no `node:*`). `judged`
 * assertions are NOT here — the scorer surfaces them as fields, never resolving
 * them deterministically.
 *
 * The extension imports ONLY `@ai-substrate/engineering-harness/contract`, so
 * the {@link SessionEvidence} shape is re-declared here (it is the documented
 * Phase-1→Phase-2 seam: parse `envelope.data` into this shape) — never imported
 * from CLI internals.
 */

import type { ExecResult } from '@ai-substrate/engineering-harness/contract';
import type { Assertion, AssertionSource } from './scenario.js';
import { ASSERTION_TYPES, join } from './scenario.js';

/** Three-valued verdict for a deterministic assertion. */
export type Verdict = 'pass' | 'fail' | 'unknown';

/**
 * The normalized per-pij-session evidence (mirror of Phase 1's `SessionEvidence`).
 * Re-declared here because an extension can't import CLI src — this IS the parsed
 * `envelope.data` of `harness telemetry get --json`.
 */
export interface SessionEvidence {
  pij_session_id: string;
  harness: string;
  segments: number;
  skills: Record<string, number>;
  skill_order: string[];
  files: { written: string[]; edited: string[] };
  flow_seams: string[];
  harness_verbs: Record<string, number>;
  checks: Array<{ status: string }>;
  compactions: number;
  tools: Record<string, number>;
  gaps: string[];
}

/** The read surface a resolver needs over the subject's worktree. */
export interface ResolverFs {
  exists(path: string): boolean;
  readText(path: string): string | null;
  readdir(path: string): string[];
}

/** What every resolver is handed: shared evidence (fetched once) + worktree access. */
export interface ResolveContext {
  /** The session's telemetry evidence, or `null` when `telemetry get` errored/absent. */
  evidence: SessionEvidence | null;
  /** The subject's worktree root — fs reads + `command-succeeds` cwd resolve here. */
  worktree: string;
  fs: ResolverFs;
  /** Run a real command (the `command-succeeds` lane). cwd defaults to the worktree. */
  exec(command: string, args: string[], opts: { cwd: string }): Promise<ExecResult>;
}

/** A resolver: type-dispatched, lane-tagged, three-valued (may be async for `command-succeeds`). */
export type ResolverFn = (a: Assertion, rc: ResolveContext) => Verdict | Promise<Verdict>;

export interface ResolverEntry {
  lanes: AssertionSource[];
  resolve: ResolverFn;
}

// ---- param helpers (tolerant; a bad param degrades to unknown, never throws) ----

function strParam(a: Assertion, key: string): string | undefined {
  const v = a.params[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function numParam(a: Assertion, key: string, dflt: number): number {
  const v = a.params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

function bool(verdict: boolean): Verdict {
  return verdict ? 'pass' : 'fail';
}

// ---- glob matching over the worktree (node-free; uses fs.readdir/exists) ----

/** Compile one glob segment (`*`/`?` wildcards) to an anchored, slash-free regex. */
function segToRegExp(seg: string): RegExp {
  let re = '';
  for (const ch of seg) {
    if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** True if ≥1 path under `base` matches the remaining glob `segments`. */
function matchGlob(fs: ResolverFs, base: string, segments: string[]): boolean {
  if (segments.length === 0) return fs.exists(base);
  const [head, ...rest] = segments;
  if (head === '**') {
    if (matchGlob(fs, base, rest)) return true; // ** matches zero dirs
    for (const name of fs.readdir(base)) {
      if (matchGlob(fs, join(base, name), segments)) return true; // …or one+ dirs
    }
    return false;
  }
  if (head.includes('*') || head.includes('?')) {
    const re = segToRegExp(head);
    for (const name of fs.readdir(base)) {
      if (re.test(name) && matchGlob(fs, join(base, name), rest)) return true;
    }
    return false;
  }
  return matchGlob(fs, join(base, head), rest); // literal segment
}

/** Resolve a `{ glob | path }` param against the worktree → does it match? */
function fsMatch(a: Assertion, rc: ResolveContext): boolean {
  const path = strParam(a, 'path');
  if (path) return rc.fs.exists(join(rc.worktree, path));
  const glob = strParam(a, 'glob');
  if (!glob) return false;
  return matchGlob(rc.fs, rc.worktree, glob.split('/').filter((s) => s.length > 0));
}

// ---- skill-name-capture fallback (F8: copilot emits no `kind:"skill"`/`kind:"flow"`) ----

/**
 * Verb signatures for skills whose telemetry NAME events some harnesses don't emit
 * (copilot — flagged by the `skill_name_capture` gap). A skill counts as "called" when
 * ANY of its signature harness verbs ran. Used ONLY on the fallback path when names are
 * uncaptured; harnesses that DO name skills (Claude) populate `skills` and never reach
 * here. The signatures are each skill's own CLI surface: `the-flow` drives the `flow`
 * verb family; `eng-harness-flow` drives the loop verbs (absence ⇒ the loop never ran —
 * the real conformance signal, preserved).
 */
const SKILL_VERB_SIGNATURES: Record<string, string[]> = {
  'the-flow': ['flow'],
  'eng-harness-flow': ['observe', 'retro', 'boot', 'backpressure'],
};

/** Did any harness verb equal to — or prefixed `"<p> "` by — one of `prefixes` run? */
function anyVerbRan(harnessVerbs: Record<string, number>, prefixes: string[]): boolean {
  return Object.keys(harnessVerbs).some((v) =>
    prefixes.some((p) => v === p || v.startsWith(`${p} `)),
  );
}

// ---- telemetry-lane resolvers (evidence === null ⇒ unknown) ----

const skillCalled: ResolverFn = (a, rc) => {
  if (!rc.evidence) return 'unknown';
  const skill = strParam(a, 'skill');
  if (!skill) return 'unknown';
  if ((rc.evidence.skills[skill] ?? 0) >= numParam(a, 'min', 1)) return 'pass';
  // Fallback: this harness doesn't capture skill NAMES (copilot — `skill_name_capture`).
  // Infer the call from the skill's CLI-verb signature; a skill with no known signature
  // can't be verified ⇒ `unknown`, never a false `fail` (the determinism boundary).
  if (rc.evidence.gaps.includes('skill_name_capture')) {
    const sig = SKILL_VERB_SIGNATURES[skill];
    if (!sig) return 'unknown';
    return bool(anyVerbRan(rc.evidence.harness_verbs, sig));
  }
  return 'fail';
};

const skillSequence: ResolverFn = (a, rc) => {
  if (!rc.evidence) return 'unknown';
  const skills = a.params.skills;
  if (!Array.isArray(skills) || skills.some((s) => typeof s !== 'string')) return 'unknown';
  // Stage-level skill NAMES aren't captured by every harness (copilot) — a SEQUENCE can't
  // be verified without them ⇒ `unknown`, never a false `fail` (the determinism boundary).
  if (rc.evidence.gaps.includes('skill_name_capture') && rc.evidence.skill_order.length === 0) {
    return 'unknown';
  }
  const ordered = a.params.ordered !== false; // default true
  const order = rc.evidence.skill_order;
  if (!ordered) return bool((skills as string[]).every((s) => order.includes(s)));
  // ordered: each next skill must appear at-or-after the previous one's index.
  let cursor = -1;
  for (const s of skills as string[]) {
    const idx = order.indexOf(s, cursor + 1);
    if (idx === -1) return 'fail';
    cursor = idx;
  }
  return 'pass';
};

const flowSeamFired: ResolverFn = (a, rc) => {
  if (!rc.evidence) return 'unknown';
  const hook = strParam(a, 'hook');
  if (!hook) return 'unknown';
  // Seam (`kind:"flow"`) events aren't emitted by every harness (copilot) — when the
  // seam stream is structurally empty under that gap, a fired seam can't be confirmed
  // ⇒ `unknown`, never a false `fail` (the determinism boundary).
  if (rc.evidence.gaps.includes('skill_name_capture') && rc.evidence.flow_seams.length === 0) {
    return 'unknown';
  }
  return bool(
    rc.evidence.flow_seams.some((s) => s === hook || s.endsWith(`:${hook}`) || s.includes(hook)),
  );
};

const harnessVerbRan: ResolverFn = (a, rc) => {
  if (!rc.evidence) return 'unknown';
  const verb = strParam(a, 'verb');
  if (!verb) return 'unknown';
  return bool((rc.evidence.harness_verbs[verb] ?? 0) >= numParam(a, 'min', 1));
};

const checksRan: ResolverFn = (a, rc) => {
  if (!rc.evidence) return 'unknown';
  const status = strParam(a, 'status');
  const checks = rc.evidence.checks;
  if (status) return bool(checks.some((c) => c.status === status));
  return bool(checks.length >= numParam(a, 'min', 1));
};

const toolUsed: ResolverFn = (a, rc) => {
  if (!rc.evidence) return 'unknown';
  const tool = strParam(a, 'tool');
  if (!tool) return 'unknown';
  return bool((rc.evidence.tools[tool] ?? 0) >= numParam(a, 'min', 1));
};

const compactionOccurred: ResolverFn = (a, rc) => {
  if (!rc.evidence) return 'unknown';
  return bool(rc.evidence.compactions >= numParam(a, 'min', 1));
};

// ---- fs-lane resolvers (the worktree is always readable ⇒ pass/fail, no unknown) ----

const fileCreated: ResolverFn = (a, rc) => bool(fsMatch(a, rc));

const artifactExists: ResolverFn = (a, rc) => bool(fsMatch(a, rc));

const fileContentMatches: ResolverFn = (a, rc) => {
  const path = strParam(a, 'path');
  const pattern = strParam(a, 'pattern');
  if (!path || !pattern) return 'unknown';
  const text = rc.fs.readText(join(rc.worktree, path));
  if (text === null) return 'fail'; // the file isn't there ⇒ content can't match
  try {
    return bool(new RegExp(pattern).test(text));
  } catch {
    return 'unknown'; // an un-compilable pattern can't be evaluated
  }
};

const commandSucceeds: ResolverFn = async (a, rc) => {
  const cmd = strParam(a, 'cmd');
  if (!cmd) return 'unknown';
  const parts = cmd.split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) return 'unknown';
  const [command, ...args] = parts;
  const cwdParam = strParam(a, 'cwd');
  const cwd = cwdParam ? join(rc.worktree, cwdParam) : rc.worktree;
  const expectExit = numParam(a, 'expect_exit', 0);
  const r = await rc.exec(command, args, { cwd });
  return bool(r.code === expectExit);
};

// ---- composite fs+telemetry (AND; fail dominates, then unknown) ----

/** Three-valued AND: any fail ⇒ fail; else any unknown ⇒ unknown; else pass. */
function andVerdict(a: Verdict, b: Verdict): Verdict {
  if (a === 'fail' || b === 'fail') return 'fail';
  if (a === 'unknown' || b === 'unknown') return 'unknown';
  return 'pass';
}

const retroDrained: ResolverFn = (a, rc) => {
  // telemetry half: a retro drain wrote a record THIS session. The harness has no
  // `retro` verb — a drain is `harness observe` (capture) → `harness record` (write),
  // so the real drain-write signal is the `record` verb (legacy `retro` still honoured).
  // F11: keying on the phantom `retro` verb false-failed every genuine drain.
  const min = numParam(a, 'min', 1);
  const driveVerbs = rc.evidence
    ? (rc.evidence.harness_verbs.record ?? 0) + (rc.evidence.harness_verbs.retro ?? 0)
    : 0;
  const telemetry: Verdict = !rc.evidence ? 'unknown' : bool(driveVerbs >= min);
  // fs half: a retro record file exists. AND-ed with the telemetry half, this also
  // guards against a stale pre-existing record passing alone — a `record` verb must
  // have fired this session for the file to count.
  const evidenceGlob = strParam(a, 'evidence_glob') ?? strParam(a, 'glob');
  const fsHalf: Verdict = evidenceGlob
    ? bool(matchGlob(rc.fs, rc.worktree, evidenceGlob.split('/').filter((s) => s.length > 0)))
    : 'unknown';
  return andVerdict(telemetry, fsHalf);
};

/** The type→resolver registry (lane-tagged). `judged` is intentionally absent. */
export const RESOLVERS: Record<string, ResolverEntry> = {
  'skill-called': { lanes: ASSERTION_TYPES['skill-called'], resolve: skillCalled },
  'skill-sequence': { lanes: ASSERTION_TYPES['skill-sequence'], resolve: skillSequence },
  'flow-seam-fired': { lanes: ASSERTION_TYPES['flow-seam-fired'], resolve: flowSeamFired },
  'harness-verb-ran': { lanes: ASSERTION_TYPES['harness-verb-ran'], resolve: harnessVerbRan },
  'checks-ran': { lanes: ASSERTION_TYPES['checks-ran'], resolve: checksRan },
  'tool-used': { lanes: ASSERTION_TYPES['tool-used'], resolve: toolUsed },
  'compaction-occurred': {
    lanes: ASSERTION_TYPES['compaction-occurred'],
    resolve: compactionOccurred,
  },
  'file-created': { lanes: ASSERTION_TYPES['file-created'], resolve: fileCreated },
  'file-content-matches': {
    lanes: ASSERTION_TYPES['file-content-matches'],
    resolve: fileContentMatches,
  },
  'artifact-exists': { lanes: ASSERTION_TYPES['artifact-exists'], resolve: artifactExists },
  'command-succeeds': { lanes: ASSERTION_TYPES['command-succeeds'], resolve: commandSucceeds },
  'retro-drained': { lanes: ASSERTION_TYPES['retro-drained'], resolve: retroDrained },
};

/** Resolve ONE deterministic assertion to its verdict (dispatch by `type`). */
export async function resolveAssertion(a: Assertion, rc: ResolveContext): Promise<Verdict> {
  const entry = RESOLVERS[a.type];
  if (!entry) return 'unknown'; // unknown type (loader normally rejects these first)
  return entry.resolve(a, rc);
}
