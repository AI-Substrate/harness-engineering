import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  embedReports,
  formatDuration,
  formatTokens,
  type ReportColumn,
  renderReports,
} from '../../../src/services/telemetry/render/report-html.js';
import { REPORT_TEMPLATE_HTML } from '../../../src/services/telemetry/render/template.js';
import {
  type ReportDimension,
  type Rollup,
  TELEMETRY_REPORT_SCHEMA_VERSION,
  type TelemetryReport,
} from '../../../src/services/telemetry/report.js';

/**
 * Phase 2 (plan 047) — the self-contained HTML render (T007/T009).
 *
 * Validates the load-bearing render contract: inline-embed (NO `fetch`), one
 * `report-column` block per comparison column, human-friendly durations, and the
 * `template.ts` ⇄ `template.html` drift guard (the `.ts` is the runtime source of
 * truth that ships in `dist`; the `.html` is the human-editable twin).
 */

function emptyRollup(dimension: ReportDimension): Rollup {
  return {
    dimension,
    entries: [],
    total: { count: 0, tokens: { input: 0, output: 0 } },
  };
}

/** A minimal valid report with a couple of rows on two dimensions (render is builder-agnostic). */
function mkReport(over: {
  sessionId: string;
  harness: string;
  bash: Record<string, number>;
  harnessCmd: Record<string, number>;
  time_s?: number;
}): TelemetryReport {
  // Command lenses carry NO time_s (FX002) — only {input, output}.
  const bashEntries = Object.entries(over.bash).map(([key, count]) => ({
    key,
    count,
    tokens: { input: count * 10, output: count * 5 },
  }));
  const harnessEntries = Object.entries(over.harnessCmd).map(([key, count]) => ({
    key,
    count,
    tokens: { input: 0, output: 0 },
  }));
  const sum = (es: { count: number; tokens: { input: number; output: number } }[]) =>
    es.reduce(
      (a, e) => ({
        count: a.count + e.count,
        tokens: {
          input: a.tokens.input + e.tokens.input,
          output: a.tokens.output + e.tokens.output,
        },
      }),
      { count: 0, tokens: { input: 0, output: 0 } },
    );
  return {
    schema_version: TELEMETRY_REPORT_SCHEMA_VERSION,
    scope: { session_count: 1, single: true, session_ids: [over.sessionId] },
    filter: {},
    totals: {
      time_s: over.time_s ?? 3661,
      tokens: { input: 700, output: 500 },
      cache: { read: 4_200_000, create: 12_000 },
      sessions: 1,
    },
    rollups: {
      flow_stage: emptyRollup('flow_stage'),
      skill: emptyRollup('skill'),
      tool: emptyRollup('tool'),
      bash_command: { dimension: 'bash_command', entries: bashEntries, total: sum(bashEntries) },
      harness_command: {
        dimension: 'harness_command',
        entries: harnessEntries,
        total: sum(harnessEntries),
      },
    },
    attribution: {
      tokens: 'non-cache-input+output',
      time: 'per-lens',
      exact: ['count'],
      bash_command_key: 'shell-command-signature-or-tool-name',
      notes: [],
    },
    provenance: {
      date_range: { from: '2026-06-01T00:00:00Z', to: '2026-06-02T00:00:00Z' },
      repos: [],
      branches: ['main'],
      harnesses: [over.harness],
      models: ['claude-opus-4-8'],
      session_count: 1,
      source_paths: ['./sessions'],
      generated_at: '2026-07-01T00:00:00Z',
    },
  };
}

describe('T007 — drift guard: template.ts ships the exact template.html bytes', () => {
  it('REPORT_TEMPLATE_HTML equals the authored template.html (edit both in lockstep)', () => {
    const html = readFileSync(
      fileURLToPath(
        new URL('../../../src/services/telemetry/render/template.html', import.meta.url),
      ),
      'utf8',
    );
    expect(REPORT_TEMPLATE_HTML).toBe(html);
  });

  it('the template is self-contained: no fetch, no external script/style src', () => {
    expect(REPORT_TEMPLATE_HTML).not.toMatch(/fetch\s*\(/);
    expect(REPORT_TEMPLATE_HTML).not.toMatch(/<script[^>]+\bsrc=/i);
    expect(REPORT_TEMPLATE_HTML).not.toMatch(/<link[^>]+stylesheet/i);
    expect(REPORT_TEMPLATE_HTML).toContain('<!--REPORT_DATA-->');
  });
});

describe('T009 — durations + token magnitudes are human-friendly', () => {
  it('formatDuration: seconds / minutes / hours / days', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(28 * 60)).toBe('28m');
    expect(formatDuration(Math.round(4.2 * 3600))).toBe('4.2h');
    expect(formatDuration(Math.round(1.3 * 86400))).toBe('1.3 days');
    expect(formatDuration(0)).toBe('0s');
  });

  it('formatTokens: raw / k / M', () => {
    expect(formatTokens(540)).toBe('540');
    expect(formatTokens(380_000)).toBe('380k');
    expect(formatTokens(1_200_000)).toBe('1.2M');
  });
});

