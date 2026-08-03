import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { ddGateDrift, evaluateDdGate } from '../../../src/services/flow/flow-dd-gate.js';
import type { DdLink } from '../../../src/services/flow/flow-events.js';
import { setNow } from '../../../src/services/flow/flow-mutations.js';
import { renderFlow, renderRailLine } from '../../../src/services/flow/flow-renderer.js';
import { type GateFixture, gatedFlow, gateFixture, STATES } from './gate-fixtures/index.js';

/**
 * AC-11 — gate surfacing + basis drift (plan 065 P6 T004/T005).
 *
 * Two halves, and they are deliberately proven against different sources of
 * truth: the DRIFT half runs live (it must notice a file that changed on disk),
 * and the SURFACING half runs against the recorded reading only, which is what
 * keeps `renderFlow`/`renderRailLine` pure functions of the document.
 */

const CLOCK = '2026-08-04T09:00:00.000Z';
let fixture: GateFixture | undefined;

afterEach(() => {
  fixture?.cleanup();
  fixture = undefined;
});

function corpus(states: string[]) {
  fixture = gateFixture([{ name: 'fixture/plan' }]);
  const items = states.map((state, index) => ({
    id: `dw-000${index + 1}`,
    state,
  }));
  fixture.writeDoc('docs/tasks.dd.json', 'fixture/plan', items);
  return fixture;
}

function deps(fx: GateFixture) {
  return {
    clock: new FakeClock(CLOCK),
    gate: {
      evaluate: (link: DdLink) =>
        evaluateDdGate(link, fx.deps, { repoRoot: fx.root, fromPath: null }),
    },
  };
}

describe('AC-11 (drift) — an upstream edit surfaces as a warning, never a refusal', () => {
  it('reports the address and BOTH shas once the target moves', () => {
    const fx = corpus([STATES.checked]);
    const link: DdLink = { address: 'docs/tasks.dd.json#tasks' };

    // Departing records the basis at the sha the gate actually read.
    const first = setNow(gatedFlow(link), 'b', deps(fx));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const recorded = first.doc.nodes[0]?.dd_link as DdLink;
    expect(recorded.basis_sha).toMatch(/^[0-9a-f]{64}$/);
    expect(ddGateDrift(recorded, fx.deps, { repoRoot: fx.root, fromPath: null })).toBeNull();

    // Someone adds a row upstream. That is a SECOND command's worth of the world,
    // so it is read with second-command wiring (see `freshDeps`).
    fx.writeDoc('docs/tasks.dd.json', 'fixture/plan', [
      { id: 'dw-0001', state: STATES.checked },
      { id: 'dw-0002', state: STATES.checked },
    ]);
    const after = fx.freshDeps();
    const drift = ddGateDrift(recorded, after, { repoRoot: fx.root, fromPath: null });
    expect(drift).not.toBeNull();
    expect(drift?.address).toBe('docs/tasks.dd.json#tasks');
    expect(drift?.path).toBe(`${fx.root}/docs/tasks.dd.json`);
    expect(drift?.recorded).toBe(recorded.basis_sha);
    expect(drift?.actual).not.toBe(recorded.basis_sha);
  });

  it('drift does not hold the gate — a still-complete target still lets you leave', () => {
    const fx = corpus([STATES.checked]);
    const link: DdLink = {
      address: 'docs/tasks.dd.json#tasks',
      basis_sha: 'a-sha-from-before-the-edit',
    };
    const result = setNow(gatedFlow(link), 'b', deps(fx));
    expect(result.ok).toBe(true);
  });

  it('says nothing when there is no recorded basis to compare against', () => {
    const fx = corpus([STATES.checked]);
    const drift = ddGateDrift({ address: 'docs/tasks.dd.json#tasks' }, fx.deps, {
      repoRoot: fx.root,
      fromPath: null,
    });
    expect(drift).toBeNull();
  });

  it('says nothing when the address itself does not resolve — the gate reports that', () => {
    const fx = corpus([STATES.checked]);
    const drift = ddGateDrift({ address: 'docs/absent.dd.json#tasks', basis_sha: 'x' }, fx.deps, {
      repoRoot: fx.root,
      fromPath: null,
    });
    expect(drift).toBeNull();
  });
});

