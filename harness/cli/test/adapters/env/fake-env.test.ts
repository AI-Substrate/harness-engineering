import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { NodeEnv } from '../../../src/adapters/env/node-env.js';

describe('FakeEnv', () => {
  it('given_seeded_vars_when_get_called_then_returns_value_and_records_gets', () => {
    /*
    Test Doc:
    - Why: services should read env via a port so tests don't mutate process.env.
    - Contract: FakeEnv.get returns the seeded value (or undefined) and records each name.
    - Usage Notes: construct with a {name: value} map; assert on `gets`.
    - Quality Contribution: keeps env-dependent service logic deterministic in tests.
    - Worked Example: new FakeEnv({HARNESS_JSON:'1'}).get('HARNESS_JSON') === '1'.
    */
    const env = new FakeEnv({ HARNESS_JSON: '1' });
    expect(env.get('HARNESS_JSON')).toBe('1');
    expect(env.get('MISSING')).toBeUndefined();
    expect(env.gets).toEqual(['HARNESS_JSON', 'MISSING']);
  });
});

describe('NodeEnv', () => {
  it('reads a real env var set on process.env', () => {
    process.env.HARNESS_TEST_VAR = 'present';
    try {
      expect(new NodeEnv().get('HARNESS_TEST_VAR')).toBe('present');
      expect(new NodeEnv().get('HARNESS_DEFINITELY_UNSET_VAR')).toBeUndefined();
    } finally {
      delete process.env.HARNESS_TEST_VAR;
    }
  });
});
