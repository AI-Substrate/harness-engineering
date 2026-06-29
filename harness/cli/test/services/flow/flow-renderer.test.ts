import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FlowDoc, FlowNode } from '../../../src/services/flow/flow-events.js';
import {
  effectiveZone,
  renderFlow,
  renderRailBody,
  renderRailLine,
} from '../../../src/services/flow/flow-renderer.js';

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/render', import.meta.url));

function loadFixture(name: string): FlowDoc {
  return JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, 'utf8')) as FlowDoc;
}

/** A minimal valid FlowDoc with the given nodes (root fields the renderer reads). */
function doc(nodes: Partial<FlowNode>[], extra: Partial<FlowDoc> = {}): FlowDoc {
  return {
    schema_version: 1,
    kind: 'flight-plan',
    slug: 'test',
    nav: { now: nodes[0]?.id ?? '', next: null },
    created_at: '2026-01-01T00:00:00Z',
    provenance: {
      record_kind: 'flow',
      harness_version: '0.0.0',
      branch: null,
      repo: '',
      created_at: '2026-01-01T00:00:00Z',
      agent: null,
      plan_id: null,
    },
    events: [],
    nodes: nodes as FlowNode[],
    ...extra,
  } as FlowDoc;
}

/** Extract the FIRST fenced mermaid block body (between the ``` fences). */
function mermaidBlock(rendered: string): string {
  const m = rendered.match(/```mermaid\n([\s\S]*?)\n```/);
  return m ? m[1] : '';
}

/** Extract EVERY fenced mermaid block body (the sections render emits one per node). */
function mermaidBlocks(rendered: string): string[] {
  return [...rendered.matchAll(/```mermaid\n([\s\S]*?)\n```/g)].map((m) => m[1]);
}

/** The harness's own headless `mermaid.parse()` runner (jsdom, no Chromium) — the
 *  SAME validator `harness markdown-lint` uses, reused here because its frozen scope
 *  excludes `docs/plans/**` + test fixtures, so the renderer's output was never
 *  syntax-checked (which let an invalid chained `:::a:::b` ship). */
const MERMAID_RUNNER = fileURLToPath(
  new URL(
    '../../../../../.harness/extensions/markdown-lint/lib/mermaid-runner.mjs',
    import.meta.url,
  ),
);

type Fence = { path: string; text: string };
function validateMermaid(fences: Fence[]): { path?: string; valid: boolean; error?: string }[] {
  const out = execFileSync('node', [MERMAID_RUNNER, JSON.stringify(fences)], { encoding: 'utf8' });
  const last = out.trim().split('\n').filter(Boolean).pop() ?? '{}';
  const parsed = JSON.parse(last) as {
    ok: boolean;
    loadError?: string;
    results?: { path?: string; valid: boolean; error?: string }[];
  };
  if (!parsed.ok) throw new Error(`mermaid-runner setup failed: ${parsed.loadError}`);
  return parsed.results ?? [];
}

// ---------------------------------------------------------------------------
// Plan 040 — the renderer's mermaid output must actually PARSE. A chained inline
// class (`id:::harness:::impOptional`) is a mermaid PARSE ERROR (STYLE_SEPARATOR)
// that string-only golden comparison never caught — importance borders go via a
// separate `class <id> <imp>;` statement instead.
// ---------------------------------------------------------------------------

