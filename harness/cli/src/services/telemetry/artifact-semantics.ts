import {
  isWithin,
  posixJoin,
  posixNormalize,
  posixRelative,
  toPosix,
} from '../shared/posix-path.js';
import type {
  ArtifactCountKey,
  ArtifactEnumKey,
  ArtifactEvent,
  ArtifactType,
  Event,
} from './events.js';
import { isPlanDocPath, planIdFromPath } from './plan-paths.js';

/** The closed count/enum maps an extractor authors (compile-time key discipline, F2). */
type Counts = Partial<Record<ArtifactCountKey, number>>;
type Enums = Partial<Record<ArtifactEnumKey, string>>;

/**
 * Semantic artifact telemetry (plan 050) — the pure extractor registry that
 * turns a changed flow/SDD artifact into a counts-only {@link ArtifactEvent}.
 *
 * Modelled wholesale on {@link flowLogEvents} (the exemplar): pure, defensive,
 * privacy-scoped. The flow already writes rich deterministic artifacts (reviews,
 * plans, workshops, dossiers, the-flow.json); their process signals (fixes per
 * review, phases per plan, workshop depth) sit unread. This module reads the
 * STRUCTURAL MARKERS the flow verbs author and emits them as integers + a fixed
 * enum vocabulary — never the surrounding prose.
 *
 * CONTRACT (workshop § Extractor registry):
 *  1. `extract` NEVER throws — unparseable content returns empty counts; a
 *     garbage artifact silently yields a thin event, never a capture failure.
 *  2. Path-first dispatch: the FIRST matching extractor wins; an unmatched
 *     changed file emits nothing (no default extractor).
 *  3. Counts omit zero-valued keys → a garbage artifact serializes with `{}`
 *     counts (AC-04). Enum values are gated to a fixed vocabulary with an `other`
 *     fallback — the extractor IS the value allowlist (AC-05), no free text can
 *     travel.
 */

export interface ArtifactExtractor {
  type: ArtifactType;
  /** Pure predicate on a repo-relative POSIX path. */
  match: (repoRelPath: string) => boolean;
  /** Pure `(content) → counts/enums`. Never throws (see {@link extractArtifact}). */
  extract: (content: string) => { counts: Counts; enums: Enums };
}

/** The minimal read surface the capture helper needs (FsPort satisfies it). */
export interface ArtifactContentReader {
  readText(path: string): string | null;
}

/** Artifacts larger than this are skipped, not parsed (AC-04 oversized guard). */
export const MAX_ARTIFACT_BYTES = 512 * 1024;

// ── pure count/enum primitives ───────────────────────────────────────────────

/** Count global-regex matches (0 when none). */
function countOf(content: string, re: RegExp): number {
  const m = content.match(re);
  return m === null ? 0 : m.length;
}

/** Count DISTINCT capture-group-1 values of a global regex (0 when none). */
function distinctCount(content: string, re: RegExp): number {
  const seen = new Set<string>();
  for (const m of content.matchAll(re)) if (m[1] !== undefined) seen.add(m[1]);
  return seen.size;
}

/** Set a count key ONLY when > 0 — so a garbage artifact yields `{}` (AC-04). */
function put(counts: Counts, key: ArtifactCountKey, n: number): void {
  if (n > 0) counts[key] = n;
}

