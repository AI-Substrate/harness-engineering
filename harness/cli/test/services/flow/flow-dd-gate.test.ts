import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { ErrorCodes } from '../../../src/output/error-codes.js';
import { evaluateDdGate } from '../../../src/services/flow/flow-dd-gate.js';
import type { DdLink, FlowDoc, FlowNode } from '../../../src/services/flow/flow-events.js';
import { type GateEvaluator, setNow } from '../../../src/services/flow/flow-mutations.js';
import {
  type GateFixture,
  gatedFlow,
  gateFixture,
  type Item,
  STATES,
} from './gate-fixtures/index.js';

/**
 * AC-10 — the full gate matrix (plan 065 P6 T001/T003).
 *
 * Every row drives the REAL evaluator over a REAL temp-dir corpus through the
 * REAL `setNow` mutation, because the control being proven is a refusal: a gate
 * that is demonstrated rather than tested is a gate nobody has watched say no.
 *
 * Values are pinned BY VALUE, not by shape (ruled-values-need-pinning, P5 DL-003).
 * The E-codes, the refusal envelope, the default terminal set and the `--force`
 * event shape are all ruled decisions, and a ruling that only a log row records
 * is a ruling the next refactor will quietly move.
 */

const CLOCK = '2026-08-04T09:00:00.000Z';
let fixture: GateFixture | undefined;

afterEach(() => {
  fixture?.cleanup();
  fixture = undefined;
});

/** Build a corpus + the `setNow` deps that evaluate against it. */
function corpus(
  items: Item[],
  options: {
    schema?: string;
    custom?: { values: string[]; gateTerminal: string[] };
    doc?: string;
  } = {},
) {
  const schema = options.schema ?? 'fixture/plan';
  const relative = options.doc ?? 'docs/tasks.dd.json';
  fixture = gateFixture([{ name: schema, ...(options.custom && { custom: options.custom }) }]);
  fixture.writeDoc(relative, schema, items);
  return { fixture, address: `${relative}#tasks` };
}

function deps(fx: GateFixture): { clock: FakeClock; gate: GateEvaluator } {
  return {
    clock: new FakeClock(CLOCK),
    gate: {
      evaluate: (link: DdLink) =>
        evaluateDdGate(link, fx.deps, { repoRoot: fx.root, fromPath: null }),
    },
  };
}

/** Depart the gated node `a` → `b`, the move AC-10 governs. */
function depart(doc: FlowDoc, fx: GateFixture, force = false) {
  return setNow(doc, 'b', deps(fx), { force });
}

function nodeA(doc: FlowDoc): FlowNode {
  const node = doc.nodes.find((n) => n.id === 'a');
  if (node === undefined) throw new Error('fixture flow lost node a');
  return node;
}

describe('AC-10 — a gate whose items are all terminal lets the cursor leave', () => {
  it.each([
    ['checked alone', [{ id: 'dw-0001', state: STATES.checked }]],
    ['human-skipped alone', [{ id: 'dw-0001', state: STATES.humanSkipped }]],
    ['na alone', [{ id: 'dw-0001', state: STATES.na }]],
    [
      'all three mixed',
      [
        { id: 'dw-0001', state: STATES.checked },
        { id: 'dw-0002', state: STATES.humanSkipped },
        { id: 'dw-0003', state: STATES.na },
      ],
    ],
  ])('%s passes the default terminal set', (_label, items) => {
    const { fixture: fx } = corpus(items as Item[]);
    const result = depart(gatedFlow({ address: `docs/tasks.dd.json#tasks` }), fx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.nav?.now).toBe('b');
    expect(result.notice).toBeUndefined();
  });

  it('pins the default gate-terminal set BY VALUE (workshop-002 Ruling 2)', () => {
    const { fixture: fx, address } = corpus([{ id: 'dw-0001', state: STATES.checked }]);
    const result = evaluateDdGate({ address }, fx.deps, { repoRoot: fx.root, fromPath: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.gate_terminal]).toEqual(['checked', 'human-skipped', 'na']);
  });
});

