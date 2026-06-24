import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import {
  copilotAdapter,
  copilotEventsPath,
  copilotLogsDir,
} from '../../../src/services/telemetry/adapters/copilot-adapter.js';
import type { HarnessContext } from '../../../src/services/telemetry/adapters/harness-adapter.js';
import type { Event } from '../../../src/services/telemetry/events.js';
import { serializeSegment } from '../../../src/services/telemetry/segment.js';

/**
 * Phase 5 · T5.4 (Copilot) — the Copilot adapter emits a v2 event stream from the
 * timestamped `events.jsonl` + the process-log tokens (attributed per interaction
 * to the turn). Proves: prompt/turn(dur+tokens+model)/tool-burst/model/subagent/
 * harness events; AC-16 (rollup.tools == v1 tools, rollup.tokens == v1 buckets);
 * AC-15 (secrets in tool args / prompt / raw_prompt never reach an event).
 */

const REPO = '/repo';
const HOME = '/home/u';
const SESSION = 'sess-copilot-1';
const LOG_NAME = 'process-123-456.log';
const EVENTS = readFileSync(new URL('./fixtures/copilot-events.jsonl', import.meta.url), 'utf8');
const PROCLOG = readFileSync(new URL('./fixtures/copilot-process-log.txt', import.meta.url), 'utf8');

function ctx(): HarnessContext {
  const fs = new FakeFs(
    {
      [copilotEventsPath(HOME, SESSION)]: EVENTS,
      [`${copilotLogsDir(HOME)}/${LOG_NAME}`]: PROCLOG,
    },
    { [copilotLogsDir(HOME)]: [LOG_NAME] },
  );
  const env = new FakeEnv({ COPILOT_AGENT_SESSION_ID: SESSION }, HOME);
  return {
    env,
    fs,
    repoRoot: REPO,
    harness: 'copilot-cli',
    window: { since: 'session-start', from: 0, to: 99 },
  };
}

function kinds(events: Event[], kind: Event['kind']): Event[] {
  return events.filter((e) => e.kind === kind);
}

describe('copilotAdapter — v2 event stream (T5.4)', () => {
  const caps = copilotAdapter.extract(ctx());
  const stream = caps.event_stream as Event[];

  it('emits a non-null, time-ordered stream', () => {
    expect(stream).not.toBeNull();
    const ts = stream.map((e) => Date.parse(e.t));
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });

  it('emits a prompt (word count only)', () => {
    expect(kinds(stream, 'prompt')).toContainEqual(
      expect.objectContaining({ kind: 'prompt', words: 6 }),
    );
  });

  it('pairs turn_start/turn_end into a turn with dur_s + per-interaction tokens + model', () => {
    const turns = kinds(stream, 'turn');
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      t: '2026-06-23T08:00:03Z',
      dur_s: 7,
      in: 120,
      out: 95,
      cache_read: 40,
      cache_create: 5,
      model: 'claude-opus-4-8',
    });
  });

  it('collapses the bash tool calls into one burst + emits model/subagent/harness', () => {
    const tools = kinds(stream, 'tools') as Array<Event & { name: string; count: number }>;
    expect(tools).toContainEqual(expect.objectContaining({ name: 'bash', count: 2 }));
    expect(kinds(stream, 'model')).toContainEqual(
      expect.objectContaining({ kind: 'model', model: 'claude-opus-4-8', effort: 'high' }),
    );
    expect(kinds(stream, 'subagent')).toContainEqual(
      expect.objectContaining({ kind: 'subagent', name: 'explorer', status: 'completed' }),
    );
    expect(kinds(stream, 'harness')).toContainEqual(
      expect.objectContaining({ kind: 'harness', verb: 'flow nav' }),
    );
  });

  it('AC-16 — rollup equals the v1 counts (no drift)', () => {
    const seg = serializeSegment(
      {
        command: 'boot',
        harness: 'copilot-cli',
        harness_session_id: SESSION,
        timecode: '2026-06-23T08:00:10Z',
        window: { since: 'session-start', from: 0, to: 99 },
        branch: null,
        branch_changed: false,
        tokens: caps.tokens,
        tools: caps.tools ?? {},
        event_stream: stream,
      },
      REPO,
    );
    expect(seg.rollup?.tools).toEqual(seg.tools);
    expect(seg.rollup?.tokens).toEqual({ in: 120, out: 95, cache_read: 40, cache_create: 5 });
    expect(seg.tokens).toMatchObject({ input: 120, output: 95, cache_read: 40, cache_create: 5 });
  });

  it('AC-15 — secrets in tool args / prompt / raw_prompt never reach an event', () => {
    const json = JSON.stringify(stream);
    expect(json).not.toContain('SUPER_SECRET');
    expect(json).not.toContain('/Users/jordan');
    expect(json).not.toContain('keys.env');
    expect(json).not.toContain('raw_prompt');
  });
});

describe('copilotAdapter — tool name only on execution_complete (companion HIGH, AC-16)', () => {
  // execution_start carries NO toolName; the name appears only on execution_complete.
  const lines = [
    { type: 'user.message', timestamp: '2026-06-23T09:00:02Z', data: { interactionId: 'i1', content: 'hi there now' } },
    { type: 'assistant.turn_start', timestamp: '2026-06-23T09:00:03Z', data: { interactionId: 'i1' } },
    { type: 'tool.execution_start', timestamp: '2026-06-23T09:00:04Z', data: { toolCallId: 'tc-1' } },
    {
      type: 'tool.execution_complete',
      timestamp: '2026-06-23T09:00:05Z',
      data: { toolCallId: 'tc-1', toolName: 'str_replace_editor', interactionId: 'i1' },
    },
    { type: 'assistant.turn_end', timestamp: '2026-06-23T09:00:06Z', data: { interactionId: 'i1' } },
  ];
  const content = `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`;

  it('emits the tools event so rollup.tools matches the v1 histogram', () => {
    const fs = new FakeFs({ [copilotEventsPath(HOME, 'sx')]: content }, {});
    const env = new FakeEnv({ COPILOT_AGENT_SESSION_ID: 'sx' }, HOME);
    const caps = copilotAdapter.extract({
      env,
      fs,
      repoRoot: REPO,
      harness: 'copilot-cli',
      window: { since: 'session-start', from: 0, to: 99 },
    });
    expect(caps.tools).toEqual({ str_replace_editor: 1 }); // v1 counts it
    const tools = (caps.event_stream as Event[]).filter((e) => e.kind === 'tools');
    expect(tools).toContainEqual(
      expect.objectContaining({ name: 'str_replace_editor', count: 1 }),
    );
  });
});
