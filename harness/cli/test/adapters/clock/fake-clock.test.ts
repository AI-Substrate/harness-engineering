import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { SystemClock } from '../../../src/adapters/clock/system-clock.js';

describe('FakeClock', () => {
  it('given_fixed_start_when_nowIso_called_twice_then_returns_same_instant', () => {
    /*
    Test Doc:
    - Why: Envelope timestamps must be deterministic in unit tests (Finding 04); a
      non-deterministic clock would make every kernel test flaky.
    - Contract: FakeClock.nowIso() returns the same ISO string until advance()/set().
    - Usage Notes: construct with an ISO string/number/Date; default is a fixed 2026 instant.
    - Quality Contribution: guards the injected-clock determinism the whole kernel relies on.
    - Worked Example: new FakeClock('2026-06-08T07:20:00.000Z').nowIso() is stable across calls.
    */
    const clock = new FakeClock('2026-06-08T07:20:00.000Z');
    expect(clock.nowIso()).toBe('2026-06-08T07:20:00.000Z');
    expect(clock.nowIso()).toBe('2026-06-08T07:20:00.000Z');
  });

  it('records call history (fakes over mocks)', () => {
    const clock = new FakeClock('2026-06-08T07:20:00.000Z');
    clock.nowIso();
    clock.nowIso();
    expect(clock.calls).toHaveLength(2);
  });

  it('advance() moves the instant forward by ms', () => {
    const clock = new FakeClock('2026-06-08T07:20:00.000Z');
    clock.advance(1000);
    expect(clock.nowIso()).toBe('2026-06-08T07:20:01.000Z');
  });

  it('set() jumps to an absolute instant', () => {
    const clock = new FakeClock('2026-06-08T07:20:00.000Z');
    clock.set('2027-01-01T00:00:00.000Z');
    expect(clock.nowIso()).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('SystemClock', () => {
  it('returns a valid ISO-8601 string', () => {
    const iso = new SystemClock().nowIso();
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isNaN(Date.parse(iso))).toBe(false);
  });
});
