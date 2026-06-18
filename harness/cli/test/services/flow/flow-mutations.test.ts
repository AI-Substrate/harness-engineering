import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { ErrorCodes } from '../../../src/output/error-codes.js';
import type { FlowDoc, FlowEvent } from '../../../src/services/flow/flow-events.js';
import {
  addComment,
  addNode,
  dagIssue,
  getMeta,
  insertNode,
  navShow,
  predecessorsOf,
  setIntent,
  setMeta,
  setNext,
  setNode,
  setNow,
  setStatus,
  successorsOf,
} from '../../../src/services/flow/flow-mutations.js';

/**
 * T010 (mutations fire built-in events; comment + datetime + provenance) +
 * T011 (insert-node edge algebra + DAG re-check) — plan 024 AC-04/05/15;
 * ws-002 §E2/E5 + ws-003 I2–I4.
 */

function baseDoc(nodes?: FlowDoc['nodes']): FlowDoc {
  return {
    schema_version: 1,
    kind: 'harness-loop',
    slug: 'demo',
    nav: { now: 'a', next: null },
    created_at: '2026-06-18T00:00:00.000Z',
    provenance: {
      record_kind: 'flow',
      harness_version: '0.4.0',
      branch: 'main',
      repo: null,
      created_at: '2026-06-18T00:00:00.000Z',
      agent: null,
      plan_id: null,
    },
    events: [],
    nodes: nodes ?? [
      { id: 'a', type: 'boot', label: 'A', status: 'done', next: ['b'] },
      { id: 'b', type: 'observe', label: 'B', status: 'in_progress', next: ['c'] },
      { id: 'c', type: 'retro', label: 'C', status: 'known', next: [] },
    ],
  };
}

const deps = () => ({ clock: new FakeClock('2026-06-18T05:00:00.000Z') });
const ev = (doc: FlowDoc): FlowEvent[] => doc.events;
const lastEvent = (doc: FlowDoc): FlowEvent => doc.events[doc.events.length - 1] as FlowEvent;

