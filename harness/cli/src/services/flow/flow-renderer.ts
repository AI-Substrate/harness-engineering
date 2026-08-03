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
 * decision: `comments[]` → `💬N` badge + a per-node markdown body-log (the Node
 * log), a distinct `decision` class, covering agents folded into the gutter box).
 *
 * LAYOUT — TD two columns (plan 043). One `flowchart TD` per flow: the spine is a
 * straight LEFT column (every spine node declared once, chained linearly in topo
 * order `n0 --> n1 --> …`); each node's side-content collapses into ONE combined
 * gutter box in a parallel RIGHT column. The old per-excursion fan skewed the spine
 * diagonally (dagre, LAYERED, shoved each node toward its fan); collapsing every
 * node's `branch_of` excursions + covering agents into a single newline-joined box
 * drops the side-node count ~4×, and an invisible `~~~` chain holds the boxes in
 * their own column while dotted `-.-` links bias each box onto its node's row. Each
 * gutter LINE is `<pip><importance-marker> <label>` (agents: `🤖`/`🛠 <slug>`); the
 * per-node 🗣 user_input bubble is dropped (it was the other skew source). Row
 * alignment is a dagre BIAS, not guaranteed — but the markdown reading order (rail
 * → spine column) is a dead-straight spine, rendering inline anywhere (no ELK/Graphviz).
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
const HARNESS_TYPES = new Set(['harness-boot', 'harness-retro', 'backpressure', 'observe']);
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
 * border-only weight applied via a SEPARATE `class <id> <impClass>;` statement
 * (mermaid rejects a chained `id:::harness:::impStrong`) — the graphical read that
 * pairs with the rail-legible glyph marker. `recommended` / `informational` → no
 * border class (plain 1px).
 */
const IMPORTANCE_CLASS: Record<string, string> = {
  optional: 'impOptional',
  'strongly-recommended': 'impStrong',
};
/** The `🧰` badge's importance marker for a chore (`°`/plain/`‼`); '' when unmapped. */
const choreMarker = (importance: string | undefined): string =>
  IMPORTANCE_MARKER[importance ?? ''] ?? '';

/**
 * Chore status → the `🧰` badge's status mark (SPACED off the badge for legibility):
 * a satisfied chore gets a ` ✓` tick, a skipped one a ` ✕`, and an incomplete chore
 * NO mark at all — its faded-violet fill (see `nodeClass`) already reads as "not yet".
 * So done chores POP (tick + full colour) out of a faded, unmarked backlog. '' for an
 * incomplete chore or a non-done/skipped state.
 */
const choreStatusGlyph = (status: string | undefined): string =>
  status === 'done' ? ' ✓' : status === 'skipped' ? ' ✕' : '';

/**
 * The dd-gate badge for a node carrying a `dd_link` (plan 065 P6 T005).
 *
 * `⛨` (the shield) reads as "guarded" and does not collide with any glyph already
 * in the badge channel. The mark is the RECORDED reading and nothing else — the
 * renderer resolves no addresses, loads no documents and consults no schema, so it
 * stays a pure `FlowDoc → markdown` function exactly as it was. A link that has
 * never been evaluated renders the bare shield; an evaluated one carries its
 * `terminal/total` count and a ` ✓` when the gate was open.
 *
 * A non-gating link (`gate: false`) is still badged: the node genuinely does point
 * at that document, and hiding the fact would make the diagram less true than the
 * data. The gating/not-gating distinction belongs to `orient`, which has the room
 * to say it in words.
 */
function ddGateBadge(node: FlowNode): string | null {
  const link = node.dd_link;
  if (link === undefined || typeof link.address !== 'string') return null;
  const reading = link.reading;
  if (reading === undefined) return '⛨';
  const tick = reading.status === 'complete' ? ' ✓' : '';
  return `⛨${reading.terminal}/${reading.total}${tick}`;
}

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

