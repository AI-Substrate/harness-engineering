import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import {
  claudeAdapter,
  claudeTranscriptPath,
} from '../../../src/services/telemetry/adapters/claude-adapter.js';
import {
  copilotAdapter,
  copilotEventsPath,
} from '../../../src/services/telemetry/adapters/copilot-adapter.js';
import type {
  HarnessContext,
  HarnessSource,
} from '../../../src/services/telemetry/adapters/harness-adapter.js';
import {
  shellSignature,
  skillDigitArg,
} from '../../../src/services/telemetry/command-signature.js';
import type { Event } from '../../../src/services/telemetry/events.js';
import { otlpLogsToEvents, segmentToOtlpLogs } from '../../../src/services/telemetry/otlp/logs.js';
import { serializeSegment } from '../../../src/services/telemetry/segment.js';

/**
 * FX001 — capture command/skill param signatures (two facets, one P12 floor).
 *
 * Facet A: a shell tool burst carries the (already-computed, previously discarded)
 * non-harness command SIGNATURE (`rg`, `git status`) so `bash:rg` and `bash:git`
 * are distinct bursts; a co-timed `harness …` stays a separate `harness` event
 * with NO signature (no double-count / no leak).
 * Facet B: a skill invocation captures ONLY a leading pure-digit positional
 * (`/the-flow 08 "x"` → `08`); a non-digit or quoted arg is NEVER stored (P12).
 *
 * Every equality test names the deliberate MUTATION that flips it.
 */

const REPO = '/repo';
const HOME = '/home/u';

// ── Facet-B unit: the leading-digit rule (fast, exhaustive) ─────────────────
describe('skillDigitArg — only a leading ^\\d+$ token survives (FX001-B)', () => {
  it('keeps a leading pure-digit token, drops everything else', () => {
    // MUTATION: changing the regex from ^\d+$ to \d+ (accept a non-digit-anchored
    // token) flips the `'a8'`/`'v2'` cases from undefined to a captured value.
    expect(skillDigitArg('08 "sldjdlf"')).toBe('08'); // digit first → keep, drop the quoted tail
    expect(skillDigitArg('7')).toBe('7');
    expect(skillDigitArg('specify')).toBeUndefined(); // non-digit first token
    expect(skillDigitArg('a sldf')).toBeUndefined();
    expect(skillDigitArg('"sldjdlf"')).toBeUndefined(); // quoted first token
    expect(skillDigitArg('v2 08')).toBeUndefined(); // alphanumeric ≠ pure digit
    expect(skillDigitArg('08a')).toBeUndefined(); // trailing letter ≠ pure digit
    expect(skillDigitArg('')).toBeUndefined();
    expect(skillDigitArg(undefined)).toBeUndefined();
    expect(skillDigitArg(42)).toBeUndefined(); // non-string
  });
});

// ── Facet-A unit: the shell signature reuses commandSignatures verbatim ──────
describe('shellSignature — first NON-harness signature only (FX001-A)', () => {
  it('keeps program+verb, drops a pure-harness command (no double-count)', () => {
    // MUTATION: returning `.harness[0]` instead of `.bash[0]` flips the harness
    // cases to a value (which would double-count with the HarnessEvent).
    expect(shellSignature('rg needle src/')).toBe('rg');
    expect(shellSignature('git status -s')).toBe('git status');
    expect(shellSignature('rg foo && harness checks')).toBe('rg'); // harness stripped, rg kept
    expect(shellSignature('harness doctor --json')).toBeUndefined(); // pure harness → nothing
    expect(shellSignature('node harness/cli/bin/harness.js checks')).toBe('node'); // argv dropped
  });
});

// ── Facet A + B integration over the Claude adapter ─────────────────────────
const PROMPT = 'please capture the command signatures now'; // 6 words
const CLAUDE_LINES = [
  { type: 'user', timestamp: '2026-06-24T09:00:00Z', message: { role: 'user', content: PROMPT } },
  {
    type: 'assistant',
    timestamp: '2026-06-24T09:00:30Z',
    message: {
      id: 'm1',
      model: 'claude-opus-4-8',
      usage: { input_tokens: 10, output_tokens: 20 },
      content: [
        // Two ADJACENT Bash calls (same t) with DIFFERENT signatures → two bursts.
        { type: 'tool_use', name: 'Bash', id: 'b1', input: { command: "rg 'sk-GREPSECRET' src/" } },
        { type: 'tool_use', name: 'Bash', id: 'b2', input: { command: 'git status -s' } },
      ],
    },
  },
  {
    type: 'assistant',
    timestamp: '2026-06-24T09:01:00Z',
    message: {
      id: 'm2',
      model: 'claude-opus-4-8',
      usage: { input_tokens: 5, output_tokens: 10 },
      content: [
        // A co-timed harness Bash → HarnessEvent, and a Bash tools event with NO signature.
        { type: 'tool_use', name: 'Bash', id: 'b3', input: { command: 'harness checks --json' } },
        // Skill with a leading digit + a poisoned quoted tail → arg '08' ONLY.
        {
          type: 'tool_use',
          name: 'Skill',
          id: 's1',
          input: { skill: 'the-flow', args: '08 "sk-SKILL-LEAK"' },
        },
      ],
    },
  },
  {
    type: 'assistant',
    timestamp: '2026-06-24T09:01:30Z',
    message: {
      id: 'm3',
      model: 'claude-opus-4-8',
      usage: { input_tokens: 5, output_tokens: 10 },
      content: [
        // Non-digit and quoted-only skill args → NO arg captured.
        {
          type: 'tool_use',
          name: 'Skill',
          id: 's2',
          input: { skill: 'crew-cut', args: 'specify' },
        },
        {
          type: 'tool_use',
          name: 'Skill',
          id: 's3',
          input: { skill: 'thesis', args: '"prod-token"' },
        },
      ],
    },
  },
];
const CLAUDE_TRANSCRIPT = `${CLAUDE_LINES.map((l) => JSON.stringify(l)).join('\n')}\n`;

