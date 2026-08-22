import { FsDocLoader } from '@ai-substrate/dd';
import { MemoizingDocLoader } from '@ai-substrate/dd/links';
import { NodeSchemaFs } from '@ai-substrate/dd/node';
import { ConventionSchemaResolver } from '@ai-substrate/dd/schema';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { NodeHash } from '../../../src/adapters/hash/node-hash.js';
import { ErrorCodes } from '../../../src/output/error-codes.js';
import {
  type DdGateDeps,
  type DdGateResult,
  evaluateDdGate,
} from '../../../src/services/flow/flow-dd-gate.js';
import {
  type DdLink,
  type FlowDoc,
  sanitizeDdLink,
} from '../../../src/services/flow/flow-events.js';
import { type GateEvaluator, setNow } from '../../../src/services/flow/flow-mutations.js';
import { createSyntheticPlan, type SyntheticCorpus } from '../../support/dd-corpus.js';
import { gatedFlow } from './gate-fixtures/index.js';

/**
 * ac-7109 — the CHECK-kind departure gate (tk-7131 + tk-7132).
 *
 * The completion gate asks "are these items ticked?". This one asks "does this
 * plan pass its own validator?", and the difference is the whole point: a phase
 * can be ticked to the last box and still be telling a story that does not hang
 * together. So every row here drives the REAL evaluator over a REAL builder-schema
 * corpus through the REAL `setNow` mutation — a refusal that is demonstrated
 * rather than tested is a refusal nobody has watched say no.
 *
 * The corpus is the shared synthetic factory, which COPIES the shipped
 * `.dd/schemas`. That makes each row also a test of the real `builder/plan`
 * declarations: if `satisfies` stops being rel-typed, or `pressure` stops being
 * mandatory, the gate stops seeing it and these tests go red.
 */

const CLOCK = '2026-08-04T09:00:00.000Z';
let corpus: SyntheticCorpus | undefined;

afterEach(() => {
  corpus?.cleanup();
  corpus = undefined;
});

function gateDeps(root: string): DdGateDeps {
  const fs = new NodeSchemaFs();
  return {
    schemaResolver: new ConventionSchemaResolver({ fs, repoRoot: root, home: `${root}/nohome` }),
    docLoader: new MemoizingDocLoader(new FsDocLoader(fs, new NodeHash(), null)),
  };
}

function evaluate(link: DdLink, root: string): DdGateResult {
  return evaluateDdGate(link, gateDeps(root), { repoRoot: root, fromPath: null });
}

function deps(root: string): { clock: FakeClock; gate: GateEvaluator } {
  return {
    clock: new FakeClock(CLOCK),
    gate: { evaluate: (link: DdLink) => evaluate(link, root) },
  };
}

function depart(doc: FlowDoc, root: string, force = false) {
  return setNow(doc, 'b', deps(root), { force });
}

/** A plan whose story hangs together: everything closed, every AC claimed. */
function greenPlan(): SyntheticCorpus {
  return createSyntheticPlan({
    acceptance: [{ id: 'ac-0001', claim: 'the thing works', state: 'checked' }],
    phases: [
      {
        id: 'ph-0001',
        title: 'core',
        state: 'checked',
        tasks: [
          {
            id: 'tk-0001',
            title: 'build it',
            state: 'checked',
            satisfies: ['ac-0001'],
            assertions: [
              {
                id: 'dw-0001',
                assertion: 'it builds',
                state: 'checked',
                pressure: 'not-applicable',
              },
            ],
          },
        ],
      },
    ],
  });
}