/** Normalize a raw marker token to an UPPER_SNAKE enum candidate. */
function normToken(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

/**
 * First marker value, mapped to a fixed vocabulary (else `other`); an ABSENT
 * marker ⇒ `undefined` (the enum key is omitted). This is the value allowlist
 * gate: a novel/unknown token becomes `other`, never travels verbatim (AC-05).
 */
function enumOf(content: string, re: RegExp, vocab: readonly string[]): string | undefined {
  const m = re.exec(content);
  if (m === null) return undefined;
  const tok = normToken(m[1] ?? '');
  return vocab.includes(tok) ? tok : 'other';
}

/** Tally `F<n> · <SEV>` finding markers by severity (review grammar). */
function tallyFindings(content: string): Counts {
  const re = /F\d+\s*·\s*(CRITICAL|HIGH|MEDIUM|MED|LOW)/gi;
  const out: Counts = {};
  let critical = 0;
  let high = 0;
  let med = 0;
  let low = 0;
  for (const m of content.matchAll(re)) {
    const s = (m[1] ?? '').toUpperCase();
    if (s === 'CRITICAL') critical++;
    else if (s === 'HIGH') high++;
    else if (s === 'LOW') low++;
    else med++;
  }
  put(out, 'findings_critical', critical);
  put(out, 'findings_high', high);
  put(out, 'findings_med', med);
  put(out, 'findings_low', low);
  return out;
}

// ── enum vocabularies (fixed, `other` fallback) ──────────────────────────────

const VERDICT_VOCAB = ['APPROVE', 'APPROVE_WITH_NOTES', 'FIX_REQUIRED', 'NEEDS_ATTENTION'] as const;
const PLAN_MODE_VOCAB = ['SIMPLE', 'FULL'] as const;
const PLAN_STATUS_VOCAB = ['READY', 'DRAFT'] as const;
const PROOF_VOCAB = [
  'CONTRACT_READY',
  'PREFERRED_DIRECTION',
  'DIRECTIONAL',
  'EXPLORATORY',
] as const;
const CERTAINTY_VOCAB = ['FULL', 'PARTIAL', 'NONE', 'COMPLETE'] as const;
const VALIDATION_VOCAB = ['VALIDATED', 'VALIDATED_WITH_FIXES', 'NEEDS_ATTENTION'] as const;
const PR_STATE_VOCAB = ['OPEN', 'MERGED', 'CLOSED', 'DRAFT'] as const;

// ── the ten extractors (thin regex counters — KISS) ──────────────────────────

/**
 * The FIRST verdict token on the `**Verdict**:` line, gated to {@link VERDICT_VOCAB}
 * (else `other`); `undefined` when absent OR when the line is a RUBRIC (F-08 / plan
 * 052 T002). A review-PACKET template enumerates the whole vocabulary as
 * pipe-separated options (`**Verdict**: APPROVE | APPROVE_WITH_NOTES | FIX_REQUIRED`)
 * — an instruction, not a verdict — so ≥2 DISTINCT verdicts across `|`-split
 * segments rejects it. A real verdict is one token; later parenthetical mentions
 * (`APPROVE (FIX_REQUIRED → fixed)`) use arrows/parens, not pipes, so they still
 * resolve to the leading token.
 */
function reviewVerdict(content: string): string | undefined {
  const m = /\*\*Verdict\*\*:([^\n]*)/.exec(content);
  if (m === null) return undefined;
  const line = m[1] ?? '';
  const parts = line.split('|');
  if (parts.length >= 2) {
    const distinct = new Set<string>();
    for (const part of parts) {
      for (const v of VERDICT_VOCAB) if (new RegExp(`\\b${v}\\b`).test(part)) distinct.add(v);
    }
    if (distinct.size >= 2) return undefined; // rubric list → not a verdict
  }
  return enumOf(line, /([A-Z][A-Z_]{2,})/, VERDICT_VOCAB);
}

/** Row 1–4: reviews — fixes, findings by severity, re-review loops, verdict. */
const reviewExtractor: ArtifactExtractor = {
  type: 'review',
  // A real review report lives at `reviews/<name>.md`, but NOT a review-PACKET
  // template (`*-packet.md`) — those enumerate the finding/verdict GRAMMAR as
  // instructions, so classifying them as reviews mis-reports a template's rubric
  // as a real verdict (F-08 / plan 052 T002). Excluded here → no extractor matches
  // → the packet emits nothing (there is no default extractor).
  match: (p) => /\/reviews\/[^/]+\.md$/.test(p) && !/-packet\.md$/.test(p),
  extract: (content) => {
    const counts: Counts = { ...tallyFindings(content) };
    put(counts, 'fixes', countOf(content, /\*\*Fix(?:\s*\([^)]*\))?\*\*:/g));
    put(counts, 're_reviews', countOf(content, /re-review/gi));
    const enums: Enums = {};
    // Verdict grammar varies: `**Verdict**: FIX_REQUIRED`, `✅ **APPROVE** (…)`,
    // `✅ APPROVE_WITH_NOTES …`. Take the FIRST UPPER_SNAKE token on the verdict
    // line regardless of bold/emoji wrapping; the enum vocab still gates it, and a
    // pipe-separated rubric line is rejected outright (F1 / F-08).
    const verdict = reviewVerdict(content);
    if (verdict !== undefined) enums.verdict = verdict;
    return { counts, enums };
  },
};

