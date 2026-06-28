import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import type { FlowDoc } from '../../../src/services/flow/flow-events.js';
import {
  addNode,
  applyBatch,
  insertNode,
  setNode,
} from '../../../src/services/flow/flow-mutations.js';

/**
 * Plan 040 Phase 1 (Task 1.1) — the per-node `instructions[]` field round-trips
 * through every mutation touch-point (`NodeSpec` → `specFrom` → `materialize`) and
 * an `apply` upsert batch carrying it run twice is byte-identical (AC-01 round-trip
 * + AC-07 idempotency guard). Real flow docs, no mocks (repo convention).
 */

const deps = () => ({ clock: new FakeClock('2026-06-29T05:00:00.000Z') });

/** research(done) → plan(in_progress) → ship(known). */
function baseDoc(): FlowDoc {
  return {
    schema_version: 1,
    kind: 'flight-plan',
    slug: 'demo',
    nav: { now: 'plan', next: null },
    created_at: '2026-06-29T00:00:00.000Z',
    provenance: {
      record_kind: 'flow',
      harness_version: '0.6.0',
      branch: 'main',
      repo: null,
      created_at: '2026-06-29T00:00:00.000Z',
      agent: null,
      plan_id: null,
    },
    events: [],
    nodes: [
      { id: 'research', type: 'research', label: 'R', status: 'done', next: ['plan'] },
      { id: 'plan', type: 'plan', label: 'P', status: 'in_progress', next: ['ship'] },
      { id: 'ship', type: 'merge', label: 'S', status: 'known', next: [] },
    ],
  };
}

const node = (doc: FlowDoc, id: string) => doc.nodes.find((n) => n.id === id);

describe('plan 040 P1 — instructions[] round-trips through mutations', () => {
  it('addNode materializes instructions[] (NodeSpec → materialize)', () => {
    const res = addNode(
      baseDoc(),
      {
        id: 'orient',
        type: 'phase',
        label: 'O',
        status: 'known',
        next: [],
        instructions: ['read nav', 'run orient'],
      },
      deps(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(node(res.doc, 'orient')?.instructions).toEqual(['read nav', 'run orient']);
  });

  it('insertNode materializes instructions[] (spliced node keeps the field)', () => {
    const res = insertNode(
      baseDoc(),
      { id: 'mid', type: 'phase', label: 'M', status: 'known', instructions: ['do the thing'] },
      { after: 'research' },
      deps(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(node(res.doc, 'mid')?.instructions).toEqual(['do the thing']);
  });

  it('apply upsert (insert-if-absent) carries instructions[] (specFrom → materialize)', () => {
    const res = applyBatch(
      baseDoc(),
      [
        {
          op: 'upsert',
          id: 'boot',
          type: 'phase',
          label: 'B',
          status: 'known',
          next: ['ship'],
          instructions: ['do x'],
        },
      ],
      deps(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(node(res.doc, 'boot')?.instructions).toEqual(['do x']);
  });

  it('apply upsert (merge-if-present) shallow-merges instructions[] onto an existing node', () => {
    const res = applyBatch(
      baseDoc(),
      [{ op: 'upsert', id: 'plan', instructions: ['author the plan'] }],
      deps(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(node(res.doc, 'plan')?.instructions).toEqual(['author the plan']);
  });

  it('setNode merges instructions[] onto an existing node', () => {
    const res = setNode(baseDoc(), 'plan', { instructions: ['author the plan'] }, deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(node(res.doc, 'plan')?.instructions).toEqual(['author the plan']);
  });

  it('AC-07 — an apply upsert batch carrying instructions run TWICE is byte-identical', () => {
    const ops = [
      {
        op: 'upsert',
        id: 'boot',
        type: 'phase',
        label: 'B',
        status: 'known',
        next: ['ship'],
        instructions: ['a', 'b'],
      },
    ];
    const first = applyBatch(baseDoc(), ops, deps());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const before = JSON.stringify(first.doc);
    const second = applyBatch(first.doc, ops, deps());
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // no new event fired on the identical re-apply, and the doc is byte-identical
    expect(second.doc.events).toHaveLength(first.doc.events.length);
    expect(JSON.stringify(second.doc)).toBe(before);
  });
});
