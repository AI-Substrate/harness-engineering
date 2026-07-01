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
import type { Event } from '../../../src/services/telemetry/events.js';
import { otlpLogsToEvents, segmentToOtlpLogs } from '../../../src/services/telemetry/otlp/logs.js';
import { collapseToolBursts, type ToolCall } from '../../../src/services/telemetry/rollup.js';
import { serializeSegment } from '../../../src/services/telemetry/segment.js';

/**
 * FX003 — per-tool-call result size (the "dumper" signal).
 *
 * The one honest, capturable per-call number is the SIZE of what a call dumped
 * back (its `tool_result` payload) — a token-count ESTIMATE (char/4), never the
 * text (P12). `ToolCall`/`ToolsEvent` gain `result_tokens?: number`;
 * `collapseToolBursts` SUMS it per `(name, signature)` burst; it threads through
 * the OTLP logs round-trip (`harness.tool.result_tokens`). copilot-vscode is
 * turns-only → it OMITS the field (honest absence, never a fabricated 0).
 *
 * Every equality names the deliberate MUTATION that flips it (Dimension 0).
 */

const REPO = '/repo';
const HOME = '/home/u';

function toolsOf(
  stream: Event[],
): Array<Event & { name: string; count: number; signature?: string; result_tokens?: number }> {
  return stream.filter((e) => e.kind === 'tools') as Array<
    Event & { name: string; count: number; signature?: string; result_tokens?: number }
  >;
}

// ── Unit: collapseToolBursts SUMS result_tokens per (name, signature) ────────
describe('collapseToolBursts — sums result_tokens across the burst (FX003)', () => {
  it('sums every call in a same-(name,signature) burst', () => {
    // MUTATION: dropping the `cur.resultTokens += call.result_tokens` accumulation
    // (keeping only the first call's size) flips 60 → 10.
    const calls: ToolCall[] = [
      { name: 'Bash', t: '2026-06-24T09:00:00Z', signature: 'rg', result_tokens: 10 },
      { name: 'Bash', t: '2026-06-24T09:00:01Z', signature: 'rg', result_tokens: 20 },
      { name: 'Bash', t: '2026-06-24T09:00:02Z', signature: 'rg', result_tokens: 30 },
    ];
    const bursts = collapseToolBursts(calls);
    expect(bursts).toHaveLength(1);
    expect(bursts[0].count).toBe(3);
    expect(bursts[0].result_tokens).toBe(60);
  });

  it('a different signature starts a NEW burst with its OWN sum', () => {
    const calls: ToolCall[] = [
      { name: 'Bash', t: '2026-06-24T09:00:00Z', signature: 'rg', result_tokens: 10 },
      { name: 'Bash', t: '2026-06-24T09:00:01Z', signature: 'git status', result_tokens: 5 },
    ];
    const bursts = collapseToolBursts(calls);
    expect(bursts.map((b) => b.result_tokens)).toEqual([10, 5]);
  });

  it('HONEST ABSENCE — a burst with NO sized call carries NO result_tokens (never 0)', () => {
    // MUTATION: initializing the burst sum to 0 (instead of leaving it undefined)
    // fabricates a `result_tokens: 0` on a turns-only source → this flips.
    const bursts = collapseToolBursts([
      { name: 'Read', t: '2026-06-24T09:00:00Z' },
      { name: 'Read', t: '2026-06-24T09:00:01Z' },
    ]);
    expect(bursts).toHaveLength(1);
    expect(bursts[0].result_tokens).toBeUndefined();
    expect('result_tokens' in bursts[0]).toBe(false);
  });
});

// ── Claude adapter: big vs small result_tokens end-to-end + P12 byte-scan ────
const RESULT_SECRET = 'sk-RESULT-LEAK-SECRET';
const BIG_PAYLOAD = `${RESULT_SECRET} ${'A'.repeat(800)}`; // 822 chars → ceil/4 = 206
const SMALL_PAYLOAD = 'ok done.'; // 8 chars → ceil/4 = 2
const BIG_RT = Math.ceil(BIG_PAYLOAD.length / 4);
const SMALL_RT = Math.ceil(SMALL_PAYLOAD.length / 4);

