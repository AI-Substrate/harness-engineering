/**
 * `flow-eval` run ledger (plan 046 Phase 2, tasks 2.1–2.2; workshop 004).
 *
 * The durable, append-only memory of every scored run. Each `flow-eval score`
 * appends ONE {@link RunRecord} line to the **scenario-level** ledger
 * (`.harness/live-testing/<slug>/ledger.jsonl`) — never the per-run subdir — so
 * drift is readable over time and two models are comparable (workshop 004).
 *
 * Design (workshop 004 Decision Space):
 *  - **JSONL append-only** — one record per line; prior lines are byte-stable
 *    (AC-05). `ReportFsWrite` has no append, so the writer does a **read-then-
 *    write**: read the whole file, concatenate `record + "\n"`, write it back.
 *  - **Seed = a reproduction TUPLE**, not a single RNG int (temp-0 ≠ deterministic).
 *    `scenario_hash` + `base_ref` are the comparison key `--compare` groups on.
 *  - **Aggregates at READ** — the ledger stores raw per-run facts; `pass^k` / CIs
 *    / flips are derived by the reader ({@link ledger-view}).
 *  - **Honest absence** — `session_export` / `telemetry_summary` are `null` when
 *    there is no export; a cost field is NEVER zero-filled (a missing summary is
 *    counted + excluded, never counted as zero — 2.5).
 *
 * Node-free: pure string ops only (the content hash is a pure-JS FNV-1a, not a
 * `node:crypto` shell-out — the extension imports ONLY the published contract).
 */

import { join, type JudgeProvenance } from './scenario.js';
import type { ScoredReport } from './scorer.js';

/** The honest reproduction key — NOT a single RNG int (temp-0 ≠ deterministic). */
export interface SeedTuple {
  model: string;
  model_version?: string;
  harness: string;
  effort?: string;
  /** Git ref/sha the worktree was cut from — half of the `--compare` match key. */
  base_ref: string;
  /** Hash of scenario.json + assertions.json — the other half; detects rubric drift. */
  scenario_hash: string;
  /** Hash of the blind subject packet — detects packet drift. */
  prompt_hash: string;
  /** pij id of the driver, for the orchestrator-confound question (003 Q1). */
  orchestrator_id?: string;
}

/** One deterministic lane's outcome, aligned by `assertion_id` across runs (workshop 004). */
export interface LaneOutcome {
  lane: string;
  assertion_id: string;
  verdict: 'pass' | 'fail' | 'unknown';
  required: boolean;
  axis: 'capability' | 'process' | 'safety';
}

/**
 * Denormalized, counts-only cost summary copied from the 047 session export's
 * `totals` at score time (FX002). Present ONLY when a real export exists — every
 * field is a genuine measurement, NEVER zero-filled (an absent export ⇒ the whole
 * summary is `null`, so a reader counts + excludes the run rather than reading a
 * fabricated zero; 2.5).
 */
export interface TelemetrySummary {
  /** ACTIVE (idle-excluded) time — never wall-span (FX002-5). */
  active_time_s: number;
  /** Non-cache `{ input, output }` (FX002). */
  tokens: { input: number; output: number };
  /** Context re-reads — shown, NEVER ranked (cross-harness cache economics differ). */
  cache: { read: number; create: number };
  turns: number;
}

/** The current on-disk record shape. Bump {@link RUN_RECORD_SCHEMA_VERSION} on a breaking change. */
export const RUN_RECORD_SCHEMA_VERSION = 1 as const;

