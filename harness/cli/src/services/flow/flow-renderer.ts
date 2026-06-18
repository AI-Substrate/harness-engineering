import type { FlowComment, FlowDoc, FlowNode } from './flow-events.js';

/**
 * Deterministic flow renderer (plan 024 Phase 2; AC-06). PURE — `FlowDoc → string`:
 * no I/O, no `node:*`, no `new Date()`, no `process`. The clock/IO stay in the act;
 * this is the dependency LEAF (imports only the `flow-events` TYPES), so the graph
 * stays acyclic.
 *
 * It supplants the old hand-cranked the-flow mermaid render (grill 8): output is
 * **best-fit, not byte-matched** to the prototype — what matters is that it is
 * byte-stable across runs/OS (golden-file pinned + `--check` drift-guarded) and
 * covers every render rule (00-routing § Render rules + the render-surface
 * decision: genesis 🗣 bubble per node, `comments[]` → `💬N` badge + a per-node
 * markdown body-log, a distinct `decision` class, the agents subgraph).
 *
 * Two safety invariants are load-bearing (Risk #10):
 *   - every user-supplied string (`label`/`user_input`/comment text/refs/slug) is
 *     escaped so mermaid/markdown control characters can never corrupt the `.md`;
 *   - an unknown node `type` or `status` falls back to a neutral class and never
 *     throws — a malformed flow renders, it does not crash.
 *
 * The body-log is **render-only** (locked Non-Goal): the markdown is never parsed
 * back into state — `comments[]` JSON is the single source of truth.
 */

// ---------------------------------------------------------------------------
// Vocabulary (tolerant — unknown values fall back, never throw).
// ---------------------------------------------------------------------------

/** Node types rendered on the solid main line (the spine). */
const SPINE_TYPES = new Set(['research', 'spec', 'plan', 'phase', 'merge']);
/** Harness-loop seam node types — always violet, regardless of status (rule 4/5). */
const HARNESS_TYPES = new Set(['harness-boot', 'harness-retro', 'backpressure']);
/** status → classDef name (rule 5); anything else → the neutral `unknown` fallback. */
const STATUS_CLASS: Record<string, string> = {
  done: 'done',
  in_progress: 'wip',
  blocked: 'blocked',
  known: 'known',
  assumed: 'assumed',
};
/** status → rail pip (done filled, in-progress half, blocked cross, else hollow). */
const STATUS_PIP: Record<string, string> = {
  done: '◆',
  in_progress: '◐',
  blocked: '✗',
};

/** The classDef block — emitted once at the foot of the diagram (rule 1). */
const CLASS_DEFS: readonly string[] = [
  'classDef done fill:#C8E6C9,stroke:#2E7D32;',
  'classDef wip fill:#FFE0B2,stroke:#EF6C00;',
  'classDef blocked fill:#FFCDD2,stroke:#C62828;',
  'classDef known fill:#BBDEFB,stroke:#1565C0;',
  'classDef assumed fill:#ECEFF1,stroke:#90A4AE,stroke-dasharray:5 3;',
  'classDef said fill:#FFF9C4,stroke:#F9A825;',
  'classDef harness fill:#EDE7F6,stroke:#673AB7;',
  'classDef decision fill:#FFF3E0,stroke:#FB8C00,stroke-dasharray:2 2;',
  'classDef companion fill:#D1C4E9,stroke:#5E35B1;',
  'classDef worker fill:#B2DFDB,stroke:#00897B;',
  'classDef unknown fill:#FAFAFA,stroke:#BDBDBD,stroke-dasharray:1 4;',
];

const LEGEND =
  '**Legend**: 🟩 done · 🟧 in-progress · 🟥 blocked · 🟦 known (designed) · ⬜ assumed (speculative)' +
  ' · 🔶 decision · 🗣 user input · 🟪 harness loop · 🤖 companion · 🛠 worker.';

// ---------------------------------------------------------------------------
// Escaping — the corruption firewall (Risk #10).
// ---------------------------------------------------------------------------

/**
 * Neutralise mermaid control characters in a label. Order matters: `#` is escaped
 * FIRST (so a user `#` becomes `#35;`), then the HTML-style entities we inject for
 * `"`/`<`/`>` are safe (their own `#` is already past the escape pass). Newlines
 * collapse to a space — a label is always one line.
 */
