/**
 * `flow-eval` report writer (plan 041 Phase 2, T005).
 *
 * Renders a {@link ScoredReport} into the workshop §4 output contract and writes
 * BOTH `report.json` (machine verdict) and `report.md` (human rendering) to
 * `.harness/live-testing/<slug>/<run-id>/` via the OPTIONAL `ctx.fsWrite`
 * capability (feature-detected — an older core without it gets an honest error,
 * never a silent no-op; AC-07 / Finding 05).
 *
 * Deterministic: stable key order in the JSON, stable row order in the MD table,
 * so two runs over the same inputs diff cleanly. Node-free.
 */

import { appendRunRecord, buildRunRecord, type TelemetrySummary } from './ledger.js';
import { join, type JudgeProvenance } from './scenario.js';
import type { JudgedField, ResultRow, ScoredReport } from './scorer.js';

/**
 * The filesystem surface the report + ledger need. Adds `readText` to the
 * write-side subset because the append is a **read-then-write** (`fsWrite` has no
 * append) — `ctx.fs.readText` + `ctx.fsWrite.{writeText,mkdirp}` satisfy it.
 */
export interface ReportFsWrite {
  readText(path: string): string | null;
  writeText(path: string, contents: string): void;
  mkdirp(path: string): void;
}

/**
 * The extra, per-run facts the ledger record needs that the report itself does
 * not carry (the seed-tuple hashes + honest cost/telemetry provenance). When
 * present on {@link ReportInput}, `writeReport` also appends the run to the
 * scenario-level `ledger.jsonl` (task 2.2); when absent, only the report files
 * are written (a report-only unit path).
 */
export interface ReportLedgerInput {
  seed: {
    scenario_hash: string;
    prompt_hash: string;
    model_version?: string;
    orchestrator_id?: string;
  };
  telemetry_available: boolean;
  duration_s?: number | null;
  session_export?: string | null;
  telemetry_summary?: TelemetrySummary | null;
  provenance?: ReportProvenance;
}

/** The resolved subject recorded in the report (the matrix knob + the live session). */
export interface ReportSubject {
  harness: string;
  model: string;
  pij_session_id: string;
  effort?: string;
}

export interface ReportProvenance {
  judge: JudgeProvenance | null;
}

export interface ReportInput {
  scenario: string;
  run_id: string;
  subject: ReportSubject;
  base_ref: string;
  /** F-A: a visible worktree-drift warning (HEAD ≠ base_ref); rendered + persisted for re-render. */
  base_ref_warning?: string | null;
  started_at: string;
  finished_at: string;
  scored: ScoredReport;
  provenance?: ReportProvenance;
  /** When present, `writeReport` also appends the run to the scenario ledger (task 2.2). */
  ledger?: ReportLedgerInput;
}

export type ReportResult =
  | { ok: true; dir: string; files: { json: string; md: string }; ledger?: string }
  | { ok: false; error: string };

/** Verdict glyphs for the MD table — pass/fail/unknown. */
const GLYPH: Record<string, string> = { pass: '✓', fail: '✗', unknown: '?' };

/** Build the machine report object with a STABLE key order (workshop §4). */
export function buildReportJson(input: ReportInput): Record<string, unknown> {
  const { scored } = input;
  return {
    scenario: input.scenario,
    run_id: input.run_id,
    subject: {
      harness: input.subject.harness,
      model: input.subject.model,
      pij_session_id: input.subject.pij_session_id,
      ...(input.subject.effort !== undefined && { effort: input.subject.effort }),
    },
    base_ref: input.base_ref,
    ...(input.base_ref_warning ? { base_ref_warning: input.base_ref_warning } : {}),
    started_at: input.started_at,
    finished_at: input.finished_at,
    deterministic: {
      score: scored.deterministic.score,
      axis_scores: {
        process: scored.deterministic.axis_scores.process,
        capability: scored.deterministic.axis_scores.capability,
      },
      passed: scored.deterministic.passed,
      failed: scored.deterministic.failed,
      unknown: scored.deterministic.unknown,
      total: scored.deterministic.total,
      required_failed: scored.deterministic.required_failed,
      results: scored.deterministic.results.map((r: ResultRow) => ({
        id: r.id,
        type: r.type,
        source: r.source,
        axis: r.axis,
        status: r.status,
        required: r.required,
        weight: r.weight,
        ...(r.describe !== undefined && { describe: r.describe }),
      })),
    },
    judged: scored.judged.map((j: JudgedField) => ({
      id: j.id,
      ...(j.criterion !== undefined && { criterion: j.criterion }),
      field: j.field,
      prompt: j.prompt,
      ...(j.rubric !== undefined && { rubric: j.rubric }),
      ...(j.describe !== undefined && { describe: j.describe }),
      verdict: j.verdict,
      rationale: j.rationale,
      by: j.by,
    })),
    provenance: {
      judge: input.provenance?.judge ?? null,
    },
    alarms: scored.alarms,
    verdict: scored.verdict,
  };
}

function mdCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** Render the human-readable `report.md` (deterministic table + judged + verdict). */
export function buildReportMd(input: ReportInput): string {
  const { scored } = input;
  const d = scored.deterministic;
  const lines: string[] = [];
  lines.push(`# flow-eval report — ${input.scenario}`);
  lines.push('');
  lines.push(`- **Verdict**: ${scored.verdict}`);
  lines.push(`- **Score**: ${d.score.toFixed(2)} (${d.passed} pass / ${d.failed} fail / ${d.unknown} unknown of ${d.total})`);
  // F-B: an axis with NO scorable (pass|fail) lane is UNMEASURED — render `unmeasured`,
  // never `0.00` (a `0.00` is legal ONLY for a measured axis that scored zero). The
  // measured-ness test mirrors the ledger's `scorable()` (buildRunRecord), keeping the
  // report header honest with the RunRecord's null-axis semantics.
  const axisMeasured = (axis: 'process' | 'capability'): boolean =>
    d.results.some((r) => r.axis === axis && r.status !== 'unknown');
  const axisCell = (axis: 'process' | 'capability'): string =>
    axisMeasured(axis) ? d.axis_scores[axis].toFixed(2) : 'unmeasured';
  lines.push(`- **Axis scores**: process ${axisCell('process')} · capability ${axisCell('capability')}`);
  lines.push(`- **Required (capability/safety) failed**: ${d.required_failed}`);
  if (scored.alarms.length > 0) {
    lines.push(`- **Alarms**: ${scored.alarms.map(mdCell).join(', ')}`);
  }
  lines.push(`- **Subject**: ${input.subject.harness} · ${input.subject.model}${input.subject.effort ? ` · ${input.subject.effort}` : ''} · session \`${input.subject.pij_session_id}\``);
  lines.push(`- **Base ref**: ${input.base_ref}`);
  if (input.base_ref_warning) {
    lines.push(`- **⚠ base_ref warning**: ${mdCell(input.base_ref_warning)}`);
  }
  lines.push(`- **Run**: ${input.run_id} (${input.started_at} → ${input.finished_at})`);
  if (input.provenance?.judge) {
    const j = input.provenance.judge;
    lines.push(`- **Judge**: ${j.model}@${j.model_version} (${j.judge_family}; subject family ${j.subject_family})`);
    if (j.warnings.length > 0) lines.push(`- **Judge warnings**: ${j.warnings.map(mdCell).join(', ')}`);
  }
  lines.push('');
  lines.push('## Deterministic results');
  lines.push('');
  lines.push('| | ID | Type | Source | Req | W | Description | Axis |');
  lines.push('|---|----|------|--------|-----|---|-------------|------|');
  for (const r of d.results) {
    lines.push(
      `| ${GLYPH[r.status] ?? '?'} | ${mdCell(r.id)} | ${mdCell(r.type)} | ${mdCell(r.source)} | ${r.required ? '✓' : ''} | ${r.weight} | ${mdCell(r.describe ?? '')} | ${mdCell(r.axis)} |`,
    );
  }
  lines.push('');
  lines.push('## Judged (inferential — filled by the orchestrator)');
  lines.push('');
  if (scored.judged.length === 0) {
    lines.push('_None._');
  } else {
    for (const j of scored.judged) {
      lines.push(`- **${mdCell(j.field)}** (${mdCell(j.id)}): ${mdCell(j.describe ?? j.prompt)}`);
      if (j.criterion !== undefined) lines.push(`  - criterion: ${mdCell(j.criterion)}`);
      lines.push(`  - verdict: ${j.verdict ?? '_pending_'} · by: ${j.by ?? '_pending_'}`);
      if (j.rationale) lines.push(`  - rationale: ${mdCell(j.rationale)}`);
    }
  }
  if (input.provenance?.judge) {
    const j = input.provenance.judge;
    lines.push('');
    lines.push('## Judge provenance');
    lines.push('');
    lines.push(`- model: ${mdCell(j.model)} @ ${mdCell(j.model_version)}`);
    lines.push(`- different-family-than-subject: ${j.different_family_than_subject ? 'yes' : 'no'} (asserted: ${j.different_family_than_subject_asserted ? 'yes' : 'no'})`);
    lines.push(`- artifact-only: ${j.artifact_only ? 'yes' : 'no'} · identity-stripped: ${j.identity_stripped ? 'yes' : 'no'}`);
    lines.push(`- temperature: ${j.temperature} · version-pinned: ${j.version_pinned ? 'yes' : 'no'}`);
    lines.push(`- anti-verbosity: ${mdCell(j.anti_verbosity)}`);
    lines.push(`- canonical good-flow anchor: present, content deferred (${j.prompt_scaffold.calibration_set})`);
  }
  lines.push('');
  return lines.join('\n');
}

/** F-C: the re-render result — the regenerated markdown + judged fill counts. */
export type RenderFromJsonResult =
  | { ok: true; md: string; judged_total: number; judged_filled: number }
  | { ok: false; error: string };

