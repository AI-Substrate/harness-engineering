import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import type { DdGateResult } from '../../../src/services/flow/flow-dd-gate.js';
import { evaluateDdGate } from '../../../src/services/flow/flow-dd-gate.js';
import type { DdLink, FlowDoc } from '../../../src/services/flow/flow-events.js';
import {
  applyBatch,
  type GateEvaluator,
  setNow,
  setStatus,
} from '../../../src/services/flow/flow-mutations.js';
import { type GateFixture, gatedFlow, gateFixture } from './gate-fixtures/index.js';

/*
Test Doc:
- Why: issue #135 asked whether a `dd_link` written through `flow apply` — rather than
  baked by `create --template` — actually FIRES. The original probe could not answer it:
  it moved a node to `done` and was allowed, but the UNGATED control was allowed too, so
  both legs passed and the probe proved nothing.
- Contract: the legs must DISAGREE. An apply-written gate refuses departure; an otherwise
  identical ungated node does not; and `status` never consults the gate at all, which is
  why the original probe was blind.
- Usage Notes: a test whose legs all pass is not evidence. Every behavioural leg here is
  paired with one that must behave differently, and the one state that cannot be probed
  behaviourally is asserted on the stored field instead — see the `gate: false` row.
- Quality Contribution: turns "the field is written" into "the gate refuses", which are
  not the same claim. Storage is not behaviour.
- Worked Example: `apply` writes `{address}` → `nav set` refuses E440 naming the
  outstanding row; the same move on an ungated node returns ok.
*/

const CLOCK = '2026-08-09T00:00:00.000Z';
let fixture: GateFixture | undefined;

afterEach(() => {
  fixture?.cleanup();
  fixture = undefined;
});

/** A repo whose single dd document has one ticked row and one outstanding one. */
function incompleteTarget(): { address: string; fixture: GateFixture } {
  const built = gateFixture([{ name: 'demo/plan' }]);
  fixture = built;
  const path = built.writeDoc('docs/tasks.dd.json', 'demo/plan', [
    { id: 't-0001', state: 'checked' },
    { id: 't-0002', state: 'unchecked' },
  ]);
  return { address: `${path}#tasks`, fixture: built };
}

function deps(built: GateFixture): { clock: FakeClock; gate: GateEvaluator } {
  return {
    clock: new FakeClock(CLOCK),
    gate: {
      evaluate: (link: DdLink): DdGateResult =>
        evaluateDdGate(link, built.freshDeps(), { repoRoot: built.root, fromPath: null }),
    },
  };
}

/** Write a `dd_link` the way an author does — through the op surface, not the template. */
function wire(doc: FlowDoc, link: unknown, built: GateFixture): FlowDoc {
  const result = applyBatch(doc, [{ op: 'set', id: 'a', dd_link: link }], deps(built));
  if (!('doc' in result)) throw new Error(`apply refused: ${JSON.stringify(result)}`);
  return result.doc;
}

describe('#135 item 5 — an apply-written gate fires, and the legs must disagree', () => {
  it('REFUSES departure from a node whose gate was written through `apply`', () => {
    const { address, fixture: built } = incompleteTarget();
    const wired = wire(gatedFlow(undefined), { address }, built);
    expect(wired.nodes[0]?.dd_link).toEqual({ address });

    const result = setNow(wired, 'b', deps(built), {});
    expect('ok' in result && result.ok).toBe(false);
    const failure = result as { code: string; message: string };
    // Naming the row proves the gate READ the target rather than merely holding a
    // well-formed field. An inert gate cannot enumerate a document it never opened.
    expect(failure.message).toContain('t-0002');
    // Nothing was written: the cursor has not moved.
    expect(wired.nav?.now).toBe('a');
  });

  it('ALLOWS the identical departure when the node carries no gate — the control', () => {
    const { fixture: built } = incompleteTarget();
    // Same flow, same target document, same move. The ONLY difference is the absent
    // dd_link. If this leg refused, the leg above would prove nothing.
    const result = setNow(gatedFlow(undefined), 'b', deps(built), {});
    expect('ok' in result && result.ok).toBe(true);
    if (!('doc' in result)) throw new Error('expected a successful departure');
    expect(result.doc.nav?.now).toBe('b');
  });

  it('does NOT consult the gate on `status` — why the original probe was blind', () => {
    const { address, fixture: built } = incompleteTarget();
    const wired = wire(gatedFlow(undefined), { address }, built);
    // The gate hangs off departure, not off a status change. Moving the SAME gated node
    // to `done` with the target still incomplete is allowed — so a status-based probe
    // returns "allowed" for gated and ungated alike and cannot tell them apart. This
    // leg exists to stop that probe being written a second time.
    const result = setStatus(wired, 'a', 'done', deps(built));
    expect('ok' in result && result.ok).toBe(true);
  });

  it('OPENS once the target is complete — the gate tracks the work, not the flag', () => {
    const { address, fixture: built } = incompleteTarget();
    const wired = wire(gatedFlow(undefined), { address }, built);
    built.writeDoc('docs/tasks.dd.json', 'demo/plan', [
      { id: 't-0001', state: 'checked' },
      { id: 't-0002', state: 'human-skipped' },
    ]);
    const result = setNow(wired, 'b', deps(built), {});
    expect('ok' in result && result.ok).toBe(true);
  });

  it('a DISARMED gate is asserted on the FIELD — it cannot be probed by departing', () => {
    // THE ODD ONE OUT, DELIBERATELY. Do not "make this uniform" with the behavioural
    // legs above: `gate: false` is the one state that trying it cannot detect. A
    // disarmed gate permits departure EXACTLY as a satisfied one does, and exactly as a
    // node that was never gated does — three different states, one identical observation.
    // So the stored field is the only witness there is, and a departure-based assertion
    // here would pass for the wrong reason and would keep passing if the dd_link were
    // never written at all. Assert what was stored; never that the move succeeded.
    const { address, fixture: built } = incompleteTarget();
    const wired = wire(
      gatedFlow(undefined),
      { address, check: 'plan-validate', gate: false },
      built,
    );
    expect(wired.nodes[0]?.dd_link).toEqual({ address, check: 'plan-validate', gate: false });
  });
});