/** The classDef block — emitted once at the foot of the diagram (rule 1). Saturated
 *  status palette (not pastel): the status a node is IN reads at a glance — vivid green
 *  done, bright green in-progress, hard red blocked, strong blue known — with white
 *  text on the dark fills for contrast. `assumed`/`unknown` stay deliberately muted
 *  (dashed, low-chroma) because they are NOT-yet-real states. */
const CLASS_DEFS: readonly string[] = [
  'classDef done fill:#1B7F2E,stroke:#0F4F1B,color:#fff;',
  'classDef wip fill:#43C04A,stroke:#1B7F2E,color:#04210A;',
  'classDef blocked fill:#E53935,stroke:#8E1513,color:#fff;',
  'classDef known fill:#1E73E8,stroke:#0D3F86,color:#fff;',
  'classDef assumed fill:#CFD8DC,stroke:#607D8B,color:#1a1a1a,stroke-dasharray:5 3;',
  'classDef said fill:#FFD21F,stroke:#C79100,color:#241c00;',
  'classDef harness fill:#7E3FF2,stroke:#4A1FA8,color:#fff;',
  // A harness CHORE that is not yet done — faded violet, so the backlog recedes and a
  // satisfied (full-violet + `✓`) chore pops out of it.
  'classDef harnessFaded fill:#D6CBEC,stroke:#A892D4,color:#5B4E78;',
  'classDef decision fill:#FF8F00,stroke:#B25E00,color:#1a1100,stroke-dasharray:2 2;',
  'classDef companion fill:#AB2FCB,stroke:#6A1480,color:#fff;',
  'classDef worker fill:#00A38C,stroke:#005046,color:#fff;',
  'classDef unknown fill:#ECEFF1,stroke:#90A4AE,color:#1a1a1a,stroke-dasharray:1 4;',
  // The gutter box (plan 043 TD-columns): one combined right-column box per spine node
  // holding its `branch_of` excursions + covering agents as newline-joined lines.
  // `text-align:left` keeps the stacked lines flush; a soft violet fill reads as a
  // distinct gutter lane beside the saturated spine.
  'classDef chore fill:#f5f3ff,stroke:#8b5cf6,color:#4c1d95,text-align:left;',
  // Importance is an ADDITIVE border channel (D5) — colour stays TYPE; these are
  // applied via a separate `class <id> <impClass>;` statement (mermaid rejects a
  // chained `:::harness:::impStrong`). Chore-ness is now the `🧰` badge + dotted
  // edge, so the old teal `classDef chore` is retired.
  'classDef impOptional stroke-dasharray:2 3;',
  'classDef impStrong stroke-width:3px;',
  // The CURRENT node (`nav.now`) — a bright-orange "you are here" overlay, applied
  // LAST (after the status class + any importance border) so it always wins. Vivid
  // fill + a heavy ring so the cursor position is unmistakable regardless of status.
  'classDef current fill:#FF7A00,stroke:#C24E00,color:#1a0e00,stroke-width:4px;',
];

// Two channels (D5/D4): a COLOUR row (type/status — `🧰 chore` dropped, no longer a
// colour) and a BADGES row (the colour-independent label glyphs, incl. D4 `📝
// instructions` and the D5 `🧰` importance markers). Kept as one rendered line.
const LEGEND =
  '**Legend** — colour = type/status: 🟩 done · 🟢 in-progress · 🟥 blocked · 🟦 known · ⬜ assumed' +
  ' · 🔶 decision · 🗣 user input · 🟪 harness chore (faded = not yet done) · 🤖 companion · 🛠 worker' +
  ' · 🟧 current (you are here).' +
  ' Badges: 💬 comments · 📄 artifacts · 📝 instructions · 🧰 chore' +
  ' (° optional / recommended / ‼ strongly-recommended; ✓ done · ✕ skipped)' +
  ' · ⛨ dd gate (terminal/total from the last evaluation; ✓ = open).';

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
 *  (D5; AC-04, F-01). Colour encodes **type** — a harness seam is violet — but a harness
 *  CHORE additionally dims by status: an incomplete/skipped chore renders FADED violet
 *  (`harnessFaded`) and a satisfied one the FULL vivid `harness`, so a done chore visibly
 *  pops out of the faded backlog (paired with the `✓` label tick). A chore on a spine
 *  node keeps its status-mapped colour; the decision rhombus still wins its class. */
