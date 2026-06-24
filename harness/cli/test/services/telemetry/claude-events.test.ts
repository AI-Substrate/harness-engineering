import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import {
  claudeAdapter,
  claudeTranscriptPath,
} from '../../../src/services/telemetry/adapters/claude-adapter.js';
import type {
  HarnessContext,
  HarnessSource,
} from '../../../src/services/telemetry/adapters/harness-adapter.js';
import type { Event } from '../../../src/services/telemetry/events.js';
import { serializeSegment } from '../../../src/services/telemetry/segment.js';

/**
 * Phase 5 · T5.4 — the Claude adapter emits a v2 event stream from a TIMESTAMPED
 * transcript (real transcripts carry `timestamp`; the Phase-2 fixture doesn't, so
 * this drives its own). Proves: prompt/turn/tools-burst/skill/harness/subagent/
 * compaction events; AC-16 (rollup.tools == the v1 tools histogram, no drift);
 * AC-15 (a secret in a Bash command line never reaches any event).
 */

const REPO = '/repo';
const HOME = '/home/u';
const SESSION = 'sess-evt';
const PROMPT = 'please build the event stream now'; // 6 words

// 6 timestamped transcript lines (no header — every line is a real entry).
const LINES = [
  { type: 'user', timestamp: '2026-06-24T09:00:00Z', message: { role: 'user', content: PROMPT } },
  {
    type: 'assistant',
    timestamp: '2026-06-24T09:00:30Z',
    message: {
      id: 'msg-1',
      model: 'claude-opus-4-8',
      usage: {
        input_tokens: 50,
        output_tokens: 100,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 200,
      },
      content: [
        { type: 'tool_use', name: 'Read', id: 't1', input: { file_path: '/repo/a.ts' } },
        { type: 'tool_use', name: 'Read', id: 't2', input: { file_path: '/repo/b.ts' } },
        { type: 'tool_use', name: 'Edit', id: 't3', input: { file_path: '/repo/c.ts' } },
      ],
    },
  },
  {
    type: 'assistant',
    timestamp: '2026-06-24T09:01:00Z',
    message: {
      id: 'msg-2',
      model: 'claude-opus-4-8',
      usage: { input_tokens: 20, output_tokens: 40, cache_read_input_tokens: 300 },
      content: [
        { type: 'tool_use', name: 'Skill', id: 's1', input: { skill: 'the-flow' } },
        {
          type: 'tool_use',
          name: 'Bash',
          id: 'b1',
          input: { command: 'harness checks --json # secret sk-LEAK-zzz' },
        },
      ],
    },
  },
  {
    type: 'assistant',
    timestamp: '2026-06-24T09:01:30Z',
    message: {
      id: 'msg-3',
      model: 'claude-opus-4-8',
      usage: { input_tokens: 5, output_tokens: 10 },
      content: [{ type: 'tool_use', name: 'Agent', id: 'agent-1', input: { subagent_type: 'Explore' } }],
    },
  },
  {
    type: 'user',
    timestamp: '2026-06-24T09:02:00Z',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'agent-1',
          content: 'done <usage>subagent_tokens: 500\ntool_uses: 3</usage>',
        },
      ],
    },
  },
  {
    type: 'compaction',
    timestamp: '2026-06-24T09:03:00Z',
    compactMetadata: { trigger: 'auto', preTokens: 1000, postTokens: 200 },
  },
];
const TRANSCRIPT = `${LINES.map((l) => JSON.stringify(l)).join('\n')}\n`;

function ctx(): HarnessContext {
  const fs = new FakeFs({ [claudeTranscriptPath(HOME, REPO, SESSION)]: TRANSCRIPT });
  const env = new FakeEnv({ CLAUDE_CODE_SESSION_ID: SESSION }, HOME);
  const src: HarnessSource = { env, fs, repoRoot: REPO, harness: 'claude-code' };
  return { ...src, window: { since: 'session-start', from: 0, to: LINES.length } };
}

function kinds(events: Event[], kind: Event['kind']): Event[] {
  return events.filter((e) => e.kind === kind);
}

describe('claudeAdapter — v2 event stream (T5.4)', () => {
  const caps = claudeAdapter.extract(ctx());
  const stream = caps.event_stream as Event[];

  it('emits a non-null, time-ordered stream', () => {
    expect(stream).not.toBeNull();
    const ts = stream.map((e) => Date.parse(e.t));
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });

  it('emits a prompt event with a word count (never the text)', () => {
    expect(kinds(stream, 'prompt')).toContainEqual({
      t: '2026-06-24T09:00:00Z',
      kind: 'prompt',
      words: 6,
    });
  });

  it('emits turns with dur_s + tokens + model', () => {
    const turns = kinds(stream, 'turn');
    expect(turns).toHaveLength(3);
    expect(turns[0]).toMatchObject({ dur_s: 30, out: 100, in: 50, cache_read: 200, cache_create: 10, model: 'claude-opus-4-8' });
  });

  it('collapses same-name tool runs into per-tool bursts', () => {
    const tools = kinds(stream, 'tools') as Array<Event & { name: string; count: number }>;
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.count]));
    expect(byName.Read).toBe(2);
    expect(byName.Edit).toBe(1);
  });

  it('emits skill / harness / subagent / compaction events', () => {
    expect(kinds(stream, 'skill')).toContainEqual(
      expect.objectContaining({ kind: 'skill', name: 'the-flow', status: 'completed' }),
    );
    expect(kinds(stream, 'harness')).toContainEqual(
      expect.objectContaining({ kind: 'harness', verb: 'checks' }),
    );
    expect(kinds(stream, 'subagent')).toContainEqual(
      expect.objectContaining({ kind: 'subagent', name: 'Explore', status: 'completed' }),
    );
    expect(kinds(stream, 'compaction')).toHaveLength(1);
  });

  it('AC-16 — derived rollup.tools equals the v1 tools histogram (no drift)', () => {
    const seg = serializeSegment(
      {
        command: 'flow',
        harness: 'claude-code',
        harness_session_id: SESSION,
        timecode: '2026-06-24T09:03:00Z',
        window: { since: 'session-start', from: 0, to: LINES.length },
        branch: null,
        branch_changed: false,
        tokens: caps.tokens,
        tools: caps.tools ?? {},
        event_stream: stream,
      },
      REPO,
    );
    expect(seg.rollup?.tools).toEqual(seg.tools);
    // token buckets: v1 tokens fields == rollup tokens
    expect(seg.rollup?.tokens).toEqual({ in: 75, out: 150, cache_read: 500, cache_create: 10 });
    expect(seg.tokens).toMatchObject({ input: 75, output: 150, cache_read: 500, cache_create: 10 });
  });

  it('AC-15 — a secret in a Bash command never reaches any event', () => {
    const json = JSON.stringify(stream);
    expect(json).not.toContain('sk-LEAK');
    expect(json).not.toContain('secret');
    expect(json).not.toContain(PROMPT);
    expect(json).not.toContain('/repo/a.ts');
  });
});
