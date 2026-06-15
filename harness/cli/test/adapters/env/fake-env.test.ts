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

  it('given_seeded_home_when_home_called_then_returns_it_and_records_the_call', () => {
    /*
    Test Doc:
    - Why: services placing user-global state (the update-check cache) need the
      home dir via the port, never os.homedir() (P2).
    - Contract: FakeEnv.home returns the seeded home (or undefined) and counts calls.
    - Usage Notes: pass home as the 2nd constructor arg; assert on `homeCalls`.
    - Quality Contribution: keeps home-dependent path logic deterministic in tests.
    - Worked Example: new FakeEnv({}, '/home/u').home() === '/home/u'.
    */
    const withHome = new FakeEnv({}, '/home/u');
    expect(withHome.home()).toBe('/home/u');
    expect(withHome.homeCalls).toBe(1);
    expect(new FakeEnv().home()).toBeUndefined();
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