function nodeClass(node: FlowNode): string {
  if (node.type === 'decision') return 'decision';
  if (HARNESS_TYPES.has(node.type)) {
    if (node.chore !== undefined && node.status !== 'done') return 'harnessFaded';
    return 'harness';
  }
  return STATUS_CLASS[node.status] ?? 'unknown';
}

/**
 * The node label: escaped `label` (or id) + the colour-independent badge channel,
 * in one fixed order — `<label> 💬N 📄N 📝N 🧰<marker><pip>` (D4/D5). `💬N` comments ·
 * `📄N` artifacts · `📝N` instructions (COUNT only — the instruction TEXT never
 * enters the diagram; `orient` prints it) · `🧰<marker><mark>` when the node is a chore,
 * the marker (`°`/plain/`‼`) carrying importance and the spaced trailing mark (` ✓` done ·
 * ` ✕` skipped · none for incomplete) carrying STATUS on the text surface — paired with
 * the faded-violet fill an incomplete chore gets, so done chores pop.
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
  if (node.chore !== undefined)
    badges.push(`🧰${choreMarker(node.chore.importance)}${choreStatusGlyph(node.status)}`);
  const gate = ddGateBadge(node);
  if (gate !== null) badges.push(gate);
  return badges.length > 0 ? `${base} ${badges.join(' ')}` : base;
}

/**
 * Declare a node: `decision` is a rhombus fork `{"…"}`; everything else a box `["…"]`.
 * Only the single TYPE class is inline (`:::<type>`) — mermaid rejects a chained
 * `:::a:::b`. The additive importance border (D5) is emitted SEPARATELY as a
 * `class <id> <impClass>;` statement (see importanceClassLine); recommended /
 * informational / non-chore nodes get no such statement.
 */
function declareNode(node: FlowNode, mid: string): string {
  const label = nodeLabel(node);
  const cls = nodeClass(node);
  // Only the TYPE class goes inline — mermaid's `:::` shorthand takes exactly ONE
  // class; a chained `:::type:::imp` is a PARSE ERROR (STYLE_SEPARATOR). The additive
  // importance border is applied separately via a `class <id> <imp>;` statement
  // (see importanceClassLine), which mermaid does accept.
  return node.type === 'decision'
    ? `    ${mid}{"${label}"}:::${cls}`
    : `    ${mid}["${label}"]:::${cls}`;
}

/** The additive importance border for a chore node, as a SEPARATE mermaid `class`
 *  statement (D5). Mermaid rejects chained inline classes (`id:::a:::b`), so the
 *  `impOptional`/`impStrong` border MUST be applied with `class <id> <impClass>;`
 *  after the classDefs — never as a second `:::` token. `recommended`/`informational`
 *  map to no border, so they yield no line. */
function importanceClassLine(node: FlowNode, mid: string): string | undefined {
  if (node.chore === undefined) return undefined;
  const imp = IMPORTANCE_CLASS[node.chore.importance];
  return imp ? `    class ${mid} ${imp};` : undefined;
}

function isExcursion(node: FlowNode): boolean {
  return typeof node.branch_of === 'string' && node.branch_of.length > 0;
}

/**
 * The gutter LINE pip for an excursion folded into a combined box (plan 043). A chore
 * shows its SQUARE by status (`□` todo · `■` done · `▨` skipped); a non-chore excursion
 * keeps the diamond family. NOTE: unlike `pipOf`, importance is NOT folded into the pip
 * glyph here — it rides a separate marker char so a strongly-recommended todo reads
 * `□‼`, not `▣` (the gutter line carries pip + marker as two channels, like the rail).
 */
