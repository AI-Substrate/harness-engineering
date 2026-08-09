import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import type { FlowDoc } from '../../../src/services/flow/flow-events.js';
import { sanitizeDdLink } from '../../../src/services/flow/flow-events.js';
import { applyBatch, setNode } from '../../../src/services/flow/flow-mutations.js';

/*
Test Doc:
- Why: issue #135 (dd fr-0011) — `flow apply` accepted a key nobody declared and reported
  `ok`. The defect has TWO layers and the same shape at both: the outer merge wrote any
  key onto the node, and `sanitizeDdLink` discarded any key it did not recognise INSIDE
  the link. Fixing only the outer one closes the issue on a green test while a near-miss
  spelling still writes a `dd_link` that does not mean what its author wrote.
- Contract: an unrecognised key is REFUSED, never dropped and never silently corrected —
  the same answer `check` already gives, in the same `E108` grammar.
- Usage Notes: the near-miss spelling is the dangerous case and the reason this file leads
  with it. `{"kind": "plan-complete"}` is one letter-group away from the real `check` key,
  and it is the exact shape a reporter reached for unprompted.
- Quality Contribution: pins the layer most likely to be quietly satisfied by an allowlist
  that only guards the outer merge.
- Worked Example: `{"kind":"plan-complete","address":"x.dd.json"}` → refused, NOT reduced
  to `{address}`.
*/

describe('#135 — an unrecognised dd_link key is refused, not silently dropped', () => {
  it('refuses the near-miss `kind` instead of reducing the link to {address}', () => {
    // MEASURED before the fix: this returned `{ address: 'docs/x.dd.json' }` and the op
    // reported `ok`. The author asked for a semantic check gate and silently got a
    // DIFFERENT gate — a completion gate on a section address, or an unevaluable one
    // (`E441` at every departure) on a bare document address. Neither is what was written.
    expect(sanitizeDdLink({ kind: 'plan-complete', address: 'docs/x.dd.json' })).toBeNull();
  });

  it.each([
    ['a near-miss of `check`', { address: 'docs/x.dd.json', checks: 'plan-validate' }],
    ['a near-miss of `gate`', { address: 'docs/x.dd.json', gated: true }],
    ['a near-miss of `address`', { address: 'docs/x.dd.json', adress: 'docs/y.dd.json' }],
    ['a wholly unknown key', { address: 'docs/x.dd.json', severity: 'high' }],
  ])('refuses %s', (_label, raw) => {
    expect(sanitizeDdLink(raw)).toBeNull();
  });

  it('still accepts every key the link genuinely declares', () => {
    // The refusal must be narrow: tightening the unknown-key path must not start
    // refusing the authored or recorded halves the link is made of.
    const raw = {
      address: 'docs/x.dd.json#tasks',
      check: 'plan-validate',
      gate: true,
      basis_sha: 'abc123',
      reading: { status: 'complete', terminal: 2, total: 2, incomplete: [], at: CLOCK },
    };
    expect(sanitizeDdLink(raw)).toEqual(raw);
  });
});

const CLOCK = '2026-08-09T00:00:00.000Z';

/** A two-node flow — the smallest doc that can carry a corrupted field. */
function doc(): FlowDoc {
  return {
    schema_version: 1,
    kind: 'harness-loop',
    slug: 'allowlist',
    created_at: CLOCK,
    provenance: {},
    nav: { now: 'a', next: null },
    nodes: [
      { id: 'a', type: 'boot', label: 'A', status: 'known', next: ['b'] },
      { id: 'b', type: 'observe', label: 'B', status: 'known', next: [] },
    ],
    events: [],
  } as unknown as FlowDoc;
}

const deps = () => ({ clock: new FakeClock(CLOCK) });

function nodeA(result: ReturnType<typeof applyBatch>) {
  if (!('doc' in result)) throw new Error('expected a successful mutation');
  return result.doc.nodes[0] as Record<string, unknown>;
}

