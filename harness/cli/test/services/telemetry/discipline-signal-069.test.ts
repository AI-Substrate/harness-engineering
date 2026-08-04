import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type { Envelope } from '../../../src/output/envelope.js';
import { captureChecksOutcome } from '../../../src/services/telemetry/checks-capture.js';
import {
  CONTROL_SIGNATURES,
  controlSignatures,
  shellSignature,
} from '../../../src/services/telemetry/command-signature.js';
import type { Event, ToolsEvent } from '../../../src/services/telemetry/events.js';
import { otlpLogsToEvents, segmentToOtlpLogs } from '../../../src/services/telemetry/otlp/logs.js';
import { buildChecksEvent } from '../../../src/services/telemetry/outcome-events.js';
import { collapseToolBursts, type ToolCall } from '../../../src/services/telemetry/rollup.js';
import { serializeEvent } from '../../../src/services/telemetry/segment.js';

/**
 * Plan 069 — discipline signal capture. Pins the two producer fixes that made the
 * discipline panel able to report a non-zero, and the honesty rails on both.
 *
 * The measured gap this locks shut (item 0, from the real corpus + 859 real
 * chained git command lines): the chain-HEAD `signature` rule captured 2.9% of
 * `git push`/`git commit` invocations — the other 97.1% were recorded as `cd`,
 * `git add`, a bare `git`, or `set` — and a `checks` EVENT was only ever emitted
 * by the claude adapter, only from a JSON envelope in a captured tool result.
 */

const REPO = '/repo';

function envelope(over: Partial<Envelope> = {}): Envelope {
  return {
    command: 'checks',
    status: 'ok',
    timestamp: '2026-08-04T05:00:00.000Z',
    ...over,
  };
}

function checksDeps(env: Record<string, string> = { COPILOT_AGENT_SESSION_ID: 'sessA' }) {
  const fs = new FakeFs();
  return { deps: { fs, env: new FakeEnv(env), proc: new FakeProcess({}, REPO) }, fs };
}

describe('plan 069 · controlSignatures — the git verbs the chain HEAD drops', () => {
  it('captures a push that a `cd …` prefix hides from `shellSignature`', () => {
    const raw = 'cd /Users/x/repo && git push -u origin feat/069 2>&1 | tail -15';
    // The regression itself: the recorded signature is the *prefix*, not the act.
    expect(shellSignature(raw)).toBe('cd');
    expect(controlSignatures(raw)).toEqual({ 'git push': 1 });
  });

  it('captures both verbs of the canonical ship line (add → commit → push)', () => {
    const raw = 'cd /repo && git add -A && git commit -m "secret message" && git push';
    expect(shellSignature(raw)).toBe('cd');
    expect(controlSignatures(raw)).toEqual({ 'git commit': 1, 'git push': 1 });
  });

  it('counts repeats, and survives newline/`set -e` script form', () => {
    const raw = 'set -e\ngit commit -m one\ngit commit -m two\ngit push';
    expect(controlSignatures(raw)).toEqual({ 'git commit': 2, 'git push': 1 });
  });

  it('is a CLOSED allowlist: no other git verb, and no free text, can ride it', () => {
    expect(controlSignatures('git status && git log && git add -A')).toBeUndefined();
    // A quoted commit message can never leak — only the 2 allowlisted signatures.
    const keys = Object.keys(controlSignatures('git commit -m "ghp_notasecret token"') ?? {});
    expect(keys).toEqual(['git commit']);
    expect([...CONTROL_SIGNATURES]).toEqual(['git push', 'git commit']);
  });

  it('omits (never `{}`) when the line ran no control command — pre-069 byte-identical', () => {
    expect(controlSignatures('rg TODO src/')).toBeUndefined();
    expect(controlSignatures('')).toBeUndefined();
  });
});