function gutterPip(node: FlowNode): string {
  if (node.chore !== undefined) return CHORE_PIP[node.status] ?? '□';
  return STATUS_PIP[node.status] ?? '◇';
}

/** One gutter-box line for an excursion: `<pip><importance-marker> <escaped label>`. */
function gutterLine(node: FlowNode): string {
  const marker = node.chore !== undefined ? choreMarker(node.chore.importance) : '';
  return `${gutterPip(node)}${marker} ${escapeMermaid(node.label ?? node.id)}`;
}

/** One gutter-box line for a covering agent: `🛠 <slug>` (worker/side) or `🤖 <slug>`. */
function agentGutterLine(a: FlowAgent): string {
  const slug = typeof a.slug === 'string' && a.slug.length > 0 ? a.slug : 'agent';
  const glyph = a.kind === 'worker' || a.render === 'side' ? '🛠' : '🤖';
  return `${glyph} ${escapeMermaid(slug)}`;
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

  // --- TD two-column diagram (plan 043) -------------------------------------
  // ONE `flowchart TD`: the spine is a straight LEFT column (declared once, chained
  // linearly in topo order); each node's side-content (its `branch_of` excursions +
  // covering agents) collapses into ONE combined gutter box in a parallel RIGHT
  // column, held by an invisible `~~~` chain and biased onto its node's row by a
  // dotted `-.-` link. Collapsing the old per-excursion fan into one box per node
  // (~4× fewer side nodes) + dropping the 🗣 user_input bubble removes the diagonal
  // skew. Row alignment is a dagre BIAS, not guaranteed.
  const excursions = nodes.filter((n) => isExcursion(n));
  const order = topoOrderMain(nodes);
  const orderedIds = new Set(order.map((n) => n.id));

  // group excursions under their `branch_of` parent; an orphan (parent missing/not on
  // the spine) rides a trailing gutter box so the renderer never silently drops a node.
  const exByParent = new Map<string, FlowNode[]>();
  for (const n of excursions) {
    const key = typeof n.branch_of === 'string' && orderedIds.has(n.branch_of) ? n.branch_of : '';
    const arr = exByParent.get(key);
    if (arr) arr.push(n);
    else exByParent.set(key, [n]);
  }
  const docAgents: FlowAgent[] = Array.isArray((doc as { agents?: unknown }).agents)
    ? ((doc as { agents?: unknown }).agents as FlowAgent[])
    : [];
  const agentsFor = (id: string): FlowAgent[] =>
    docAgents.filter((a) => (Array.isArray(a.covers) ? a.covers : []).includes(id));

  out.push('```mermaid');
  out.push('flowchart TD');

  // 1) spine node declarations (badges/classes/decision-rhombus preserved).
  for (const n of order) out.push(declareNode(n, mid(n.id)));

  // 2) the spine chain — one connected left column in reading order.
  if (order.length >= 2) {
    out.push('');
    out.push(`    ${order.map((n) => mid(n.id)).join(' --> ')}`);
  }

  // 3) one combined gutter box per spine node carrying side-content (excursions +
  //    covering agents), in spine order; plus a trailing box for any orphans.
  const gutters: { parentMid: string | null; boxId: string }[] = [];
  const gutterDecls: string[] = [];
  for (const head of order) {
    const lines = [
      ...(exByParent.get(head.id) ?? []).map(gutterLine),
      ...agentsFor(head.id).map(agentGutterLine),
    ];
    if (lines.length === 0) continue;
    const boxId = `${mid(head.id)}C`;
    gutterDecls.push(`    ${boxId}["${lines.join('<br/>')}"]:::chore`);
    gutters.push({ parentMid: mid(head.id), boxId });
  }
  const orphans = exByParent.get('') ?? [];
  if (orphans.length > 0) {
    gutterDecls.push(`    orphansC["${orphans.map(gutterLine).join('<br/>')}"]:::chore`);
    gutters.push({ parentMid: null, boxId: 'orphansC' });
  }
  if (gutterDecls.length > 0) {
    out.push('');
    for (const d of gutterDecls) out.push(d);
  }

  // 4) invisible chain holds the gutter boxes in their own column (spine order).
  if (gutters.length >= 2) {
    out.push('');
    out.push('    %% invisible chain holds the gutter boxes in their own column');
    out.push(`    ${gutters.map((g) => g.boxId).join(' ~~~ ')}`);
  }

  // 5) dotted links bias each gutter box beside its node (same row).
  const linked = gutters.filter((g) => g.parentMid !== null);
  if (linked.length > 0) {
    out.push('');
    out.push('    %% dotted links pull each gutter box beside its node');
    for (const g of linked) out.push(`    ${g.parentMid} -.- ${g.boxId}`);
  }

  // 6) classDefs (only those referenced) + additive importance borders + the current
  //    overlay LAST so the bright-orange "you are here" wins over status + importance.
  const used = new Set<string>();
  for (const n of order) used.add(nodeClass(n));
  if (gutters.length > 0) used.add('chore');
  for (const n of order) {
    if (n.chore !== undefined) {
      const ic = IMPORTANCE_CLASS[n.chore.importance];
      if (ic) used.add(ic);
    }
  }
  const currentId =
    typeof nav?.now === 'string' && orderedIds.has(nav.now) ? (nav.now as string) : null;
  if (currentId) used.add('current');

  out.push('');
  for (const def of CLASS_DEFS) {
    const start = 'classDef '.length;
    const name = def.slice(start, def.indexOf(' ', start));
    if (used.has(name)) out.push(`    ${def}`);
  }
  for (const n of order) {
    const line = importanceClassLine(n, mid(n.id));
    if (line) out.push(line);
  }
  if (currentId) out.push(`    class ${mid(currentId)} current;`);
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
  const gate = railGateCallout(doc);
  if (due.length === 0) return `${line}${gate}`;
  // Each due chore carries its `🧰`+importance marker (D5 rail parity) so the text
  // surface signals chore-ness + how strongly it's advised; the `, ` join is kept.
  return `${line}  ⚑ due: ${due
    .map((c) => `${escapeMd(c.label)} 🧰${choreMarker(c.importance)}`)
    .join(', ')}${gate}`;
}