const CLAUDE_LINES = [
  {
    type: 'user',
    timestamp: '2026-06-24T09:00:00Z',
    message: { role: 'user', content: 'go now please' },
  },
  {
    type: 'assistant',
    timestamp: '2026-06-24T09:00:30Z',
    message: {
      id: 'm1',
      model: 'claude-opus-4-8',
      usage: { input_tokens: 10, output_tokens: 20 },
      content: [
        { type: 'tool_use', name: 'Bash', id: 'big', input: { command: 'cat huge-report.json' } },
        { type: 'tool_use', name: 'Bash', id: 'small', input: { command: 'git status -s' } },
      ],
    },
  },
  {
    type: 'user',
    timestamp: '2026-06-24T09:00:45Z',
    message: {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'big', content: BIG_PAYLOAD },
        { type: 'tool_result', tool_use_id: 'small', content: SMALL_PAYLOAD },
      ],
    },
  },
];
const CLAUDE_TRANSCRIPT = `${CLAUDE_LINES.map((l) => JSON.stringify(l)).join('\n')}\n`;

function claudeCaps() {
  const fs = new FakeFs({ [claudeTranscriptPath(HOME, REPO, 'rt-sess')]: CLAUDE_TRANSCRIPT });
  const env = new FakeEnv({ CLAUDE_CODE_SESSION_ID: 'rt-sess' }, HOME);
  return claudeAdapter.extract({
    env,
    fs,
    repoRoot: REPO,
    harness: 'claude-code',
    window: { since: 'session-start', from: 0, to: CLAUDE_LINES.length },
  });
}

describe('claudeAdapter — sizes the correlated tool_result payload (FX003)', () => {
  const caps = claudeCaps();
  const stream = caps.event_stream as Event[];

  it('a big-dump call surfaces a BIG result_tokens; a tiny one a SMALL one', () => {
    // MUTATION: making estimateResultTokens return 0 (or never attaching it) drops
    // both to undefined/0 → the `BIG_RT`/`SMALL_RT` equalities and big>small flip.
    const bySig = Object.fromEntries(
      toolsOf(stream)
        .filter((t) => t.name === 'Bash')
        .map((t) => [t.signature, t.result_tokens]),
    );
    expect(bySig.cat).toBe(BIG_RT);
    expect(bySig['git status']).toBe(SMALL_RT);
    expect((bySig.cat ?? 0) > (bySig['git status'] ?? 0)).toBe(true);
  });

  it('P12 — only the NUMBER is serialized; the payload text NEVER reaches the segment', () => {
    // MUTATION: keeping the payload text (e.g. storing toolResultText instead of its
    // size) makes the forbidden secret appear in the serialized JSON → this fails.
    const seg = serializeSegment(
      {
        command: 'flow',
        harness: 'claude-code',
        harness_session_id: 'rt-sess',
        timecode: '2026-06-24T09:00:00Z',
        window: { since: 'session-start', from: 0, to: CLAUDE_LINES.length },
        branch: null,
        event_stream: caps.event_stream ?? undefined,
      },
      REPO,
    );
    const json = JSON.stringify(seg);
    expect(json).toContain(`"result_tokens":${BIG_RT}`);
    expect(json).not.toContain(RESULT_SECRET);
    expect(json).not.toContain('AAAA');
  });
});