describe('tk-7131 — the check variant is authored, validated, and never trusted', () => {
  it('dw-0001: sanitize keeps a well-formed check link', () => {
    const link = sanitizeDdLink({ address: 'docs/plan.dd.json#phases', check: 'plan-validate' });
    expect(link).toEqual({ address: 'docs/plan.dd.json#phases', check: 'plan-validate' });
  });

  it.each([
    ['an unknown check kind', { address: 'docs/plan.dd.json', check: 'plan-vibes' }],
    ['a non-string check', { address: 'docs/plan.dd.json', check: 7 }],
    ['a null check', { address: 'docs/plan.dd.json', check: null }],
    ['an empty check', { address: 'docs/plan.dd.json', check: '' }],
    ['an object check', { address: 'docs/plan.dd.json', check: { kind: 'plan-validate' } }],
  ])('dw-0001: sanitize REFUSES %s — an authored key is never defaulted', (_label, raw) => {
    // The planted bad. Both plausible defaults lie: running `plan-validate` anyway
    // performs a check nobody asked for, and dropping the key silently downgrades a
    // semantic gate to no gate — the failure where an author believes the flow is
    // protected and it is not.
    expect(sanitizeDdLink(raw)).toBeNull();
  });

  it('dw-0001: the RECORDED half is still dropped, not refused, on a check link', () => {
    // The F004 authored/recorded split survives the second kind: nobody authored
    // `reading`, the gate re-derives it live, so a malformed one loses a badge
    // rather than refusing a legitimate link.
    const link = sanitizeDdLink({
      address: 'docs/plan.dd.json',
      check: 'plan-validate',
      reading: { status: 'complete', terminal: '1"] --> EVIL', total: 1, incomplete: [], at: 'x' },
    });
    expect(link).toEqual({ address: 'docs/plan.dd.json', check: 'plan-validate' });
  });

  it('dw-0002: a check the CLI does not implement REFUSES — it never passes vacuously', () => {
    corpus = greenPlan();
    // Bypassing sanitize on purpose: this is the file-on-disk threat, not the
    // authoring one. A flow written against a newer CLI must fail loudly here.
    const result = evaluate(
      { address: corpus.planRelative, check: 'plan-vibes' } as DdLink,
      corpus.root,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('check-unknown');
    expect(result.message).toContain('which this CLI does not implement');
  });

  it('dw-0002: gate evaluation never executes or resolves document-supplied text', () => {
    // The untrusted-reading discipline, stated as a property. The plan's own prose
    // carries a command substitution and a mermaid break-out; the gate reproduces
    // them as TEXT in a finding and does nothing else with them.
    corpus = createSyntheticPlan({
      acceptance: [{ id: 'ac-0001', claim: '$(touch /tmp/pwned) 1"] --> EVIL["x' }],
      phases: [{ id: 'ph-0001', title: 'core', tasks: [{ id: 'tk-0001', title: 'work' }] }],
    });
    const result = evaluate({ address: corpus.planRelative, check: 'plan-validate' }, corpus.root);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.complete).toBe(false);
    // Every finding is data the CLI produced about STRUCTURE. The dangerous string
    // appears nowhere as a resolved address or an executed thing.
    for (const finding of result.findings) {
      expect(typeof finding.message).toBe('string');
      expect(finding.address).not.toContain('$(');
    }
    // And the counts stay counts — the numbers a renderer interpolates are ours.
    expect(result.total).toBe(1);
    expect(Number.isSafeInteger(result.terminal)).toBe(true);
  });
});