/**
 * The `⚑ gate:` rail segment for a GATING `dd_link` at `nav.now` (plan 065 P6 T005).
 *
 * It flags the node the cursor is standing on, because that is the node whose gate
 * is about to refuse a departure — a gate three nodes away is not yet anyone's
 * problem, and putting every gated node on a one-line rail would drown the signal
 * the callout exists to carry.
 *
 * Like every other rail segment this is PURE: it reports the recorded reading, and
 * says `not yet evaluated` rather than resolving an address to find out. An
 * un-gating link (`gate: false`) never appears here — it cannot stop anything.
 * No gate at the cursor ⇒ the empty string, so the line stays byte-identical to
 * what it was before this existed.
 */
function railGateCallout(doc: FlowDoc): string {
  const now = doc.nav?.now;
  if (typeof now !== 'string' || now.length === 0) return '';
  const node = (Array.isArray(doc.nodes) ? doc.nodes : []).find((n) => n.id === now);
  const link = node?.dd_link;
  if (node === undefined || link === undefined || link.gate === false) return '';
  if (typeof link.address !== 'string' || link.address.length === 0) return '';
  const reading = link.reading;
  const state =
    reading === undefined
      ? 'not yet evaluated'
      : reading.status === 'complete'
        ? `${reading.terminal}/${reading.total} ✓`
        : `${reading.terminal}/${reading.total}`;
  return `  ⚑ gate: ${escapeMd(node.label ?? node.id)} ⛨ ${state}`;
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