describe('T009 — render validation: N reports → N columns, inline data, keys aligned', () => {
  const cols: ReportColumn[] = [
    {
      label: 'Opus 4.8',
      report: mkReport({
        sessionId: 's1',
        harness: 'claude-code',
        bash: { rg: 54, git: 3 },
        harnessCmd: { doctor: 1 },
      }),
    },
    {
      label: 'gpt-5.5',
      report: mkReport({
        sessionId: 's2',
        harness: 'copilot-cli',
        bash: { rg: 12 },
        harnessCmd: { 'flow nav': 7 },
      }),
    },
  ];

  it('embeds exactly N inline application/json blocks (one per column), no fetch', () => {
    const html = renderReports(cols);
    const blocks = html.match(/<script type="application\/json" class="report-column">/g) ?? [];
    expect(blocks).toHaveLength(2);
    expect(html).not.toMatch(/fetch\s*\(/);
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });

  it('embeds the actual report data inline (labels + keys are present in the page)', () => {
    const html = renderReports(cols);
    expect(html).toContain('Opus 4.8');
    expect(html).toContain('gpt-5.5');
    // The rows a reader compares across columns:
    expect(html).toContain('rg');
    expect(html).toContain('flow nav');
    // Parse the embedded blocks back and confirm alignment on the shared 'rg' key.
    const jsons = [...html.matchAll(/class="report-column">(.*?)<\/script>/gs)].map((m) =>
      JSON.parse(m[1].replace(/\\u003c/g, '<')),
    );
    expect(jsons).toHaveLength(2);
    expect(jsons[0].label).toBe('Opus 4.8');
    const rg0 = jsons[0].report.rollups.bash_command.entries.find(
      (e: { key: string }) => e.key === 'rg',
    );
    const rg1 = jsons[1].report.rollups.bash_command.entries.find(
      (e: { key: string }) => e.key === 'rg',
    );
    expect(rg0.count).toBe(54);
    expect(rg1.count).toBe(12); // same key, both columns → the HTML aligns them into one row
  });

  it('N=1 renders a single column (session save path)', () => {
    const html = renderReports([cols[0]]);
    expect(html.match(/class="report-column"/g) ?? []).toHaveLength(1);
  });

  it('FX002 render: the template surfaces session cache as "context re-reads" + {input,output}', () => {
    const html = renderReports(cols);
    // The shipped template renders session-level cache separately, labelled.
    expect(html).toContain('context re-reads');
    // Rows/totals are in/out (never a single "tokens.total").
    expect(html).toContain(' in \u00b7 ');
    expect(html).toContain(' out');
    // The embedded JSON carries the session-level cache (never per-dimension).
    const jsons = [...html.matchAll(/class="report-column">(.*?)<\/script>/gs)].map((m) =>
      JSON.parse(m[1].replace(/\\u003c/g, '<')),
    );
    expect(jsons[0].report.totals.cache).toEqual({ read: 4_200_000, create: 12_000 });
    // …and no per-dimension row leaks a cache bucket.
    const rowsJson = JSON.stringify(jsons[0].report.rollups.bash_command.entries);
    expect(rowsJson).not.toContain('cache_read');
    expect(rowsJson).not.toContain('total');
  });

  it('escapes `<` in embedded JSON so a value can never break out of the script tag', () => {
    const evil = mkReport({
      sessionId: 's<script>alert(1)</script>',
      harness: 'x',
      bash: {},
      harnessCmd: {},
    });
    const html = embedReports(REPORT_TEMPLATE_HTML, [{ label: 'x', report: evil }]);
    // The literal closing tag must not appear inside the data payload.
    const payload = /class="report-column">(.*?)<\/script>/s.exec(html)?.[1] ?? '';
    expect(payload).not.toContain('</script>');
    expect(payload).toContain('\\u003cscript'); // escaped instead
  });
});
