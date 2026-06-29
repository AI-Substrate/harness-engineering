import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import type { FlowDoc, FlowNode } from '../../../src/services/flow/flow-events.js';
import {
  addNode,
  dueChores,
  insertNode,
  listChores,
  navShow,
  setStatus,
} from '../../../src/services/flow/flow-mutations.js';
import { renderFlow, renderRailBody } from '../../../src/services/flow/flow-renderer.js';
import { resolveFlowSchema, validateFlowDoc } from '../../../src/services/flow/flow-schema.js';

/**
 * Phase 4 — Chore Nodes (plan 024 vNext; workshop 004 C1–C8).
 *
 * Chores are an ORTHOGONAL node attribute (a nested `chore: {kind, importance}`
 * object — NOT a node type, C1), with overlay-declared statuses (`todo`/`skipped`,
 * C4) and validated enums (C2/C3). This file is the schema-layer home for the
 * chore feature; renderer + mutation behaviour live in their sibling test files.
 */

const REPO = '/repo';

/** Resolve the bundled harness-loop overlay. */
function loopSchema() {
  const res = resolveFlowSchema({ type: 'harness-loop', repoRoot: REPO }, { fs: new FakeFs() });
  if (!res.ok) throw new Error(`harness-loop must resolve (bundled): ${res.message}`);
  return res.schema;
}

/** A minimal valid harness-loop flow doc; override `nodes` to exercise a case. */
function loopDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    kind: 'harness-loop',
    slug: 'demo',
    created_at: '2026-06-18T00:00:00Z',
    provenance: {
      record_kind: 'flow',
      harness_version: '0.4.0',
      branch: null,
      repo: null,
      created_at: '2026-06-18T00:00:00Z',
      agent: null,
      plan_id: null,
    },
    events: [],
    nodes: [{ id: 'boot', type: 'boot', label: 'Boot', status: 'done', next: [] }],
    ...overrides,
  };
}

describe('T001 — harness-loop overlay declares chore statuses todo/skipped', () => {
  it('the resolved harness-loop statuses include done + the new todo/skipped', () => {
    const s = loopSchema();
    expect(s.statuses).toEqual(expect.arrayContaining(['done', 'todo', 'skipped']));
  });

  it('a node with status "todo" validates under harness-loop', () => {
    const doc = loopDoc({
      nodes: [{ id: 'c1', type: 'boot', label: 'Compact', status: 'todo', next: [] }],
    });
    expect(validateFlowDoc(doc, loopSchema())).toEqual([]);
  });

  it('a node with status "skipped" validates under harness-loop', () => {
    const doc = loopDoc({
      nodes: [{ id: 'c1', type: 'boot', label: 'Compact', status: 'skipped', next: [] }],
    });
    expect(validateFlowDoc(doc, loopSchema())).toEqual([]);
  });

  it('an undeclared status is still rejected (vocabulary stays closed)', () => {
    const doc = loopDoc({
      nodes: [{ id: 'c1', type: 'boot', label: 'X', status: 'bogus-status', next: [] }],
    });
    expect(validateFlowDoc(doc, loopSchema()).join(' ')).toMatch(/status/);
  });
});

describe('T002 — shared-core declares `chore` as a first-class optional node field', () => {
  it('the resolved schema nodeOptional includes "chore" (and the Phase-1 "command")', () => {
    const s = loopSchema();
    expect(s.nodeOptional).toContain('chore');
    expect(s.nodeOptional).toContain('command');
  });

  it('a node carrying a chore object + command validates clean (additive round-trip)', () => {
    const doc = loopDoc({
      nodes: [
        {
          id: 'c1',
          type: 'boot',
          label: 'Compact',
          status: 'todo',
          next: [],
          chore: { kind: 'skill', importance: 'recommended' },
          command: '/compact',
        },
      ],
    });
    expect(validateFlowDoc(doc, loopSchema())).toEqual([]);
  });
});

