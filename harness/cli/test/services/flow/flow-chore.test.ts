import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import type { FlowDoc, FlowNode } from '../../../src/services/flow/flow-events.js';
import {
  addNode,
  insertNode,
  listChores,
  setStatus,
} from '../../../src/services/flow/flow-mutations.js';
import {
  renderFlow,
  renderRailBody,
  renderRailLine,
} from '../../../src/services/flow/flow-renderer.js';
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

describe('T011 — chore nodes get a distinct mermaid class (tolerant; old renderers fall back)', () => {
  it('a chore node declares with :::chore and the classDef block is emitted', () => {
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
    expect(md).toMatch(/c1\["Compact[^\]]*"\]:::chore/);
    expect(md).toContain('classDef chore');
  });

  it('a non-chore node keeps its status class (chore class does not leak)', () => {
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

  it('lifecycle: insert → validate clean → render shows :::chore → listChores finds it runnable', () => {
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
    expect(renderFlow(r.doc)).toMatch(/c1\["Validate[^\]]*"\]:::chore/);
    const chores = listChores(r.doc);
    expect(chores[0]).toMatchObject({ id: 'c1', kind: 'command', anchor: 'boot', runnable: true });
  });
});