describe('#135 — an op field the node schema does not declare is refused, not written', () => {
  it.each([
    [
      'the doctrine`s own path/value pair',
      { op: 'set', id: 'a', path: 'dd_link', value: null },
      ['"path"', '"value"'],
    ],
    ['a misspelled label', { op: 'set', id: 'a', labell: 'typo' }, ['"labell"']],
    ['a misspelled status', { op: 'set', id: 'a', statuss: 'done' }, ['"statuss"']],
  ])('refuses %s and writes NOTHING', (_label, op, named) => {
    // MEASURED before the fix: every one of these returned `ok` and wrote the junk key
    // onto the node. Ox found twelve nodes in a LIVE flow carrying exactly this.
    const before = doc();
    const result = applyBatch(before, [op], deps());
    expect('ok' in result && result.ok).toBe(false);
    const failure = result as { message: string };
    for (const key of named) expect(failure.message).toContain(key);
    // Transactional: the batch refused, so the document is untouched.
    expect(before.nodes[0]).toEqual(doc().nodes[0]);
  });

  it('refuses the nested-`node` upsert and says where the fields actually go', () => {
    // The shape ox found on a live phase-2 node: a top-level id AND a nested `node`,
    // so the spec is read from the top level and `node` lands as a junk key.
    const result = applyBatch(
      doc(),
      [{ op: 'upsert', id: 'b', node: { id: 'b', type: 'review', zone: 'flight' } }],
      deps(),
    );
    expect('ok' in result && result.ok).toBe(false);
    const failure = result as { message: string; next_action: string };
    expect(failure.message).toContain('"node"');
    expect(failure.next_action).toContain('TOP LEVEL');
  });

  it('teaches the nesting even when the op has NO top-level id — the doctrine`s shape', () => {
    // The malformed example shipped in `flight-plan-ops.md` carries no top-level `id`
    // at all, so it fails the id check BEFORE the field guard can ever see it. Its
    // author gets "every op needs an id" while looking straight at an id they wrote
    // one level down. This is the op verbatim from the doctrine.
    const result = applyBatch(
      doc(),
      [
        {
          op: 'upsert',
          node: {
            id: 'review-2',
            type: 'review',
            zone: 'flight',
            dd_link: { address: 'plan.dd.json', check: 'plan-validate' },
          },
        },
      ],
      deps(),
    );
    expect('ok' in result && result.ok).toBe(false);
    const failure = result as { message: string; next_action: string };
    expect(failure.message).toContain('TOP LEVEL');
    // The refusal hands back the id it found, so the fix is a copy-paste rather than
    // a re-read of the reference.
    expect(failure.next_action).toContain('"review-2"');
  });

  it('refuses an unknown dd_link key through the batch surface too', () => {
    // Item 3 reached through the verb rather than the unit — the two layers of the same
    // defect, proven to be closed at the surface an author actually types.
    const result = applyBatch(
      doc(),
      [{ op: 'set', id: 'a', dd_link: { kind: 'plan-complete', address: 'docs/x.dd.json' } }],
      deps(),
    );
    expect('ok' in result && result.ok).toBe(false);
    expect((result as { message: string }).message).toContain('"kind"');
  });

  it('still writes every field the schema DOES declare', () => {
    // The guard must refuse the undeclared without narrowing the declared — including
    // the pass-through bookkeeping keys `validateFlowDoc` deliberately round-trips.
    const result = applyBatch(
      doc(),
      [
        {
          op: 'set',
          id: 'a',
          label: 'renamed',
          zone: 'flight',
          artifacts: ['out.txt'],
          instructions: ['do the thing'],
          output: 'bookkeeping',
        },
      ],
      deps(),
    );
    expect('ok' in result && result.ok).toBe(true);
    expect(nodeA(result)).toMatchObject({
      label: 'renamed',
      zone: 'flight',
      artifacts: ['out.txt'],
      instructions: ['do the thing'],
      output: 'bookkeeping',
    });
  });

  it('refuses an undeclared field through setNode, the third writer', () => {
    // `apply` is guarded in `parseOp`, but `setNode` writes its fields just as directly.
    // Guarding only the batch surface would leave the same corruption one call away.
    const result = setNode(doc(), 'a', { severity: 'high' }, deps());
    expect('ok' in result && result.ok).toBe(false);
    expect((result as { message: string }).message).toContain('"severity"');
  });

  it('leaves add/insert`s implicit allowlist pinned rather than trusted', () => {
    // `specFrom` copies only named keys, so creating ops were already safe. That is a
    // property worth a test rather than a comment: it is one careless spread away
    // from becoming the same defect.
    const result = applyBatch(
      doc(),
      [{ op: 'add', id: 'c', type: 'observe', label: 'C', bogus: 1 }],
      deps(),
    );
    expect('ok' in result && result.ok).toBe(false);
    expect((result as { message: string }).message).toContain('"bogus"');
  });
});
