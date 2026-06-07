import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { exitCodeFor } from '../../../src/output/exit.js';
import { validateCommandMap } from '../../../src/services/config/load-config.js';
import { type CommandSlot, loadSlotRegistry } from '../../../src/services/slots/slot-registry.js';

const clock = () => new FakeClock('2026-06-08T07:20:00.000Z');

describe('validateCommandMap', () => {
  it('given_the_builtin_registry_when_validated_then_ok', () => {
    /*
    Test Doc:
    - Why: a malformed command-map must be caught before use, as an actionable error (AC-12).
    - Contract: validateCommandMap returns formatOk for a well-formed registry.
    - Usage Notes: feed the live slot registry + a clock; returns an Envelope (never throws).
    - Quality Contribution: guards the slot contract the whole CLI dispatches on.
    - Worked Example: validateCommandMap(loadSlotRegistry(fs), clock).status === 'ok'.
    */
    const env = validateCommandMap(loadSlotRegistry(new FakeFs()), clock());
    expect(env.status).toBe('ok');
    expect(env.data).toEqual({ valid: true, slots: 8 });
    expect(exitCodeFor(env)).toBe(0);
  });

  it('returns an actionable E120 error envelope (not a throw) for a malformed map', () => {
    const bad = [
      { name: '', status: 'unconfigured', description: 'x', next_action: 'y' },
      { name: 'run', status: 'bogus', description: '', next_action: '' },
    ] as unknown as CommandSlot[];
    const env = validateCommandMap(bad, clock());
    expect(env.status).toBe('error');
    expect(env.error?.code).toBe('E120');
    expect(Array.isArray(env.error?.details)).toBe(true);
    expect(env.next_action).toBeDefined();
    expect(exitCodeFor(env)).toBe(1);
  });

  it('flags duplicate slot names', () => {
    const dupes = [
      { name: 'run', status: 'unconfigured', description: 'a', next_action: 'a' },
      { name: 'run', status: 'unconfigured', description: 'b', next_action: 'b' },
    ] as unknown as CommandSlot[];
    const env = validateCommandMap(dupes, clock());
    expect(env.status).toBe('error');
    const details = env.error?.details as Array<{ problem: string }>;
    expect(details.some((d) => d.problem === 'duplicate name')).toBe(true);
  });
});