describe('plan 069 · burst collapsing keys on the control shape', () => {
  const call = (t: string, control?: Record<string, number>): ToolCall => {
    const c: ToolCall = { name: 'Bash', t, signature: 'cd' };
    if (control !== undefined) c.control = control;
    return c;
  };

  it('does NOT merge a `cd && git push` call into an adjacent `cd && git add` burst', () => {
    const bursts = collapseToolBursts([
      call('2026-08-04T05:00:00.000Z'),
      call('2026-08-04T05:00:01.000Z', { 'git push': 1 }),
    ]);
    expect(bursts).toHaveLength(2);
    // The push keeps its OWN instant — the strict `checks.t < push.t` join depends on it.
    expect(bursts[1]?.t).toBe('2026-08-04T05:00:01.000Z');
    expect(bursts[1]?.control).toEqual({ 'git push': 1 });
  });

  it('sums the counts of identically-shaped adjacent calls', () => {
    const bursts = collapseToolBursts([
      call('2026-08-04T05:00:00.000Z', { 'git push': 1 }),
      call('2026-08-04T05:00:01.000Z', { 'git push': 1 }),
    ]);
    expect(bursts).toHaveLength(1);
    expect(bursts[0]?.control).toEqual({ 'git push': 2 });
    expect(bursts[0]?.count).toBe(2);
  });

  it('leaves control-free bursts exactly as before (no `control` key at all)', () => {
    const bursts = collapseToolBursts([
      call('2026-08-04T05:00:00.000Z'),
      call('2026-08-04T05:00:01.000Z'),
    ]);
    expect(bursts).toHaveLength(1);
    expect(bursts[0]).not.toHaveProperty('control');
  });
});

describe('plan 069 · the control map is allowlisted on the way out', () => {
  it('serializeEvent drops unknown keys and non-positive/fractional counts', () => {
    const planted = {
      t: '2026-08-04T05:00:00.000Z',
      kind: 'tools',
      name: 'Bash',
      count: 1,
      span_s: 0,
      control: { 'git push': 1, 'rm -rf /': 3, 'git commit': 0, ghp_secrettoken: 9 },
    } as unknown as Event;
    const out = serializeEvent(planted) as ToolsEvent;
    expect(out.control).toEqual({ 'git push': 1 });
  });

  it('serializeEvent omits `control` entirely when nothing survives', () => {
    const planted = {
      t: '2026-08-04T05:00:00.000Z',
      kind: 'tools',
      name: 'Bash',
      count: 1,
      span_s: 0,
      control: { 'sudo rm': 2 },
    } as unknown as Event;
    expect(serializeEvent(planted)).not.toHaveProperty('control');
  });

  it('round-trips over the OTLP wire (encode → decode) unchanged', () => {
    const event: Event = {
      t: '2026-08-04T05:00:00.000Z',
      kind: 'tools',
      name: 'Bash',
      count: 2,
      span_s: 3,
      signature: 'cd',
      control: { 'git commit': 2, 'git push': 1 },
    };
    const segment = {
      schema_version: '2.6',
      command: 'checks',
      harness: 'copilot-cli',
      harness_session_id: 'sessA',
      harness_version: '0.13.0',
      timecode: '2026-08-04T05:00:00.000Z',
      window: { since: 'session-start', from: 0, to: 1 },
      branch: null,
      tokens: null,
      models: {},
      skills: {},
      tools: {},
      user_prompts: [],
      subagents: [],
      files: { written: [], edited: [] },
      plans_touched: [],
      events: { compactions: [], api_errors: 0, local_commands: 0 },
      thinking: null,
      event_stream: [event],
      rollup: null,
    } as never;
    const decoded = otlpLogsToEvents(segmentToOtlpLogs(segment));
    const tools = decoded.find((e) => e.kind === 'tools') as ToolsEvent | undefined;
    expect(tools?.control).toEqual({ 'git commit': 2, 'git push': 1 });
  });
});