describe('flow-renderer · rendered mermaid is parse-valid (plan 040)', () => {
  const fixtures = readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));

  it('every golden fixture renders syntactically valid mermaid (headless mermaid.parse)', () => {
    const fences = fixtures
      .map((name) => ({ path: name, text: mermaidBlock(renderFlow(loadFixture(name))) }))
      .filter((f) => f.text.length > 0);
    const results = validateMermaid(fences);
    const invalid = results.filter((r) => !r.valid);
    expect(invalid, `invalid mermaid fences: ${JSON.stringify(invalid)}`).toHaveLength(0);
  });

  it('importance borders use a separate `class` statement, never a chained `:::a:::b`', () => {
    const out = renderFlow(
      doc([
        { id: 'p1', type: 'phase', label: 'P1', status: 'known', next: ['ship'] },
        { id: 'ship', type: 'ship', label: 'Ship', status: 'assumed', next: [] },
        {
          id: 'opt',
          type: 'backpressure',
          label: 'Opt',
          status: 'assumed',
          branch_of: 'p1',
          next: ['p1'],
          chore: { kind: 'command', importance: 'optional' },
        },
        {
          id: 'strong',
          type: 'harness-retro',
          label: 'Strong',
          status: 'assumed',
          branch_of: 'p1',
          next: ['p1'],
          chore: { kind: 'command', importance: 'strongly-recommended' },
        },
      ]),
    );
    // the bug: no chained inline class token anywhere across any per-node fence
    expect(out).not.toMatch(/:::[A-Za-z][\w-]*:::/);
    // importance applied as separate, valid `class` statements (in p1's fence — both
    // chores branch off p1, so they render in its section)
    expect(out).toContain('class opt impOptional;');
    expect(out).toContain('class strong impStrong;');
    // and every fence actually parses
    for (const block of mermaidBlocks(out)) {
      const [res] = validateMermaid([{ path: 'importance', text: block }]);
      expect(res.valid, `mermaid error: ${res.error}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// T001 — golden-file render parity (byte-identical) + drift detection.
// ---------------------------------------------------------------------------

describe('flow-renderer · golden-file parity', () => {
  const fixtures = readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));

  it('discovers committed fixtures', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(2);
  });

  // Regenerate the goldens with `npm run gen:flow-fixtures` (which runs the built
  // `harness flow render --output` over each <name>.json). The goldens are derived
  // artifacts — NEVER hand-edit them; this test pins them byte-identical.
  for (const name of fixtures) {
    it(`renders ${name}.json byte-identical to its committed ${name}.md golden`, () => {
      const golden = readFileSync(`${FIXTURE_DIR}/${name}.md`, 'utf8');
      expect(renderFlow(loadFixture(name))).toBe(golden);
    });
  }

  it('detects drift — a mutated doc no longer matches the committed golden', () => {
    const fp = loadFixture('flight-plan-024');
    const golden = readFileSync(`${FIXTURE_DIR}/flight-plan-024.md`, 'utf8');
    const mutated = { ...fp, nav: { now: 'merge', next: null } } as FlowDoc;
    expect(renderFlow(mutated)).not.toBe(golden);
  });

  it('is idempotent — rendering twice yields identical bytes', () => {
    const d = loadFixture('kitchen-sink');
    expect(renderFlow(d)).toBe(renderFlow(d));
  });
});

// ---------------------------------------------------------------------------
// T002 — every render rule.
// ---------------------------------------------------------------------------

describe('flow-renderer · render rules', () => {
  it('emits flowchart LR + only the classDefs a fence references (rule 1, sections)', () => {
    const out = renderFlow(
      doc([{ id: 'a', type: 'research', label: 'A', status: 'done', next: [] }]),
    );
    // sections render: each node is its own small left-to-right diagram.
    expect(out).toContain('flowchart LR');
    expect(out).not.toContain('flowchart TD');
    // classDefs are emitted ON DEMAND — a lone `done` node defines only `classDef done`,
    // never the unused rest (keeps each fence minimal + valid).
    expect(out).toContain('classDef done');
    expect(out).not.toContain('classDef wip');
    expect(out).not.toContain('classDef worker');
    // D5 — chore is no longer a colour; the teal `classDef chore` is retired.
    expect(out).not.toContain('classDef chore ');
  });

  it('renders spine nodes as ordered sections (rule 2, sections)', () => {
    const out = renderFlow(
      doc([
        { id: 'research', type: 'research', label: 'R', status: 'done', next: ['plan'] },
        { id: 'plan', type: 'plan', label: 'P', status: 'done', next: ['p1'] },
        { id: 'p1', type: 'phase', label: 'Phase 1', status: 'in_progress', next: [] },
      ]),
    );
    // each spine node is a heading + its own fence, in topo order (the document is the spine)
    expect(out).toContain('### ◆ R · _done_');
    expect(out).toContain('### ◆ P · _done_');
    expect(out).toContain('### ◐ Phase 1 · _in progress_');
    expect(out).toContain('p1["Phase 1"]:::wip');
    // heading order follows the flow, joined by `↓`
    expect(out.indexOf('### ◆ R')).toBeLessThan(out.indexOf('### ◆ P'));
    expect(out.indexOf('### ◆ P')).toBeLessThan(out.indexOf('### ◐ Phase 1'));
    expect(out).toContain('\n↓\n');
  });

  it('maps each status to its class (rule 5)', () => {
    const out = renderFlow(
      doc([
        { id: 'a', type: 'phase', label: 'a', status: 'done', next: [] },
        { id: 'b', type: 'phase', label: 'b', status: 'in_progress', next: [] },
        { id: 'c', type: 'phase', label: 'c', status: 'blocked', next: [] },
        { id: 'd', type: 'phase', label: 'd', status: 'known', next: [] },
        { id: 'e', type: 'phase', label: 'e', status: 'assumed', next: [] },
      ]),
    );
    expect(out).toContain('a["a"]:::done');
    expect(out).toContain('b["b"]:::wip');
    expect(out).toContain('c["c"]:::blocked');
    expect(out).toContain('d["d"]:::known');
    expect(out).toContain('e["e"]:::assumed');
  });

  it('renders excursions (branch_of) as dotted edges (rule 3)', () => {
    const out = renderFlow(
      doc([
        { id: 'plan', type: 'plan', label: 'P', status: 'done', next: ['merge'] },
        { id: 'merge', type: 'merge', label: 'M', status: 'known', next: [] },
        {
          id: 'ws',
          type: 'workshop',
          label: 'W',
          status: 'done',
          branch_of: 'plan',
          next: ['plan'],
        },
      ]),
    );
    // the excursion renders inside its parent's section, attached by an undirected
    // dotted link (`parent -.- child`); merge is its own separate section.
    expect(out).toContain('plan -.- ws');
    expect(out).toContain('### ◇ M · _known_');
  });

  it('styles harness-seam nodes violet regardless of status (rule 4/5)', () => {
    const out = renderFlow(
      doc([
        { id: 'p1', type: 'phase', label: 'P1', status: 'done', next: [] },
        {
          id: 'boot',
          type: 'harness-boot',
          label: 'boot',
          status: 'done',
          branch_of: 'p1',
          next: ['p1'],
        },
        {
          id: 'retro',
          type: 'harness-retro',
          label: 'retro',
          status: 'known',
          branch_of: 'p1',
          next: ['p1'],
        },
        {
          id: 'bp',
          type: 'backpressure',
          label: 'bp',
          status: 'assumed',
          branch_of: 'p1',
          next: ['p1'],
        },
      ]),
    );
    expect(out).toContain('boot["boot"]:::harness');
    expect(out).toContain('retro["retro"]:::harness');
    expect(out).toContain('bp["bp"]:::harness');
  });

  it('styles an `observe` seam violet too — colour=type, not status (plan 040 P3.1)', () => {
    // `observe` is a harness-loop seam exactly like backpressure/boot/retro: the
    // per-phase `coding`-hook capture. It must render `:::harness`, never fall to
    // status-mapping (`:::assumed`). Covers both a bare seam and a chore-flagged one.
    const out = renderFlow(
      doc([
        { id: 'p1', type: 'phase', label: 'P1', status: 'in_progress', next: [] },
        {
          id: 'obsbare',
          type: 'observe',
          label: 'observe',
          status: 'assumed',
          branch_of: 'p1',
          next: ['p1'],
        },
        {
          id: 'obschore',
          type: 'observe',
          label: 'Observe',
          status: 'assumed',
          branch_of: 'p1',
          next: ['p1'],
          chore: { kind: 'command', importance: 'recommended' },
        },
      ]),
    );
    // bare observe → violet despite `assumed` status (today it renders `:::assumed`).
    expect(out).toContain('obsbare["observe"]:::harness');
    // chore-flagged observe, still incomplete → FADED violet AND keeps its `🧰` badge.
    expect(out).toContain('obschore["Observe 🧰"]:::harnessFaded');
  });

  it('emits exactly one genesis bubble per node carrying user_input (rule 6)', () => {
    const out = renderFlow(
      doc([
        { id: 'a', type: 'research', label: 'A', status: 'done', next: ['b'], user_input: 'do A' },
        { id: 'b', type: 'plan', label: 'B', status: 'done', next: [] },
      ]),
    );
    expect(out).toContain('say_a>"🗣 do A"]:::said');
    expect(out).toContain('say_a -.- a');
    // exactly one bubble (one node had user_input)
    expect((out.match(/:::said/g) ?? []).length).toBe(1);
    expect(out).not.toContain('say_b');
  });

  it('badges comments[] and body-logs them, source/kind/refs tagged (render-surface)', () => {
    const out = renderFlow(
      doc([
        {
          id: 'plan',
          type: 'plan',
          label: 'Plan',
          status: 'done',
          next: [],
          comments: [
            { at: '2026-01-01T00:00:00Z', text: 'first', source: 'agent', kind: 'note' },
            {
              at: '2026-01-02T00:00:00Z',
              text: 'second',
              source: 'user',
              kind: 'decision',
              refs: ['x.md'],
            },
          ],
        },
      ]),
    );
    expect(out).toContain('plan["Plan 💬2"]:::done'); // count badge
    expect(out).toContain('## Node log');
    expect(out).toContain('### plan · Plan');
    expect(out).toContain('- `2026-01-01T00:00:00Z` · agent · note — first');
    expect(out).toContain('- `2026-01-02T00:00:00Z` · user · decision — second · refs: x.md');
  });

  it('renders a decision node as a distinct fork class + rhombus (rule: decision)', () => {
    const out = renderFlow(
      doc([
        { id: 'dec', type: 'decision', label: 'Pick', status: 'known', next: ['a', 'b'] },
        { id: 'a', type: 'phase', label: 'A', status: 'known', next: [] },
        { id: 'b', type: 'phase', label: 'B', status: 'known', next: [] },
      ]),
    );
    // decision keeps its rhombus + class; its branches a/b are their own sections
    // (no inter-section spine edges in the sections render).
    expect(out).toContain('dec{"Pick"}:::decision');
    expect(out).toContain('### ◇ A · _known_');
    expect(out).toContain('### ◇ B · _known_');
  });

  it('renders covering agents inside the covered node section (rule 7, sections)', () => {
    const out = renderFlow(
      doc([{ id: 'p1', type: 'phase', label: 'P1', status: 'done', next: [] }], {
        agents: [
          { slug: 'code-review-companion', kind: 'companion', render: 'wrap', covers: ['p1'] },
          { slug: 'docs-writer', kind: 'worker', render: 'side', covers: ['p1'] },
        ],
      } as Partial<FlowDoc>),
    );
    // a per-fence section can't span a cross-fence subgraph, so a companion renders
    // as a labelled node that `covers` the head; a worker as a node that `builds` it.
    expect(out).toContain('cmp_code_review_companion["🤖 code-review-companion"]:::companion');
    expect(out).toContain('cmp_code_review_companion -. covers .-> p1');
    expect(out).toContain('wrk_docs_writer["🛠 docs-writer"]:::worker');
    expect(out).toContain('wrk_docs_writer -. builds .-> p1');
  });

  it('emits the legend and the rail (rule 8 + rail)', () => {
    const out = renderFlow(
      doc([
        { id: 'research', type: 'research', label: 'R', status: 'done', next: ['merge'] },
        { id: 'merge', type: 'merge', label: 'M', status: 'known', next: [] },
      ]),
    );
    // D5 — two-channel legend: a colour=type/status row, then a Badges row.
    expect(out).toContain('**Legend** — colour = type/status:');
    expect(out).toContain('Badges: 💬 comments · 📄 artifacts · 📝 instructions · 🧰 chore');
    expect(out).not.toContain('🧰 chore (upkeep)'); // chore is no longer a colour
    expect(out).toContain('**Rail**:');
    // zoned; each name carries its pip; bands joined by ` · `: research(pre,done) · merge(post,known)
    expect(out).toContain('**Rail**: ◆─◇  ◆ R · ◇ M');
  });

  it('rails the main spine in flow order incl. `review`, regardless of array order (rail fix)', () => {
    // Nodes deliberately OUT OF ARRAY ORDER; the edges define the spine.
    const out = renderFlow(
      doc([
        { id: 'merge', type: 'merge', label: 'M', status: 'known', next: [] },
        { id: 'p2', type: 'phase', label: 'P2', status: 'done', next: ['review'] },
        { id: 'research', type: 'research', label: 'R', status: 'done', next: ['plan'] },
        { id: 'review', type: 'review', label: 'Rev', status: 'known', next: ['merge'] },
        { id: 'plan', type: 'plan', label: 'Pl', status: 'done', next: ['p2'] },
        {
          id: 'ws',
          type: 'workshop',
          label: 'W',
          status: 'done',
          branch_of: 'plan',
          next: ['plan'],
        },
      ]),
    );
    // Topological order (NOT array order); `review` (not a legacy "spine type") is on the
    // rail; the `ws` excursion never is.
    // topo order, zone-banded, label names; `review` on the rail, `ws` excursion never
    expect(out).toContain('**Rail**: ◆─◆─[ ◆ ]─◇─◇  ◆ R · ◆ Pl · [ ◆ P2 ] · ◇ Rev · ◇ M');
    expect(out).not.toMatch(/· ws\b/);
  });

  it('badges artifacts[] (`📄N`) and body-logs the paths (artifacts surface)', () => {
    const out = renderFlow(
      doc([
        {
          id: 'research',
          type: 'research',
          label: 'Research',
          status: 'done',
          next: [],
          artifacts: ['research-dossier.md', 'original-ask.md'],
        },
      ]),
    );
    expect(out).toContain('research["Research 📄2"]:::done'); // count badge
    expect(out).toContain('## Node log');
    expect(out).toContain('### research · Research');
    expect(out).toContain('- 📄 artifacts: research-dossier.md, original-ask.md');
  });

  it('orders badges 💬 then 📄 when a node has both comments and artifacts', () => {
    const out = renderFlow(
      doc([
        {
          id: 'plan',
          type: 'plan',
          label: 'Plan',
          status: 'done',
          next: [],
          comments: [{ at: '2026-01-01T00:00:00Z', text: 'c', source: 'agent', kind: 'note' }],
          artifacts: ['plan.md'],
        },
      ]),
    );
    expect(out).toContain('plan["Plan 💬1 📄1"]:::done');
  });
});

// ---------------------------------------------------------------------------
// T002 — tolerance + safety (never crash; never corrupt the .md).
// ---------------------------------------------------------------------------

describe('flow-renderer · tolerance + safety', () => {
  it('falls back for an unknown node type (keeps the status class, never crashes)', () => {
    const out = renderFlow(
      doc([{ id: 'x', type: 'totally-made-up', label: 'X', status: 'known', next: [] }]),
    );
    expect(out).toContain('x["X"]:::known'); // status class survives an unknown type
  });

  it('falls back to the unknown class for an unknown status', () => {
    const out = renderFlow(
      doc([{ id: 'x', type: 'phase', label: 'X', status: 'weird-status', next: [] }]),
    );
    expect(out).toContain('x["X"]:::unknown');
  });

  it('never throws on an empty / degenerate flow', () => {
    expect(() => renderFlow(doc([]))).not.toThrow();
    expect(() => renderFlow({ slug: 'x' } as unknown as FlowDoc)).not.toThrow();
  });

  it('escapes mermaid/markdown control characters so the .md cannot be corrupted', () => {
    const out = renderFlow(loadFixture('kitchen-sink'));
    // fences stay balanced (one open + one close per section) — adversarial text
    // injected no stray fence (an odd count would mean an unescaped ``` leaked).
    const fenceCount = (out.match(/```/g) ?? []).length;
    expect(fenceCount).toBeGreaterThanOrEqual(2);
    expect(fenceCount % 2).toBe(0);
    // quotes + angle brackets are entity-escaped, not raw
    expect(out).toContain('#quot;hi#quot;');
    expect(out).toContain('#lt;b#gt;bold');
    expect(out).not.toContain('<b>bold</b>');
    // brackets / braces / pipe are entity-escaped inside mermaid labels too
    expect(out).toContain('#124; pipe');
    expect(out).toContain('#91;bracket#93;');
    expect(out).toContain('#123;brace#125;');
    // a newline inside a label collapsed to one line (no broken declaration) —
    // search across ALL per-node fences (the adversarial node has its own section).
    const allBlocks = mermaidBlocks(out).join('\n');
    expect(allBlocks).not.toContain('[bracket]'); // never raw inside any mermaid diagram
    const advLine = allBlocks.split('\n').find((l) => l.includes('second line'));
    expect(advLine).toBeDefined();
    expect(advLine).toContain('He said'); // label stayed on a single line
  });

  it('sanitises node ids with non-mermaid characters deterministically', () => {
    const out = renderFlow(
      doc([
        {
          id: 'ws-cli',
          type: 'workshop',
          label: 'W',
          status: 'done',
          branch_of: 'plan',
          next: ['plan'],
        },
        { id: 'plan', type: 'plan', label: 'P', status: 'done', next: [] },
      ]),
    );
    expect(out).toContain('ws_cli["W"]:::done');
    // the sanitised excursion attaches to its parent by the undirected dotted link
    expect(out).toContain('plan -.- ws_cli');
  });

  it('guards mermaid reserved keywords used as node ids (e.g. `end`)', () => {
    const out = renderFlow(
      doc([
        { id: 'a', type: 'phase', label: 'A', status: 'done', next: ['end'] },
        { id: 'end', type: 'merge', label: 'End', status: 'known', next: [] },
      ]),
    );
    expect(out).toContain('end_["End"]:::known'); // suffixed away from the reserved word
    expect(out).toContain('### ◇ End · _known_'); // `end` is its own section
    expect(out).not.toMatch(/\n {4}end\["End"\]/); // never a bare `end[...]`
  });
});

describe('flow-renderer · effectiveZone (zone default-by-type; unknown → flight; total map)', () => {
  it('maps every the-flow overlay type to its band (AC-3)', () => {
    for (const t of ['research', 'plan', 'workshop', 'tasks', 'adr']) {
      expect(effectiveZone({ type: t })).toBe('preflight');
    }
    expect(effectiveZone({ type: 'phase' })).toBe('flight');
    for (const t of ['review', 'merge', 'retro']) {
      expect(effectiveZone({ type: t })).toBe('postflight');
    }
  });

  it('an unknown / unlisted type → flight (graceful total-map fallback, never an error)', () => {
    expect(effectiveZone({ type: 'totally-made-up' })).toBe('flight');
    expect(effectiveZone({ type: undefined })).toBe('flight');
    expect(effectiveZone({})).toBe('flight');
  });

  it('an explicit valid zone overrides the type default; an invalid zone falls back to type', () => {
    expect(effectiveZone({ type: 'phase', zone: 'preflight' })).toBe('preflight');
    expect(effectiveZone({ type: 'research', zone: 'bogus' })).toBe('preflight');
  });
});

// ---------------------------------------------------------------------------
// 040 D5 (AC-02/04/05; F-01) — colour encodes TYPE only; chore-ness + importance
// move OFF colour onto the `🧰<marker>` label badge + the additive
// `impOptional`/`impStrong` border; the D4 `📝N` instructions badge (count only —
// text never leaks); a two-channel legend; rail due-chores carry `🧰`+marker.
// Oracle: workshops/002-d5-visual-modifier-vocabulary.md (the worked mermaid).
// ---------------------------------------------------------------------------
describe('flow-renderer · D5 visual vocabulary (colour=type, badges, importance, legend)', () => {
  it('an INCOMPLETE chore-flagged harness-retro renders :::harnessFaded (faded until done)', () => {
    const out = renderFlow(
      doc([
        { id: 'p1', type: 'phase', label: 'P1', status: 'done', next: [] },
        {
          id: 'retro',
          type: 'harness-retro',
          label: 'Drain',
          status: 'todo',
          branch_of: 'p1',
          next: ['p1'],
          chore: { kind: 'skill', importance: 'recommended' },
        },
      ]),
    );
    // harness type → violet, but an incomplete chore is FADED; recommended → plain `🧰`,
    // no status mark, single class token (no importance border)
    expect(out).toContain('retro["Drain 🧰"]:::harnessFaded');
    expect(out).not.toContain(':::chore');
  });

  it('a chore on a NON-harness spine node keeps its status-mapped colour (chore ≠ colour)', () => {
    const out = renderFlow(
      doc([
        {
          id: 'compact',
          type: 'phase',
          label: 'Compact',
          status: 'done',
          next: [],
          chore: { kind: 'builtin', importance: 'optional' },
        },
      ]),
    );
    // colour stays `done` (status); optional adds the `🧰°` marker, the done `✓` mark,
    // + the `impOptional` border — border via a SEPARATE `class` statement (mermaid
    // rejects chained `:::`)
    expect(out).toContain('compact["Compact 🧰° ✓"]:::done');
    expect(out).toContain('class compact impOptional;');
  });

  it('importance: optional→🧰°/impOptional · recommended→🧰/no border · strongly→🧰‼/impStrong', () => {
    const out = renderFlow(
      doc([
        {
          id: 'opt',
          type: 'harness-boot',
          label: 'opt',
          status: 'done',
          next: [],
          chore: { kind: 'command', importance: 'optional' },
        },
        {
          id: 'rec',
          type: 'harness-boot',
          label: 'rec',
          status: 'done',
          next: [],
          chore: { kind: 'command', importance: 'recommended' },
        },
        {
          id: 'strong',
          type: 'harness-boot',
          label: 'strong',
          status: 'done',
          next: [],
          chore: { kind: 'command', importance: 'strongly-recommended' },
        },
      ]),
    );
    expect(out).toContain('opt["opt 🧰° ✓"]:::harness');
    expect(out).toContain('class opt impOptional;');
    expect(out).toContain('rec["rec 🧰 ✓"]:::harness\n'); // recommended: plain marker, single class, no border line
    expect(out).not.toContain('class rec '); // recommended → no importance border statement
    expect(out).toContain('strong["strong 🧰‼ ✓"]:::harness');
    expect(out).toContain('class strong impStrong;');
  });

  it('badge ORDER is 💬N 📄N 📝N 🧰<marker> and instruction TEXT never leaks (D4/D5)', () => {
    const out = renderFlow(
      doc([
        {
          id: 'n',
          type: 'harness-boot',
          label: 'Boot check',
          status: 'done',
          next: [],
          comments: [{ at: '2026-01-01T00:00:00Z', text: 'c', source: 'agent', kind: 'note' }],
          artifacts: ['a.md'],
          instructions: ['Read the brief end to end', 'Run the linter'],
          chore: { kind: 'command', importance: 'optional' },
        },
      ]),
    );
    // exact assembled order; impOptional border rides the optional chore (separate `class` stmt);
    // the done `✓` mark trails the `🧰°` badge
    expect(out).toContain('n["Boot check 💬1 📄1 📝2 🧰° ✓"]:::harness');
    expect(out).toContain('class n impOptional;');
    // 📝N is a COUNT — the instruction text is absent from the entire render (D4)
    expect(out).not.toContain('Read the brief end to end');
    expect(out).not.toContain('Run the linter');
  });

  it('📝N renders only for a non-empty instructions[] array', () => {
    // scope to the mermaid block — the legend's `📝 instructions` is always present.
    const none = renderFlow(
      doc([{ id: 'a', type: 'phase', label: 'A', status: 'done', next: [] }]),
    );
    expect(mermaidBlock(none)).not.toContain('📝');
    const empty = renderFlow(
      doc([{ id: 'a', type: 'phase', label: 'A', status: 'done', next: [], instructions: [] }]),
    );
    expect(mermaidBlock(empty)).not.toContain('📝');
    const three = renderFlow(
      doc([
        {
          id: 'a',
          type: 'phase',
          label: 'A',
          status: 'done',
          next: [],
          instructions: ['x', 'y', 'z'],
        },
      ]),
    );
    expect(three).toContain('a["A 📝3"]:::done');
  });

  it('an UN-flagged harness seam still renders :::harness with no `🧰` badge (AC-08 back-compat)', () => {
    const out = renderFlow(
      doc([
        { id: 'p1', type: 'phase', label: 'P1', status: 'done', next: [] },
        {
          id: 'boot',
          type: 'harness-boot',
          label: 'boot',
          status: 'done',
          branch_of: 'p1',
          next: ['p1'],
        },
      ]),
    );
    expect(out).toContain('boot["boot"]:::harness'); // no badge — not a chore
    expect(mermaidBlock(out)).not.toContain('🧰'); // legend always has `🧰 chore`; diagram must not
  });

  it('the two-channel legend drops `🧰 chore` from the colour row and adds a Badges row (AC-05)', () => {
    const out = renderFlow(doc([{ id: 'a', type: 'phase', label: 'A', status: 'done', next: [] }]));
    expect(out).toContain(
      '**Legend** — colour = type/status: 🟩 done · 🟢 in-progress · 🟥 blocked · 🟦 known · ⬜ assumed · 🔶 decision · 🗣 user input · 🟪 harness chore (faded = not yet done) · 🤖 companion · 🛠 worker · 🟧 current (you are here). Badges: 💬 comments · 📄 artifacts · 📝 instructions · 🧰 chore (° optional / recommended / ‼ strongly-recommended; ✓ done · ✕ skipped).',
    );
    expect(out).not.toContain('🧰 chore (upkeep)'); // chore is no longer a colour
  });

  it('renderRailLine surfaces due chores with a `🧰`+importance marker (rail parity, AC-03)', () => {
    const d = doc(
      [
        { id: 'plan', type: 'plan', label: 'Plan', status: 'in_progress', next: ['ship'] },
        { id: 'ship', type: 'merge', label: 'Ship', status: 'known', next: [] },
        {
          id: 'bp',
          type: 'backpressure',
          label: 'Backpressure',
          status: 'todo',
          branch_of: 'plan',
          next: ['plan'],
          chore: { kind: 'command', importance: 'optional' },
        },
      ],
      { nav: { now: 'plan', next: 'ship' } },
    );
    expect(renderRailLine(d)).toContain('⚑ due: Backpressure 🧰°'); // optional → °
  });

  it('rail due-chore: a recommended chore gets a plain `🧰` (no importance marker)', () => {
    const d = doc(
      [
        { id: 'plan', type: 'plan', label: 'Plan', status: 'in_progress', next: ['ship'] },
        { id: 'ship', type: 'merge', label: 'Ship', status: 'known', next: [] },
        {
          id: 'bp',
          type: 'backpressure',
          label: 'Backpressure',
          status: 'todo',
          branch_of: 'plan',
          next: ['plan'],
          chore: { kind: 'command', importance: 'recommended' },
        },
      ],
      { nav: { now: 'plan', next: 'ship' } },
    );
    const line = renderRailLine(d);
    expect(line).toContain('⚑ due: Backpressure 🧰');
    expect(line).not.toContain('🧰°');
    expect(line).not.toContain('🧰‼');
  });

  it('renderRailLine with NO due chores at the cursor is byte-identical to today (no due: segment)', () => {
    const d = doc([{ id: 'p1', type: 'phase', label: 'Build', status: 'in_progress', next: [] }]);
    expect(renderRailLine(d)).toBe('[test] [ ◐ ]  [ ◐ Build ]'); // unchanged
    expect(renderRailLine(d)).not.toContain('due:');
  });

  it('a done/skipped chore at the cursor is NOT surfaced as due', () => {
    const d = doc(
      [
        { id: 'plan', type: 'plan', label: 'Plan', status: 'in_progress', next: ['ship'] },
        { id: 'ship', type: 'merge', label: 'Ship', status: 'known', next: [] },
        {
          id: 'bp',
          type: 'backpressure',
          label: 'Backpressure',
          status: 'done',
          branch_of: 'plan',
          next: ['plan'],
          chore: { kind: 'command', importance: 'recommended' },
        },
      ],
      { nav: { now: 'plan', next: 'ship' } },
    );
    expect(renderRailLine(d)).not.toContain('due:');
  });
});

describe('flow-renderer · zoned rail (bands pre ─ [ flight ] ─ post + title) — T009', () => {
  it('bands the spine with status pips + label names', () => {
    const d = doc([
      { id: 'research', type: 'research', label: 'Research', status: 'done', next: ['plan'] },
      { id: 'plan', type: 'plan', label: 'Plan', status: 'done', next: ['p1'] },
      { id: 'p1', type: 'phase', label: 'Build', status: 'in_progress', next: ['review'] },
      { id: 'review', type: 'review', label: 'Review', status: 'known', next: ['merge'] },
      { id: 'merge', type: 'merge', label: 'Merge', status: 'known', next: [] },
    ]);
    expect(renderRailBody(d.nodes)).toBe(
      '◆─◆─[ ◐ ]─◇─◇  ◆ Research · ◆ Plan · [ ◐ Build ] · ◇ Review · ◇ Merge',
    );
  });

  it('renderRailLine prefixes the title from provenance.agent', () => {
    const d = doc([{ id: 'p1', type: 'phase', label: 'Build', status: 'in_progress', next: [] }]);
    d.provenance.agent = 'the-flow';
    expect(renderRailLine(d)).toBe('[the-flow] [ ◐ ]  [ ◐ Build ]');
  });

  it('title falls back to slug when agent is null (AC-4)', () => {
    const d = doc([{ id: 'p1', type: 'phase', label: 'Build', status: 'known', next: [] }]);
    expect(renderRailLine(d)).toBe('[test] [ ◇ ]  [ ◇ Build ]'); // slug = 'test'
  });

  it('title prefers an explicit doc.title over the slug (middle rung)', () => {
    const d = doc([{ id: 'p1', type: 'phase', label: 'B', status: 'known', next: [] }]);
    (d as { title?: string }).title = 'My Flow';
    expect(renderRailLine(d)).toBe('[My Flow] [ ◇ ]  [ ◇ B ]');
  });

  it('(no nodes) rails gracefully', () => {
    expect(renderRailBody([])).toBe('(no nodes)');
    expect(renderRailLine(doc([]))).toBe('[test] (no nodes)');
  });
});