describe('AC-11 (surfacing) — the rail flags the gated node at the cursor', () => {
  it('appends a gate callout carrying the recorded reading', () => {
    const doc = gatedFlow({
      address: 'docs/tasks.dd.json#tasks',
      reading: { status: 'incomplete', terminal: 1, total: 3, incomplete: ['dw-0002'], at: CLOCK },
    });
    expect(renderRailLine(doc)).toContain('⚑ gate: Phase A ⛨ 1/3');
    expect(renderRailLine(doc)).not.toContain('✓');
  });

  it('ticks an open gate', () => {
    const doc = gatedFlow({
      address: 'docs/tasks.dd.json#tasks',
      reading: { status: 'complete', terminal: 3, total: 3, incomplete: [], at: CLOCK },
    });
    expect(renderRailLine(doc)).toContain('⚑ gate: Phase A ⛨ 3/3 ✓');
  });

  it('says so honestly when the link has never been evaluated', () => {
    expect(renderRailLine(gatedFlow({ address: 'docs/tasks.dd.json#tasks' }))).toContain(
      '⚑ gate: Phase A ⛨ not yet evaluated',
    );
  });

  it('never flags a non-gating link — it cannot stop anything', () => {
    const doc = gatedFlow({ address: 'docs/tasks.dd.json#tasks', gate: false });
    expect(renderRailLine(doc)).not.toContain('⚑ gate:');
  });

  it('leaves the line byte-identical when no gate sits at the cursor', () => {
    expect(renderRailLine(gatedFlow(undefined))).toBe(renderRailLine(gatedFlow(undefined)));
    expect(renderRailLine(gatedFlow(undefined))).not.toContain('⚑ gate:');
  });
});

describe('AC-11 (surfacing) — the rendered markdown badges the node, purely', () => {
  it('badges terminal/total from the STORED reading, resolving nothing', () => {
    const doc = gatedFlow({
      address: 'docs/tasks.dd.json#tasks',
      reading: { status: 'incomplete', terminal: 2, total: 5, incomplete: ['dw-0003'], at: CLOCK },
    });
    expect(renderFlow(doc)).toContain('⛨2/5');
  });

  it('ticks a complete reading', () => {
    const doc = gatedFlow({
      address: 'docs/tasks.dd.json#tasks',
      reading: { status: 'complete', terminal: 5, total: 5, incomplete: [], at: CLOCK },
    });
    expect(renderFlow(doc)).toContain('⛨5/5 ✓');
  });

  it('badges an unevaluated link with the bare shield', () => {
    expect(renderFlow(gatedFlow({ address: 'docs/tasks.dd.json#tasks' }))).toContain('⛨');
  });

  it('adds nothing to the DIAGRAM for a flow with no dd_link', () => {
    // The legend is a constant caption and always names every badge; what must
    // stay clean is the node declaration.
    const declaration = renderFlow(gatedFlow(undefined))
      .split('\n')
      .find((line) => line.trim().startsWith('a['));
    expect(declaration).toBe('    a["Phase A"]:::wip');
  });

  it('the renderer stays pure — an address pointing nowhere renders fine', () => {
    // No filesystem exists for this address anywhere; a renderer that resolved
    // would have to fail, warn, or block. It does none of those.
    const doc = gatedFlow({
      address: '/definitely/not/here.dd.json#tasks',
      reading: { status: 'incomplete', terminal: 0, total: 2, incomplete: ['x', 'y'], at: CLOCK },
    });
    expect(renderFlow(doc)).toContain('⛨0/2');
  });
});

describe('AC-11 (surfacing) — per-item states come through the evaluator', () => {
  it('labels every item with the state it carries, in document order', () => {
    const fx = corpus([STATES.checked, STATES.unchecked, STATES.blocked, STATES.na]);
    const result = evaluateDdGate({ address: 'docs/tasks.dd.json#tasks' }, fx.deps, {
      repoRoot: fx.root,
      fromPath: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toEqual([
      { id: 'dw-0001', state: 'checked', terminal: true },
      { id: 'dw-0002', state: 'unchecked', terminal: false },
      { id: 'dw-0003', state: 'blocked', terminal: false },
      { id: 'dw-0004', state: 'na', terminal: true },
    ]);
  });

  it('NAMES an out-of-vocabulary state rather than flattening it to "unknown"', () => {
    // Changed deliberately in the P6 fix round (F001). The old reconstruction
    // inferred each state by re-deriving once per candidate vocabulary value, so a
    // value the schema never declared could only come back as `unknown` — and two
    // different bad states looked identical in the refusal. That is the same defect
    // 6.6(b) already found once (`blocked` and `unchecked` reading alike). The dd
    // SDK seam reports what the document actually says, so the refusal can too.
    // Out-of-vocabulary is still REPORTED, never refused: `dd validate` owns that
    // finding, and the gate's answer for it — "not terminal" — is unchanged.
    const fx = corpus([STATES.checked, 'wat']);
    const result = evaluateDdGate({ address: 'docs/tasks.dd.json#tasks' }, fx.deps, {
      repoRoot: fx.root,
      fromPath: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[1]).toEqual({ id: 'dw-0002', state: 'wat', terminal: false });
    expect(result.complete).toBe(false);
  });
});
