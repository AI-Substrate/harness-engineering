import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { buildInsights } from '../../../src/services/telemetry/insights.js';
import {
  INSIGHTS_DATA_MARKER,
  renderInsights,
} from '../../../src/services/telemetry/render/insights-html.js';
import {
  FLOW_STAGE_MAP_VERSION,
  type Rollup,
  type RollupEntry,
  TELEMETRY_REPORT_SCHEMA_VERSION,
  type TelemetryReport,
} from '../../../src/services/telemetry/report.js';

/**
 * Plan 048 Phase 2.5 — the self-contained `insights/index.html` smoke test
 * (lightweight per the testing strategy): renders offline, exposes the reserved
 * narrator slot, and — critically — EVERY number the reader sees originates from
 * the embedded insights.json (the template mints none). That last guard EXECUTES
 * the page (jsdom) so an HTML-side computed number is caught, not just the raw
 * island bytes a static-string scan would see.
 */

function rollup(dimension: Rollup['dimension'], entries: RollupEntry[]): Rollup {
  const tokens = {
    input: entries.reduce((a, e) => a + e.tokens.input, 0),
    output: entries.reduce((a, e) => a + e.tokens.output, 0),
  };
  return { dimension, entries, total: { count: entries.reduce((a, e) => a + e.count, 0), tokens } };
}

/** A single-session report whose bash rollup carries DISTINCTIVE numbers to trace. */
function reportWith(count: number, sent: number): TelemetryReport {
  return {
    schema_version: TELEMETRY_REPORT_SCHEMA_VERSION,
    scope: { session_count: 1, single: true, session_ids: ['sess1'] },
    filter: {},
    totals: {
      time_s: 0,
      tokens: { input: 0, output: 0 },
      cache: { read: 0, create: 0 },
      sessions: 1,
    },
    rollups: {
      flow_stage: rollup('flow_stage', []),
      skill: rollup('skill', []),
      tool: rollup('tool', []),
      bash_command: rollup('bash_command', [
        { key: 'rg', count, tokens: { input: sent, output: 0 } },
      ]),
      harness_command: rollup('harness_command', []),
    },
    attribution: { tokens: '', time: '', exact: ['count'], bash_command_key: '', notes: [] },
    provenance: {
      date_range: { from: '', to: '' },
      repos: [],
      branches: ['main'],
      harnesses: [],
      models: [],
      session_count: 1,
      source_paths: [],
      generated_at: '',
      flow_stage_map_version: FLOW_STAGE_MAP_VERSION,
      flow_stage_mechanism: { flow: 0, digit: 0, unlabeled: 0 },
      token_coverage: { measured: 1, unmeasured: 0 },
    },
  };
}

const DISTINCT_COUNT = 93;
const DISTINCT_SENT = 418;
// Both are small integers (< 1e3) so the template's `fmtNum` renders them
// verbatim — a `k`/`M` abbreviation (e.g. 428817 -> "428.8k") would fork the
// rendered token away from its insights.json digit-run and make the origination
// smoke below false-positive. Neither is `50`/`67` — the percentages the
// reviewer's minted-coverage mutation computes — so a minted number can never
// accidentally trace back to the fixture.