/**
 * F-C: regenerate `report.md` from an already-written `report.json` object —
 * including any judged verdicts/rationale/by the orchestrator filled in AFTER the
 * original `score` render. Pure + idempotent: re-rendering the same JSON yields
 * byte-identical markdown. Reconstructs the {@link ReportInput} shape the renderer
 * needs from the persisted JSON and delegates to {@link buildReportMd} — the null
 * axis + drift-warning honesty (F-A/F-B) come along for free. Never throws.
 */
export function renderMarkdownFromReportJson(parsed: unknown): RenderFromJsonResult {
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: 'report.json is not an object' };
  }
  const j = parsed as Record<string, unknown>;
  const det = j.deterministic as Record<string, unknown> | undefined;
  if (typeof det !== 'object' || det === null || !Array.isArray(det.results)) {
    return { ok: false, error: 'report.json is missing a deterministic.results block' };
  }
  const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const axis = (det.axis_scores as Record<string, unknown> | undefined) ?? {};
  const judged = (Array.isArray(j.judged) ? j.judged : []) as JudgedField[];
  const provenance = j.provenance as { judge?: unknown } | undefined;

  const scored: ScoredReport = {
    deterministic: {
      score: num(det.score),
      axis_scores: { process: num(axis.process), capability: num(axis.capability) },
      passed: num(det.passed),
      failed: num(det.failed),
      unknown: num(det.unknown),
      total: num(det.total, det.results.length),
      required_failed: num(det.required_failed),
      results: det.results as ResultRow[],
    },
    judged,
    alarms: (Array.isArray(j.alarms) ? j.alarms : []) as string[],
    verdict: j.verdict as ScoredReport['verdict'],
  };

  const input: ReportInput = {
    scenario: typeof j.scenario === 'string' ? j.scenario : '',
    run_id: typeof j.run_id === 'string' ? j.run_id : '',
    subject: j.subject as ReportSubject,
    base_ref: typeof j.base_ref === 'string' ? j.base_ref : '',
    base_ref_warning: typeof j.base_ref_warning === 'string' ? j.base_ref_warning : null,
    started_at: typeof j.started_at === 'string' ? j.started_at : '',
    finished_at: typeof j.finished_at === 'string' ? j.finished_at : '',
    scored,
    provenance: { judge: (provenance?.judge ?? null) as ReportProvenance['judge'] },
  };

  const judged_filled = judged.filter((x) => x != null && x.verdict !== null && x.verdict !== undefined).length;
  return { ok: true, md: buildReportMd(input), judged_total: judged.length, judged_filled };
}

/**
 * Write `report.json` + `report.md` under `.harness/live-testing/<slug>/<run-id>/`.
 * Feature-detects `fsWrite`: when absent, returns an honest error (the verb maps
 * it onto an `error` envelope) instead of pretending to write.
 */
export function writeReport(
  input: ReportInput,
  cwd: string,
  fsWrite: ReportFsWrite | undefined,
): ReportResult {
  if (!fsWrite) {
    return {
      ok: false,
      error:
        'this core build does not provide ctx.fsWrite — cannot write the report; upgrade the engineering-harness core',
    };
  }
  const dir = join(cwd, '.harness', 'live-testing', input.scenario, input.run_id);
  const jsonPath = join(dir, 'report.json');
  const mdPath = join(dir, 'report.md');
  try {
    fsWrite.mkdirp(dir);
    fsWrite.writeText(jsonPath, `${JSON.stringify(buildReportJson(input), null, 2)}\n`);
    fsWrite.writeText(mdPath, buildReportMd(input));
    // Append ONE line to the scenario-level ledger (task 2.2) — only when the
    // per-run ledger facts are supplied (the real `score` path always supplies
    // them; a report-only unit path may not). A ledger failure is surfaced as a
    // report failure, never silently swallowed.
    let ledgerOut: string | undefined;
    if (input.ledger) {
      const record = buildRunRecord({
        scenario: input.scenario,
        run_id: input.run_id,
        ts: input.finished_at,
        subject: {
          model: input.subject.model,
          harness: input.subject.harness,
          ...(input.subject.effort !== undefined && { effort: input.subject.effort }),
        },
        base_ref: input.base_ref,
        scored: input.scored,
        seed: input.ledger.seed,
        telemetry_available: input.ledger.telemetry_available,
        duration_s: input.ledger.duration_s ?? null,
        session_export: input.ledger.session_export ?? null,
        telemetry_summary: input.ledger.telemetry_summary ?? null,
        provenance: input.ledger.provenance ?? input.provenance,
      });
      const appended = appendRunRecord(record, cwd, fsWrite);
      if (!appended.ok) return { ok: false, error: appended.error };
      ledgerOut = appended.path;
    }
    return {
      ok: true,
      dir,
      files: { json: jsonPath, md: mdPath },
      ...(ledgerOut !== undefined && { ledger: ledgerOut }),
    };
  } catch (err) {
    return { ok: false, error: `failed to write report: ${err instanceof Error ? err.message : String(err)}` };
  }
}
