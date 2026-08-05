import { describe, expect, it } from 'vitest';
import { FakeExec } from '../../../harness/cli/src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../../harness/cli/src/adapters/fs/fake-fs.js';
import { ErrorCodes } from '../../../harness/cli/src/output/error-codes.js';
import {
  type ResolveContext,
  resolveAssertionDetailed,
  type SessionEvidence,
} from './resolvers.js';
import type { Assertion } from './scenario.js';

/*
THE DISCARD PROOF — additive coverage over already-shipped flow-eval behaviour.

FX003 · R2 pinned the refusal lane's error-code vocabulary to a DECLARED closed set,
`/^E\d{3}$/`, and entries failing it are EXCLUDED (not rejected — one bad key must not
throw away good skill/verb evidence). That narrowing is correct and stays.

But it makes the shape LOAD-BEARING for every other lane in the CLI: a code that does
not match is silently discarded here, so an error code minted elsewhere can vanish into
this lane without a word. That is this packet's own thesis — an unavailability
announcing itself as something else — one layer over, inside the machinery we are
shipping to cure it.

Matching the pattern is not the same as being TESTED against it. The registry guard in
`harness/cli/test/output/error-codes.test.ts` has only ever run against input that
satisfies it, which makes the property DEMONSTRATED, not PROVEN. This file supplies the
other half: it drives the LANE, with a known-bad code, and shows the discard is real.

NOTHING HERE MODIFIES flow-eval. It is a new test file beside the eight already in this
folder; the loader resolves ONE entry per extension folder (`extension.ts`) and never
loads `*.test.ts`, so this adds coverage without adding a defect to the live tree.
*/

/** A minimal, VALID evidence object whose only variable is the refusals map. */
function evidence(refusals: Record<string, number>): SessionEvidence {
  return {
    pij_session_id: 'pij-packet',
    harness_session_id: 'hs-packet',
    harness: 'claude-code',
    segments: 1,
    skills: {},
    skill_order: [],
    files: { written: [], edited: [] },
    flow_seams: [],
    harness_verbs: {},
    checks: [],
    compactions: 0,
    tools: {},
    refusals,
    gaps: [],
    duration_s: 1,
  } as SessionEvidence;
}

function rc(ev: SessionEvidence): ResolveContext {
  const exec = new FakeExec();
  return {
    evidence: ev,
    worktree: '/wt',
    fs: new FakeFs(),
    exec: (c, a, o) => exec.run(c, a, o),
  } as ResolveContext;
}

/** Drive the REAL lane: a `gate-refused` query against a refusals map. */
async function gateRefused(
  refusals: Record<string, number>,
  params: Record<string, unknown> = {},
): Promise<string> {
  const assertion = {
    id: 'gate-refused',
    type: 'gate-refused',
    source: 'telemetry',
    params,
  } as Assertion;
  return (await resolveAssertionDetailed(assertion, rc(evidence(refusals)))).verdict;
}

describe('flow-eval refusal lane — the closed code set is enforced, not assumed', () => {
  it('CONTROL: a code OUTSIDE /^E\\d{3}$/ is discarded — it cannot license a fail', async () => {
    /*
    Test Doc:
    - Why: the known-bad half of ruling #3.1. If a malformed key counted as evidence,
      a query for an ABSENT code would resolve `fail` — the false accusation FX003 · D1
      exists to prevent, arriving through the vocabulary instead of the count.
    - Contract: the entry is excluded, the lane has demonstrated nothing, and an absent
      code resolves `unknown` — never `fail`.
    */
    for (const bad of ['E1234', 'E44', 'e440', 'E44O', 'ERR440', '440', 'E440 ']) {
      expect(
        await gateRefused({ [bad]: 5 }, { code: 'E443' }),
        `bad code ${JSON.stringify(bad)} must not license a fail`,
      ).toBe('unknown');
    }
  });

  it('CONTROL: the false GREEN face — a bare query does not PASS on a discarded code', async () => {
    /*
    Test Doc:
    - Why: the polarity most likely to be forgotten, and the more dangerous one. A bare
      `gate-refused` sums the map; if a malformed key survived, `observed >= 1` would
      certify that a gate stopped the subject when nothing did. A false fail gets
      argued with; a false pass gets believed.
    */
    for (const bad of ['malformed', 'E1234', 'e440']) {
      expect(await gateRefused({ [bad]: 5 }, { min: 1 })).not.toBe('pass');
    }
  });

  it('GUARD: a VALID code with a positive count still licenses both verdicts', async () => {
    /*
    The discard must not have become a blanket refusal — a fix that can no longer say
    `fail` is less useful, not more honest.
    */
    expect(await gateRefused({ E440: 2 }, { code: 'E443' })).toBe('fail');
    expect(await gateRefused({ E440: 2 }, { min: 1 })).toBe('pass');
    expect(await gateRefused({ E440: 2 }, { code: 'E440' })).toBe('pass');
  });

  it('GUARD: exclude, do NOT reject — good entries survive alongside a bad one', async () => {
    /*
    Refusing the whole payload over one bad key would throw away good evidence. The
    valid entry must still license a verdict even when a malformed sibling is present.
    */
    expect(await gateRefused({ malformed: 9, E440: 2 }, { code: 'E443' })).toBe('fail');
  });

  it("CONTROL: EVERY code in the CLI registry survives this lane — including the packet's own E149", async () => {
    /*
    Test Doc:
    - Why: the reason the shape matters beyond flow-eval. FX004 mints E149; if a new
      code failed the pattern it would be silently discarded HERE, and the fix's own
      diagnostic would vanish into a sibling lane. This drives the real lane with every
      registered code, so the guarantee is proven for every FUTURE code too, not just
      the ones this packet happened to add.
    - Contract: for each registered code, a refusals map keyed by it licenses a `pass`
      on a bare query — i.e. the lane COUNTED it rather than discarding it.
    */
    const codes = Object.values(ErrorCodes);
    expect(codes).toContain('E149');
    for (const code of codes) {
      expect(
        await gateRefused({ [code]: 1 }, { code }),
        `${code} must be counted, not discarded`,
      ).toBe('pass');
    }
  });
});