describe('insights HTML render (2.5 — self-contained, offline, narrator slot)', () => {
  const doc = buildInsights([{ name: 'r', report: reportWith(DISTINCT_COUNT, DISTINCT_SENT) }], {
    generatedAt: '2026-07-02T00:00:00Z',
  });
  const html = renderInsights(doc);

  it('renders a self-contained HTML document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
  });

  it('issues NO network request (file:// clean)', () => {
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/\bfetch\s*\(/);
    expect(html).not.toMatch(/src\s*=\s*["']https?:/);
  });

  it('exposes the reserved narrator slot (empty, clearly marked, no inference)', () => {
    expect(html).toContain('id="narrator-slot"');
    expect(html).toContain('data-narrator="reserved"');
    expect(html).toMatch(/reserved/i);
  });

  it('embeds the insights document as a data island', () => {
    expect(html).toContain('id="insights-data"');
    // The marker was consumed (replaced by the island), not left in the output.
    expect(html).not.toContain(INSIGHTS_DATA_MARKER);
  });

  it('EVERY rendered number originates from insights.json — an HTML-side minted number is caught', () => {
    // WHY EXECUTE (F1, Dim-0 gap): `renderInsights` returns the template with the
    // JSON island embedded, but the tables are built by the template's INLINE
    // SCRIPT at browser time. A number the RENDERER mints (a computed percentage
    // NOT in insights.json) therefore appears only AFTER the script runs — a
    // static-string scan of the un-executed template is blind to it (the reviewer
    // slipped exactly such a percentage past the old smoke). So we run the page.
    const dom = new JSDOM(html, { runScripts: 'dangerously' });
    const d = dom.window.document;

    // The rendered tables must be present — else the script never ran and the
    // whole smoke is vacuous (it would pass on a blank page).
    expect((d.getElementById('insights-root')?.textContent ?? '').length).toBeGreaterThan(0);

    // Strip BOTH scripts before reading: the JSON island (raw data — not what the
    // reader sees) AND the renderer source, whose `fmtNum` constants (1e6, 100, …)
    // are code, not rendered numbers. Then flatten the VISIBLE markup, turning
    // every tag boundary into a space so adjacent table cells cannot fuse into one
    // spurious digit-run (e.g. cells `93` `418` `0` -> the phantom token `934180`).
    for (const s of d.querySelectorAll('script')) s.remove();
    const visible = d.body.innerHTML.replace(/<[^>]*>/g, ' ');

    // The ONLY visible numbers that legitimately do not originate from the data
    // are static prose scaffolding — here just the literal "Phase 3" in the
    // reserved narrator slot. Everything else must trace to the embedded JSON.
    const STATIC_SCAFFOLDING = new Set(['3']);

    const island = new Set(JSON.stringify(doc).match(/\d+/g) ?? []);
    const rendered = new Set(visible.match(/\d+/g) ?? []);
    const minted = [...rendered].filter((tok) => !island.has(tok) && !STATIC_SCAFFOLDING.has(tok));
    // A minted number is a page number with no source in insights.json.
    expect(minted).toEqual([]);

    // And the smoke is watching REAL rendered output: the distinctive data
    // figures reached the visible page, not merely the (stripped) island.
    expect(visible).toContain(String(DISTINCT_COUNT));
    expect(visible).toContain(String(DISTINCT_SENT));
  });
});

/**
 * Plan 068 item 3 — the delta-unavailable marker must survive to the HTML surface,
 * not just the JSON. A reader looking at the rendered page must be able to tell a
 * file with no measured churn from a file with zero churn.
 */
describe('plan 068 · item 3 — the delta-unavailable marker reaches the rendered page', () => {
  const report = reportWith(1, 1);
  report.authorship = {
    files: [
      {
        path: 'src/only-path.ts',
        change: 'written',
        lines_added: null,
        lines_removed: null,
        bytes_added: null,
        bytes_removed: null,
        events: 0,
        delta_unavailable: 'no_per_file_delta_capture',
      },
    ],
    totals: {
      files: 1,
      lines_added: 0,
      lines_removed: 0,
      bytes_added: 0,
      bytes_removed: 0,
      files_delta_unavailable: 1,
    },
  };
  const html = renderInsights(
    buildInsights([{ name: 'r', report }], { generatedAt: '2026-07-02T00:00:00Z' }),
  );

  it('renders the path, the named reason, and "unmeasured" cells — never a 0', () => {
    const dom = new JSDOM(html, { runScripts: 'dangerously' });
    const text = dom.window.document.body.textContent ?? '';
    expect(text).toContain('src/only-path.ts');
    expect(text).toContain('no_per_file_delta_capture');
    expect(text).toContain('delta unavailable');
    // The delta cells render as the honest "unmeasured" token, not a fabricated 0.
    const section = [...dom.window.document.querySelectorAll('section')].find((s) =>
      (s.textContent ?? '').includes('src/only-path.ts'),
    );
    if (section === undefined) throw new Error('files_written section not rendered');
    // Each of the four delta columns renders the honest "unmeasured" token, never a 0.
    const headers = [...section.querySelectorAll('thead th')].map((th) => th.textContent ?? '');
    const cells = [...section.querySelectorAll('tbody td')].map((td) => td.textContent ?? '');
    for (const column of ['lines_added', 'lines_removed', 'bytes_added', 'bytes_removed']) {
      const at = headers.indexOf(column);
      expect(at, column).toBeGreaterThan(-1);
      expect(cells[at].trim(), column).toBe('unmeasured');
    }
    // `events: 0` is a real measurement (zero file events) and stays a number.
    expect(cells[headers.indexOf('events')].trim()).toBe('0');
  });
});