describe('tk-7132 — the check gate refuses, quotes, and records', () => {
  it('dw-0003: a non-green plan REFUSES departure and writes nothing', () => {
    corpus = createSyntheticPlan({
      acceptance: [{ id: 'ac-0001', claim: 'the thing works' }],
      phases: [
        {
          id: 'ph-0001',
          title: 'core',
          tasks: [
            {
              id: 'tk-0001',
              title: 'build it',
              satisfies: ['ac-0001'],
              assertions: [{ id: 'dw-0001', assertion: 'it builds', pressure: 'not-applicable' }],
            },
          ],
        },
      ],
    });
    const doc = gatedFlow({ address: corpus.planRelative, check: 'plan-validate' });
    const before = JSON.stringify(doc);
    const result = depart(doc, corpus.root);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe(ErrorCodes.DD_GATE_UNSATISFIED);
    // NOTHING WRITTEN: the invariant every gate refusal shares.
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('dw-0003: the refusal quotes the validator VERBATIM, not a count', () => {
    corpus = createSyntheticPlan({
      acceptance: [{ id: 'ac-0001', claim: 'nobody claims me' }],
      phases: [{ id: 'ph-0001', title: 'core', tasks: [{ id: 'tk-0001', title: 'work' }] }],
    });
    const address = corpus.planRelative;
    const reading = evaluate({ address, check: 'plan-validate' }, corpus.root);
    expect(reading.ok).toBe(true);
    if (!reading.ok) throw new Error('unreachable');
    expect(reading.findings.length).toBeGreaterThan(0);

    const result = depart(gatedFlow({ address, check: 'plan-validate' }), corpus.root);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    // Every finding's own sentence appears in the refusal, unaltered. This is the
    // difference between a gate that stops you and a gate that also tells you why:
    // the reader gets what `plan validate --complete` would have said, at the
    // moment they were stopped, without running it again.
    for (const finding of reading.findings) {
      expect(result.message).toContain(finding.message);
    }
    expect(result.message).toContain(`${reading.findings.length} finding(s)`);
    // And the next_action is RUNNABLE — the address is split back into the
    // document `plan validate` actually takes.
    expect(result.next_action).toContain(`harness plan validate ${address} --complete`);
  });

  it('dw-0003: a GREEN plan lets the cursor leave — the good twin', () => {
    corpus = greenPlan();
    const doc = gatedFlow({ address: corpus.planRelative, check: 'plan-validate' });
    const result = depart(doc, corpus.root);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.doc.nav?.now).toBe('b');
    expect(result.notice).toBeUndefined();
    // The reading is recorded as ONE assertion, answered.
    const node = result.doc.nodes.find((n) => n.id === 'a');
    expect(node?.dd_link?.reading).toMatchObject({ status: 'complete', terminal: 1, total: 1 });
  });

  it('dw-0003: the gate agrees with the verb — one implementation, not two', () => {
    // The reason `readPlanCheck` is a shared seam. A gate that re-derived "green"
    // would be a second opinion about the same documents, and the day they drifted
    // it would refuse work the verb calls finished, undiscoverably.
    corpus = greenPlan();
    const green = evaluate({ address: corpus.planRelative, check: 'plan-validate' }, corpus.root);
    expect(green.ok && green.complete).toBe(true);
    if (!green.ok) throw new Error('unreachable');
    expect(green.findings).toEqual([]);
    expect(green.schema).toBe('builder/plan');
  });

  it('dw-0004: --force departs, records a defended override, and carries the etiquette', () => {
    corpus = createSyntheticPlan({
      acceptance: [{ id: 'ac-0001', claim: 'nobody claims me' }],
      phases: [{ id: 'ph-0001', title: 'core', tasks: [{ id: 'tk-0001', title: 'work' }] }],
    });
    const doc = gatedFlow({ address: corpus.planRelative, check: 'plan-validate' });
    const result = depart(doc, corpus.root, true);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.doc.nav?.now).toBe('b');
    // Exactly as the completion gate does it: a degraded envelope, the
    // `dd-gate-override` event, and the etiquette line by value.
    expect(result.notice?.status).toBe('degraded');
    expect(result.notice?.next_action).toContain('an agent may not force a dd gate');
    const event = result.doc.events.find((e) => e.kind === 'dd-gate-override');
    expect(event).toBeDefined();
    expect(event?.details).toMatchObject({ check: 'plan-validate', address: corpus.planRelative });
    // The COUNT is durable, the findings are not: a committed flow event should not
    // freeze validator prose about rows that will have changed by the time anyone
    // reads it.
    expect(typeof (event?.details as { findings?: unknown }).findings).toBe('number');
    expect(JSON.stringify(event?.details)).not.toContain('nobody claims me');
  });

  it('dw-0004: an unresolvable check address refuses as target-invalid, not as "not green"', () => {
    corpus = greenPlan();
    const result = depart(
      gatedFlow({ address: 'docs/plans/nope/plan.dd.json#phases', check: 'plan-validate' }),
      corpus.root,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    // "I could not look" and "I looked and it is not done" are different fixes, so
    // they answer to different codes — the same split the completion gate makes.
    expect(result.code).toBe(ErrorCodes.DD_GATE_TARGET_INVALID);
  });

  it('dw-0004: an unimplemented check refuses as EVALUATION_FAILED — never as a pass', () => {
    corpus = greenPlan();
    const doc = gatedFlow({ address: corpus.planRelative, check: 'plan-vibes' } as DdLink);
    const result = depart(doc, corpus.root);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe(ErrorCodes.DD_GATE_EVALUATION_FAILED);
  });

  it('gate: false keeps a check link as a plain reference, gating nothing', () => {
    // The opt-in guarantee survives the second kind.
    corpus = createSyntheticPlan({
      acceptance: [{ id: 'ac-0001', claim: 'nobody claims me' }],
      phases: [{ id: 'ph-0001', title: 'core', tasks: [{ id: 'tk-0001', title: 'work' }] }],
    });
    const doc = gatedFlow({
      address: corpus.planRelative,
      check: 'plan-validate',
      gate: false,
    });
    const result = depart(doc, corpus.root);
    expect(result.ok).toBe(true);
  });
});
