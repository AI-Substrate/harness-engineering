/**
 * `report-html.ts` (plan 047 Phase 2 · T007/T008) — turn one-or-many
 * `TelemetryReport`s into ONE self-contained HTML page.
 *
 * MECHANISM = inline-embed at render, NOT runtime fetch (KF-04): a page opened
 * via `file://` cannot `fetch` a sibling JSON (browser CORS), so each report is
 * embedded as an inline `<script type="application/json" class="report-column">`
 * block — exactly the proven `scratch/old/session-view/gen.py` pattern. The
 * shipped `template.html`/`REPORT_TEMPLATE_HTML` reads those blocks on load and
 * renders columns + the five panels; the numbers all live in the JSON.
 *
 * PURE SERVICE (P2): string in → string out. No `node:*`, no fs, no clock — the
 * caller (`acts/telemetry.ts`) reads the folder and writes the file.
 */

import type { TelemetryReport } from '../report.js';
import { REPORT_TEMPLATE_HTML } from './template.js';

/** One comparison column: a report + the label its column is headed by. */
export interface ReportColumn {
  /** The column heading (`--name`, a filename stem, or derived from `report.filter`). */
  label: string;
  report: TelemetryReport;
}

/** The template placeholder the embedded data blocks replace. */
export const REPORT_DATA_MARKER = '<!--REPORT_DATA-->';

