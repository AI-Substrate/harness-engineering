import { describe, expect, it } from 'vitest';

// TEMPORARY — lives only on the throwaway `ci-probe/red` branch, never on main.
// It exists to make one CI run genuinely RED, so the `ci-verdict` gate can be
// observed REFUSING rather than only observed passing. A gate that has only ever
// been seen to succeed is not a verified gate.
describe('ci refusal probe', () => {
  it('fails on purpose so the gate has something to refuse', () => {
    expect(1).toBe(2);
  });
});
