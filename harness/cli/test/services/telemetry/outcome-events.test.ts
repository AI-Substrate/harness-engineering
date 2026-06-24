import { describe, expect, it } from 'vitest';
import type { Event } from '../../../src/services/telemetry/events.js';
import { outcomeEvents } from '../../../src/services/telemetry/outcome-events.js';

/**
 * Phase 5 · T5.7 — outcome events (AC-19). A harness command's JSON result
 * envelope → `command_exit` (+ `checks` with per-gate verdicts). Codes/verdicts
 * ONLY: gate `note` (free text) and every non-allowlisted field are dropped.
 */

const T = '2026-06-24T09:00:00Z';

function checksEnvelope(status: string): string {
  return JSON.stringify({
    command: 'checks',
    status,
    timestamp: T,
    data: {
      durationMs: 1234,
      summary: 'all gates ran — DO NOT LEAK THIS',
      gates: [
        { name: 'tests', status: 'ok', exit: 0, note: '' },
        { name: 'arch-check', status: 'degraded', exit: 0, note: 'review 1 warn — SECRET NOTE' },
      ],
    },
  });
}

describe('outcomeEvents — harness checks envelope (T5.7)', () => {
  const events = outcomeEvents(checksEnvelope('degraded'), T);

  it('emits a checks event with the overall verdict + per-gate verdicts (names+statuses only)', () => {
    const checks = events.find((e) => e.kind === 'checks') as Event & {
      status: string;
      gates?: Record<string, string>;
    };
    expect(checks).toMatchObject({ kind: 'checks', status: 'degraded' });
    expect(checks.gates).toEqual({ tests: 'ok', 'arch-check': 'degraded' });
  });

  it('emits a command_exit (exit 0 for ok/degraded) carrying the raw status', () => {
    const ce = events.find((e) => e.kind === 'command_exit') as Event & {
      verb: string;
      exit: number;
      status?: string;
    };
    expect(ce).toMatchObject({ kind: 'command_exit', verb: 'checks', exit: 0, status: 'degraded' });
  });

  it('AC-15 — the gate notes / summary free text never reach the events', () => {
    const json = JSON.stringify(events);
    expect(json).not.toContain('SECRET NOTE');
    expect(json).not.toContain('DO NOT LEAK');
    expect(json).not.toContain('durationMs');
  });
});

describe('outcomeEvents — exit derivation', () => {
  it('error verdict ⇒ exit 1', () => {
    const ce = outcomeEvents(checksEnvelope('error'), T)[0] as Event & { exit: number };
    expect(ce.exit).toBe(1);
    const checks = outcomeEvents(checksEnvelope('error'), T).find((e) => e.kind === 'checks') as
      | (Event & { status: string })
      | undefined;
    expect(checks?.status).toBe('error');
  });

  it('observed isError flag wins even when the verdict parses ok', () => {
    const ce = outcomeEvents(JSON.stringify({ command: 'boot', status: 'ok' }), T, true)[0] as Event & {
      verb: string;
      exit: number;
    };
    expect(ce).toMatchObject({ kind: 'command_exit', verb: 'boot', exit: 1 });
  });

  it('a non-checks verb emits only command_exit (no checks event)', () => {
    const events = outcomeEvents(JSON.stringify({ command: 'boot', status: 'ok' }), T);
    expect(events.map((e) => e.kind)).toEqual(['command_exit']);
  });
});

describe('outcomeEvents — honest non-envelope handling', () => {
  it('returns [] for human-rail / non-JSON output (never fabricated)', () => {
    expect(outcomeEvents('✓ all checks passed', T)).toEqual([]);
    expect(outcomeEvents('', T)).toEqual([]);
    expect(outcomeEvents('[1,2,3]', T)).toEqual([]); // an array is not an envelope
  });

  it('returns [] for an envelope with no command', () => {
    expect(outcomeEvents(JSON.stringify({ status: 'ok' }), T)).toEqual([]);
  });

  it('checks with an unknown status emits command_exit but no checks event', () => {
    const events = outcomeEvents(JSON.stringify({ command: 'checks', status: 'weird' }), T);
    expect(events.map((e) => e.kind)).toEqual(['command_exit']);
  });
});
