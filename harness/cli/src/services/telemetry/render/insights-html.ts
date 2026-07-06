/**
 * `insights-html.ts` (plan 048 Phase 2.5) — render an {@link InsightsDocument}
 * into ONE self-contained `insights/index.html`.
 *
 * MECHANISM = inline-embed at render, NOT runtime fetch (mirrors report-html.ts /
 * KF-04): a `file://` page cannot `fetch` a sibling JSON, so the whole insights
 * document is embedded as an inline `<script type="application/json"
 * id="insights-data">` block — the DATA ISLAND. The template's own script reads
 * that island and renders the tables; EVERY number on the page originates from the
 * island (the template hardcodes none — "no HTML-side arithmetic beyond
 * formatting"). The page issues no network request.
 *
 * NARRATOR SLOT (Phase 3 seam): a clearly-marked, EMPTY container is rendered
 * alongside the data island. Nothing here calls or prepares an LLM — the slot is
 * inert scaffolding a later narrator writes prose INTO, reading the island's
 * already-computed numbers. No inference at render time.
 *
 * PURE SERVICE (P2): string in → string out. No `node:*`, no fs, no clock.
 */

import type { InsightsDocument } from '../insights.js';

/** The template placeholder the embedded data island replaces. */
export const INSIGHTS_DATA_MARKER = '<!--INSIGHTS_DATA-->';

/** Inline the document as a data island; `<` is escaped so a value can't break the tag. */
function dataIsland(doc: InsightsDocument): string {
  const json = JSON.stringify(doc).replace(/</g, '\\u003c');
  return `<script type="application/json" id="insights-data">${json}</script>`;
}

/** Inject the data island into a template copy (idempotent on the marker). */
export function embedInsights(template: string, doc: InsightsDocument): string {
  const island = dataIsland(doc);
  if (template.includes(INSIGHTS_DATA_MARKER))
    return template.replace(INSIGHTS_DATA_MARKER, island);
  return template.replace('</body>', `${island}\n</body>`);
}

/** Render the shipped template with the document embedded → self-contained HTML. */
export function renderInsights(doc: InsightsDocument): string {
  return embedInsights(INSIGHTS_TEMPLATE_HTML, doc);
}

/**
 * The self-contained insights VIEW template. Renders EMBEDDED insights JSON only
 * (no network). The reserved narrator slot is inert. All formatting lives in
 * `fmtNum`; no data value is computed in the template.
 */
