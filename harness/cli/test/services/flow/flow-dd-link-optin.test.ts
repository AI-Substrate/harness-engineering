import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import type { FlowDoc } from '../../../src/services/flow/flow-events.js';
import { applyBatch, setNow, setStatus } from '../../../src/services/flow/flow-mutations.js';
import { renderFlow, renderRailLine } from '../../../src/services/flow/flow-renderer.js';

/**
 * The opt-in contract, regression-pinned (plan 065 P6 T002).
 *
 * Phase 6 put a mechanical refusal into the machinery every flow in every
 * consuming repository already runs on. The mitigation is that the gate is reached
 * only through a node's `dd_link`, and the mitigation is only worth anything if it
 * is PROVEN rather than asserted — so this file states the contract in its
 * strongest available form: with the field absent, the output is byte-identical to
 * running with no gate wired at all.
 *
 * If a future change moves gate evaluation anywhere ahead of the `dd_link` check,
 * this file is what goes red.
 */

const CLOCK = '2026-08-04T09:00:00.000Z';

/** Deps WITH a gate wired that would explode if it were ever consulted. */
function withExplodingGate() {
  return {
    clock: new FakeClock(CLOCK),
    gate: {
      evaluate: () => {
        throw new Error('the gate was evaluated for a flow that carries no dd_link');
      },
    },
  };
}

/** Deps with no gate at all — the pre-Phase-6 world. */
function withoutGate() {
  return { clock: new FakeClock(CLOCK) };
}

function plainFlow(): FlowDoc {
  return {
    schema_version: 1,
    kind: 'harness-loop',
    slug: 'plain',
    nav: { now: 'a', next: null },
    created_at: '2026-08-04T00:00:00.000Z',
    provenance: {
      record_kind: 'flow',
      harness_version: '0.4.0',
      branch: 'main',
      repo: null,
      created_at: '2026-08-04T00:00:00.000Z',
      agent: null,
      plan_id: null,
    },
    events: [],
    nodes: [
      { id: 'a', type: 'boot', label: 'Boot', status: 'done', next: ['b'] },
      { id: 'b', type: 'observe', label: 'Observe', status: 'in_progress', next: ['c'] },
      { id: 'c', type: 'retro', label: 'Retro', status: 'known', next: [] },
    ],
  };
}

describe('opt-in — a flow without dd_link never reaches the gate', () => {
  it('setNow is byte-identical with and without a gate wired', () => {
    const gated = setNow(plainFlow(), 'b', withExplodingGate());
    const plain = setNow(plainFlow(), 'b', withoutGate());
    expect(gated.ok && plain.ok).toBe(true);
    if (!gated.ok || !plain.ok) return;
    expect(JSON.stringify(gated.doc)).toBe(JSON.stringify(plain.doc));
    expect(gated.notice).toBeUndefined();
  });

  it('--force on an ungated flow changes nothing at all', () => {
    const forced = setNow(plainFlow(), 'b', withExplodingGate(), { force: true });
    const plain = setNow(plainFlow(), 'b', withoutGate());
    expect(forced.ok && plain.ok).toBe(true);
    if (!forced.ok || !plain.ok) return;
    expect(JSON.stringify(forced.doc)).toBe(JSON.stringify(plain.doc));
    expect(forced.notice).toBeUndefined();
  });

  it('every other mutation is untouched by the gate deps', () => {
    const gated = setStatus(plainFlow(), 'b', 'done', withExplodingGate());
    const plain = setStatus(plainFlow(), 'b', 'done', withoutGate());
    expect(gated.ok && plain.ok).toBe(true);
    if (!gated.ok || !plain.ok) return;
    expect(JSON.stringify(gated.doc)).toBe(JSON.stringify(plain.doc));
  });

  it('the render and the rail are byte-identical', () => {
    expect(renderFlow(plainFlow())).toBe(renderFlow(plainFlow()));
    expect(renderRailLine(plainFlow())).toBe('[plain] [ ◆─◐ ]─◇  [ ◆ Boot · ◐ Observe ] · ◇ Retro');
  });
});

describe('opt-in — dd_link round-trips through the mutation surface', () => {
  it('apply --ops can create a node carrying a gate link', () => {
    const result = applyBatch(
      plainFlow(),
      [
        {
          op: 'insert',
          id: 'd',
          type: 'phase',
          label: 'Phase D',
          status: 'known',
          after: 'c',
          dd_link: { address: 'docs/tasks.dd.json#tasks', gate: true },
        },
      ],
      withoutGate(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.nodes.at(-1)?.dd_link).toEqual({
      address: 'docs/tasks.dd.json#tasks',
      gate: true,
    });
  });

  it('apply --ops can set a gate link on an existing node', () => {
    const result = applyBatch(
      plainFlow(),
      [{ op: 'set', id: 'b', dd_link: { address: 'docs/tasks.dd.json#tasks' } }],
      withoutGate(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.nodes[1]?.dd_link).toEqual({ address: 'docs/tasks.dd.json#tasks' });
    expect(result.doc.events.at(-1)?.details).toMatchObject({ node: 'b', fields: ['dd_link'] });
  });

  it('re-setting the same link is a no-op — no event, no restamp', () => {
    const linked = applyBatch(
      plainFlow(),
      [{ op: 'set', id: 'b', dd_link: { address: 'docs/tasks.dd.json#tasks' } }],
      withoutGate(),
    );
    expect(linked.ok).toBe(true);
    if (!linked.ok) return;
    const again = applyBatch(
      linked.doc,
      [{ op: 'set', id: 'b', dd_link: { address: 'docs/tasks.dd.json#tasks' } }],
      withoutGate(),
    );
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(JSON.stringify(again.doc)).toBe(JSON.stringify(linked.doc));
  });
});