describe('AC-10 — a gate whose items are not all terminal REFUSES, and writes nothing', () => {
  it.each([
    ['one unchecked', STATES.unchecked],
    ['one blocked', STATES.blocked],
  ])('%s holds the gate', (_label, holding) => {
    const { fixture: fx } = corpus([
      { id: 'dw-0001', state: STATES.checked },
      { id: 'dw-0002', state: holding },
    ]);
    const doc = gatedFlow({ address: 'docs/tasks.dd.json#tasks' });
    const before = JSON.stringify(doc);
    const result = depart(doc, fx);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCodes.DD_GATE_UNSATISFIED);
    expect(result.code).toBe('E440');
    // The caller's document is untouched — "nothing was written" starts here, not
    // at the filesystem: a mutation that mutated in place would leave a dirty doc
    // for the next caller even though the act refused to persist it.
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('names EVERY incomplete item, not a count and not a truncated head', () => {
    const { fixture: fx } = corpus([
      { id: 'dw-0001', state: STATES.checked },
      { id: 'dw-0002', state: STATES.unchecked },
      { id: 'dw-0003', state: STATES.blocked },
      { id: 'dw-0004', state: STATES.na },
      { id: 'dw-0005', state: STATES.unchecked },
    ]);
    const result = depart(gatedFlow({ address: 'docs/tasks.dd.json#tasks' }), fx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe(
      'node "a" gates on "docs/tasks.dd.json#tasks": 3 of 5 items are not complete (dw-0002 (unchecked), dw-0003 (blocked), dw-0005 (unchecked)).',
    );
  });

  it('pins the refusal envelope: the next_action offers the work first, --force second', () => {
    const { fixture: fx } = corpus([{ id: 'dw-0001', state: STATES.unchecked }]);
    const result = depart(gatedFlow({ address: 'docs/tasks.dd.json#tasks' }), fx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe('error');
    expect(result.next_action).toBe(
      `Complete or state the listed items in ${fx.root}/docs/tasks.dd.json (gate-terminal states: checked, human-skipped, na), then retry. If departing anyway is the human's decision, re-run with --force to record a defended override. Nothing was written.`,
    );
  });
});

describe('AC-10 — the SCHEMA declares what terminal means', () => {
  it('a custom set that NARROWS the default holds on a state the default would pass', () => {
    // `na` is gate-terminal by default; this schema says it is not.
    const { fixture: fx } = corpus(
      [
        { id: 'dw-0001', state: 'checked' },
        { id: 'dw-0002', state: 'na' },
      ],
      {
        schema: 'fixture/strict',
        custom: {
          values: ['unchecked', 'checked', 'blocked', 'human-skipped', 'na'],
          gateTerminal: ['checked'],
        },
        doc: 'docs/strict.dd.json',
      },
    );
    const result = depart(gatedFlow({ address: 'docs/strict.dd.json#tasks' }), fx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('1 of 2 items are not complete (dw-0002 (na))');
    expect(result.next_action).toContain('gate-terminal states: checked)');
  });

  it('a custom set that WIDENS the default passes on a state the default would hold', () => {
    // `reviewed` is not in dd's built-in vocabulary at all; this schema mints it
    // and declares it terminal, so the gate opens on it.
    const { fixture: fx } = corpus(
      [
        { id: 'dw-0001', state: 'checked' },
        { id: 'dw-0002', state: 'reviewed' },
      ],
      {
        schema: 'fixture/wide',
        custom: {
          values: ['unchecked', 'checked', 'reviewed', 'waived'],
          gateTerminal: ['checked', 'reviewed', 'waived'],
        },
        doc: 'docs/wide.dd.json',
      },
    );
    const result = depart(gatedFlow({ address: 'docs/wide.dd.json#tasks' }), fx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.nav?.now).toBe('b');
  });

  it('reads the declared set from the schema, not from a flow-side assumption', () => {
    const { fixture: fx, address } = corpus([{ id: 'dw-0001', state: 'reviewed' }], {
      schema: 'fixture/wide',
      custom: {
        values: ['unchecked', 'checked', 'reviewed', 'waived'],
        gateTerminal: ['checked', 'reviewed', 'waived'],
      },
      doc: 'docs/wide.dd.json',
    });
    const result = evaluateDdGate({ address }, fx.deps, { repoRoot: fx.root, fromPath: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.gate_terminal]).toEqual(['checked', 'reviewed', 'waived']);
    expect(result.schema).toBe('fixture/wide');
  });
});

describe('AC-10 — an unevaluable gate refuses with its own code, never a guessed verdict', () => {
  it('a missing target document is E441, not a silent pass', () => {
    const { fixture: fx } = corpus([{ id: 'dw-0001', state: STATES.checked }]);
    const result = depart(gatedFlow({ address: 'docs/absent.dd.json#tasks' }), fx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCodes.DD_GATE_TARGET_INVALID);
    expect(result.code).toBe('E441');
    expect(result.message).toContain('could not be evaluated');
  });

  it('an address naming no such section is E441', () => {
    const { fixture: fx } = corpus([{ id: 'dw-0001', state: STATES.checked }]);
    const result = depart(gatedFlow({ address: 'docs/tasks.dd.json#nosuchsection' }), fx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('E441');
  });

  it('an unresolvable schema is E442 — a different fix from a bad address', () => {
    const { fixture: fx } = corpus([{ id: 'dw-0001', state: STATES.checked }]);
    fx.writeRaw(
      'docs/orphan.dd.json',
      `${JSON.stringify({
        dd: { schema: 'fixture/never-installed' },
        sections: [{ name: 'tasks', value: [] }],
        references: [],
      })}\n`,
    );
    const result = depart(gatedFlow({ address: 'docs/orphan.dd.json#tasks' }), fx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCodes.DD_GATE_SCHEMA_UNRESOLVABLE);
    expect(result.code).toBe('E442');
  });

  it('a dd_link carrying no address is E449', () => {
    const { fixture: fx } = corpus([{ id: 'dw-0001', state: STATES.checked }]);
    const result = depart(gatedFlow({ address: '  ' }), fx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCodes.DD_GATE_LINK_MISSING);
    expect(result.code).toBe('E449');
  });
});

describe('AC-10 — `--force` is a defended override, never a quiet success', () => {
  it('proceeds, records the override event, and pins its shape BY VALUE', () => {
    const { fixture: fx } = corpus([
      { id: 'dw-0001', state: STATES.checked },
      { id: 'dw-0002', state: STATES.unchecked },
    ]);
    const result = depart(gatedFlow({ address: 'docs/tasks.dd.json#tasks' }), fx, true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.nav?.now).toBe('b');

    const override = result.doc.events.find((e) => e.kind === 'dd-gate-override');
    expect(override).toBeDefined();
    expect(override?.id).toBe('DDG-001');
    expect(override?.origin).toBe('manual');
    expect(override?.fired_at).toBe(CLOCK);
    expect(override?.details).toEqual({
      node: 'a',
      to: 'b',
      address: 'docs/tasks.dd.json#tasks',
      incomplete: ['dw-0002'],
      terminal: 1,
      total: 2,
    });
    // Flow documents are committed: nothing machine-specific may land in one.
    expect(JSON.stringify(override?.details)).not.toContain(fx.root);
  });

  it('says whose decision it had to be — the agent-etiquette line, pinned', () => {
    const { fixture: fx } = corpus([{ id: 'dw-0001', state: STATES.unchecked }]);
    const result = depart(gatedFlow({ address: 'docs/tasks.dd.json#tasks' }), fx, true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const etiquette =
      "Record why departing was the human's decision — an agent may not force a dd gate on its own judgment (workshop-002). `human-skipped` or `na` on the individual items is the legitimate way a gate passes without the work.";
    expect(result.notice?.next_action).toBe(etiquette);
    expect(result.notice?.status).toBe('degraded');
    expect(result.doc.events.at(-1)?.description).toContain(etiquette);
  });

  it('also overrides an UNEVALUABLE gate, so a bad address cannot brick a flow', () => {
    const { fixture: fx } = corpus([{ id: 'dw-0001', state: STATES.checked }]);
    const result = depart(gatedFlow({ address: 'docs/absent.dd.json#tasks' }), fx, true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.events.at(-1)?.details).toMatchObject({ reason: 'target-invalid' });
  });

  it('a gate that is SATISFIED carries no override, forced or not', () => {
    const { fixture: fx } = corpus([{ id: 'dw-0001', state: STATES.checked }]);
    const result = depart(gatedFlow({ address: 'docs/tasks.dd.json#tasks' }), fx, true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notice).toBeUndefined();
    expect(result.doc.events.some((e) => e.kind === 'dd-gate-override')).toBe(false);
  });
});

describe('AC-10 — the gate is evaluated LIVE; the recorded reading is never gate truth', () => {
  it('a stale recorded `complete` does not let a now-incomplete gate pass', () => {
    const { fixture: fx } = corpus([
      { id: 'dw-0001', state: STATES.checked },
      { id: 'dw-0002', state: STATES.unchecked },
    ]);
    const doc = gatedFlow({
      address: 'docs/tasks.dd.json#tasks',
      basis_sha: 'whatever-it-was',
      reading: { status: 'complete', terminal: 2, total: 2, incomplete: [], at: CLOCK },
    });
    const result = depart(doc, fx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('E440');
  });

  it('a stale recorded `incomplete` does not block a now-complete departure', () => {
    const { fixture: fx } = corpus([{ id: 'dw-0001', state: STATES.checked }]);
    const doc = gatedFlow({
      address: 'docs/tasks.dd.json#tasks',
      basis_sha: 'whatever-it-was',
      reading: { status: 'incomplete', terminal: 0, total: 1, incomplete: ['dw-0001'], at: CLOCK },
    });
    const result = depart(doc, fx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.nav?.now).toBe('b');
    // …and the stale record is replaced by what was actually just computed.
    expect(nodeA(result.doc).dd_link?.reading).toEqual({
      status: 'complete',
      terminal: 1,
      total: 1,
      incomplete: [],
      at: CLOCK,
    });
  });
});

describe('AC-10 — the gate is opt-in, and only gates departure', () => {
  it('a node WITHOUT dd_link is untouched — byte-identical to the pre-gate behaviour', () => {
    const { fixture: fx } = corpus([{ id: 'dw-0001', state: STATES.unchecked }]);
    const gateless = setNow(gatedFlow(undefined), 'b', deps(fx));
    const ungated = setNow(gatedFlow(undefined), 'b', { clock: new FakeClock(CLOCK) });
    expect(gateless.ok && ungated.ok).toBe(true);
    if (!gateless.ok || !ungated.ok) return;
    expect(JSON.stringify(gateless.doc)).toBe(JSON.stringify(ungated.doc));
  });

  it('`gate: false` surfaces the link without ever stopping anything', () => {
    const { fixture: fx } = corpus([{ id: 'dw-0001', state: STATES.unchecked }]);
    const result = depart(gatedFlow({ address: 'docs/tasks.dd.json#tasks', gate: false }), fx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.nav?.now).toBe('b');
    // Not gating also means not evaluated: nothing is recorded on the node.
    expect(nodeA(result.doc).dd_link).toEqual({
      address: 'docs/tasks.dd.json#tasks',
      gate: false,
    });
  });

  it('gates the node being LEFT, not the node being entered (PM ruling, 2026-08-04)', () => {
    const { fixture: fx } = corpus([{ id: 'dw-0001', state: STATES.unchecked }]);
    // The gate sits on `b` — the destination — so arriving there is free.
    const doc = gatedFlow(undefined, [
      { id: 'a', type: 'phase', label: 'A', status: 'done', next: ['b'] },
      {
        id: 'b',
        type: 'phase',
        label: 'B',
        status: 'known',
        next: [],
        dd_link: { address: 'docs/tasks.dd.json#tasks' },
      },
    ]);
    const arrive = setNow(doc, 'b', deps(fx));
    expect(arrive.ok).toBe(true);
    if (!arrive.ok) return;
    // …and leaving it is not: the same unsatisfied gate now refuses.
    const leave = setNow(arrive.doc, 'a', deps(fx));
    expect(leave.ok).toBe(false);
    if (leave.ok) return;
    expect(leave.code).toBe('E440');
  });
});

describe('AC-10 — the basis + reading recorded on a successful departure', () => {
  it('records the target sha and the computed reading, without restamping the node', () => {
    const { fixture: fx } = corpus([
      { id: 'dw-0001', state: STATES.checked },
      { id: 'dw-0002', state: STATES.na },
    ]);
    const doc = gatedFlow({ address: 'docs/tasks.dd.json#tasks' });
    const result = depart(doc, fx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const link = nodeA(result.doc).dd_link;
    expect(link?.reading).toEqual({
      status: 'complete',
      terminal: 2,
      total: 2,
      incomplete: [],
      at: CLOCK,
    });
    expect(link?.basis_sha).toMatch(/^[0-9a-f]{64}$/);
    // A computed reading is bookkeeping, not an authored edit.
    expect(nodeA(result.doc).modified_at).toBeUndefined();
  });
});
