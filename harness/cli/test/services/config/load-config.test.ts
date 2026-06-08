import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { exitCodeFor } from '../../../src/output/exit.js';
import { validateVerbRegistry } from '../../../src/services/config/load-config.js';
import type { HarnessVerb } from '../../../src/services/extensions/contract.js';

const clock = () => new FakeClock('2026-06-08T07:20:00.000Z');

const mkVerb = (name: string): HarnessVerb => ({
  name,
  summary: `${name} verb`,
  run: () => ({ status: 'ok' }),
});

describe('validateVerbRegistry', () => {
  it('returns ok for a well-formed, open-keyed verb list', () => {
    /*
    Test Doc:
    - Why: the assembled verb registry is validated before parse (the open-keyed successor to the
      slot command-map pre-flight); malformed entries must surface as an actionable E120 (AC-7, D3).
    - Contract: validateVerbRegistry(verbs, clock) → ok for valid verbs; names are an open string key.
    - Usage Notes: feed the registry's verbs[] + a clock; returns an Envelope (never throws).
    - Quality Contribution: guards the verb contract the CLI dispatches on.
    - Worked Example: validateVerbRegistry([mkVerb('anything')], clock).status === 'ok'.
    */
    const env = validateVerbRegistry([mkVerb('build'), mkVerb('any_custom-99')], clock());
    expect(env.status).toBe('ok');
    expect(env.data).toEqual({ valid: true, verbs: 2 });
    expect(exitCodeFor(env)).toBe(0);
  });

  it('returns an actionable E120 for verbs missing required fields', () => {
    const bad = [
      { name: '', summary: 's', run: () => ({ status: 'ok' }) },
      { name: 'x', summary: '', run: undefined },
    ] as unknown as HarnessVerb[];
    const env = validateVerbRegistry(bad, clock());
    expect(env.status).toBe('error');
    expect(env.error?.code).toBe('E120');
    expect(Array.isArray(env.error?.details)).toBe(true);
    expect(exitCodeFor(env)).toBe(1);
  });

  it('flags duplicate verb names', () => {
    const env = validateVerbRegistry([mkVerb('dup'), mkVerb('dup')], clock());
    expect(env.status).toBe('error');
    const details = env.error?.details as Array<{ problem: string }>;
    expect(details.some((d) => d.problem === 'duplicate name')).toBe(true);
  });
});
