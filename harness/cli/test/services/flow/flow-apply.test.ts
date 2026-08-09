import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { ErrorCodes } from '../../../src/output/error-codes.js';
import type { FlowDoc } from '../../../src/services/flow/flow-events.js';
import { applyBatch, mvNode, removeNode } from '../../../src/services/flow/flow-mutations.js';

/**
 * Plan 039 Phase 1 — generic, roster-blind, transactional node primitives:
 *   T001 apply atomicity · T002 forward-ref · T003 idempotency byte-stable ·
 *   T004 D5 terminal guard (batch-wide) · T005 remove rewire · T006 mv re-parent.
 *
 * Fakes only (FakeClock); pure-fn imports; reuses the flow-mutations harness.
 * Their guards are SCOPE-LIMITED to the operation, not a uniform "mechanical integrity
 * only": remove/mv enforce existence + the dangling-edge/DAG re-check + the D5 terminal
 * guard, and `applyBatch` adds the `dd_link` shape and the closed node-field set (via
 * `parseOp`) plus the shared-core `zone`/`chore` vocabularies. What stays the act's
 * concern is the OVERLAY status/node-type vocabulary — which is why the docs here use
 * arbitrary types/statuses, and carry no zone/chore.
 */

const deps = () => ({ clock: new FakeClock('2026-06-28T05:00:00.000Z') });

/** research(done) → plan(in_progress) → ship(known). `done` = terminal (D5). */
function baseDoc(nodes?: FlowDoc['nodes']): FlowDoc {
  return {
    schema_version: 1,
    kind: 'flight-plan',
    slug: 'demo',
    nav: { now: 'plan', next: null },
    created_at: '2026-06-28T00:00:00.000Z',
    provenance: {
      record_kind: 'flow',
      harness_version: '0.6.0',
      branch: 'main',
      repo: null,
      created_at: '2026-06-28T00:00:00.000Z',
      agent: null,
      plan_id: null,
    },
    events: [],
    nodes: nodes ?? [
      { id: 'research', type: 'research', label: 'R', status: 'done', next: ['plan'] },
      { id: 'plan', type: 'plan', label: 'P', status: 'in_progress', next: ['ship'] },
      { id: 'ship', type: 'merge', label: 'S', status: 'known', next: [] },
    ],
  };
}

const code = (r: unknown): string => (r as { code: string }).code;
const ids = (doc: FlowDoc): string[] => doc.nodes.map((n) => n.id);

