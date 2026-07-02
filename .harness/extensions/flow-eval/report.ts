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
  lines.push(`- **Axis scores**: process ${d.axis_scores.process.toFixed(2)} · capability ${d.axis_scores.capability.toFixed(2)}`);
  lines.push(`- **Required (capability/safety) failed**: ${d.required_failed}`);
  if (scored.alarms.length > 0) {
    lines.push(`- **Alarms**: ${scored.alarms.map(mdCell).join(', ')}`);
  }
  lines.push(`- **Subject**: ${input.subject.harness} · ${input.subject.model}${input.subject.effort ? ` · ${input.subject.effort}` : ''} · session \`${input.subject.pij_session_id}\``);
  lines.push(`- **Base ref**: ${input.base_ref}`);
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
