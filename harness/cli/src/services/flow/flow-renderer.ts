import type { FlowComment, FlowDoc, FlowNode } from './flow-events.js';
import { dueChores } from './flow-mutations.js';

/**
 * Deterministic flow renderer (plan 024 Phase 2; AC-06). PURE — `FlowDoc → string`:
 * no I/O, no `node:*`, no `new Date()`, no `process`. The clock/IO stay in the act;
 * it imports the `flow-events` TYPES plus the `dueChores` read from `flow-mutations`
 * (039 AC-11 — the one-line rail surfaces what's due at the cursor); both are
 * pure sibling modules in `services/flow`, so the graph stays acyclic.
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
/**
 * Chore status → SQUARE pip (Phase 4; ws-004 C5). Chores read as a distinct shape
 * from the diamond spine: `□` todo · `■` done · `▨` skipped. A still-`todo` chore
 * at the strongest importance gets the `▣` attention glyph (handled in `pipOf`).
 * Squares ALWAYS render — the rail's `--chores` mode only collapses the names.
 */
const CHORE_PIP: Record<string, string> = {
  todo: '□',
  done: '■',
  skipped: '▨',
};

/**
 * Chore importance → label/rail marker glyph (D5; ws-002). The marker rides the
 * `🧰` badge in the label AND the `⚑ due:` rail callout — the text surface that has
 * no CSS, so the glyph (not the border) carries importance for a weak model.
 * `recommended` / `informational` / anything else → PLAIN (no marker char): `🧰°`
 * optional · `🧰` recommended · `🧰‼` strongly-recommended. Terminal-safe glyphs.
 */
const IMPORTANCE_MARKER: Record<string, string> = {
  optional: '°',
  'strongly-recommended': '‼',
};
/**
 * Chore importance → ADDITIVE classDef (D5). Colour stays TYPE; importance is a
 * second `:::` token (mermaid `id["…"]:::harness:::impStrong`) carrying border-only
 * weight — the graphical read that pairs with the rail-legible glyph marker.
 * `recommended` / `informational` → no border class (plain 1px).
 */
const IMPORTANCE_CLASS: Record<string, string> = {
  optional: 'impOptional',
  'strongly-recommended': 'impStrong',
};
/** The `🧰` badge's importance marker for a chore (`°`/plain/`‼`); '' when unmapped. */
const choreMarker = (importance: string | undefined): string =>
  IMPORTANCE_MARKER[importance ?? ''] ?? '';

/** Rail bands (ws-002) — which segment a node renders in: `pre ─ [ flight ] ─ post`. */
export type Zone = 'preflight' | 'flight' | 'postflight';
const ZONES: ReadonlySet<string> = new Set<string>(['preflight', 'flight', 'postflight']);
/**
 * Default rail band by node TYPE (AC-3 / N12) — the the-flow overlay's map. The map
 * is TOTAL over any overlay: an unlisted/unknown type falls back to `flight` (a
 * graceful default, never an error), so the rail works for every flow kind.
 */
const ZONE_BY_TYPE: Record<string, Zone> = {
  research: 'preflight',
  plan: 'preflight',
  workshop: 'preflight',
  tasks: 'preflight',
  adr: 'preflight',
  phase: 'flight',
  review: 'postflight',
  merge: 'postflight',
  retro: 'postflight',
};

/** A node's rail band: an explicit valid `zone` wins; else the type default; else `flight`. */
export function effectiveZone(node: { type?: string; zone?: unknown }): Zone {
  if (typeof node.zone === 'string' && ZONES.has(node.zone)) return node.zone as Zone;
  return ZONE_BY_TYPE[node.type ?? ''] ?? 'flight';
}

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
  // Importance is an ADDITIVE border channel (D5) — colour stays TYPE; these stack
  // as a SECOND `:::` token (`:::harness:::impStrong`). Chore-ness is now the `🧰`
  // badge + dotted edge, so the old teal `classDef chore` is retired.
  'classDef impOptional stroke-dasharray:2 3;',
  'classDef impStrong stroke-width:3px;',
];

// Two channels (D5/D4): a COLOUR row (type/status — `🧰 chore` dropped, no longer a
// colour) and a BADGES row (the colour-independent label glyphs, incl. D4 `📝
// instructions` and the D5 `🧰` importance markers). Kept as one rendered line.
const LEGEND =
  '**Legend** — colour = type/status: 🟩 done · 🟧 in-progress · 🟥 blocked · 🟦 known · ⬜ assumed' +
  ' · 🔶 decision · 🗣 user input · 🟪 harness · 🤖 companion · 🛠 worker.' +
  ' Badges: 💬 comments · 📄 artifacts · 📝 instructions · 🧰 chore' +
  ' (° optional / recommended / ‼ strongly-recommended).';

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