export interface RunRecord {
  schema_version: typeof RUN_RECORD_SCHEMA_VERSION;
  run_id: string;
  /** ISO-8601, UTC. */
  ts: string;
  scenario: string;
  subject: { model: string; harness: string; effort?: string };
  base_ref: string;
  seed_tuple: SeedTuple;
  lanes: LaneOutcome[];
  /** Two-axis pass-rates; `null` when an axis had NO scorable (pass|fail) lane. */
  axis_scores: { capability: number | null; process: number | null };
  verdict: 'PASS' | 'PARTIAL' | 'FAIL';
  /** `false` ⇒ process lanes are expected `unknown` (NOT subject failure — the F8 case). */
  telemetry_available: boolean;
  /** Wall-span between first + last telemetry event (F13); `null` when < 2 timestamped events. */
  duration_s: number | null;
  /** A path/ref to the 047 session export, or `null` (additive, forward-compatible). */
  session_export: string | null;
  /** Denormalized cost totals from the export, or `null` honestly when absent (never zero-filled). */
  telemetry_summary: TelemetrySummary | null;
  /** Fraction `unknown` per axis — a dropped sensor stays visible, not masked (003 Q3). */
  unknown_rate_by_axis?: { capability: number; process: number };
  /** Additive provenance for non-deterministic surfaces; absent on legacy records. */
  provenance?: { judge: JudgeProvenance | null; resolutions?: Record<string, string> };
}

/**
 * The JSON Schema a downstream consumer (the 047 dashboard) reads records against
 * — the published contract artifact (workshop 004 §Schema Definitions). Kept in
 * lock-step with {@link validateRunRecord}, which derives its required-key set
 * from `RUN_RECORD_SCHEMA.required`.
 */
export const RUN_RECORD_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://ai-substrate.dev/flow-eval/run-record.schema.json',
  title: 'flow-eval RunRecord',
  type: 'object',
  additionalProperties: true,
  required: [
    'schema_version',
    'run_id',
    'ts',
    'scenario',
    'subject',
    'base_ref',
    'seed_tuple',
    'lanes',
    'axis_scores',
    'verdict',
    'telemetry_available',
    'duration_s',
    'session_export',
    'telemetry_summary',
  ],
  properties: {
    schema_version: { const: RUN_RECORD_SCHEMA_VERSION },
    run_id: { type: 'string', minLength: 1 },
    ts: { type: 'string', format: 'date-time' },
    scenario: { type: 'string', minLength: 1 },
    subject: {
      type: 'object',
      required: ['model', 'harness'],
      properties: {
        model: { type: 'string' },
        harness: { type: 'string' },
        effort: { type: 'string' },
      },
    },
    base_ref: { type: 'string' },
    seed_tuple: {
      type: 'object',
      required: ['model', 'harness', 'base_ref', 'scenario_hash', 'prompt_hash'],
      properties: {
        model: { type: 'string' },
        model_version: { type: 'string' },
        harness: { type: 'string' },
        effort: { type: 'string' },
        base_ref: { type: 'string' },
        scenario_hash: { type: 'string' },
        prompt_hash: { type: 'string' },
        orchestrator_id: { type: 'string' },
      },
    },
    lanes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['lane', 'assertion_id', 'verdict', 'required', 'axis'],
        properties: {
          lane: { type: 'string' },
          assertion_id: { type: 'string' },
          verdict: { enum: ['pass', 'fail', 'unknown'] },
          required: { type: 'boolean' },
          axis: { enum: ['capability', 'process', 'safety'] },
        },
      },
    },
    axis_scores: {
      type: 'object',
      required: ['capability', 'process'],
      properties: {
        capability: { type: ['number', 'null'], minimum: 0, maximum: 1 },
        process: { type: ['number', 'null'], minimum: 0, maximum: 1 },
      },
    },
    verdict: { enum: ['PASS', 'PARTIAL', 'FAIL'] },
    telemetry_available: { type: 'boolean' },
    duration_s: { type: ['number', 'null'], minimum: 0 },
    session_export: { type: ['string', 'null'] },
    telemetry_summary: {
      type: ['object', 'null'],
      required: ['active_time_s', 'tokens', 'cache', 'turns'],
      properties: {
        active_time_s: { type: 'number', minimum: 0 },
        tokens: {
          type: 'object',
          required: ['input', 'output'],
          properties: { input: { type: 'number' }, output: { type: 'number' } },
        },
        cache: {
          type: 'object',
          required: ['read', 'create'],
          properties: { read: { type: 'number' }, create: { type: 'number' } },
        },
        turns: { type: 'number', minimum: 0 },
      },
    },
    unknown_rate_by_axis: {
      type: 'object',
      properties: {
        capability: { type: 'number', minimum: 0, maximum: 1 },
        process: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    provenance: {
      type: 'object',
      properties: {
        judge: { type: ['object', 'null'] },
        resolutions: { type: 'object' },
      },
    },
  },
} as const;