export const INSIGHTS_TEMPLATE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Telemetry Insights</title>
<style>
  :root {
    --bg: #f6f7f9; --panel: #fff; --ink: #1b1f24; --muted: #5b6672;
    --line: #e5e8ec; --accent: #3b5bdb; --warn: #b8860b; --warn-bg: #fff8e6;
    --off: #8a94a0; --zebra: #fafbfc;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  header { padding: 20px 24px; border-bottom: 1px solid var(--line); background: var(--panel); }
  h1 { margin: 0; font-size: 18px; }
  .sub { color: var(--muted); font-size: 13px; margin-top: 4px; }
  main { padding: 20px 24px; max-width: 1100px; }
  section { background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
    margin-bottom: 16px; padding: 16px; }
  section h2 { margin: 0 0 8px; font-size: 15px; }
  .note { color: var(--muted); font-size: 12.5px; margin: 6px 0; }
  .suppressed { color: var(--warn); background: var(--warn-bg); border-radius: 4px;
    padding: 4px 8px; font-size: 12.5px; display: inline-block; margin: 6px 0; }
  .unavailable { color: var(--off); font-style: italic; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--muted); font-weight: 600; }
  tr:nth-child(even) td { background: var(--zebra); }
  .claim { font-weight: 600; }
  .meta { color: var(--muted); font-size: 12px; }
  .caveat { color: var(--muted); font-size: 12px; }
  .unmeasured { color: var(--off); font-style: italic; }
  #narrator-slot { border-style: dashed; }
  .reserved { color: var(--off); font-style: italic; }
  code.ver { color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>Telemetry Insights</h1>
  <div class="sub" id="subtitle"></div>
</header>
<main>
  <div id="insights-root"></div>

  <!-- Reserved narrator slot (Phase 3). Inert: a narrator reads #insights-data and writes prose here. NO inference at render time. -->
  <section id="narrator-slot" data-narrator="reserved">
    <h2>Narration</h2>
    <p class="reserved">Reserved for LLM narration (Phase 3). Prose only, over the numbers already in this page's data island \u2014 the narrator computes nothing.</p>
    <div id="narrator-prose"></div>
  </section>

  <section id="provenance-panel"><h2>Provenance</h2><div id="provenance"></div></section>
</main>
${INSIGHTS_DATA_MARKER}
<script>
(function () {
  var el = document.getElementById("insights-data");
  if (!el) { document.getElementById("insights-root").innerHTML = "<p class='unavailable'>No insights data embedded.</p>"; return; }
  var doc = JSON.parse(el.textContent);

  function fmtNum(v) {
    if (v === null || v === undefined) return "<span class='unmeasured'>unmeasured</span>";
    if (typeof v !== "number") return String(v);
    if (Math.abs(v) >= 1e6) return (Math.round(v / 1e5) / 10) + "M";
    if (Math.abs(v) >= 1e3) return (Math.round(v / 100) / 10) + "k";
    return String(v);
  }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }

  function valueCols(rows) {
    var keys = [];
    rows.forEach(function (r) { Object.keys(r.values || {}).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); }); });
    return keys;
  }

  function renderSection(s) {
    var h = "<section><h2>" + esc(s.title) + "</h2>";
    if (s.available === false) {
      h += "<p class='unavailable'>" + esc(s.note || "Unavailable.") + "</p></section>";
      return h;
    }
    if (s.note) h += "<p class='note'>" + esc(s.note) + "</p>";
    if (s.orderings) {
      Object.keys(s.orderings).forEach(function (k) {
        h += "<p class='meta'>" + esc(k) + ": " + s.orderings[k].map(esc).join(" &middot; ") + "</p>";
      });
    }
    if (!s.rows || !s.rows.length) {
      h += "<p class='note'>No rows.</p>";
    } else {
      var cols = valueCols(s.rows);
      h += "<table><thead><tr><th>claim</th><th>n</th>";
      cols.forEach(function (c) { h += "<th>" + esc(c) + "</th>"; });
      h += "</tr></thead><tbody>";
      s.rows.forEach(function (r) {
        h += "<tr><td><div class='claim'>" + esc(r.claim) + "</div>";
        h += "<div class='caveat'>" + esc(r.caveat) + "</div></td>";
        h += "<td>" + fmtNum(r.n) + (r.interval ? " <span class='meta'>" + esc(r.interval) + "</span>" : "") + "</td>";
        cols.forEach(function (c) { h += "<td>" + (c in r.values ? fmtNum(r.values[c]) : "") + "</td>"; });
        h += "</tr>";
      });
      h += "</tbody></table>";
    }
    if (s.suppressed) h += "<div class='suppressed'>suppressed " + esc(s.suppressed.rows) + " row(s): " + esc(s.suppressed.reason) + "</div>";
    return h + "</section>";
  }

  var sub = document.getElementById("subtitle");
  var p = doc.provenance || {};
  sub.textContent = (p.single_session_reports || 0) + " single-session + " + (p.aggregate_reports || 0) + " aggregate report(s) \u00b7 n\u2011threshold " + (p.n_threshold);

  var root = document.getElementById("insights-root");
  var html = "";
  (doc.sections || []).forEach(function (s) { html += renderSection(s); });
  if (doc.discipline) html += renderSection(doc.discipline);
  root.innerHTML = html;

  var prov = document.getElementById("provenance");
  var lines = [];
  lines.push("<p class='meta'>keying rule: " + esc(p.keying_rule || "") + "</p>");
  lines.push("<p class='meta'>flow-stage map: <code class='ver'>" + (p.flow_stage_map_versions || []).map(esc).join(", ") + "</code></p>");
  lines.push("<p class='meta'>token coverage: " + fmtNum((p.token_coverage || {}).measured) + " measured / " + fmtNum((p.token_coverage || {}).unmeasured) + " unmeasured</p>");
  if (p.input_reports) lines.push("<p class='meta'>inputs: " + p.input_reports.map(function (r) { return esc(r.name) + (r.single ? "" : " (aggregate)"); }).join(", ") + "</p>");
  if (p.skipped_inputs && p.skipped_inputs.length) lines.push("<p class='suppressed'>skipped inputs: " + p.skipped_inputs.map(function (r) { return esc(r.path) + " (" + esc(r.reason) + ")"; }).join(", ") + "</p>");
  (p.caveats || []).forEach(function (c) { lines.push("<p class='caveat'>\u26a0 " + esc(c) + "</p>"); });
  lines.push("<p class='meta'>generated_at: " + esc(p.generated_at || "") + " \u00b7 schema " + esc(doc.schema_version) + "</p>");
  prov.innerHTML = lines.join("");
})();
</script>
</body>
</html>
`;