// ── Copilot adapter: result.content sizing across split execution events ─────
const COPILOT_EVENTS = [
  {
    type: 'user.message',
    data: { content: 'hello there world' },
    timestamp: '2026-06-24T10:00:00Z',
  },
  {
    type: 'tool.execution_start',
    data: { toolCallId: 'c1', toolName: 'bash' },
    timestamp: '2026-06-24T10:00:01Z',
  },
  {
    type: 'tool.execution_complete',
    data: {
      toolCallId: 'c1',
      arguments: { command: 'cat huge.json' },
      success: true,
      result: { content: BIG_PAYLOAD },
    },
    timestamp: '2026-06-24T10:00:02Z',
  },
  {
    type: 'tool.execution_start',
    data: { toolCallId: 'c2', toolName: 'bash' },
    timestamp: '2026-06-24T10:00:40Z',
  },
  {
    type: 'tool.execution_complete',
    data: {
      toolCallId: 'c2',
      arguments: { command: 'git status -s' },
      success: true,
      result: { content: SMALL_PAYLOAD },
    },
    timestamp: '2026-06-24T10:00:41Z',
  },
]
  .map((l) => JSON.stringify(l))
  .join('\n');

describe('copilotAdapter — sizes result.content (FX003)', () => {
  const fs = new FakeFs({ [copilotEventsPath(HOME, 'co-rt')]: `${COPILOT_EVENTS}\n` });
  const env = new FakeEnv({ COPILOT_AGENT_SESSION_ID: 'co-rt' }, HOME);
  const caps = copilotAdapter.extract({
    env,
    fs,
    repoRoot: REPO,
    harness: 'copilot-cli',
    window: { since: 'session-start', from: 0, to: 99 },
  });
  const stream = caps.event_stream as Event[];

  it('a big result.content → big result_tokens; a small one → small', () => {
    // MUTATION: not reading `data.result.content` (or estimateResultTokens→0) flips
    // these to undefined.
    const bySig = Object.fromEntries(
      toolsOf(stream)
        .filter((t) => t.name === 'bash')
        .map((t) => [t.signature, t.result_tokens]),
    );
    expect(bySig.cat).toBe(BIG_RT);
    expect(bySig['git status']).toBe(SMALL_RT);
  });

  it('P12 — the copilot segment carries the size, never the payload', () => {
    const seg = serializeSegment(
      {
        command: 'flow',
        harness: 'copilot-cli',
        harness_session_id: 'co-rt',
        timecode: '2026-06-24T10:00:00Z',
        window: { since: 'session-start', from: 0, to: 99 },
        branch: null,
        event_stream: caps.event_stream ?? undefined,
      },
      REPO,
    );
    const json = JSON.stringify(seg);
    expect(json).toContain(`"result_tokens":${BIG_RT}`);
    expect(json).not.toContain(RESULT_SECRET);
  });
});

// ── OTLP round-trip: result_tokens survives the committed shard ──────────────
describe('OTLP logs round-trip — harness.tool.result_tokens (FX003-3)', () => {
  const seg = serializeSegment(
    {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: 'otlp-rt',
      timecode: '2026-06-24T09:00:00Z',
      window: { since: 'session-start', from: 0, to: 2 },
      branch: null,
      event_stream: [
        {
          t: '2026-06-24T09:00:00Z',
          kind: 'tools',
          name: 'Bash',
          count: 3,
          span_s: 0,
          signature: 'rg',
          result_tokens: 4242,
        },
        { t: '2026-06-24T09:00:01Z', kind: 'tools', name: 'Read', count: 1, span_s: 0 },
      ],
    },
    REPO,
  );

  it('a sized tools event keeps its result_tokens through logs→events', () => {
    // MUTATION: suppressing the OTLP attr (not pushing A.TOOL_RESULT_TOKENS in
    // logs.ts, or not decoding it) drops it on the committed shard → undefined here.
    const round = toolsOf(otlpLogsToEvents(segmentToOtlpLogs(seg)));
    const rg = round.find((t) => t.signature === 'rg');
    expect(rg?.result_tokens).toBe(4242);
  });

  it('HONEST ABSENCE — an unsized tools event round-trips WITHOUT result_tokens', () => {
    const round = toolsOf(otlpLogsToEvents(segmentToOtlpLogs(seg)));
    const read = round.find((t) => t.name === 'Read');
    expect(read?.result_tokens).toBeUndefined();
  });
});