// ---- content hashing (pure-JS FNV-1a; node-free) ---------------------------

/** FNV-1a over the string's char codes → an unsigned 32-bit word. */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * A stable, node-free content digest for the seed tuple's `scenario_hash` /
 * `prompt_hash`. Two independent FNV-1a passes (forward + salted) are combined
 * into a 16-hex-char digest — not cryptographic, but a deterministic drift key:
 * identical bytes ⇒ identical hash; a one-byte edit ⇒ a different hash, which is
 * all `--compare`'s mismatch refusal needs.
 */
export function contentHash(...parts: string[]): string {
  const joined = parts.join('\u0000');
  const a = fnv1a32(joined);
  const b = fnv1a32(`\u0001${joined}`);
  return `fnv1a:${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

// ---- record building -------------------------------------------------------

/** Map the scorer's `RunVerdict` onto the ledger's three-state verdict. */
function toRecordVerdict(v: ScoredReport['verdict']): RunRecord['verdict'] {
  if (v === 'FAIL') return 'FAIL';
  if (v === 'PASS') return 'PASS';
  return 'PARTIAL'; // PASS_WITH_NOTES
}

export interface BuildRunRecordInput {
  scenario: string;
  run_id: string;
  ts: string;
  subject: { model: string; harness: string; effort?: string };
  base_ref: string;
  scored: ScoredReport;
  /** The seed-tuple pieces the scorer doesn't know (hashes + optional provenance). */
  seed: {
    scenario_hash: string;
    prompt_hash: string;
    model_version?: string;
    orchestrator_id?: string;
  };
  telemetry_available: boolean;
  /** F13 wall-span in seconds; `null` when unknown (never fabricated). */
  duration_s?: number | null;
  /** 047 export ref; `null` when no export was produced. */
  session_export?: string | null;
  /** Denormalized cost totals; `null` honestly when absent (never zero-filled). */
  telemetry_summary?: TelemetrySummary | null;
  provenance?: { judge: JudgeProvenance | null; resolutions?: Record<string, string> };
}

/**
 * Fold a {@link ScoredReport} + its seed pieces into a durable {@link RunRecord}.
 * Pure: the same inputs always produce the same record (stable key order for a
 * byte-stable JSONL line). `axis_scores` is `null` on an axis with NO scorable
 * (pass|fail) lane — an honest "not measured", never a misleading `0`.
 */
export function buildRunRecord(input: BuildRunRecordInput): RunRecord {
  const results = input.scored.deterministic.results;

  const lanes: LaneOutcome[] = results.map((r) => ({
    lane: r.type,
    assertion_id: r.id,
    verdict: r.status,
    required: r.required,
    axis: r.axis,
  }));

  const scorable = (axis: 'capability' | 'process'): boolean =>
    results.some((r) => r.axis === axis && r.status !== 'unknown');
  const rateOn = (axis: 'capability' | 'process'): number => {
    const on = results.filter((r) => r.axis === axis);
    if (on.length === 0) return 0;
    return on.filter((r) => r.status === 'unknown').length / on.length;
  };

  const seed: SeedTuple = {
    model: input.subject.model,
    ...(input.seed.model_version !== undefined && { model_version: input.seed.model_version }),
    harness: input.subject.harness,
    ...(input.subject.effort !== undefined && { effort: input.subject.effort }),
    base_ref: input.base_ref,
    scenario_hash: input.seed.scenario_hash,
    prompt_hash: input.seed.prompt_hash,
    ...(input.seed.orchestrator_id !== undefined && { orchestrator_id: input.seed.orchestrator_id }),
  };

  return {
    schema_version: RUN_RECORD_SCHEMA_VERSION,
    run_id: input.run_id,
    ts: input.ts,
    scenario: input.scenario,
    subject: {
      model: input.subject.model,
      harness: input.subject.harness,
      ...(input.subject.effort !== undefined && { effort: input.subject.effort }),
    },
    base_ref: input.base_ref,
    seed_tuple: seed,
    lanes,
    axis_scores: {
      capability: scorable('capability') ? input.scored.deterministic.axis_scores.capability : null,
      process: scorable('process') ? input.scored.deterministic.axis_scores.process : null,
    },
    verdict: toRecordVerdict(input.scored.verdict),
    telemetry_available: input.telemetry_available,
    duration_s: input.duration_s ?? null,
    session_export: input.session_export ?? null,
    telemetry_summary: input.telemetry_summary ?? null,
    unknown_rate_by_axis: { capability: rateOn('capability'), process: rateOn('process') },
    ...(input.provenance !== undefined && {
      provenance: {
        judge: input.provenance.judge ?? null,
        ...(input.provenance.resolutions && Object.keys(input.provenance.resolutions).length > 0
          ? { resolutions: input.provenance.resolutions }
          : {}),
      },
    }),
  };
}

/** Serialize a record to its single, newline-terminated JSONL line. */
export function runRecordLine(record: RunRecord): string {
  return `${JSON.stringify(record)}\n`;
}

// ---- ledger annotations (4.6 SUGG-004: supersede without mutating history) --

/**
 * A ledger ANNOTATION — a non-RunRecord line that annotates the append-only log
 * WITHOUT rewriting any prior record (byte-stability is sacred; AC-05). It is
 * discriminated from a {@link RunRecord} purely by its `kind` field (RunRecords
 * never carry `kind`), so {@link validateRunRecord} stays strict about real records
 * and readers consume/skip annotations correctly.
 *
 * The only kind today is `supersede`: a corrected re-score marks the stale record
 * superseded, so `ledger` can flag it and `--compare` can exclude it — the bogus
 * line still stands (append-only), it is just no longer counted.
 */
export const LEDGER_ANNOTATION_KINDS = ['supersede'] as const;
export type LedgerAnnotationKind = (typeof LEDGER_ANNOTATION_KINDS)[number];

export interface SupersedeAnnotation {
  kind: 'supersede';
  /** The run_id being superseded (the stale record). */
  run_id: string;
  /** The run_id that supersedes it (the corrected re-score). */
  superseded_by: string;
  /** ISO-8601, UTC — when the supersede was recorded. */
  ts: string;
}

export type LedgerAnnotation = SupersedeAnnotation;

/** Discriminate an annotation line from a RunRecord (RunRecords carry no `kind`). */
export function isAnnotationValue(v: unknown): v is { kind: unknown } {
  return typeof v === 'object' && v !== null && 'kind' in v;
}

/**
 * Validate a {@link LedgerAnnotation} — its OWN guard (kept separate from
 * {@link validateRunRecord} so a real RunRecord is never mistaken for an annotation
 * and vice-versa). Returns a list of problems (empty ⇒ valid).
 */
export function validateAnnotation(v: unknown): string[] {
  const problems: string[] = [];
  if (typeof v !== 'object' || v === null) return ['annotation is not an object'];
  const a = v as Record<string, unknown>;
  if (a.kind !== 'supersede') {
    problems.push(`unknown annotation kind: ${String(a.kind)}`);
    return problems;
  }
  if (typeof a.run_id !== 'string' || a.run_id.length === 0) problems.push('supersede.run_id must be a non-empty string');
  if (typeof a.superseded_by !== 'string' || a.superseded_by.length === 0) {
    problems.push('supersede.superseded_by must be a non-empty string');
  }
  if (typeof a.ts !== 'string' || a.ts.length === 0) problems.push('supersede.ts must be a non-empty string');
  return problems;
}

/** Build a supersede annotation (pure). */
export function buildSupersedeAnnotation(input: {
  run_id: string;
  superseded_by: string;
  ts: string;
}): SupersedeAnnotation {
  return { kind: 'supersede', run_id: input.run_id, superseded_by: input.superseded_by, ts: input.ts };
}

/** Serialize an annotation to its single, newline-terminated JSONL line. */
export function annotationLine(annotation: LedgerAnnotation): string {
  return `${JSON.stringify(annotation)}\n`;
}

/** The set of run_ids marked superseded by supersede annotations (the stale runs). */
export function supersededRunIds(annotations: readonly LedgerAnnotation[]): Set<string> {
  const set = new Set<string>();
  for (const a of annotations) if (a.kind === 'supersede') set.add(a.run_id);
  return set;
}

// ---- validation (schema-derived; no ajv in this repo) ----------------------

/**
 * A compact validator over {@link RUN_RECORD_SCHEMA} — returns a list of problems
 * (empty ⇒ valid). Derives its required-key set from the schema's `required`
 * array so the two can never drift; enough to gate the reader + prove round-trip
 * validity (the repo validates schemas by construction, not ajv).
 */
export function validateRunRecord(value: unknown): string[] {
  const problems: string[] = [];
  if (typeof value !== 'object' || value === null) return ['record is not an object'];
  const rec = value as Record<string, unknown>;

  for (const key of RUN_RECORD_SCHEMA.required) {
    if (!(key in rec)) problems.push(`missing required key: ${key}`);
  }
  if (rec.schema_version !== RUN_RECORD_SCHEMA_VERSION) {
    problems.push(`schema_version must be ${RUN_RECORD_SCHEMA_VERSION} (got ${String(rec.schema_version)})`);
  }
  if (typeof rec.run_id !== 'string' || rec.run_id.length === 0) problems.push('run_id must be a non-empty string');
  if (!['PASS', 'PARTIAL', 'FAIL'].includes(rec.verdict as string)) {
    problems.push(`verdict must be PASS|PARTIAL|FAIL (got ${String(rec.verdict)})`);
  }
  if (typeof rec.telemetry_available !== 'boolean') problems.push('telemetry_available must be a boolean');
  if (!(rec.session_export === null || typeof rec.session_export === 'string')) {
    problems.push('session_export must be a string or null');
  }
  if (!(rec.duration_s === null || typeof rec.duration_s === 'number')) {
    problems.push('duration_s must be a number or null');
  }
  const ts = rec.telemetry_summary;
  if (!(ts === null || (typeof ts === 'object' && ts !== null))) {
    problems.push('telemetry_summary must be an object or null');
  }
  const axis = rec.axis_scores as Record<string, unknown> | undefined;
  if (typeof axis !== 'object' || axis === null) {
    problems.push('axis_scores must be an object');
  } else {
    for (const k of ['capability', 'process'] as const) {
      const v = axis[k];
      if (!(v === null || typeof v === 'number')) problems.push(`axis_scores.${k} must be a number or null`);
    }
  }
  if (!Array.isArray(rec.lanes)) problems.push('lanes must be an array');
  return problems;
}

// ---- append + read (the JSONL storage seam) --------------------------------

/** The scenario-level ledger path: the parent, NOT the per-run subdir (task 2.2). */
export function ledgerPath(cwd: string, scenario: string): string {
  return join(cwd, '.harness', 'live-testing', scenario, 'ledger.jsonl');
}

/** The read-then-write surface the append needs (`ReportFsWrite` has no append). */
export interface LedgerIo {
  readText(path: string): string | null;
  writeText(path: string, contents: string): void;
  mkdirp(path: string): void;
}

export type AppendResult = { ok: true; path: string } | { ok: false; error: string };

/**
 * Append ONE record line to the scenario-level ledger. Read-then-write: read the
 * existing file (or `''` when absent), concatenate `record + "\n"`, write it back
 * — prior lines are byte-stable (AC-05). Never throws (maps to an error result).
 */
export function appendRunRecord(record: RunRecord, cwd: string, io: LedgerIo): AppendResult {
  const path = ledgerPath(cwd, record.scenario);
  try {
    io.mkdirp(join(cwd, '.harness', 'live-testing', record.scenario));
    const prior = io.readText(path) ?? '';
    // A malformed prior file missing its trailing newline still gets one, so lines never fuse.
    const sep = prior.length > 0 && !prior.endsWith('\n') ? '\n' : '';
    io.writeText(path, `${prior}${sep}${runRecordLine(record)}`);
    return { ok: true, path };
  } catch (err) {
    return { ok: false, error: `failed to append to ledger: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Append ONE annotation line (e.g. `supersede`) to the scenario ledger — the SAME
 * byte-stable read-then-write as {@link appendRunRecord}: prior lines are never
 * rewritten, only a new line is added (AC-05). Never throws.
 */
export function appendAnnotation(
  annotation: LedgerAnnotation,
  cwd: string,
  scenario: string,
  io: LedgerIo,
): AppendResult {
  const path = ledgerPath(cwd, scenario);
  try {
    io.mkdirp(join(cwd, '.harness', 'live-testing', scenario));
    const prior = io.readText(path) ?? '';
    const sep = prior.length > 0 && !prior.endsWith('\n') ? '\n' : '';
    io.writeText(path, `${prior}${sep}${annotationLine(annotation)}`);
    return { ok: true, path };
  } catch (err) {
    return { ok: false, error: `failed to append annotation to ledger: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export interface ReadLedgerResult {
  records: RunRecord[];
  /** One entry per line that failed to parse / validate — surfaced, never silently dropped. */
  skipped: Array<{ line: number; reason: string }>;
  /** Annotation lines (e.g. `supersede`), parsed distinctly from RunRecords (4.6 SUGG-004). */
  annotations: LedgerAnnotation[];
}

/**
 * Read + parse the scenario ledger into {@link RunRecord}s in file (ts) order. A
 * blank line is ignored; a corrupt or schema-invalid line is SKIPPED with a
 * reason (a partial last line on crash is one dropped record, never a read
 * failure). A future `schema_version` is surfaced as a skip, not mis-parsed.
 */
export function readLedger(cwd: string, scenario: string, fs: { readText(path: string): string | null }): ReadLedgerResult {
  const raw = fs.readText(ledgerPath(cwd, scenario));
  const records: RunRecord[] = [];
  const skipped: Array<{ line: number; reason: string }> = [];
  const annotations: LedgerAnnotation[] = [];
  if (raw === null) return { records, skipped, annotations };
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      skipped.push({ line: i + 1, reason: 'invalid JSON' });
      continue;
    }
    // An annotation line (carries `kind`) is parsed by its OWN guard, so a real
    // RunRecord validation is never applied to it (and vice-versa).
    if (isAnnotationValue(parsed)) {
      const problems = validateAnnotation(parsed);
      if (problems.length > 0) {
        skipped.push({ line: i + 1, reason: problems.join('; ') });
        continue;
      }
      annotations.push(parsed as LedgerAnnotation);
      continue;
    }
    const problems = validateRunRecord(parsed);
    if (problems.length > 0) {
      skipped.push({ line: i + 1, reason: problems.join('; ') });
      continue;
    }
    records.push(parsed as RunRecord);
  }
  return { records, skipped, annotations };
}
