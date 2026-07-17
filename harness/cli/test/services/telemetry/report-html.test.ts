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

  it('preserves the legacy no-coverage render path byte-for-byte', () => {
    expect(renderReports(cols)).toBe(embedReports(REPORT_TEMPLATE_HTML, cols));
  });

  it('bundle coverage renders N-of-M, unavailable evidence, and gaps without zero/no-activity claims', () => {
    const report = mkReport({
      sessionId: 'bundle',
      harness: 'claude-code',
      bash: {},
      harnessCmd: {},
      time_s: 0,
    });
    report.scope = { session_count: 2, single: false, session_ids: ['partial', 'identity'] };
    report.provenance.session_count = 2;
    report.provenance.input_coverage = {
      accepted_sessions: 2,
      event_substrate_sessions: 0,
      kinds: { full: 0, partial: 1, identity_only: 1 },
      fields: {
        events: { available: 0, unavailable: 2, excluded: 0 },
        measurements: { available: 1, unavailable: 1, excluded: 0 },
      },
      repositories: [{ key: 'repo-a', identity: 'https://example.com/a', sessions: 2 }],
      gaps: ['repo-a:identity:events_unavailable'],
    };
    report.evidence_totals = {
      events: { state: 'unavailable', value: null, contributors: 0 },
      measurements: { state: 'measured', value: 0, contributors: 1 },
    };
    const html = renderReports([{ label: 'bundle', report }]);
    expect(html).toContain('Evidence coverage');
    expect(html).toContain('Events: unavailable (0 of 2 contributors)');
    expect(html).toContain('Measurements: measured zero (1 of 2 contributors)');
    expect(html).toContain('repo-a:identity:events_unavailable');
    expect(html).not.toContain('function renderTotals');
    expect(html).not.toContain('var DIMS');
    expect(html).not.toMatch(/0 session\(s\)|no [^<\n]* activity/i);
    expect(html).not.toMatch(/display\s*:\s*none/i);
  });

  it('coverage mode retains analytics only when event-substrate contributors exist', () => {
    const report = mkReport({
      sessionId: 'mixed',
      harness: 'claude-code',
      bash: { rg: 2 },
      harnessCmd: {},
      time_s: 0,
    });
    report.provenance.input_coverage = {
      accepted_sessions: 2,
      event_substrate_sessions: 1,
      kinds: { full: 1, partial: 0, identity_only: 1 },
      fields: {
        events: { available: 1, unavailable: 1, excluded: 0 },
        measurements: { available: 1, unavailable: 1, excluded: 0 },
      },
      repositories: [{ key: 'repo-a', identity: 'https://example.com/a', sessions: 2 }],
      gaps: ['repo-a:identity:events_unavailable'],
    };
    report.evidence_totals = {
      events: { state: 'measured', value: 2, contributors: 1 },
      measurements: { state: 'measured', value: 0, contributors: 1 },
    };
    const html = renderReports([{ label: 'mixed', report }]);
    expect(html).toContain('class="bundle-analytics"');
    expect(html).toContain('rg');
    expect(html).toContain('2×');
    expect(html).not.toMatch(/no [^<\n]* activity/i);
  });

  it('coverage mode keeps every mixed legacy and bundle column visibly analytic', () => {
    const bundle = mkReport({
      sessionId: 'bundle-mixed',
      harness: 'claude-code',
      bash: { rg: 2 },
      harnessCmd: {},
    });
    bundle.provenance.input_coverage = {
      accepted_sessions: 1,
      event_substrate_sessions: 1,
      kinds: { full: 1, partial: 0, identity_only: 0 },
      fields: {
        events: { available: 1, unavailable: 0, excluded: 0 },
        measurements: { available: 1, unavailable: 0, excluded: 0 },
      },
      repositories: [{ key: 'repo-a', identity: 'https://example.com/a', sessions: 1 }],
      gaps: [],
    };
    bundle.evidence_totals = {
      events: { state: 'measured', value: 2, contributors: 1 },
      measurements: { state: 'measured', value: 0, contributors: 1 },
    };
    const legacy = mkReport({
      sessionId: 'legacy-mixed',
      harness: 'copilot-cli',
      bash: { git: 3 },
      harnessCmd: { doctor: 1 },
    });
    const html = renderReports([
      { label: 'bundle column', report: bundle },
      { label: 'legacy column', report: legacy },
    ]);
    const main = /<main id="root">([\s\S]*?)<\/main>/.exec(html)?.[1] ?? '';
    expect(main).toContain('bundle column');
    expect(main).toContain('legacy column');
    expect(main).toContain('rg');
    expect(main).toContain('git');
    expect(main).toContain('doctor');
    expect(html.match(/class="report-column"/g) ?? []).toHaveLength(2);
    expect(html).not.toContain('function renderTotals');
    expect(html).not.toContain('var DIMS');
    expect(main).not.toMatch(/no [^<\n]* activity/i);
  });

  it('N=1 renders a single column (session save path)', () => {
    const html = renderReports([cols[0]]);
    expect(html.match(/class="report-column"/g) ?? []).toHaveLength(1);
  });

  it('T1.5 render contract: token columns are sent/received; NO cache column in the HTML', () => {
    const html = renderReports(cols);
    // WS001 D2 / AC-03: the rendered token columns collapse to sent (= non-cache
    // input) and received (= output). Cache disappears as a RENDERED concept.
    expect(html).toContain(' sent \u00b7 ');
    expect(html).toContain(' received');
    // MUTATION cache-column-reintroduced: no "context re-reads" / cache line renders.
    expect(html).not.toContain('context re-reads');
    // A measured zero still renders `0` (the template's fmtTok mirror, applied to
    // the doctor row's {input:0,output:0}) — never blanked or hidden.
    expect(formatTokens(0)).toBe('0');
    // Internals may KEEP the session-level cache in the JSON (attribution) — it is
    // simply never rendered as a column.
    const jsons = [...html.matchAll(/class="report-column">(.*?)<\/script>/gs)].map((m) =>
      JSON.parse(m[1].replace(/\\u003c/g, '<')),
    );
    expect(jsons[0].report.totals.cache).toEqual({ read: 4_200_000, create: 12_000 });
    // …and no per-dimension row leaks a cache bucket.
    const rowsJson = JSON.stringify(jsons[0].report.rollups.bash_command.entries);
    expect(rowsJson).not.toContain('cache_read');
    expect(rowsJson).not.toContain('total');
  });

  it('T1.5 mutation guard: the shipped TEMPLATE renders no cache column at all', () => {
    // The template string carries no embedded data, so any `cache` token here is a
    // RENDER concept — reintroducing the cache line (mutation) flips this RED.
    expect(REPORT_TEMPLATE_HTML).not.toContain('context re-reads');
    expect(REPORT_TEMPLATE_HTML).not.toContain('t.cache');
    expect(REPORT_TEMPLATE_HTML).not.toContain('class="cache"');
    expect(REPORT_TEMPLATE_HTML).toContain('sent');
    expect(REPORT_TEMPLATE_HTML).toContain('received');
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