describe('T003 — chore object validation (kind + importance enums; "required" is NOT a level)', () => {
  const choreNode = (chore: unknown) =>
    loopDoc({ nodes: [{ id: 'c1', type: 'boot', label: 'X', status: 'todo', next: [], chore }] });

  it('a valid chore validates clean', () => {
    expect(
      validateFlowDoc(
        choreNode({ kind: 'command', importance: 'strongly-recommended' }),
        loopSchema(),
      ),
    ).toEqual([]);
  });

  it('rejects an invalid chore.kind', () => {
    expect(
      validateFlowDoc(choreNode({ kind: 'invalid', importance: 'recommended' }), loopSchema()).join(
        ' ',
      ),
    ).toMatch(/chore\.kind/);
  });

  it('rejects "required" as an importance (advisory invariant — ws004 C3)', () => {
    expect(
      validateFlowDoc(choreNode({ kind: 'skill', importance: 'required' }), loopSchema()).join(' '),
    ).toMatch(/chore\.importance/);
  });

  it('rejects a non-object chore', () => {
    expect(validateFlowDoc(choreNode('skill'), loopSchema()).join(' ')).toMatch(/chore/);
  });

  it('a node with NO chore validates unchanged (back-compat)', () => {
    expect(validateFlowDoc(loopDoc(), loopSchema())).toEqual([]);
  });

  it('all four kinds × four importances are accepted', () => {
    const kinds = ['skill', 'command', 'builtin', 'manual'];
    const importances = ['strongly-recommended', 'recommended', 'optional', 'informational'];
    for (const kind of kinds) {
      for (const importance of importances) {
        expect(validateFlowDoc(choreNode({ kind, importance }), loopSchema())).toEqual([]);
      }
    }
  });
});

