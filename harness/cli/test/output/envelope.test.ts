import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import {
  type Envelope,
  formatDegraded,
  formatError,
  formatOk,
  formatUnconfigured,
} from '../../src/output/envelope.js';
import { exitCodeFor } from '../../src/output/exit.js';

const TS = '2026-06-08T07:20:00.000Z';
const clockAt = () => new FakeClock(TS);

describe('formatOk', () => {
  it('given_data_when_formatOk_then_ok_envelope_with_clock_timestamp', () => {
    /*
    Test Doc:
    - Why: `ok` is the success contract every command emits; agents parse it (workshop 001).
    - Contract: formatOk(command, data, clock) => {command, status:'ok', timestamp, data}; no error/next_action.
    - Usage Notes: timestamp comes from the injected clock, never new Date().
    - Quality Contribution: locks the ok envelope shape + field presence.
    - Worked Example: formatOk('help', {hello:'world'}, clock@TS).
    */
    const env = formatOk('help', { hello: 'world' }, clockAt());
    expect(env).toEqual({
      command: 'help',
      status: 'ok',
      timestamp: TS,
      data: { hello: 'world' },
    });
  });

  it('formatDegraded requires next_action and carries evidence (doctor worked example)', () => {
    /*
    Test Doc:
    - Why: workshop 001 requires next_action for EVERY non-ok status, incl. degraded;
      a degraded envelope without next_action violates the agent contract (companion F001b).
    - Contract: formatDegraded(command, data, next_action, clock, {evidence?}) => status 'degraded'
      with next_action ALWAYS present; exit 0.
    - Usage Notes: there is no formatOk({status:'degraded'}) path — degraded only via this ctor.
    - Quality Contribution: makes "next_action required when status!=ok" unbreakable by construction.
    - Worked Example: doctor degraded with evidence [{label,none:true}] + a next_action.
    */
    const env = formatDegraded(
      'doctor',
      { layers: [{ id: 0, name: 'toolchain', ok: true }] },
      'Run `harness help` to see the slot map.',
      clockAt(),
      { evidence: [{ label: 'doctor report', none: true }] },
    );
    expect(env.status).toBe('degraded');
    expect(env.evidence).toEqual([{ label: 'doctor report', none: true }]);
    expect(env.next_action).toBe('Run `harness help` to see the slot map.');
    expect(exitCodeFor(env)).toBe(0);
  });
});

describe('formatUnconfigured', () => {
  it('given_unmapped_slot_when_formatUnconfigured_then_required_next_action_no_data_or_error', () => {
    /*
    Test Doc:
    - Why: unconfigured slots must fail honestly — never fake success (Finding 05).
    - Contract: formatUnconfigured(command, next_action, clock) => status 'unconfigured', next_action REQUIRED, no data/error.
    - Usage Notes: pair with exit code 2 (see exit.test.ts).
    - Quality Contribution: guards the honest "not built" envelope.
    - Worked Example: formatUnconfigured('run', "No command is mapped to slot 'smoke' yet.", clock@TS).
    */
    const env = formatUnconfigured('run', "No command is mapped to slot 'smoke' yet.", clockAt());
    expect(env).toEqual({
      command: 'run',
      status: 'unconfigured',
      timestamp: TS,
      next_action: "No command is mapped to slot 'smoke' yet.",
    });
    expect(env.data).toBeUndefined();
    expect(env.error).toBeUndefined();
  });

  it('given_dry_run_when_formatUnconfigured_with_data_then_carries_data_and_exits_2', () => {
    /*
    Test Doc:
    - Why: workshop 001 worked example #4 — `run --dry-run` on an unconfigured slot returns an
      unconfigured envelope that ALSO carries data {dry_run,slot,mapped_command} (companion F001a).
    - Contract: formatUnconfigured(cmd, next_action, clock, {data}) keeps status 'unconfigured',
      required next_action, exit 2, and surfaces the data payload.
    - Usage Notes: dry-run never executes; safe at session start.
    - Quality Contribution: proves the kernel can represent unconfigured-with-data, not just bare unconfigured.
    - Worked Example: run --dry-run smoke → data {dry_run:true, slot:'smoke', mapped_command:null}, exit 2.
    */
    const env = formatUnconfigured(
      'run',
      "Dry-run: slot 'smoke' has no mapped command. Nothing would execute.",
      clockAt(),
      { data: { dry_run: true, slot: 'smoke', mapped_command: null } },
    );
    expect(env).toEqual({
      command: 'run',
      status: 'unconfigured',
      timestamp: TS,
      data: { dry_run: true, slot: 'smoke', mapped_command: null },
      next_action: "Dry-run: slot 'smoke' has no mapped command. Nothing would execute.",
    });
    expect(exitCodeFor(env)).toBe(2);
  });
});

describe('formatError', () => {
  it('produces error code+message with next_action defaulting to message', () => {
    const env = formatError('run', 'E108', 'Missing required argument: <slot>.', clockAt());
    expect(env.status).toBe('error');
    expect(env.error).toEqual({ code: 'E108', message: 'Missing required argument: <slot>.' });
    expect(env.next_action).toBe('Missing required argument: <slot>.');
    expect(env.data).toBeUndefined();
  });

  it('allows explicit next_action and details', () => {
    const env = formatError('run', 'E108', 'bad', clockAt(), {
      details: { arg: 'slot' },
      next_action: 'Provide a slot name.',
    });
    expect(env.error?.details).toEqual({ arg: 'slot' });
    expect(env.next_action).toBe('Provide a slot name.');
  });
});

describe('field-presence rule', () => {
  it('next_action is present whenever status !== ok', () => {
    const envs: Envelope[] = [
      formatUnconfigured('run', 'x', clockAt()),
      formatError('run', 'E100', 'y', clockAt()),
      formatDegraded('run', {}, 'z', clockAt()),
    ];
    for (const env of envs) {
      expect(env.status === 'ok' || typeof env.next_action === 'string').toBe(true);
    }
  });
});