function escapeMermaid(s: string): string {
  return String(s)
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/#/g, '#35;')
    .replace(/"/g, '#quot;')
    .replace(/</g, '#lt;')
    .replace(/>/g, '#gt;')
    .replace(/\|/g, '#124;')
    .replace(/\[/g, '#91;')
    .replace(/\]/g, '#93;')
    .replace(/\{/g, '#123;')
    .replace(/\}/g, '#125;');
}

/** Neutralise markdown structure chars in body-log/heading text: newlines (would
 * break the list item / heading) collapse to a space; inline HTML is entity-escaped;
 * pipes + backticks are backslash-escaped so they can't open tables/code spans. */
function escapeMd(s: string): string {
  return String(s)
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '\\|')
    .replace(/`/g, '\\`');
}

// ---------------------------------------------------------------------------
// Node id sanitisation — mermaid ids are `[A-Za-z0-9_]`; map deterministically.
// ---------------------------------------------------------------------------

/** Mermaid reserved keywords — a bare one as a node id breaks the parser (e.g. `end`). */
const MERMAID_RESERVED = new Set([
  'end',
  'subgraph',
  'graph',
  'flowchart',
  'style',
  'classdef',
  'class',
  'click',
  'linkstyle',
  'direction',
]);

/** Build original-id → mermaid-safe-id map, guaranteeing uniqueness deterministically. */
function buildIdMap(nodes: readonly FlowNode[]): Map<string, string> {
  const map = new Map<string, string>();
  const used = new Set<string>();
  nodes.forEach((n, i) => {
    const original = typeof n.id === 'string' ? n.id : `node_${i}`;
    const sanitised = original.replace(/[^A-Za-z0-9_]/g, '_') || `node_${i}`;
    // A reserved keyword as a bare id breaks mermaid — suffix it to a safe, stable form.
    const base = MERMAID_RESERVED.has(sanitised.toLowerCase()) ? `${sanitised}_` : sanitised;
    let id = base;
    let k = 1;
    while (used.has(id)) id = `${base}_${k++}`;
    used.add(id);
    map.set(original, id);
  });
  return map;
}

// ---------------------------------------------------------------------------
// Per-node render decisions.
// ---------------------------------------------------------------------------

/** The classDef a node renders with: harness > decision > status-mapped > unknown. */
function nodeClass(node: FlowNode): string {
  if (HARNESS_TYPES.has(node.type)) return 'harness';
  if (node.type === 'decision') return 'decision';
  return STATUS_CLASS[node.status] ?? 'unknown';
}

/** The node label: escaped `label` (or id), plus a `💬N` badge when comments exist. */
function nodeLabel(node: FlowNode): string {
  const base = escapeMermaid(node.label ?? node.id);
  const count = Array.isArray(node.comments) ? node.comments.length : 0;
  return count > 0 ? `${base} 💬${count}` : base;
}

/** Declare a node: `decision` is a rhombus fork `{"…"}`; everything else a box `["…"]`. */
function declareNode(node: FlowNode, mid: string): string {
  const label = nodeLabel(node);
  const cls = nodeClass(node);
  return node.type === 'decision'
    ? `    ${mid}{"${label}"}:::${cls}`
    : `    ${mid}["${label}"]:::${cls}`;
}

function isExcursion(node: FlowNode): boolean {
  return typeof node.branch_of === 'string' && node.branch_of.length > 0;
}

// ---------------------------------------------------------------------------
// The renderer.
// ---------------------------------------------------------------------------

/** Render a flow document to its canonical markdown (mermaid diagram + body-log). */
export function renderFlow(doc: FlowDoc): string {
  const nodes: FlowNode[] = Array.isArray(doc.nodes) ? doc.nodes : [];
  const idMap = buildIdMap(nodes);
  const mid = (original: string): string =>
    idMap.get(original) ?? (original.replace(/[^A-Za-z0-9_]/g, '_') || 'node');
  const known = (id: unknown): id is string => typeof id === 'string' && idMap.has(id);

  const out: string[] = [];

  // --- Header + metadata -----------------------------------------------------
  out.push(
    '<!-- GENERATED by `harness flow render` — do not hand-edit; regenerate from the flow JSON. -->',
  );
  out.push(`# Flow · ${escapeMd(doc.slug ?? doc.kind ?? 'flow')}`);
  out.push('');
  const meta = [
    `**Kind**: ${escapeMd(doc.kind ?? 'unknown')}`,
    `**Cursor**: ${escapeMd(doc.cursor ?? '—')}`,
  ];
  if (typeof doc.recommended_next === 'string' && doc.recommended_next.length > 0) {
    meta.push(`**Next**: ${escapeMd(doc.recommended_next)}`);
  }
  meta.push(`**Nodes**: ${nodes.length}`);
  meta.push(`**Events**: ${Array.isArray(doc.events) ? doc.events.length : 0}`);
  out.push(meta.join(' · '));
  out.push('');
  out.push(renderRail(nodes));
  out.push('');

  // --- Mermaid diagram -------------------------------------------------------
  out.push('```mermaid');
  out.push('flowchart TD');

  const mains = nodes.filter((n) => !isExcursion(n));
  const excursions = nodes.filter((n) => isExcursion(n));

  // 1. main node declarations + 2. solid spine edges.
  for (const n of mains) out.push(declareNode(n, mid(n.id)));
  const solidEdges: string[] = [];
  for (const n of mains) {
    for (const t of Array.isArray(n.next) ? n.next : []) {
      if (known(t)) solidEdges.push(`    ${mid(n.id)} --> ${mid(t)}`);
    }
  }
  if (solidEdges.length > 0) {
    out.push('');
    out.push(...solidEdges);
  }

  // 3. excursion declarations + dotted edges (workshops, backpressure, harness seams).
  if (excursions.length > 0) {
    out.push('');
    for (const n of excursions) out.push(declareNode(n, mid(n.id)));
    for (const n of excursions) {
      for (const t of Array.isArray(n.next) ? n.next : []) {
        if (known(t)) out.push(`    ${mid(n.id)} -.-> ${mid(t)}`);
      }
    }
  }

  // 4. genesis user_input bubbles — exactly one per node carrying user_input (rule 6).
  const bubbles = nodes.filter((n) => typeof n.user_input === 'string' && n.user_input.length > 0);
  if (bubbles.length > 0) {
    out.push('');
    for (const n of bubbles) {
      const sid = `say_${mid(n.id)}`;
      out.push(`    ${sid}>"🗣 ${escapeMermaid(n.user_input as string)}"]:::said`);
      out.push(`    ${sid} -.- ${mid(n.id)}`);
    }
  }

  // 5. agents — companion (render:wrap) → subgraph; worker (render:side) → side node (rule 7).
  const agentLines = renderAgents(doc, mid, known);
  if (agentLines.length > 0) {
    out.push('');
    out.push(...agentLines);
  }

  // 6. classDefs (foot).
  out.push('');
  for (const def of CLASS_DEFS) out.push(`    ${def}`);
  out.push('```');

  // --- Legend ----------------------------------------------------------------
  out.push('');
  out.push(LEGEND);

  // --- Node log (the markdown half of AC-06; render-only) --------------------
  const logged = nodes.filter((n) => Array.isArray(n.comments) && n.comments.length > 0);
  if (logged.length > 0) {
    out.push('');
    out.push('## Node log');
    for (const n of logged) {
      out.push('');
      out.push(`### ${escapeMd(n.id)} · ${escapeMd(n.label ?? n.id)}`);
      for (const c of n.comments as FlowComment[]) out.push(renderComment(c));
    }
  }

  return `${out.join('\n')}\n`;
}

/** A compact pip rail over the spine nodes (or all main nodes if no spine types). */
function renderRail(nodes: readonly FlowNode[]): string {
  const spine = nodes.filter((n) => SPINE_TYPES.has(n.type));
  const rail = spine.length > 0 ? spine : nodes.filter((n) => !isExcursion(n));
  if (rail.length === 0) return '**Rail**: (no nodes)';
  const pips = rail.map((n) => STATUS_PIP[n.status] ?? '◇').join('─');
  const names = rail.map((n) => escapeMd(n.id)).join(' · ');
  return `**Rail**: ${pips}  ${names}`;
}

/** One body-log line for a comment: timestamp · source · kind — text [· refs]. */
function renderComment(c: FlowComment): string {
  const at = escapeMd(c.at ?? '—');
  const source = escapeMd(c.source ?? '—');
  const kind = escapeMd(c.kind ?? '—');
  const text = escapeMd(c.text ?? '');
  let line = `- \`${at}\` · ${source} · ${kind} — ${text}`;
  if (Array.isArray(c.refs) && c.refs.length > 0) {
    line += ` · refs: ${c.refs.map((r) => escapeMd(String(r))).join(', ')}`;
  }
  return line;
}

interface FlowAgent {
  slug?: string;
  kind?: string;
  render?: string;
  covers?: string[];
  result?: string;
}

/** Render the `agents[]` overlay: companions wrap their covered phases, workers sit beside. */
function renderAgents(
  doc: FlowDoc,
  mid: (id: string) => string,
  known: (id: unknown) => id is string,
): string[] {
  const agents = Array.isArray((doc as { agents?: unknown }).agents)
    ? ((doc as { agents?: unknown }).agents as FlowAgent[])
    : [];
  const lines: string[] = [];
  agents.forEach((a, i) => {
    const slug = typeof a.slug === 'string' && a.slug.length > 0 ? a.slug : `agent_${i}`;
    const safe = slug.replace(/[^A-Za-z0-9_]/g, '_') || `agent_${i}`;
    const covers = (Array.isArray(a.covers) ? a.covers : []).filter(known);
    if (a.kind === 'worker' || a.render === 'side') {
      const wid = `wrk_${safe}`;
      lines.push(`    ${wid}["🛠 ${escapeMermaid(slug)}"]:::worker`);
      for (const c of covers) lines.push(`    ${wid} -. builds .-> ${mid(c)}`);
    } else {
      // companion (render:wrap) — a subgraph wrapping the covered phases.
      const gid = `cmp_${safe}`;
      lines.push(`    subgraph ${gid}["🤖 ${escapeMermaid(slug)}"]`);
      for (const c of covers) lines.push(`      ${mid(c)}`);
      lines.push('    end');
      lines.push(`    style ${gid} fill:#D1C4E9,stroke:#5E35B1`);
    }
  });
  return lines;
}