describe('plan 069 · checks outcome capture — the harness observing its own verdict', () => {
  it('writes a `checks` event carrying the real verdict + gate names', () => {
    const { deps, fs } = checksDeps();
    const result = captureChecksOutcome(
      deps,
      envelope({
        status: 'degraded',
        data: {
          gates: [
            { name: 'tests', status: 'ok', note: 'free text that must never travel' },
            { name: 'biome', status: 'warn' },
          ],
        },
      }),
    );
    expect(result).not.toBeNull();
    const written = JSON.parse(fs.readText(result?.path ?? '') ?? '{}');
    const event = written.event_stream?.[0];
    expect(event.kind).toBe('checks');
    expect(event.status).toBe('degraded');
    expect(event.gates).toEqual({ tests: 'ok', biome: 'warn' });
    // Codes/verdicts ONLY — a gate's prose never reaches the wire.
    expect(JSON.stringify(written)).not.toContain('free text');
  });

  it('stamps the envelope\u2019s own instant, not a re-read wall clock', () => {
    const { deps, fs } = checksDeps();
    const result = captureChecksOutcome(deps, envelope({ timestamp: '2026-01-02T03:04:05.000Z' }));
    const written = JSON.parse(fs.readText(result?.path ?? '') ?? '{}');
    expect(written.event_stream?.[0]?.t).toBe('2026-01-02T03:04:05.000Z');
  });

  it('records a zero-width window, so it never moves the transcript cursor', () => {
    const { deps, fs } = checksDeps();
    const result = captureChecksOutcome(deps, envelope());
    const written = JSON.parse(fs.readText(result?.path ?? '') ?? '{}');
    expect(written.window).toEqual({ since: 'session-start', from: 0, to: 0 });
  });

  it('works for EVERY agent harness — the CLI is the observer, not the transcript', () => {
    for (const env of [
      { COPILOT_AGENT_SESSION_ID: 'sessA' },
      { CLAUDE_CODE_SESSION_ID: 'sessB' },
      { CURSOR_CONVERSATION_ID: 'sessC' },
    ]) {
      const { deps } = checksDeps(env);
      expect(captureChecksOutcome(deps, envelope())).not.toBeNull();
    }
  });

  // ── AC-4: nothing is ever fabricated ──────────────────────────────────────
  it('writes NOTHING when there is no harness session to attribute it to', () => {
    const { deps, fs } = checksDeps({});
    expect(captureChecksOutcome(deps, envelope())).toBeNull();
    expect(fs.writes).toEqual([]);
  });

  it('writes NOTHING for an unrecognized verdict — never a fabricated `ok`', () => {
    const { deps, fs } = checksDeps();
    expect(captureChecksOutcome(deps, envelope({ status: 'unconfigured' }))).toBeNull();
    expect(fs.writes).toEqual([]);
  });

  it('omits `gates` when the envelope carried none (honest absence)', () => {
    const { deps, fs } = checksDeps();
    const result = captureChecksOutcome(deps, envelope({ data: { summary: 'no gates here' } }));
    const written = JSON.parse(fs.readText(result?.path ?? '') ?? '{}');
    expect(written.event_stream?.[0]).not.toHaveProperty('gates');
  });

  it('reads the gates of a FAILING run, where they live in `error.details`', () => {
    // The real shape of a failed gate — the case the discipline panel most needs.
    const { deps, fs } = checksDeps();
    const result = captureChecksOutcome(
      deps,
      envelope({
        status: 'error',
        error: {
          code: 'E_CHECKS_FAILED',
          message: 'Quality gate failed: biome did not pass.',
          details: {
            gates: [
              { name: 'tests', status: 'ok' },
              { name: 'biome', status: 'error' },
            ],
          },
        },
      }),
    );
    const event = JSON.parse(fs.readText(result?.path ?? '') ?? '{}').event_stream?.[0];
    expect(event.status).toBe('error');
    expect(event.gates).toEqual({ tests: 'ok', biome: 'error' });
  });
});

describe('plan 069 · one grammar across the seam', () => {
  it('buildChecksEvent is shared by both producers and normalizes fatal → error', () => {
    expect(buildChecksEvent('fatal', undefined, 'T')).toEqual({
      t: 'T',
      kind: 'checks',
      status: 'error',
    });
    expect(buildChecksEvent('nonsense', undefined, 'T')).toBeNull();
  });
});
