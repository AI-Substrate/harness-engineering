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

import { join } from './scenario.js';
import type { JudgedField, ResultRow, ScoredReport } from './scorer.js';

/** The write-side surface the report needs (a subset of `VerbContext.fsWrite`). */
export interface ReportFsWrite {
  writeText(path: string, contents: string): void;
  mkdirp(path: string): void;
}

/** The resolved subject recorded in the report (the matrix knob + the live session). */
export interface ReportSubject {
  harness: string;
  model: string;
  pij_session_id: string;
  effort?: string;
}

export interface ReportInput {
  scenario: string;
  run_id: string;
  subject: ReportSubject;
  base_ref: string;
  started_at: string;
  finished_at: string;
  scored: ScoredReport;
}

export type ReportResult =
  | { ok: true; dir: string; files: { json: string; md: string } }
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
      passed: scored.deterministic.passed,
      failed: scored.deterministic.failed,
      unknown: scored.deterministic.unknown,
      total: scored.deterministic.total,
      required_failed: scored.deterministic.required_failed,
      results: scored.deterministic.results.map((r: ResultRow) => ({
        id: r.id,
        type: r.type,
        source: r.source,
        status: r.status,
        required: r.required,
        weight: r.weight,
        ...(r.describe !== undefined && { describe: r.describe }),
      })),
    },
    judged: scored.judged.map((j: JudgedField) => ({
      id: j.id,
      field: j.field,
      prompt: j.prompt,
      ...(j.rubric !== undefined && { rubric: j.rubric }),
      ...(j.describe !== undefined && { describe: j.describe }),
      verdict: j.verdict,
      rationale: j.rationale,
      by: j.by,
    })),
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
  lines.push(`- **Required failed**: ${d.required_failed}`);
  lines.push(`- **Subject**: ${input.subject.harness} · ${input.subject.model}${input.subject.effort ? ` · ${input.subject.effort}` : ''} · session \`${input.subject.pij_session_id}\``);
  lines.push(`- **Base ref**: ${input.base_ref}`);
  lines.push(`- **Run**: ${input.run_id} (${input.started_at} → ${input.finished_at})`);
  lines.push('');
  lines.push('## Deterministic results');
  lines.push('');
  lines.push('| | ID | Type | Source | Req | W | Description |');
  lines.push('|---|----|------|--------|-----|---|-------------|');
  for (const r of d.results) {
    lines.push(
      `| ${GLYPH[r.status] ?? '?'} | ${mdCell(r.id)} | ${mdCell(r.type)} | ${mdCell(r.source)} | ${r.required ? '✓' : ''} | ${r.weight} | ${mdCell(r.describe ?? '')} |`,
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
      lines.push(`  - verdict: ${j.verdict ?? '_pending_'} · by: ${j.by ?? '_pending_'}`);
    }
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
    return { ok: true, dir, files: { json: jsonPath, md: mdPath } };
  } catch (err) {
    return { ok: false, error: `failed to write report: ${err instanceof Error ? err.message : String(err)}` };
  }
}
