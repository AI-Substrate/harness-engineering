import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Resolve from THIS file's location, not cwd — the suite must read true from any
// invocation directory. This test lives at harness/cli/test/architecture/.
const CLI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SEMANTICS = join(CLI_ROOT, 'src', 'services', 'dd', 'plan', 'semantics.ts');

/**
 * The SHA-256 of `semantics.ts` as the readiness gate found it (plan 072, AC-09).
 *
 * Changing this constant is how you change that file — deliberately, in a diff a
 * reviewer sees, with the reason in the commit. That is the entire mechanism: the
 * pin does not forbid the edit, it forbids the SILENT edit.
 */
const FROZEN_DIGEST = '3856153824f7fd3448aaf285197054a2f4a2524ed80c0fffe6dc9a3f8526f150';

/**
 * AC-09 — `semantics.ts` is byte-unchanged by the readiness gate.
 *
 * The backpressure survey recorded finding 03's mitigation as "checkable by
 * diff", and nothing actually checked it. A mitigation nobody runs is a promise,
 * and the specific promise here matters: `CLAIMING_RELS` excludes `pressure` on
 * stated grounds — a backpressure row has no state to contradict and gates
 * nothing, so treating a missing instrument link as a claim failure would
 * re-invent the coverage predicate the design explicitly threw away.
 *
 * The readiness gate is a CONSUMER of that decision. It composes
 * `readPlanSemantics` and gates on the survey CHORE, never on per-criterion
 * pressure links. The failure this guard exists to catch is the quiet one: a
 * future change that "just adds one more finding class" to make readiness easier
 * to compute, and reverses a written architectural decision as a side effect
 * while every test still passes.
 *
 * A digest is used rather than a behavioural assertion on purpose. Behaviour
 * tests can only catch the semantics somebody thought to test; the decision being
 * protected is about what the file is ALLOWED to become, and only the bytes carry
 * that.
 */
describe('architecture — dd/plan semantics is frozen (plan 072, AC-09)', () => {
  it('has not changed since the readiness gate composed it', () => {
    const digest = createHash('sha256').update(readFileSync(SEMANTICS)).digest('hex');

    expect(digest).toBe(FROZEN_DIGEST);
  });

  it('still carries the written rationale for excluding `pressure` from the claiming relations', () => {
    // The digest above would also fire on a whitespace change, which tells a
    // reader nothing about WHY the file is pinned. This second assertion names
    // the decision, so a failure points at the argument rather than at a hash.
    const source = readFileSync(SEMANTICS, 'utf8');

    expect(source).toContain(
      "const CLAIMING_RELS = new Set(['proven_by', 'satisfies', 'derives'])",
    );
    expect(source).toContain('`pressure` is deliberately absent');
    expect(source).toContain(
      're-invent the\n * coverage predicate the design explicitly threw away',
    );
  });
});