function trim1(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * Human-friendly duration from seconds (`45s` · `28m` · `4.2h` · `1.3 days`).
 * Mirrors the template's in-view `fmtDur` so a headless test and the rendered
 * page agree.
 */
export function formatDuration(timeS: number): string {
  const s = Math.max(0, Math.round(timeS || 0));
  if (s < 60) return `${s}s`;
  const m = s / 60;
  if (m < 60) return `${trim1(m)}m`;
  const h = m / 60;
  if (h < 24) return `${trim1(h)}h`;
  return `${trim1(h / 24)} days`;
}

/** Compact token magnitude (`540` · `380k` · `1.2M`) — mirrors the template. */
export function formatTokens(n: number): string {
  const v = Math.round(n || 0);
  if (v >= 1e6) return `${trim1(v / 1e6)}M`;
  if (v >= 1e3) return `${trim1(v / 1e3)}k`;
  return String(v);
}

/** One inline data block for a column; `<` is escaped so a value can't break the tag. */
function embedBlock(col: ReportColumn): string {
  const json = JSON.stringify({ label: col.label, report: col.report });
  const safe = json.replace(/</g, '\\u003c');
  return `<script type="application/json" class="report-column">${safe}</script>`;
}

/** Inject the columns' data into a template copy (idempotent on the marker). */
export function embedReports(template: string, columns: readonly ReportColumn[]): string {
  const blocks = columns.map(embedBlock).join('\n');
  if (template.includes(REPORT_DATA_MARKER)) return template.replace(REPORT_DATA_MARKER, blocks);
  // Defensive fallback: a template without the marker still gets its data.
  return template.replace('</body>', `${blocks}\n</body>`);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function evidenceLine(
  label: string,
  field: { available: number; unavailable: number; excluded: number },
  measure: { state: 'measured' | 'unavailable'; value: number | null; contributors: number },
): string {
  const total = field.available + field.unavailable + field.excluded;
  const state =
    measure.state === 'unavailable'
      ? 'unavailable'
      : measure.value === 0
        ? 'measured zero'
        : `${measure.value ?? 0} observed`;
  const exclusions = field.excluded > 0 ? `; ${field.excluded} excluded by filters` : '';
  return `${label}: ${state} (${measure.contributors} of ${total} contributors${exclusions})`;
}

function bundleCoverageBlock(column: ReportColumn): string {
  const coverage = column.report.provenance.input_coverage;
  const evidence = column.report.evidence_totals;
  if (coverage === undefined) return '';
  if (evidence === undefined) {
    return [
      '<section class="bundle-coverage" aria-label="Bundle evidence coverage">',
      `<h2>Evidence coverage — ${escapeHtml(column.label)}</h2>`,
      '<p>Coverage evidence unavailable.</p>',
      '</section>',
    ].join('');
  }
  const total =
    coverage.fields.events.available +
    coverage.fields.events.unavailable +
    coverage.fields.events.excluded;
  const gaps =
    coverage.gaps.length === 0
      ? '<li>Gaps: none</li>'
      : `<li>Gaps: ${coverage.gaps.map(escapeHtml).join(', ')}</li>`;
  return [
    '<section class="bundle-coverage" aria-label="Bundle evidence coverage">',
    `<h2>Evidence coverage — ${escapeHtml(column.label)}</h2>`,
    `<p>Sessions: ${coverage.accepted_sessions} accepted of ${total} considered.</p>`,
    '<ul>',
    `<li>${evidenceLine('Events', coverage.fields.events, evidence.events)}</li>`,
    `<li>${evidenceLine('Measurements', coverage.fields.measurements, evidence.measurements)}</li>`,
    gaps,
    '</ul>',
    '</section>',
  ].join('');
}

const BUNDLE_DIMENSIONS = [
  ['harness_command', 'Harness command'],
  ['flow_stage', 'Flow stage'],
  ['skill', 'Skill'],
  ['tool', 'Tool'],
  ['bash_command', 'Bash command'],
] as const;

function analyticDimensions(column: ReportColumn): string {
  return BUNDLE_DIMENSIONS.flatMap(([key, label]) => {
    const rollup = column.report.rollups[key];
    if (rollup.entries.length === 0) return [];
    const items = rollup.entries
      .map((entry) => {
        const time = entry.time_s === undefined ? '' : ` · ${formatDuration(entry.time_s)}`;
        return `<li><b>${escapeHtml(entry.key)}</b>: ${entry.count}× · ${formatTokens(
          entry.tokens.input,
        )} sent · ${formatTokens(entry.tokens.output)} received${time}</li>`;
      })
      .join('');
    return [`<section class="bundle-dimension"><h3>${label}</h3><ul>${items}</ul></section>`];
  }).join('');
}

function bundleAnalyticsBlock(column: ReportColumn): string {
  const coverage = column.report.provenance.input_coverage;
  const evidence = column.report.evidence_totals;
  if (
    coverage === undefined ||
    evidence === undefined ||
    coverage.fields.events.available === 0 ||
    evidence.events.state === 'unavailable'
  ) {
    return '';
  }
  const dimensions = analyticDimensions(column);
  return [
    '<section class="bundle-analytics" aria-label="Event-substrate analytics">',
    `<h2>Event-substrate analytics — ${escapeHtml(column.label)}</h2>`,
    `<p>${evidence.events.contributors} of ${
      coverage.fields.events.available +
      coverage.fields.events.unavailable +
      coverage.fields.events.excluded
    } sessions contribute event evidence.</p>`,
    dimensions,
    '</section>',
  ].join('');
}

function legacyAnalyticsBlock(column: ReportColumn): string {
  const totals = column.report.totals;
  return [
    '<section class="legacy-analytics" aria-label="Legacy SessionExport analytics">',
    `<h2>Legacy export analytics — ${escapeHtml(column.label)}</h2>`,
    `<p>${totals.sessions} session(s) · ${formatDuration(totals.time_s)} · ${formatTokens(
      totals.tokens.input,
    )} sent · ${formatTokens(totals.tokens.output)} received.</p>`,
    analyticDimensions(column),
    '</section>',
  ].join('');
}

interface CoverageDisplayColumn {
  column: ReportColumn;
  coverage: string;
  analytics: string;
}

/** Pure final-page model: coverage mode always contains one visible entry per input column. */
function coverageDisplayModel(columns: readonly ReportColumn[]): CoverageDisplayColumn[] {
  return columns.map((column) => {
    const isBundle = column.report.provenance.input_coverage !== undefined;
    return {
      column,
      coverage: isBundle ? bundleCoverageBlock(column) : '',
      analytics: isBundle ? bundleAnalyticsBlock(column) : legacyAnalyticsBlock(column),
    };
  });
}

function withoutLegacyRuntime(template: string): string {
  const start = template.indexOf('<script>\n(function () {');
  if (start < 0) return template;
  const close = template.indexOf('</script>', start);
  if (close < 0) return template;
  return `${template.slice(0, start)}${template.slice(close + '</script>'.length)}`;
}

/** Render the shipped template with the given columns embedded → self-contained HTML. */
export function renderReports(columns: readonly ReportColumn[]): string {
  if (!columns.some((column) => column.report.provenance.input_coverage !== undefined)) {
    return embedReports(REPORT_TEMPLATE_HTML, columns);
  }
  const body = coverageDisplayModel(columns)
    .flatMap((display) => [display.coverage, display.analytics])
    .filter((block) => block.length > 0)
    .join('\n');
  const bundleTemplate = withoutLegacyRuntime(REPORT_TEMPLATE_HTML)
    .replace('<span class="sub" id="head-sub"></span>', '<span class="sub">bundle evidence</span>')
    .replace('<main id="root"></main>', `<main id="root">${body}</main>`);
  return embedReports(bundleTemplate, columns);
}