/** The classDef a node renders with: decision > harness-type > status-mapped > unknown
 *  (D5; AC-04, F-01). Colour now encodes **type** ONLY — the chore flag NO LONGER
 *  overrides the class (039 AC-11 reversed). A chore-flagged harness seam renders
 *  `:::harness` (violet); a chore on a spine node keeps its status-mapped colour;
 *  chore-ness + importance ride the `🧰<marker>` label badge + the additive
 *  `impOptional`/`impStrong` border instead. The decision rhombus still wins its class. */
function nodeClass(node: FlowNode): string {
  if (node.type === 'decision') return 'decision';
  if (HARNESS_TYPES.has(node.type)) return 'harness';
  return STATUS_CLASS[node.status] ?? 'unknown';
}

/**
 * The node label: escaped `label` (or id) + the colour-independent badge channel,
 * in one fixed order — `<label> 💬N 📄N 📝N 🧰<marker>` (D4/D5). `💬N` comments ·
 * `📄N` artifacts · `📝N` instructions (COUNT only — the instruction TEXT never
 * enters the diagram; `orient` prints it) · `🧰<marker>` when the node is a chore,
 * the marker (`°`/plain/`‼`) carrying importance on the text surface.
 */
function nodeLabel(node: FlowNode): string {
  const base = escapeMermaid(node.label ?? node.id);
  const badges: string[] = [];
  const comments = Array.isArray(node.comments) ? node.comments.length : 0;
  if (comments > 0) badges.push(`💬${comments}`);
  const artifacts = Array.isArray(node.artifacts) ? node.artifacts.length : 0;
  if (artifacts > 0) badges.push(`📄${artifacts}`);
  const instructions = Array.isArray(node.instructions) ? node.instructions.length : 0;
  if (instructions > 0) badges.push(`📝${instructions}`);
  if (node.chore !== undefined) badges.push(`🧰${choreMarker(node.chore.importance)}`);
  return badges.length > 0 ? `${base} ${badges.join(' ')}` : base;
}

/**
 * Declare a node: `decision` is a rhombus fork `{"…"}`; everything else a box `["…"]`.
 * Importance rides an ADDITIVE second class token (D5) — `:::<type>:::impOptional` /
 * `:::impStrong` for optional / strongly-recommended chores (colour stays the type
 * class); recommended / informational / non-chore nodes emit the single class token.
 */