describe('T010 — mutations fire built-in events + stamp datetime; provenance untouched', () => {
  it('setNow moves nav.now + fires cursor-moved {from,to}', () => {
    const res = setNow(baseDoc(), 'b', deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc.nav?.now).toBe('b');
    expect(lastEvent(res.doc).kind).toBe('cursor-moved');
    expect(lastEvent(res.doc).details).toEqual({ from: 'a', to: 'b' });
  });

  it('setNext sets advisory nav.next WITHOUT moving now + no event; null clears it', () => {
    const set = setNext(baseDoc(), 'c', deps());
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(set.doc.nav?.next).toBe('c');
    expect(set.doc.nav?.now).toBe('a'); // unchanged
    expect(set.doc.events).toHaveLength(0); // advisory — no transition event
    const cleared = setNext(set.doc, null, deps());
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect(cleared.doc.nav?.next).toBeNull();
  });

  it('setIntent sets nav.intent without firing an event', () => {
    const res = setIntent(baseDoc(), 'ship the nav primitives', deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc.nav?.intent).toBe('ship the nav primitives');
    expect(res.doc.events).toHaveLength(0);
  });

  it('setNow AND setNext reject a missing ref → E305 (both validate node-refs)', () => {
    expect((setNow(baseDoc(), 'nope', deps()) as { code: string }).code).toBe(
      ErrorCodes.FLOW_NODE_INVALID,
    );
    expect((setNext(baseDoc(), 'nope', deps()) as { code: string }).code).toBe(
      ErrorCodes.FLOW_NODE_INVALID,
    );
  });

  it('setStatus →done fires status-changed + stamps modified_at AND ran_at', () => {
    const res = setStatus(baseDoc(), 'b', 'done', deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const node = res.doc.nodes.find((n) => n.id === 'b');
    expect(node?.status).toBe('done');
    expect(node?.modified_at).toBe('2026-06-18T05:00:00.000Z');
    expect(node?.ran_at).toBe('2026-06-18T05:00:00.000Z');
    expect(lastEvent(res.doc).kind).toBe('status-changed');
    expect(lastEvent(res.doc).details).toEqual({ node: 'b', from: 'in_progress', to: 'done' });
  });

  it('setStatus →in_progress stamps modified_at but NOT ran_at', () => {
    const res = setStatus(baseDoc(), 'c', 'in_progress', deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const node = res.doc.nodes.find((n) => n.id === 'c');
    expect(node?.modified_at).toBe('2026-06-18T05:00:00.000Z');
    expect(node?.ran_at).toBeUndefined();
  });

  it('addNode fires node-created {node,type} + stamps created_at', () => {
    const res = addNode(
      baseDoc(),
      { id: 'd', type: 'improve', label: 'D', status: 'known', next: [] },
      deps(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const node = res.doc.nodes.find((n) => n.id === 'd');
    expect(node?.created_at).toBe('2026-06-18T05:00:00.000Z');
    expect(node?.modified_at).toBe('2026-06-18T05:00:00.000Z'); // trio present on a new node
    expect(lastEvent(res.doc).kind).toBe('node-created');
    expect(lastEvent(res.doc).details).toEqual({ node: 'd', type: 'improve' });
  });

  it('addNode rejects a duplicate id → E108', () => {
    const res = addNode(
      baseDoc(),
      { id: 'a', type: 'boot', label: 'dup', status: 'known' },
      deps(),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe(ErrorCodes.INVALID_ARGS);
  });

  it('setNode merges fields, fires node-updated {node,fields}, bumps modified_at, never reassigns id', () => {
    const res = setNode(baseDoc(), 'b', { label: 'B-renamed', id: 'HACK' }, deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const node = res.doc.nodes.find((n) => n.id === 'b');
    expect(node?.label).toBe('B-renamed');
    expect(res.doc.nodes.some((n) => n.id === 'HACK')).toBe(false); // id ignored
    expect(lastEvent(res.doc).kind).toBe('node-updated');
    expect(lastEvent(res.doc).details).toEqual({ node: 'b', fields: ['label'] });
  });

  it('addComment appends {at,text,source,kind,refs} + fires node-updated', () => {
    const res = addComment(baseDoc(), 'c', 'a review note', deps(), {
      source: 'agent',
      kind: 'validation',
      refs: ['abc123'],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const node = res.doc.nodes.find((n) => n.id === 'c');
    expect(node?.comments).toHaveLength(1);
    expect(node?.comments?.[0]).toEqual({
      at: '2026-06-18T05:00:00.000Z',
      text: 'a review note',
      source: 'agent',
      kind: 'validation',
      refs: ['abc123'],
    });
    expect(node?.modified_at).toBe('2026-06-18T05:00:00.000Z');
    expect(lastEvent(res.doc).details).toEqual({ node: 'c', fields: ['comments'] });
  });

  it('a mutation on a missing node → E305', () => {
    expect((setStatus(baseDoc(), 'nope', 'done', deps()) as { code: string }).code).toBe(
      ErrorCodes.FLOW_NODE_INVALID,
    );
    expect((addComment(baseDoc(), 'nope', 'x', deps()) as { code: string }).code).toBe(
      ErrorCodes.FLOW_NODE_INVALID,
    );
    expect((setNow(baseDoc(), 'nope', deps()) as { code: string }).code).toBe(
      ErrorCodes.FLOW_NODE_INVALID,
    );
  });

  it('provenance is stamped once and never touched by mutations; event ids are monotonic per prefix', () => {
    let doc = baseDoc();
    const r1 = setStatus(doc, 'b', 'done', deps());
    if (r1.ok) doc = r1.doc;
    const r2 = setStatus(doc, 'c', 'done', deps());
    if (r2.ok) doc = r2.doc;
    expect(Object.keys(doc.provenance)).toHaveLength(7);
    expect(doc.provenance.branch).toBe('main');
    const staIds = ev(doc)
      .filter((e) => e.kind === 'status-changed')
      .map((e) => e.id);
    expect(staIds).toEqual(['STA-001', 'STA-002']);
  });

  it('mutations are pure — the input doc is never mutated', () => {
    const doc = baseDoc();
    setNow(doc, 'b', deps());
    expect(doc.nav?.now).toBe('a');
    expect(doc.events).toHaveLength(0);
  });
});

describe('T003 — nav meta (shallow-merge bag) + neighbour utils + navShow', () => {
  it('setMeta shallow-merges into bag (other keys preserved); getMeta reads', () => {
    const r1 = setMeta(baseDoc(), 'replan_reason', 'draft', deps());
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = setMeta(r1.doc, 'attempts', 2, deps());
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.doc.nav?.bag).toEqual({ replan_reason: 'draft', attempts: 2 });
    expect(getMeta(r2.doc, 'replan_reason')).toBe('draft');
    expect(getMeta(r2.doc)).toEqual({ replan_reason: 'draft', attempts: 2 });
    expect(r2.doc.events).toHaveLength(0); // meta is not a transition — no event
  });

  it('predecessorsOf / successorsOf compute neighbour node sets', () => {
    const nodes = baseDoc().nodes;
    expect(successorsOf(nodes, 'a').map((n) => n.id)).toEqual(['b']);
    expect(predecessorsOf(nodes, 'b').map((n) => n.id)).toEqual(['a']);
    expect(predecessorsOf(nodes, 'a')).toEqual([]); // root has no predecessor
    expect(successorsOf(nodes, 'c')).toEqual([]); // leaf has no successor
  });

  it('navShow assembles {nav, predecessors, successors} with trimmed neighbours', () => {
    const shown = navShow(baseDoc());
    expect(shown.nav).toEqual({ now: 'a', next: null });
    expect(shown.successors).toEqual([
      { id: 'b', type: 'observe', status: 'in_progress', label: 'B', next: ['c'] },
    ]);
    expect(shown.predecessors).toEqual([]);
  });

  it('navShow returns nav:null when the doc carries no nav (graceful absent)', () => {
    const doc = baseDoc();
    doc.nav = undefined;
    const shown = navShow(doc);
    expect(shown.nav).toBeNull();
    expect(shown.predecessors).toEqual([]);
    expect(shown.successors).toEqual([]);
  });
});

describe('T007 — node zone carries through add-node / insert-node', () => {
  it('addNode persists an explicit zone', () => {
    const res = addNode(
      baseDoc(),
      { id: 'd', type: 'improve', label: 'D', status: 'known', zone: 'postflight' },
      deps(),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.doc.nodes.find((n) => n.id === 'd')?.zone).toBe('postflight');
  });

  it('insertNode persists an explicit zone', () => {
    const res = insertNode(
      baseDoc(),
      { id: 'n', type: 'phase', label: 'N', status: 'known', zone: 'flight' },
      { after: 'a' },
      deps(),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.doc.nodes.find((n) => n.id === 'n')?.zone).toBe('flight');
  });

  it('addNode / insertNode reject an invalid zone → E108, nothing written (companion MED)', () => {
    expect(
      (
        addNode(
          baseDoc(),
          { id: 'z', type: 'improve', label: 'Z', status: 'known', zone: 'bogus' },
          deps(),
        ) as { code: string }
      ).code,
    ).toBe(ErrorCodes.INVALID_ARGS);
    expect(
      (
        insertNode(
          baseDoc(),
          { id: 'z', type: 'phase', label: 'Z', status: 'known', zone: 'sideways' },
          { after: 'a' },
          deps(),
        ) as { code: string }
      ).code,
    ).toBe(ErrorCodes.INVALID_ARGS);
  });
});

describe('T011 — insert-node edge algebra + DAG re-check (E309) + audit events', () => {
  it('--after X: N inherits X out-edges, X→[N]; fires node-created + node-updated{splice-after}', () => {
    const res = insertNode(
      baseDoc(),
      { id: 'n', type: 'phase', label: 'N', status: 'known' },
      { after: 'a' },
      deps(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const a = res.doc.nodes.find((x) => x.id === 'a');
    const n = res.doc.nodes.find((x) => x.id === 'n');
    expect(a?.next).toEqual(['n']);
    expect(a?.modified_at).toBe('2026-06-18T05:00:00.000Z'); // rewired target → modified_at bumped
    expect(n?.next).toEqual(['b']); // inherited a's old out-edge
    expect(n?.modified_at).toBe('2026-06-18T05:00:00.000Z'); // new node carries the trio
    const kinds = res.doc.events.map((e) => e.kind);
    expect(kinds).toEqual(['node-created', 'node-updated']);
    expect(res.doc.events[1]?.details).toEqual({
      node: 'a',
      fields: ['next'],
      edge_op: 'splice-after',
    });
  });

  it('--before X (single predecessor): predecessor→N, N→X; node-updated{splice-before}', () => {
    const res = insertNode(
      baseDoc(),
      { id: 'n', type: 'phase', label: 'N', status: 'known' },
      { before: 'b' },
      deps(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc.nodes.find((x) => x.id === 'a')?.next).toEqual(['n']); // a was b's predecessor
    expect(res.doc.nodes.find((x) => x.id === 'n')?.next).toEqual(['b']);
    expect(res.doc.events[1]?.details).toEqual({
      node: 'a',
      fields: ['next'],
      edge_op: 'splice-before',
    });
  });

  it('--before X (MULTI predecessor): every predecessor rewired → one node-updated each', () => {
    const doc = baseDoc([
      { id: 'a', type: 'phase', label: 'A', status: 'done', next: ['x'] },
      { id: 'b', type: 'phase', label: 'B', status: 'done', next: ['x'] },
      { id: 'x', type: 'phase', label: 'X', status: 'known', next: [] },
    ]);
    const res = insertNode(
      doc,
      { id: 'n', type: 'phase', label: 'N', status: 'known' },
      { before: 'x' },
      deps(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc.nodes.find((p) => p.id === 'a')?.next).toEqual(['n']);
    expect(res.doc.nodes.find((p) => p.id === 'b')?.next).toEqual(['n']);
    expect(res.doc.nodes.find((p) => p.id === 'n')?.next).toEqual(['x']);
    // both rewired predecessors got their modified_at bumped
    expect(res.doc.nodes.find((p) => p.id === 'a')?.modified_at).toBe('2026-06-18T05:00:00.000Z');
    expect(res.doc.nodes.find((p) => p.id === 'b')?.modified_at).toBe('2026-06-18T05:00:00.000Z');
    const updates = res.doc.events.filter((e) => e.kind === 'node-updated');
    expect(updates).toHaveLength(2); // one per rewired predecessor
    expect(
      updates.every((e) => (e.details as { edge_op: string }).edge_op === 'splice-before'),
    ).toBe(true);
  });

  it('--branch-of X: excursion N.branch_of=X, N→X, X.next UNCHANGED; only node-created fires', () => {
    const res = insertNode(
      baseDoc(),
      { id: 'ws', type: 'phase', label: 'Workshop', status: 'done' },
      { branchOf: 'b' },
      deps(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ws = res.doc.nodes.find((x) => x.id === 'ws');
    expect(ws?.branch_of).toBe('b');
    expect(ws?.next).toEqual(['b']);
    expect(res.doc.nodes.find((x) => x.id === 'b')?.next).toEqual(['c']); // unchanged
    expect(res.doc.events.map((e) => e.kind)).toEqual(['node-created']); // no edge rewired
  });

  it('--branch-of X --rejoin R: N rejoins at R instead of X', () => {
    const res = insertNode(
      baseDoc(),
      { id: 'ws', type: 'phase', label: 'WS', status: 'done' },
      { branchOf: 'a', rejoin: 'c' },
      deps(),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.doc.nodes.find((x) => x.id === 'ws')?.next).toEqual(['c']);
  });

  it('mutually-exclusive placement flags → E108', () => {
    const res = insertNode(
      baseDoc(),
      { id: 'n', type: 'p', label: 'N', status: 'known' },
      { after: 'a', before: 'b' },
      deps(),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe(ErrorCodes.INVALID_ARGS);
  });

  it('no placement flag → E108', () => {
    const res = insertNode(
      baseDoc(),
      { id: 'n', type: 'p', label: 'N', status: 'known' },
      {},
      deps(),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe(ErrorCodes.INVALID_ARGS);
  });

  it('a missing target → E305', () => {
    const res = insertNode(
      baseDoc(),
      { id: 'n', type: 'p', label: 'N', status: 'known' },
      { after: 'nope' },
      deps(),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe(ErrorCodes.FLOW_NODE_INVALID);
  });

  it('a splice that creates a cycle → E309 with NOTHING written (input doc untouched)', () => {
    const doc = baseDoc();
    // --branch-of a --rejoin <self> forces N.next=[N] → a self-cycle the re-check catches.
    const res = insertNode(
      doc,
      { id: 'n', type: 'p', label: 'N', status: 'known' },
      { branchOf: 'a', rejoin: 'n' },
      deps(),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe(ErrorCodes.FLOW_EDGE_INVALID);
    // nothing written: the original doc gained no node + no event
    expect(doc.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(doc.events).toHaveLength(0);
  });

  it('dagIssue detects a cycle and an orphan directly', () => {
    expect(
      dagIssue([
        { id: 'a', type: 'p', label: 'A', status: 'known', next: ['b'] },
        { id: 'b', type: 'p', label: 'B', status: 'known', next: ['a'] },
      ]),
    ).toMatch(/cycle/);
    expect(
      dagIssue([
        { id: 'a', type: 'p', label: 'A', status: 'known', next: ['b'] },
        { id: 'b', type: 'p', label: 'B', status: 'known', next: [] },
        { id: 'orphan', type: 'p', label: 'O', status: 'known', next: [] },
      ]),
    ).toMatch(/orphan/);
    expect(
      dagIssue([
        { id: 'a', type: 'p', label: 'A', status: 'known', next: ['b'] },
        { id: 'b', type: 'p', label: 'B', status: 'known', next: [] },
      ]),
    ).toBeNull();
  });
});