function claudeCtx(): HarnessContext {
  const fs = new FakeFs({
    [claudeTranscriptPath(HOME, REPO, 'sig-sess')]: CLAUDE_TRANSCRIPT,
  });
  const env = new FakeEnv({ CLAUDE_CODE_SESSION_ID: 'sig-sess' }, HOME);
  const src: HarnessSource = { env, fs, repoRoot: REPO, harness: 'claude-code' };
  return { ...src, window: { since: 'session-start', from: 0, to: CLAUDE_LINES.length } };
}

function toolsOf(
  stream: Event[],
): Array<Event & { name: string; count: number; signature?: string }> {
  return stream.filter((e) => e.kind === 'tools') as Array<
    Event & { name: string; count: number; signature?: string }
  >;
}
function skillsOf(stream: Event[]): Array<Event & { name: string; arg?: string }> {
  return stream.filter((e) => e.kind === 'skill') as Array<Event & { name: string; arg?: string }>;
}

describe('claudeAdapter — shell signature + skill digit (FX001)', () => {
  const caps = claudeAdapter.extract(claudeCtx());
  const stream = caps.event_stream as Event[];

  it('Facet A — a non-harness Bash surfaces its signature', () => {
    // MUTATION: dropping the kept `signature` in claude-adapter (never setting
    // call.signature) makes both these lookups undefined → this fails.
    const tools = toolsOf(stream);
    const sigs = tools.filter((t) => t.name === 'Bash').map((t) => t.signature);
    expect(sigs).toContain('rg');
    expect(sigs).toContain('git status');
  });

  it('Facet A — (name, signature) keying splits rg and git into DISTINCT bursts', () => {
    // MUTATION: removing `call.signature === cur.signature` from collapseToolBursts
    // collapses these two same-t Bash calls into ONE burst count 2 → length 1.
    const bashBursts = toolsOf(stream).filter(
      (t) => t.name === 'Bash' && t.signature !== undefined,
    );
    expect(bashBursts).toHaveLength(2);
    for (const b of bashBursts) expect(b.count).toBe(1);
  });

  it('Facet A — a co-timed harness stays a `harness` event; its Bash burst has NO signature', () => {
    // MUTATION: attaching `.harness[0]` as the signature would both leak `checks`
    // onto the Bash burst and double-count against the HarnessEvent.
    expect(stream.filter((e) => e.kind === 'harness')).toContainEqual(
      expect.objectContaining({ kind: 'harness', verb: 'checks' }),
    );
    const harnessBash = toolsOf(stream).find(
      (t) => t.name === 'Bash' && t.t === '2026-06-24T09:01:00Z',
    );
    expect(harnessBash?.signature).toBeUndefined();
  });

  it('Facet B — a leading digit is captured; non-digit / quoted args are not', () => {
    // MUTATION: passing the whole args string (skipping skillDigitArg) would set
    // `arg` to '08 "sk-SKILL-LEAK"' / 'specify' / '"prod-token"' → these fail.
    const skills = skillsOf(stream);
    const byName = Object.fromEntries(skills.map((s) => [s.name, s.arg]));
    expect(byName['the-flow']).toBe('08');
    expect(byName['crew-cut']).toBeUndefined();
    expect(byName.thesis).toBeUndefined();
  });

  it('P12 byte-scan — no alphabetic/quoted skill-arg text or shell secret ever serializes', () => {
    // MUTATION: widening the skill-arg or shell-signature capture (e.g. storing the
    // raw args / full command) makes one of the forbidden substrings appear → fails.
    const seg = serializeSegment(
      {
        command: 'flow',
        harness: 'claude-code',
        harness_session_id: 'sig-sess',
        timecode: '2026-06-24T09:00:00Z',
        window: { since: 'session-start', from: 0, to: CLAUDE_LINES.length },
        branch: null,
        tokens: caps.tokens,
        event_stream: caps.event_stream ?? undefined,
      },
      REPO,
    );
    const json = JSON.stringify(seg);
    expect(json).toContain('"arg":"08"'); // the one allowed, fixed-shape positional
    for (const forbidden of [
      'sk-SKILL-LEAK', // quoted skill-arg tail
      'specify', // non-digit skill arg
      'prod-token', // quoted-only skill arg
      'sk-GREPSECRET', // shell argument (only the `rg` signature survives)
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });
});

// ── Facet A over the Copilot adapter — the callId-DECOUPLED path ─────────────
// The tool NAME (execution_start) and the `arguments.command` (execution_complete)
// arrive on DIFFERENT events; the signature must still correlate by callId.
const COPILOT_EVENTS = [
  {
    type: 'user.message',
    data: { content: 'hello there world' },
    timestamp: '2026-06-24T10:00:00Z',
  },
  {
    type: 'tool.execution_start',
    data: { toolCallId: 'c1', toolName: 'bash' }, // name only, no command yet
    timestamp: '2026-06-24T10:00:01Z',
  },
  {
    type: 'tool.execution_complete',
    data: { toolCallId: 'c1', arguments: { command: 'rg needle src/' }, success: true }, // command late
    timestamp: '2026-06-24T10:00:02Z',
  },
  {
    type: 'tool.execution_start',
    data: { toolCallId: 'c2', toolName: 'bash', arguments: { command: 'harness doctor --json' } },
    timestamp: '2026-06-24T10:00:40Z',
  },
  {
    type: 'tool.execution_complete',
    data: { toolCallId: 'c2', success: true },
    timestamp: '2026-06-24T10:00:41Z',
  },
]
  .map((l) => JSON.stringify(l))
  .join('\n');

describe('copilotAdapter — shell signature across split execution events (FX001-A)', () => {
  const fs = new FakeFs({ [copilotEventsPath(HOME, 'co-sig')]: `${COPILOT_EVENTS}\n` });
  const env = new FakeEnv({ COPILOT_AGENT_SESSION_ID: 'co-sig' }, HOME);
  const caps = copilotAdapter.extract({
    env,
    fs,
    repoRoot: REPO,
    harness: 'copilot-cli',
    window: { since: 'session-start', from: 0, to: 99 },
  });
  const stream = caps.event_stream as Event[];

  it('correlates the command (late event) to the tool call (early event) by callId', () => {
    // MUTATION: reverting to the in-loop `toolCalls.push({name,t})` (no callId
    // correlation) leaves the `rg` signature unattached → this fails.
    const rg = toolsOf(stream).find((t) => t.signature === 'rg');
    expect(rg).toBeDefined();
    expect(rg?.name).toBe('bash');
  });

  it('a pure-harness shell command carries NO signature (harness stays separate)', () => {
    expect(stream.filter((e) => e.kind === 'harness')).toContainEqual(
      expect.objectContaining({ kind: 'harness', verb: 'doctor' }),
    );
    const harnessBash = toolsOf(stream).find((t) => t.name === 'bash' && t.t.endsWith('40Z'));
    expect(harnessBash?.signature).toBeUndefined();
  });
});

// ── OTLP round-trip: the PERSISTED form carries signature/arg (FX001) ────────
// The committed telemetry shard IS the OTLP logs blob — the git-ref source
// reconstructs the segment from it — so both fields must survive segment →
// segmentToOtlpLogs → otlpLogsToEvents, or FX001 is inert on real captures
// (and the P1 reconstruction invariant breaks).
describe('OTLP round-trip — signature + arg survive the persisted form (FX001)', () => {
  const caps = claudeAdapter.extract(claudeCtx());
  const seg = serializeSegment(
    {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: 'sig-sess',
      timecode: '2026-06-24T09:00:00Z',
      window: { since: 'session-start', from: 0, to: CLAUDE_LINES.length },
      branch: null,
      tokens: caps.tokens,
      event_stream: caps.event_stream ?? undefined,
    },
    REPO,
  );
  const reconstructed: Event[] = otlpLogsToEvents(segmentToOtlpLogs(seg));

  it('a shell signature and a skill digit-arg survive segment → OTLP logs → events', () => {
    // MUTATION: dropping the `A.TOOL_SIG` / `A.SKILL_ARG` kv on encode (or its
    // readStr on decode) in otlp/logs.ts loses the field through the round-trip —
    // the reconstructed `git status` / `08` disappears → both assertions flip RED.
    expect(toolsOf(reconstructed).map((t) => t.signature)).toContain('git status');
    expect(skillsOf(reconstructed).find((s) => s.name === 'the-flow')?.arg).toBe('08');
  });
});