function declareNode(node: FlowNode, mid: string): string {
  const label = nodeLabel(node);
  const cls = nodeClass(node);
  const imp = node.chore !== undefined ? IMPORTANCE_CLASS[node.chore.importance] : undefined;
  const classTok = imp ? `:::${cls}:::${imp}` : `:::${cls}`;
  return node.type === 'decision'
    ? `    ${mid}{"${label}"}${classTok}`
    : `    ${mid}["${label}"]${classTok}`;
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
  const nav = doc.nav;
  const meta = [
    `**Kind**: ${escapeMd(doc.kind ?? 'unknown')}`,
    `**Now**: ${escapeMd(nav?.now ?? '—')}`,
  ];
  if (typeof nav?.next === 'string' && nav.next.length > 0) {
    meta.push(`**Next**: ${escapeMd(nav.next)}`);
  }
  if (typeof nav?.intent === 'string' && nav.intent.length > 0) {
    meta.push(`**Intent**: ${escapeMd(nav.intent)}`);
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
  // A node logs when it carries comments OR artifacts — both ride the body-log
  // (discoverable via the node's 💬/📄 badge): the render-surface "clean box +
  // auditable body" rule, extended to artifacts so the box stays slim (grill 8).
  const hasComments = (n: FlowNode): boolean => Array.isArray(n.comments) && n.comments.length > 0;
  const hasArtifacts = (n: FlowNode): boolean =>
    Array.isArray(n.artifacts) && n.artifacts.length > 0;
  const logged = nodes.filter((n) => hasComments(n) || hasArtifacts(n));
  if (logged.length > 0) {
    out.push('');
    out.push('## Node log');
    for (const n of logged) {
      out.push('');
      out.push(`### ${escapeMd(n.id)} · ${escapeMd(n.label ?? n.id)}`);
      if (hasArtifacts(n)) {
        const arts = (n.artifacts as string[]).map((a) => escapeMd(String(a))).join(', ');
        out.push(`- 📄 artifacts: ${arts}`);
      }
      if (hasComments(n)) for (const c of n.comments as FlowComment[]) out.push(renderComment(c));
    }
  }

  return `${out.join('\n')}\n`;
}

/**
 * Topologically order the main spine (non-excursion nodes) by following `next[]`
 * (Kahn's algorithm, insertion-order tie-break → deterministic). "Main" = not a
 * `branch_of` excursion; node TYPE is irrelevant (a `review`/`adr`/`decision`
 * on the main line belongs on the rail). Any node left over after the sort (a
 * cycle within the main subgraph — should not happen post-DAG-check) is appended
 * in insertion order, so the rail never silently drops a node.
 */
function topoOrderMain(nodes: readonly FlowNode[]): FlowNode[] {
  const main = nodes.filter((n) => !isExcursion(n));
  const ids = new Set(main.map((n) => n.id));
  const indeg = new Map<string, number>(main.map((n) => [n.id, 0]));
  for (const n of main) {
    for (const t of Array.isArray(n.next) ? n.next : []) {
      if (ids.has(t)) indeg.set(t, (indeg.get(t) ?? 0) + 1);
    }
  }
  const queue = main.filter((n) => (indeg.get(n.id) ?? 0) === 0); // roots, insertion order
  const queued = new Set(queue.map((n) => n.id));
  const order: FlowNode[] = [];
  while (queue.length > 0) {
    const n = queue.shift() as FlowNode;
    order.push(n);
    for (const t of Array.isArray(n.next) ? n.next : []) {
      if (!ids.has(t)) continue;
      const d = (indeg.get(t) ?? 0) - 1;
      indeg.set(t, d);
      if (d === 0 && !queued.has(t)) {
        const node = main.find((m) => m.id === t);
        if (node) {
          queue.push(node);
          queued.add(t);
        }
      }
    }
  }
  for (const n of main) if (!order.includes(n)) order.push(n); // cycle remnant — never drop
  return order;
}

/**
 * Live-status pip for a node. A chore renders a SQUARE by status (Phase 4): `□`
 * todo · `■` done · `▨` skipped, with `▣` for a still-`todo` strongly-recommended
 * chore (draw the eye). A non-chore node keeps the diamond family (done filled,
 * in-progress half, blocked cross, else hollow). Tolerant — an unknown chore
 * status falls back to the hollow square `□`.
 */
function pipOf(node: FlowNode): string {
  if (node.chore !== undefined) {
    if (node.chore.importance === 'strongly-recommended' && node.status === 'todo') return '▣';
    return CHORE_PIP[node.status] ?? '□';
  }
  return STATUS_PIP[node.status] ?? '◇';
}

/**
 * The rail's chore-name visibility (Phase 4; ws-004 C5). Affects ONLY the names
 * segment — pips (squares) always render, in every mode.
 *   - `show`     every chore named (plain label — the square pip is the chore marker);
 *   - `collapse` (default) strongly-recommended chores stay named; recommended/
 *     optional collapse to a `[*]`/`[*N]` marker; informational are dropped;
 *   - `hide`     un-named chores (and their markers) vanish — only the pip remains.
 */
export type ChoreRailMode = 'show' | 'collapse' | 'hide';
export const CHORE_RAIL_MODES: readonly ChoreRailMode[] = ['show', 'collapse', 'hide'];

/**
 * Build a band's NAME segment honouring the chore `mode`. Each NAMED item renders
 * as `<pip> <label>` — the same pip glyph as the top row (diamond for spine, square
 * for chore; open/half/closed by status), so the name lane is self-describing.
 * Spine nodes are always named. A chore is named when `mode==='show'` OR its
 * importance is `strongly-recommended` (the strongest level refuses to hide — the
 * advisory invariant's only teeth). Otherwise, in `collapse` a run of recommended/
 * optional chores folds into one pip-less `[*]`/`[*N]` token (informational
 * dropped); in `hide` every un-named chore is dropped (its top-row pip is its only
 * trace).
 */
function railNames(band: readonly FlowNode[], mode: ChoreRailMode): string {
  const tokens: string[] = [];
  let collapsed = 0;
  const flush = (): void => {
    if (collapsed > 0) {
      tokens.push(collapsed === 1 ? '[*]' : `[*${collapsed}]`);
      collapsed = 0;
    }
  };
  for (const n of band) {
    // Each named item carries its own pip (the SAME glyph as the top pip row):
    // a diamond for spine nodes, a square for chores; open/half/closed by status.
    const item = `${pipOf(n)} ${escapeMd(n.label ?? n.id)}`;
    if (n.chore === undefined) {
      flush();
      tokens.push(item);
      continue;
    }
    if (mode === 'show' || n.chore.importance === 'strongly-recommended') {
      flush();
      tokens.push(item);
      continue;
    }
    if (mode === 'hide' || n.chore.importance === 'informational') continue; // dropped, no marker
    collapsed++; // recommended / optional in collapse → roll into a pip-less [*N]
  }
  flush();
  return tokens.join(' · ');
}

/**
 * The shared rail BODY (Finding 05) — `<pips>  <names>` grouped into zone bands
 * `pre ─ [ flight ] ─ post`. Walks the main spine (topo order; `branch_of`
 * excursions excluded), pips from LIVE status (no stored counters → no drift),
 * names from `label` (chore names obey `mode`), bands from `effectiveZone`. Reused
 * by the embedded render rail (`**Rail**:`) and the standalone `harness flow rail`.
 */
export function renderRailBody(
  nodes: readonly FlowNode[],
  mode: ChoreRailMode = 'collapse',
): string {
  const spine = topoOrderMain(nodes);
  if (spine.length === 0) return '(no nodes)';
  const bands: Record<Zone, FlowNode[]> = { preflight: [], flight: [], postflight: [] };
  for (const n of spine) bands[effectiveZone(n)].push(n);

  const pipSeg = (band: FlowNode[]): string => band.map(pipOf).join('─');
  const nameSeg = (band: FlowNode[]): string => railNames(band, mode);

  const pips: string[] = [];
  if (bands.preflight.length > 0) pips.push(pipSeg(bands.preflight));
  if (bands.flight.length > 0) pips.push(`[ ${pipSeg(bands.flight)} ]`);
  if (bands.postflight.length > 0) pips.push(pipSeg(bands.postflight));

  const names: string[] = [];
  if (bands.preflight.length > 0) names.push(nameSeg(bands.preflight));
  if (bands.flight.length > 0) names.push(`[ ${nameSeg(bands.flight)} ]`);
  if (bands.postflight.length > 0) names.push(nameSeg(bands.postflight));

  // The PIP lane keeps the box-drawing band join `─` (regular rail, unchanged); the
  // NAME lane joins bands with ` · ` (consistent with within-band dots — the `[ … ]`
  // flight brackets still mark the bands).
  return `${pips.join('─')}  ${names.join(' · ')}`;
}

/** The rail title (AC-4): `provenance.agent` → `doc.title` → `slug` → `'flow'`. */
function railTitle(doc: FlowDoc): string {
  const agent = doc.provenance?.agent;
  if (typeof agent === 'string' && agent.length > 0) return agent;
  if (typeof doc.title === 'string' && doc.title.length > 0) return doc.title;
  if (typeof doc.slug === 'string' && doc.slug.length > 0) return doc.slug;
  return 'flow';
}

/** The standalone `harness flow rail` line: `[<title>] <pips>  <names>` (AC-4). The
 *  `mode` controls chore-name visibility (default `collapse`); pips always render.
 *  When chores are DUE at the cursor (the `dueChores` read — anchored at `nav.now`,
 *  still outstanding) a `⚑ due: …` segment is appended so "what's due here" is visible
 *  without opening the diagram (039 AC-11). No due chores → byte-identical to before. */
export function renderRailLine(doc: FlowDoc, mode: ChoreRailMode = 'collapse'): string {
  const nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
  const line = `[${railTitle(doc)}] ${renderRailBody(nodes, mode)}`;
  const due = dueChores(doc);
  if (due.length === 0) return line;
  // Each due chore carries its `🧰`+importance marker (D5 rail parity) so the text
  // surface signals chore-ness + how strongly it's advised; the `, ` join is kept.
  return `${line}  ⚑ due: ${due
    .map((c) => `${escapeMd(c.label)} 🧰${choreMarker(c.importance)}`)
    .join(', ')}`;
}

/** The embedded rail line for the rendered `.md` — the shared zoned body, labelled. */
function renderRail(nodes: readonly FlowNode[]): string {
  return `**Rail**: ${renderRailBody(nodes)}`;
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