describe('T004 — mutations thread chore + command through NodeSpec/materialize', () => {
  const clk = { clock: new FakeClock('2026-06-18T00:00:00.000Z') };

  it('addNode persists chore + command on the new node', () => {
    const r = addNode(
      loopDoc() as unknown as FlowDoc,
      {
        id: 'c1',
        type: 'boot',
        label: 'Compact',
        status: 'todo',
        chore: { kind: 'skill', importance: 'recommended' },
        command: '/compact',
      },
      clk,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const n = r.doc.nodes.find((x) => x.id === 'c1');
    expect(n?.chore).toEqual({ kind: 'skill', importance: 'recommended' });
    expect(n?.command).toBe('/compact');
  });

  it('insertNode --after carries chore + command and round-trips validation', () => {
    const r = insertNode(
      loopDoc() as unknown as FlowDoc,
      {
        id: 'c1',
        type: 'boot',
        label: 'Validate',
        status: 'todo',
        chore: { kind: 'command', importance: 'strongly-recommended' },
        command: '/validate-v2',
      },
      { after: 'boot' },
      clk,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const n = r.doc.nodes.find((x) => x.id === 'c1');
    expect(n?.chore).toEqual({ kind: 'command', importance: 'strongly-recommended' });
    expect(n?.command).toBe('/validate-v2');
    expect(validateFlowDoc(r.doc, loopSchema())).toEqual([]);
  });
});

/** A two-node flow: a done (non-chore) boot + one chore node with the given status/importance. */
function choreRailNodes(status: string, importance = 'recommended'): FlowNode[] {
  return [
    { id: 'boot', type: 'boot', label: 'Boot', status: 'done', next: ['c1'] },
    {
      id: 'c1',
      type: 'boot',
      label: 'Compact',
      status,
      next: [],
      chore: { kind: 'skill', importance },
    },
  ];
}

describe('T007 — chore-aware pips (squares for chores; spine keeps diamonds)', () => {
  it('todo chore → □', () => {
    expect(renderRailBody(choreRailNodes('todo'))).toContain('□');
  });
  it('done chore → ■', () => {
    expect(renderRailBody(choreRailNodes('done'))).toContain('■');
  });
  it('skipped chore → ▨', () => {
    expect(renderRailBody(choreRailNodes('skipped'))).toContain('▨');
  });
  it('strongly-recommended + todo → ▣ (the attention glyph)', () => {
    expect(renderRailBody(choreRailNodes('todo', 'strongly-recommended'))).toContain('▣');
  });
  it('a non-chore done node keeps the diamond ◆ (chores do not change the spine)', () => {
    const rail = renderRailBody(choreRailNodes('todo'));
    expect(rail).toContain('◆'); // boot (done, non-chore)
    expect(rail).not.toContain('◇'); // no hollow diamond — the chore uses a square, not a diamond
  });
});

describe('T008 — importance-aware name collapse (show | collapse | hide)', () => {
  it('collapse (default): a recommended chore name → [*]; the label is hidden', () => {
    const body = renderRailBody(choreRailNodes('todo', 'recommended'));
    expect(body).toContain('[*]');
    expect(body).not.toContain('Compact');
  });

  it('show: the chore name IS rendered, with NO marker prefix (the pip is the chore signal)', () => {
    const body = renderRailBody(choreRailNodes('todo', 'recommended'), 'show');
    expect(body).toContain('Compact');
    expect(body).not.toContain('▸');
  });

  it('hide: the chore name AND the [*] marker are gone, but the square pip remains', () => {
    const body = renderRailBody(choreRailNodes('todo', 'recommended'), 'hide');
    expect(body).not.toContain('Compact');
    expect(body).not.toContain('[*]');
    expect(body).toContain('□'); // the pip survives — hide only drops the NAME
  });

  it('strongly-recommended stays named even in collapse (refuses to hide)', () => {
    const body = renderRailBody(choreRailNodes('todo', 'strongly-recommended'));
    expect(body).toContain('Compact');
    expect(body).not.toContain('[*]');
  });

  it('informational is dropped from the names in collapse (not even [*])', () => {
    const body = renderRailBody(choreRailNodes('todo', 'informational'));
    expect(body).not.toContain('Compact');
    expect(body).not.toContain('[*]');
  });

  it('two consecutive collapsed chores → [*2]', () => {
    const nodes: FlowNode[] = [
      { id: 'boot', type: 'boot', label: 'Boot', status: 'done', next: ['c1'] },
      {
        id: 'c1',
        type: 'boot',
        label: 'Compact',
        status: 'todo',
        next: ['c2'],
        chore: { kind: 'skill', importance: 'recommended' },
      },
      {
        id: 'c2',
        type: 'boot',
        label: 'Validate',
        status: 'todo',
        next: [],
        chore: { kind: 'command', importance: 'optional' },
      },
    ];
    expect(renderRailBody(nodes)).toContain('[*2]');
  });
});

describe('T011 — chore-ness rides the 🧰 badge, colour=type (D5; F-01)', () => {
  it('a chore node carries the 🧰 badge (colour=type); importance classDefs are emitted on-demand', () => {
    const doc = loopDoc({
      nodes: [
        { id: 'boot', type: 'boot', label: 'Boot', status: 'done', next: ['c1'] },
        {
          id: 'c1',
          type: 'improve',
          label: 'Compact',
          status: 'todo',
          next: [],
          chore: { kind: 'skill', importance: 'recommended' },
        },
      ],
    }) as unknown as FlowDoc;
    const md = renderFlow(doc);
    // D5: the chore flag no longer sets a colour — `improve`+`todo` has no status colour
    // → `:::unknown`; chore-ness is the `🧰` badge (recommended → plain marker).
    expect(md).toMatch(/c1\["Compact 🧰"\]:::unknown/);
    // sections render emits classDefs ON DEMAND — a `recommended` chore has no border,
    // so neither importance classDef is referenced and neither is emitted.
    expect(md).not.toContain('classDef impOptional');
    expect(md).not.toContain('classDef impStrong');
    expect(md).not.toContain('classDef chore '); // teal chore colour retired
  });

  it('a non-chore node keeps its status class (no badge leaks)', () => {
    const md = renderFlow(loopDoc() as unknown as FlowDoc);
    expect(md).toMatch(/boot\["Boot"\]:::done/);
  });
});

describe('T012 — consolidation: C7 events, two-overlay validation, orthogonality, lifecycle', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const fixtureOverlay = readFileSync(join(HERE, 'fixtures/test-flow.schema.json'), 'utf8');
  const clk = { clock: new FakeClock('2026-06-18T00:00:00.000Z') };

  it('C7: an inserted chore rides a `chore` discriminator on its node-created event (no new kind)', () => {
    const r = insertNode(
      loopDoc() as unknown as FlowDoc,
      {
        id: 'c1',
        type: 'boot',
        label: 'Validate',
        status: 'todo',
        chore: { kind: 'command', importance: 'recommended' },
      },
      { after: 'boot' },
      clk,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const created = r.doc.events.find((e) => e.kind === 'node-created' && e.details?.node === 'c1');
    // C7: the discriminator is the full {kind, importance} pair (replayable, no new kind).
    expect(created?.details?.chore).toEqual({ kind: 'command', importance: 'recommended' });
  });

  it('C7: ticking a chore status rides the discriminator on status-changed', () => {
    const inserted = insertNode(
      loopDoc() as unknown as FlowDoc,
      {
        id: 'c1',
        type: 'boot',
        label: 'C',
        status: 'todo',
        chore: { kind: 'skill', importance: 'optional' },
      },
      { after: 'boot' },
      clk,
    );
    if (!inserted.ok) throw new Error('insert failed');
    const ticked = setStatus(inserted.doc, 'c1', 'done', clk);
    expect(ticked.ok).toBe(true);
    if (!ticked.ok) return;
    const changed = ticked.doc.events.find((e) => e.kind === 'status-changed');
    expect(changed?.details?.chore).toEqual({ kind: 'skill', importance: 'optional' });
  });

  it('two-overlay (AC-03): the chore object validates under a CUSTOM overlay too (enums are core)', () => {
    const fs = new FakeFs({
      [`${REPO}/.harness/schemas/flows/test-flow.schema.json`]: fixtureOverlay,
    });
    const res = resolveFlowSchema({ type: 'test-flow', repoRoot: REPO }, { fs });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const good = loopDoc({
      kind: 'test-flow',
      nodes: [
        {
          id: 'd1',
          type: 'decision',
          label: 'Decide',
          status: 'declined',
          next: [],
          chore: { kind: 'skill', importance: 'optional' },
        },
      ],
    });
    expect(validateFlowDoc(good, res.schema)).toEqual([]);
    const bad = loopDoc({
      kind: 'test-flow',
      nodes: [
        {
          id: 'd1',
          type: 'decision',
          label: 'Decide',
          status: 'declined',
          next: [],
          chore: { kind: 'nope', importance: 'optional' },
        },
      ],
    });
    expect(validateFlowDoc(bad, res.schema).join(' ')).toMatch(/chore\.kind/);
  });

  it('orthogonality (C1): a chore on a `decision` node validates and lists (chore ⊥ type)', () => {
    const fs = new FakeFs({
      [`${REPO}/.harness/schemas/flows/test-flow.schema.json`]: fixtureOverlay,
    });
    const res = resolveFlowSchema({ type: 'test-flow', repoRoot: REPO }, { fs });
    if (!res.ok) throw new Error('fixture must resolve');
    // `test-flow` does not declare the chore lifecycle statuses (todo/skipped) — those
    // are overlay-declared and only harness-loop + the-flow opt in. So the node carries a
    // test-flow status (`known`); the chore marker is orthogonal to both type AND status.
    const doc = loopDoc({
      kind: 'test-flow',
      nodes: [
        {
          id: 'd1',
          type: 'decision',
          label: 'Fork',
          status: 'known',
          next: [],
          chore: { kind: 'skill', importance: 'recommended' },
        },
      ],
    });
    expect(validateFlowDoc(doc, res.schema)).toEqual([]);
    const chores = listChores(doc as unknown as FlowDoc);
    expect(chores).toHaveLength(1);
    expect(chores[0]?.id).toBe('d1');
    expect(chores[0]?.kind).toBe('skill');
  });

  it('lifecycle: insert → validate clean → render shows the 🧰 badge → listChores finds it runnable', () => {
    const r = insertNode(
      loopDoc() as unknown as FlowDoc,
      {
        id: 'c1',
        type: 'improve',
        label: 'Validate',
        status: 'todo',
        chore: { kind: 'command', importance: 'recommended' },
        command: '/validate-v2',
      },
      { after: 'boot' },
      clk,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(validateFlowDoc(r.doc, loopSchema())).toEqual([]);
    expect(renderFlow(r.doc)).toMatch(/c1\["Validate 🧰"\]:::unknown/);
    const chores = listChores(r.doc);
    expect(chores[0]).toMatchObject({ id: 'c1', kind: 'command', anchor: 'boot', runnable: true });
  });
});

describe('T013 — position-aware chore reads (`chores --at` + `nav show` due_chores)', () => {
  const clk = { clock: new FakeClock('2026-06-18T00:00:00.000Z') };

  /** plan(now) → ship, with two chores anchored at plan (one todo, one done) and one at ship. */
  function anchoredDoc(): FlowDoc {
    return loopDoc({
      nodes: [
        { id: 'plan', type: 'boot', label: 'Plan', status: 'in_progress', next: ['ship'] },
        { id: 'ship', type: 'improve', label: 'Ship', status: 'assumed', next: [] },
        {
          id: 'c_due',
          type: 'boot',
          label: 'Pre-coding',
          status: 'todo',
          next: ['plan'],
          branch_of: 'plan',
          chore: { kind: 'command', importance: 'recommended' },
          command: 'run /eng-harness-flow --hook pre-coding',
        },
        {
          id: 'c_done',
          type: 'boot',
          label: 'Pre-flight',
          status: 'done',
          next: ['plan'],
          branch_of: 'plan',
          chore: { kind: 'command', importance: 'strongly-recommended' },
        },
        {
          id: 'c_ship',
          type: 'improve',
          label: 'Post-flight',
          status: 'todo',
          next: ['ship'],
          branch_of: 'ship',
          chore: { kind: 'command', importance: 'recommended' },
        },
      ],
      nav: { now: 'plan', next: 'ship' },
    }) as unknown as FlowDoc;
  }

  it('listChores --at filters to chores anchored at that node', () => {
    const doc = anchoredDoc();
    expect(listChores(doc, 'plan').map((c) => c.id)).toEqual(['c_due', 'c_done']);
    expect(listChores(doc, 'ship').map((c) => c.id)).toEqual(['c_ship']);
  });

  it('listChores --at an unknown node → empty (no error)', () => {
    expect(listChores(anchoredDoc(), 'nope')).toEqual([]);
  });

  it('listChores with no filter still returns every chore (back-compat)', () => {
    expect(listChores(anchoredDoc())).toHaveLength(3);
  });

  it('dueChores → chores anchored at nav.now that are still outstanding', () => {
    // c_done excluded (done); c_ship excluded (anchored at ship, not the current node)
    expect(dueChores(anchoredDoc()).map((c) => c.id)).toEqual(['c_due']);
  });

  it('dueChores carries the full ChoreRow shape', () => {
    expect(dueChores(anchoredDoc())[0]).toEqual({
      id: 'c_due',
      label: 'Pre-coding',
      status: 'todo',
      kind: 'command',
      importance: 'recommended',
      command: 'run /eng-harness-flow --hook pre-coding',
      anchor: 'plan',
      runnable: true,
    });
  });

  it('a chore at nav.now ticked to done drops out of due', () => {
    const ticked = setStatus(anchoredDoc(), 'c_due', 'done', clk);
    expect(ticked.ok).toBe(true);
    if (!ticked.ok) return;
    expect(dueChores(ticked.doc)).toEqual([]);
  });

  it('nav show carries due_chores (mirrors dueChores)', () => {
    const doc = anchoredDoc();
    expect(navShow(doc).due_chores).toEqual(dueChores(doc));
  });

  it('no nav / no position → due_chores is [] (graceful)', () => {
    const doc = loopDoc({
      nodes: [
        { id: 'boot', type: 'boot', label: 'Boot', status: 'done', next: [] },
        {
          id: 'c1',
          type: 'boot',
          label: 'X',
          status: 'todo',
          next: [],
          branch_of: 'boot',
          chore: { kind: 'skill', importance: 'optional' },
        },
      ],
    }) as unknown as FlowDoc;
    expect(dueChores(doc)).toEqual([]);
    expect(navShow(doc).due_chores).toEqual([]);
  });
});

describe('T014 — anchored loop-chore injection (the AC-07 recipe never orphans)', () => {
  const clk = { clock: new FakeClock('2026-06-18T00:00:00.000Z') };
  const FIRE_HOOKS = ['pre-flight', 'pre-coding', 'post-coding', 'post-flight'] as const;

  /** A bare flight-plan-shaped spine: research → plan → ship (no phase nodes). */
  function spineDoc(): FlowDoc {
    return loopDoc({
      nodes: [
        { id: 'research', type: 'boot', label: 'Research', status: 'done', next: ['plan'] },
        { id: 'plan', type: 'backpressure', label: 'Plan', status: 'in_progress', next: ['ship'] },
        { id: 'ship', type: 'improve', label: 'Ship', status: 'assumed', next: [] },
      ],
      nav: { now: 'plan', next: 'ship' },
    }) as unknown as FlowDoc;
  }

  // hook → anchor map (total; deterministic fallback). Mirrors
  // skills/eng-harness-flow/references/flight-plan-ops.md § hook → anchor map.
  function anchorFor(hook: string, doc: FlowDoc): string {
    const ids = new Set(doc.nodes.map((n) => n.id));
    const phases = doc.nodes.filter((n) => n.type === 'phase').map((n) => n.id);
    const pick = (...cands: (string | undefined)[]) =>
      cands.find((c) => c !== undefined && ids.has(c)) as string;
    switch (hook) {
      case 'pre-flight':
        return pick(phases[0], 'plan', 'research');
      case 'pre-coding':
        return pick('plan', phases[0], 'research');
      case 'post-coding':
        return pick(phases[phases.length - 1], 'plan');
      case 'post-flight':
        return pick('ship', 'review', phases[phases.length - 1], 'plan');
      default:
        throw new Error(`unknown hook ${hook}`);
    }
  }

  /** Inject the four fire hooks as ANCHORED chores, deduped on the --hook token (the recipe). */
  function inject(doc: FlowDoc): FlowDoc {
    let cur = doc;
    for (const hook of FIRE_HOOKS) {
      const token = `--hook ${hook}`;
      // recipe step 1 — dedup: skip if a node already carries this hook token
      if (cur.nodes.some((n) => typeof n.command === 'string' && n.command.includes(token)))
        continue;
      const r = insertNode(
        cur,
        {
          id: `ehf-${hook}`,
          type: 'improve',
          label: `${hook} hook`,
          status: 'todo',
          chore: {
            kind: 'command',
            importance: hook === 'pre-flight' ? 'strongly-recommended' : 'recommended',
          },
          command: `run /eng-harness-flow ${token}`,
        },
        { branchOf: anchorFor(hook, cur) },
        clk,
      );
      if (!r.ok) throw new Error(`inject ${hook} failed: ${r.message}`);
      cur = r.doc;
    }
    return cur;
  }

  it('every injected chore has a non-null anchor (no orphans) per the map', () => {
    const chores = listChores(inject(spineDoc()));
    expect(chores).toHaveLength(4);
    for (const c of chores) expect(c.anchor).not.toBeNull();
    const at = Object.fromEntries(chores.map((c) => [c.id, c.anchor]));
    // no phase nodes → pre-flight/pre-coding/post-coding fall back to plan; post-flight → ship
    expect(at['ehf-pre-flight']).toBe('plan');
    expect(at['ehf-pre-coding']).toBe('plan');
    expect(at['ehf-post-coding']).toBe('plan');
    expect(at['ehf-post-flight']).toBe('ship');
  });

  it('the render draws a connected dotted excursion for each chore (no floating box)', () => {
    const md = renderFlow(inject(spineDoc()));
    // sections render: each chore is attached inside its parent's section by an
    // undirected dotted link (`parent -.- chore`), so no chore ever floats free.
    expect(md).toContain('plan -.- ehf_pre_flight');
    expect(md).toContain('plan -.- ehf_pre_coding');
    expect(md).toContain('plan -.- ehf_post_coding');
    expect(md).toContain('ship -.- ehf_post_flight');
  });

  it('re-injection is idempotent (dedup on the --hook token → no new nodes)', () => {
    const once = inject(spineDoc());
    const twice = inject(once);
    expect(twice.nodes.length).toBe(once.nodes.length);
    expect(JSON.stringify(twice.nodes)).toBe(JSON.stringify(once.nodes));
  });
});