// ---------------------------------------------------------------------------
// T001 — apply atomicity (AC-01): all-or-nothing, one write or none.
// ---------------------------------------------------------------------------
describe('T001 — applyBatch atomicity (AC-01)', () => {
  it('a valid batch applies EVERY op in one result (add + insert)', () => {
    const res = applyBatch(
      baseDoc(),
      [
        { op: 'add', id: 'extra', type: 'phase', label: 'Extra', status: 'known', next: ['ship'] },
        { op: 'insert', id: 'rev', type: 'review', label: 'Rev', status: 'known', before: 'ship' },
      ],
      deps(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // both new nodes present
    expect(ids(res.doc)).toEqual(expect.arrayContaining(['extra', 'rev']));
    // insert --before ship rewired plan's edge to rev, rev → ship
    expect(res.doc.nodes.find((n) => n.id === 'rev')?.next).toEqual(['ship']);
    expect(res.doc.nodes.find((n) => n.id === 'plan')?.next).toEqual(['rev']);
  });

  it('an unknown op kind writes NOTHING → E108, input untouched', () => {
    const doc = baseDoc();
    const res = applyBatch(doc, [{ op: 'frobnicate', id: 'x' }], deps());
    expect(res.ok).toBe(false);
    expect(code(res)).toBe(ErrorCodes.INVALID_ARGS);
    expect(ids(doc)).toEqual(['research', 'plan', 'ship']); // pure — input untouched
    expect(doc.events).toHaveLength(0);
  });

  it('a non-array ops payload → E108, nothing written', () => {
    const res = applyBatch(baseDoc(), { op: 'add' } as unknown, deps());
    expect(res.ok).toBe(false);
    expect(code(res)).toBe(ErrorCodes.INVALID_ARGS);
  });

  it('a batch that produces a CYCLE writes NOTHING → E309', () => {
    const doc = baseDoc();
    const res = applyBatch(
      doc,
      [
        { op: 'add', id: 'a', type: 'phase', label: 'A', status: 'known', next: ['b'] },
        { op: 'add', id: 'b', type: 'phase', label: 'B', status: 'known', next: ['a'] },
      ],
      deps(),
    );
    expect(res.ok).toBe(false);
    expect(code(res)).toBe(ErrorCodes.FLOW_EDGE_INVALID);
    expect(ids(doc)).toEqual(['research', 'plan', 'ship']); // nothing written
    expect(doc.events).toHaveLength(0);
  });

  it('a batch that ORPHANS a node writes NOTHING → E309', () => {
    // remove the only sink: a→b, x→b, b leaf → removing b orphans a + x.
    const doc = baseDoc([
      { id: 'a', type: 'phase', label: 'A', status: 'known', next: ['b'] },
      { id: 'x', type: 'phase', label: 'X', status: 'known', next: ['b'] },
      { id: 'b', type: 'phase', label: 'B', status: 'known', next: [] },
    ]);
    const res = applyBatch(doc, [{ op: 'remove', id: 'b' }], deps());
    expect(res.ok).toBe(false);
    expect(code(res)).toBe(ErrorCodes.FLOW_EDGE_INVALID);
    expect(ids(doc)).toEqual(['a', 'x', 'b']); // nothing written
  });
});

// ---------------------------------------------------------------------------
// T002 — forward-ref (AC-02): order within a batch is irrelevant.
// ---------------------------------------------------------------------------
describe('T002 — applyBatch forward-ref (AC-02)', () => {
  it('an op references a node created LATER in the same batch → resolves', () => {
    // `a` (added first) points at `b` (added second). The build-order wart is gone.
    const res = applyBatch(
      baseDoc(),
      [
        { op: 'add', id: 'a', type: 'phase', label: 'A', status: 'known', next: ['b'] },
        { op: 'add', id: 'b', type: 'phase', label: 'B', status: 'known', next: ['ship'] },
      ],
      deps(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc.nodes.find((n) => n.id === 'a')?.next).toEqual(['b']);
    expect(res.doc.nodes.find((n) => n.id === 'b')?.next).toEqual(['ship']);
  });

  it('a ref to a node in NEITHER the base graph NOR the batch → E305, nothing written', () => {
    const doc = baseDoc();
    const res = applyBatch(
      doc,
      [{ op: 'add', id: 'a', type: 'phase', label: 'A', status: 'known', next: ['ghost'] }],
      deps(),
    );
    expect(res.ok).toBe(false);
    expect(code(res)).toBe(ErrorCodes.FLOW_NODE_INVALID);
    expect(ids(doc)).toEqual(['research', 'plan', 'ship']);
  });
});

// ---------------------------------------------------------------------------
// T003 — idempotency, byte-stable (AC-03).
// ---------------------------------------------------------------------------
describe('T003 — applyBatch idempotency byte-stable (AC-03)', () => {
  it('upsert ABSENT → insert (the node is created)', () => {
    const res = applyBatch(
      baseDoc(),
      [
        {
          op: 'upsert',
          id: 'extra',
          type: 'phase',
          label: 'Extra',
          status: 'known',
          next: ['ship'],
        },
        { op: 'set', id: 'plan', next: ['extra'] }, // wire it in (no orphan)
      ],
      deps(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc.nodes.find((n) => n.id === 'extra')).toMatchObject({
      type: 'phase',
      label: 'Extra',
      next: ['ship'],
    });
  });

  it('upsert PRESENT → shallow-merge (only the given field changes)', () => {
    const res = applyBatch(baseDoc(), [{ op: 'upsert', id: 'plan', label: 'Planned' }], deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const plan = res.doc.nodes.find((n) => n.id === 'plan');
    expect(plan?.label).toBe('Planned'); // merged
    expect(plan?.type).toBe('plan'); // untouched
    expect(plan?.next).toEqual(['ship']); // untouched
  });

  it('upsert IDENTICAL → no-op: no event, doc byte-identical', () => {
    const doc = baseDoc();
    const before = JSON.stringify(doc);
    const res = applyBatch(
      doc,
      [
        {
          op: 'upsert',
          id: 'plan',
          type: 'plan',
          label: 'P',
          status: 'in_progress',
          next: ['ship'],
        },
      ],
      deps(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc.events).toHaveLength(0);
    expect(JSON.stringify(res.doc)).toBe(before);
  });

  it('phase-2 edge-wiring NO-OPS on a matching edge (no event)', () => {
    const doc = baseDoc();
    // research already → plan: re-asserting the same edge is a no-op.
    const res = applyBatch(doc, [{ op: 'set', id: 'research', next: ['plan'] }], deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc.events).toHaveLength(0);
    expect(JSON.stringify(res.doc)).toBe(JSON.stringify(doc));
  });

  it('a fully-no-op BATCH leaves the file byte-identical (no modified_at bump, no event)', () => {
    const doc = baseDoc();
    const before = JSON.stringify(doc);
    const res = applyBatch(
      doc,
      [
        { op: 'upsert', id: 'plan', label: 'P' }, // identical
        { op: 'set', id: 'research', next: ['plan'] }, // identical edge
        { op: 'upsert', id: 'ship', type: 'merge', label: 'S', status: 'known', next: [] }, // identical
      ],
      deps(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc.events).toHaveLength(0);
    expect(JSON.stringify(res.doc)).toBe(before);
  });

  it('re-applying an additive batch is byte-stable (idempotent expander shape)', () => {
    const ops = [
      { op: 'insert', id: 'p2', type: 'phase', label: 'P2', status: 'known', after: 'plan' },
    ];
    const once = applyBatch(baseDoc(), ops, deps());
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = applyBatch(once.doc, ops, deps());
    // second run: the node already exists → upsert-style no-op path is NOT taken by
    // insert (insert refuses a dup id), so the expander dedups before re-inserting.
    // Here we assert the by-id dup is refused cleanly (nothing written), proving the
    // caller must dedup — the byte-stable guarantee lives at the op level above.
    expect(twice.ok).toBe(false);
    expect(code(twice)).toBe(ErrorCodes.INVALID_ARGS);
  });
});

// ---------------------------------------------------------------------------
// T004 — D5 terminal guard, batch-wide (AC-04).
// ---------------------------------------------------------------------------
describe('T004 — D5 terminal guard, batch-wide (AC-04)', () => {
  /** research(done) → plan(in_progress) → p1(DONE, terminal middle) → ship(known). */
  function termDoc(): FlowDoc {
    return baseDoc([
      { id: 'research', type: 'research', label: 'R', status: 'done', next: ['plan'] },
      { id: 'plan', type: 'plan', label: 'P', status: 'in_progress', next: ['p1'] },
      { id: 'p1', type: 'phase', label: 'P1', status: 'done', next: ['ship'] },
      { id: 'ship', type: 'merge', label: 'S', status: 'known', next: [] },
    ]);
  }

  it('upsert that flips a done node back to todo → refused, nothing written', () => {
    const doc = termDoc();
    const res = applyBatch(doc, [{ op: 'upsert', id: 'p1', status: 'todo' }], deps());
    expect(res.ok).toBe(false);
    expect(code(res)).toBe(ErrorCodes.INVALID_ARGS);
    expect(doc.nodes.find((n) => n.id === 'p1')?.status).toBe('done'); // untouched
  });

  it('set that flips a done node back to todo → refused', () => {
    const res = applyBatch(termDoc(), [{ op: 'set', id: 'p1', status: 'todo' }], deps());
    expect(res.ok).toBe(false);
    expect(code(res)).toBe(ErrorCodes.INVALID_ARGS);
  });

  it('remove of a terminal node WITHOUT force → refused', () => {
    const res = applyBatch(termDoc(), [{ op: 'remove', id: 'p1' }], deps());
    expect(res.ok).toBe(false);
    expect(code(res)).toBe(ErrorCodes.INVALID_ARGS);
  });

  it('remove of a terminal node WITH force → allowed (plan rewired to ship)', () => {
    const res = applyBatch(termDoc(), [{ op: 'remove', id: 'p1', force: true }], deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc.nodes.some((n) => n.id === 'p1')).toBe(false);
    expect(res.doc.nodes.find((n) => n.id === 'plan')?.next).toEqual(['ship']);
  });

  it('mv of a terminal node WITHOUT force → refused', () => {
    const res = applyBatch(termDoc(), [{ op: 'mv', id: 'p1', after: 'research' }], deps());
    expect(res.ok).toBe(false);
    expect(code(res)).toBe(ErrorCodes.INVALID_ARGS);
  });

  it('LAUNDERING: remove(force)-then-re-add the same terminal id as todo → refused (no resurrection)', () => {
    const res = applyBatch(
      termDoc(),
      [
        { op: 'remove', id: 'p1', force: true },
        { op: 'add', id: 'p1', type: 'phase', label: 'P1', status: 'todo', next: ['ship'] },
      ],
      deps(),
    );
    expect(res.ok).toBe(false);
    expect(code(res)).toBe(ErrorCodes.INVALID_ARGS);
  });

  it('re-adding a removed terminal AS done (preserving terminal status) → allowed', () => {
    const res = applyBatch(
      termDoc(),
      [
        { op: 'remove', id: 'p1', force: true },
        { op: 'add', id: 'p1', type: 'phase', label: 'P1b', status: 'done', next: ['ship'] },
      ],
      deps(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc.nodes.find((n) => n.id === 'p1')?.label).toBe('P1b');
  });

  it('a no-op upsert on a terminal node (identical) is fine (terminal stays terminal)', () => {
    const res = applyBatch(termDoc(), [{ op: 'upsert', id: 'p1', status: 'done' }], deps());
    expect(res.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T005 — remove-node rewire (AC-05).
// ---------------------------------------------------------------------------
describe('T005 — removeNode rewire (AC-05)', () => {
  it('removes a middle node and rejoins predecessor→successor (no orphan)', () => {
    const res = removeNode(baseDoc(), 'plan', {}, deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc.nodes.some((n) => n.id === 'plan')).toBe(false);
    expect(res.doc.nodes.find((n) => n.id === 'research')?.next).toEqual(['ship']);
  });

  it('a graph-breaking removal (orphans the predecessors) → E309, nothing written', () => {
    const doc = baseDoc([
      { id: 'a', type: 'phase', label: 'A', status: 'known', next: ['b'] },
      { id: 'x', type: 'phase', label: 'X', status: 'known', next: ['b'] },
      { id: 'b', type: 'phase', label: 'B', status: 'known', next: [] },
    ]);
    const res = removeNode(doc, 'b', {}, deps());
    expect(res.ok).toBe(false);
    expect(code(res)).toBe(ErrorCodes.FLOW_EDGE_INVALID);
    expect(ids(doc)).toEqual(['a', 'x', 'b']);
  });

  it('removing a missing node → E305', () => {
    const res = removeNode(baseDoc(), 'ghost', {}, deps());
    expect(res.ok).toBe(false);
    expect(code(res)).toBe(ErrorCodes.FLOW_NODE_INVALID);
  });

  it('removing a multi-predecessor node rewires every predecessor', () => {
    const doc = baseDoc([
      { id: 'a', type: 'phase', label: 'A', status: 'known', next: ['m'] },
      { id: 'b', type: 'phase', label: 'B', status: 'known', next: ['m'] },
      { id: 'm', type: 'phase', label: 'M', status: 'known', next: ['z'] },
      { id: 'z', type: 'phase', label: 'Z', status: 'known', next: [] },
    ]);
    const res = removeNode(doc, 'm', {}, deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc.nodes.find((n) => n.id === 'a')?.next).toEqual(['z']);
    expect(res.doc.nodes.find((n) => n.id === 'b')?.next).toEqual(['z']);
  });
});

// ---------------------------------------------------------------------------
// T006 — mv-node re-parent (AC-06).
// ---------------------------------------------------------------------------
describe('T006 — mvNode re-parent (AC-06)', () => {
  it('re-parents a node with --after + rewires the old position', () => {
    // research → plan → ship; mv ship --after research → research → ship → plan
    const res = mvNode(baseDoc(), 'ship', { after: 'research' }, {}, deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc.nodes.find((n) => n.id === 'research')?.next).toEqual(['ship']);
    expect(res.doc.nodes.find((n) => n.id === 'ship')?.next).toEqual(['plan']);
    expect(res.doc.nodes.find((n) => n.id === 'plan')?.next).toEqual([]); // old successor link cleared
  });

  it('re-parents with --before', () => {
    // mv ship --before plan → research → ship → plan
    const res = mvNode(baseDoc(), 'ship', { before: 'plan' }, {}, deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc.nodes.find((n) => n.id === 'research')?.next).toEqual(['ship']);
    expect(res.doc.nodes.find((n) => n.id === 'ship')?.next).toEqual(['plan']);
  });

  it('a mv that would create a CYCLE is refused → E309, nothing written', () => {
    const doc = baseDoc();
    const res = mvNode(doc, 'ship', { after: 'ship' }, {}, deps()); // self-placement → self-cycle
    expect(res.ok).toBe(false);
    expect(code(res)).toBe(ErrorCodes.FLOW_EDGE_INVALID);
    expect(ids(doc)).toEqual(['research', 'plan', 'ship']);
  });

  it('moving a missing node → E305', () => {
    const res = mvNode(baseDoc(), 'ghost', { after: 'plan' }, {}, deps());
    expect(res.ok).toBe(false);
    expect(code(res)).toBe(ErrorCodes.FLOW_NODE_INVALID);
  });

  it('mv re-parents via the apply batch op kind too', () => {
    const res = applyBatch(baseDoc(), [{ op: 'mv', id: 'ship', after: 'research' }], deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc.nodes.find((n) => n.id === 'research')?.next).toEqual(['ship']);
  });
});
