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

/** Render the shipped template with the given columns embedded → self-contained HTML. */
export function renderReports(columns: readonly ReportColumn[]): string {
  return embedReports(REPORT_TEMPLATE_HTML, columns);
}