/** Rows 5–10: plans — phases, CS, gate matrix, gaps, workshop opps; mode + status enums. */
const planExtractor: ArtifactExtractor = {
  type: 'plan',
  match: isPlanDocPath,
  extract: (content) => {
    const counts: Counts = {};
    const phases = countOf(content, /^#### Phase \d+/gm);
    // A "Simple" plan authors no Phase headers but is a single phase (workshop row 5).
    put(counts, 'phases', phases > 0 ? phases : /\*\*Mode\*\*:\s*Simple/i.test(content) ? 1 : 0);
    const cs = /\bCS-(\d+)/.exec(content);
    if (cs !== null) put(counts, 'cs', Number(cs[1]));
    put(counts, 'gate_pass', countOf(content, /\|\s*PASS\s*\|/g));
    put(counts, 'gate_fail', countOf(content, /\|\s*FAIL\s*\|/g));
    put(counts, 'gate_na', countOf(content, /\|\s*N\/A\s*\|/g));
    // Row 10 (unresolved gaps): the flow's inline `⚠️ GAP:` marker. The prose
    // `## Unresolved Gaps` section is deliberately NOT bullet-counted (a "None —
    // all gates PASS" line would fabricate a gap); markers are the honest signal.
    put(counts, 'gaps', countOf(content, /⚠️ GAP:/g));
    // Row 9 (workshop opportunities): distinct `WS-<n>` identifiers — the flow's
    // structural marker for a deferred workshop fork (deduped so a repeated WS-1
    // reference counts once).
    put(counts, 'workshop_opps', distinctCount(content, /\bWS-(\d+)\b/g));
    const enums: Enums = {};
    const mode = enumOf(content, /\*\*Mode\*\*:\s*([A-Za-z]+)/, PLAN_MODE_VOCAB);
    if (mode !== undefined) enums.mode = mode;
    const status = enumOf(content, /\*\*Status\*\*:\s*([A-Za-z]+)/, PLAN_STATUS_VOCAB);
    if (status !== undefined) enums.status = status;
    return { counts, enums };
  },
};

/** Rows 11–14: workshops — sections, decisions, open/resolved; proof-level enums. */
const workshopExtractor: ArtifactExtractor = {
  type: 'workshop',
  match: (p) => /\/workshops\/[^/]+\.md$/.test(p),
  extract: (content) => {
    const counts: Counts = {};
    put(counts, 'sections', countOf(content, /^## /gm));
    put(counts, 'decisions', countOf(content, /\bSelected\b/g));
    put(counts, 'open', countOf(content, /\*\*OPEN\*\*/g));
    put(counts, 'resolved', countOf(content, /\*\*RESOLVED\*\*/g));
    const enums: Enums = {};
    const target = enumOf(
      content,
      /\*\*Target Proof Level\*\*:\s*([A-Za-z][A-Za-z ]*)/,
      PROOF_VOCAB,
    );
    if (target !== undefined) enums.target_proof = target;
    const current = enumOf(
      content,
      /\*\*Current Proof Level\*\*:\s*([A-Za-z][A-Za-z ]*)/,
      PROOF_VOCAB,
    );
    if (current !== undefined) enums.current_proof = current;
    return { counts, enums };
  },
};

/** Rows 15–16: research dossier — sections, findings, high-impact rows. */
const dossierExtractor: ArtifactExtractor = {
  type: 'dossier',
  match: (p) => /\/research-dossier\.md$/.test(p),
  extract: (content) => {
    const counts: Counts = {};
    put(counts, 'sections', countOf(content, /^## /gm));
    put(counts, 'findings', countOf(content, /^\|\s*F-?\d+\b/gm));
    put(counts, 'high', countOf(content, /\|\s*High\s*\|/g));
    return { counts, enums: {} };
  },
};

/** Row 17: tasks — table rows by status token. */
const tasksExtractor: ArtifactExtractor = {
  type: 'tasks',
  match: (p) => /\/tasks\/[^/]+\/tasks\.md$/.test(p),
  extract: (content) => {
    const counts: Counts = {};
    put(counts, 'done', countOf(content, /\|\s*\[x\]/gi));
    put(counts, 'todo', countOf(content, /\|\s*\[ \]/g));
    put(counts, 'blocked', countOf(content, /\|\s*\[!\]/g));
    put(counts, 'in_progress', countOf(content, /\|\s*\[~\]/g));
    return { counts, enums: {} };
  },
};

/** Row 18: execution logs — entry headers, deviations, deferrals. */
const executionLogExtractor: ArtifactExtractor = {
  type: 'execution-log',
  match: (p) => /\/execution\.log\.md$/.test(p),
  extract: (content) => {
    const counts: Counts = {};
    put(counts, 'entries', countOf(content, /^## /gm));
    put(counts, 'deviations', countOf(content, /Deviation/gi));
    put(counts, 'deferred', countOf(content, /Deferred/gi));
    return { counts, enums: {} };
  },
};

/** Row 19: backpressure coverage — sensor status counts; certainty enum. */
const backpressureExtractor: ArtifactExtractor = {
  type: 'backpressure',
  match: (p) => /\/backpressure[^/]*\.md$/.test(p),
  extract: (content) => {
    const counts: Counts = {};
    put(counts, 'exists', countOf(content, /\bEXISTS\b/g));
    put(counts, 'buildable', countOf(content, /\bBUILDABLE\b/g));
    put(counts, 'absent', countOf(content, /\bABSENT\b/g));
    const enums: Enums = {};
    const certainty = enumOf(content, /\*\*Certainty\*\*:\s*([A-Za-z]+)/, CERTAINTY_VOCAB);
    if (certainty !== undefined) enums.certainty = certainty;
    return { counts, enums };
  },
};

/** Row 20: validations — findings by severity; verdict enum. */
const validationExtractor: ArtifactExtractor = {
  type: 'validation',
  match: (p) => /\/validations\/[^/]+\.md$/.test(p),
  extract: (content) => {
    const counts: Counts = {};
    put(counts, 'findings_critical', countOf(content, /\|\s*CRITICAL\s*\|/gi));
    put(counts, 'findings_high', countOf(content, /\|\s*HIGH\s*\|/gi));
    put(counts, 'findings_med', countOf(content, /\|\s*(?:MED|MEDIUM)\s*\|/gi));
    const enums: Enums = {};
    const verdict = enumOf(content, /\*\*Verdict\*\*:[^\n]*?([A-Z][A-Z ]+)/, VALIDATION_VOCAB);
    if (verdict !== undefined) enums.verdict = verdict;
    return { counts, enums };
  },
};

/** Row 21: ship reports — checks green/total, PR opened; PR-state enum. */
const shipReportExtractor: ArtifactExtractor = {
  type: 'ship-report',
  match: (p) => /\/ship-report\.md$/.test(p),
  extract: (content) => {
    const counts: Counts = {};
    const green = /all green \((\d+)\/(\d+)\)/i.exec(content);
    if (green !== null) {
      put(counts, 'checks_green', Number(green[1]));
      put(counts, 'checks_total', Number(green[2]));
    }
    put(counts, 'pr_opened', /\*\*PR\*\*:[^\n]*pull\/\d+/i.test(content) ? 1 : 0);
    const enums: Enums = {};
    const state = enumOf(content, /\*\*State\*\*:\s*([A-Za-z]+)/, PR_STATE_VOCAB);
    if (state !== undefined) enums.pr_state = state;
    return { counts, enums };
  },
};

/** Row 22: flight-plan rollup — the CURRENT shape of the-flow.json (complements flow_log replay). */
const flightPlanExtractor: ArtifactExtractor = {
  type: 'flight-plan',
  match: (p) => /\/the-flow\.json$/.test(p),
  extract: (content) => {
    const counts: Counts = {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { counts, enums: {} }; // malformed JSON → thin event, never a throw
    }
    const doc = (parsed ?? {}) as { nodes?: unknown; events?: unknown };
    const nodes = Array.isArray(doc.nodes) ? (doc.nodes as Array<Record<string, unknown>>) : [];
    let phases = 0;
    let workshops = 0;
    let chores = 0;
    let done = 0;
    let skipped = 0;
    let comments = 0;
    // Chore-scoped status rollup (workshop row 22: "chores done/skipped/todo").
    // A chore is "todo" when neither done nor skipped — the same unfinished-chore
    // predicate the flow itself uses (flow-mutations.ts listChores filter).
    let choresDone = 0;
    let choresSkipped = 0;
    let choresTodo = 0;
    for (const n of nodes) {
      const type = typeof n.type === 'string' ? n.type : '';
      const status = typeof n.status === 'string' ? n.status : '';
      if (type === 'phase') phases++;
      else if (type === 'workshop') workshops++;
      else if (type === 'chore') {
        chores++;
        if (status === 'done') choresDone++;
        else if (status === 'skipped') choresSkipped++;
        else choresTodo++;
      }
      if (status === 'done') done++;
      else if (status === 'skipped') skipped++;
      if (Array.isArray(n.comments)) comments += n.comments.length;
    }
    put(counts, 'nodes', nodes.length);
    put(counts, 'phases', phases);
    put(counts, 'workshops', workshops);
    put(counts, 'chores', chores);
    put(counts, 'chores_done', choresDone);
    put(counts, 'chores_skipped', choresSkipped);
    put(counts, 'chores_todo', choresTodo);
    put(counts, 'done', done);
    put(counts, 'skipped', skipped);
    put(counts, 'comments', comments);
    put(counts, 'events', Array.isArray(doc.events) ? doc.events.length : 0);
    return { counts, enums: {} };
  },
};

/**
 * Row 23 (plan 056): retro records — the drained observation ledger. Counts the
 * structured `entries[]` signal only: total observations, disposition mix, and
 * kind mix. The per-entry `disposition`/`kind` tokens are closed vocabularies
 * (schema 1.2 / workshop D2), so this stays counts-only — the description prose
 * and the `fp` fingerprint (workshop D5: high-cardinality) never travel.
 */
const OBSERVE_KIND_COUNT_KEY: Record<string, ArtifactCountKey> = {
  difficulty: 'kind_difficulty',
  'magic-wand': 'kind_magic_wand',
  gift: 'kind_gift',
  insight: 'kind_insight',
  coordination: 'kind_coordination',
  'improvement-suggestion': 'kind_improvement_suggestion',
  confusion: 'kind_confusion',
  win: 'kind_win',
};
const DISPOSITION_COUNT_KEY: Record<string, ArtifactCountKey> = {
  'fixed-now': 'disp_fixed_now',
  task: 'disp_task',
  plan: 'disp_plan',
  diffs: 'disp_diffs',
  command: 'disp_command',
  kept: 'disp_kept',
  declined: 'disp_declined',
  deferred: 'disp_deferred',
};

/** Tally a closed-vocab per-entry field (`kind:`/`disposition:`) into its count keys. */
function tallyEntryField(
  content: string,
  field: 'kind' | 'disposition',
  keyMap: Record<string, ArtifactCountKey>,
  counts: Counts,
): void {
  const re = new RegExp(`^\\s*${field}:\\s*([a-z-]+)`, 'gm');
  const tally: Partial<Record<ArtifactCountKey, number>> = {};
  for (const m of content.matchAll(re)) {
    const key = keyMap[m[1] ?? ''];
    if (key !== undefined) tally[key] = (tally[key] ?? 0) + 1;
  }
  for (const [k, n] of Object.entries(tally)) put(counts, k as ArtifactCountKey, n ?? 0);
}

const retroExtractor: ArtifactExtractor = {
  type: 'retro',
  match: (p) => /(?:^|\/)\.harness\/records\/retro\/.+\.md$/.test(p),
  extract: (content) => {
    const counts: Counts = {};
    // observations = structured entry blocks (`- id: …`), the durable signal.
    put(counts, 'observations', countOf(content, /^\s*-\s+id:/gm));
    tallyEntryField(content, 'kind', OBSERVE_KIND_COUNT_KEY, counts);
    tallyEntryField(content, 'disposition', DISPOSITION_COUNT_KEY, counts);
    return { counts, enums: {} };
  },
};

/**
 * The registry — path-first dispatch, FIRST match wins. Ordered most-specific
 * filename first so the broad `-plan.md` matcher never shadows a nested review /
 * validation / workshop file.
 */
export const ARTIFACT_EXTRACTORS: readonly ArtifactExtractor[] = [
  flightPlanExtractor,
  retroExtractor,
  reviewExtractor,
  validationExtractor,
  backpressureExtractor,
  shipReportExtractor,
  dossierExtractor,
  executionLogExtractor,
  tasksExtractor,
  workshopExtractor,
  planExtractor,
];

/** The first extractor whose `match` accepts the repo-relative path, or null. */
export function matchExtractor(repoRelPath: string): ArtifactExtractor | null {
  return ARTIFACT_EXTRACTORS.find((e) => e.match(repoRelPath)) ?? null;
}

/** Run an extractor DEFENSIVELY — any throw degrades to empty counts (AC-04). */
export function extractArtifact(
  ex: ArtifactExtractor,
  content: string,
): { counts: Counts; enums: Enums } {
  try {
    const r = ex.extract(content);
    return { counts: r.counts ?? {}, enums: r.enums ?? {} };
  } catch {
    return { counts: {}, enums: {} };
  }
}

// ── path resolution + the capture helper ─────────────────────────────────────

/** A logical path is already root-anchored: leading `/`, UNC `//`, or a drive root `C:/`. */
const ABSOLUTE_LOGICAL = /^([A-Za-z]:)?\//;

/**
 * Resolve a raw capture path against the repo root. Returns the repo-relative
 * POSIX path (for matching + the event `path`) and the absolute POSIX read path,
 * or `null` when the artifact resolves OUTSIDE the repo (skipped, never emitted —
 * mirrors the segment relativization + privacy rule).
 */
export function resolveArtifactPath(
  raw: string,
  repoRoot: string,
): { rel: string; read: string } | null {
  const root = posixNormalize(toPosix(repoRoot));
  const p = toPosix(raw);
  const abs = ABSOLUTE_LOGICAL.test(p) ? posixNormalize(p) : posixNormalize(posixJoin(root, p));
  if (!isWithin(root, abs)) return null;
  const rel = posixRelative(root, abs);
  return { rel: rel === '' ? '.' : rel, read: abs };
}

function lineCount(content: string): number {
  if (content.length === 0) return 0;
  let n = 1;
  for (let i = 0; i < content.length; i++) if (content.charCodeAt(i) === 10) n++;
  return n;
}

/**
 * The capture-window pass (plan 050 § Capture mechanic). For each path in the
 * window's `written ∪ edited` set (written first; deduped per path), match an
 * extractor, GUARD-READ the file (skip missing/binary/oversized/out-of-repo),
 * and emit one counts-only {@link ArtifactEvent} stamped at capture time `t`.
 *
 * Pure over the injected reader; never throws (the extractor is defensive and the
 * reader returns `null` on any read failure). Bounded to the changed set — at most
 * |changed files| reads per capture.
 */
export function artifactSemanticsEvents(
  reader: ArtifactContentReader,
  repoRoot: string,
  files: { written?: readonly string[]; edited?: readonly string[] } | null | undefined,
  t: string,
): Event[] {
  const out: Event[] = [];
  const seen = new Set<string>();
  const groups: Array<{ change: 'written' | 'edited'; paths: readonly string[] }> = [
    { change: 'written', paths: files?.written ?? [] },
    { change: 'edited', paths: files?.edited ?? [] },
  ];
  for (const { change, paths } of groups) {
    for (const raw of paths) {
      const resolved = resolveArtifactPath(raw, repoRoot);
      if (resolved === null) continue; // out-of-repo → skip (privacy)
      const { rel, read } = resolved;
      if (seen.has(rel)) continue; // one snapshot per artifact per window
      const ex = matchExtractor(rel);
      if (ex === null) continue; // unmatched changed file → no event
      seen.add(rel);
      const content = reader.readText(read);
      if (content === null) continue; // missing / unreadable → skip (AC-04)
      if (content.length > MAX_ARTIFACT_BYTES) continue; // oversized → skip
      if (content.includes('\u0000')) continue; // binary → skip
      const { counts, enums } = extractArtifact(ex, content);
      const ev: ArtifactEvent = {
        t,
        t_precision: 'anchored',
        kind: 'artifact',
        path: rel,
        artifact_type: ex.type,
        change,
        counts,
        enums,
        size: { lines: lineCount(content), bytes: new TextEncoder().encode(content).length },
      };
      const planId = planIdFromPath(rel);
      if (planId !== null) ev.plan_id = planId;
      out.push(ev);
    }
  }
  return out;
}
