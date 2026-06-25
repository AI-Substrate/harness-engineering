import { describe, expect, it } from 'vitest';
import { FakeDb } from '../../../src/adapters/db/fake-db.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import {
  cursorAdapter,
  cursorTranscriptPath,
} from '../../../src/services/telemetry/adapters/cursor-adapter.js';
import type { HarnessContext } from '../../../src/services/telemetry/adapters/harness-adapter.js';
import type { Event } from '../../../src/services/telemetry/events.js';
import { serializeSegment } from '../../../src/services/telemetry/segment.js';

/**
 * Phase 5 · T5.5 — the Cursor adapter emits a v2 event stream anchored to the IDE-
 * store bubble `createdAt` times (the transcript is untimed — the honest ceiling).
 * Proves: turn-grained timeline + model from bubbles; tools/skills/harness anchored
 * to their turn (`t_precision: "anchored"`); tokens null (never estimated, AC-15);
 * rollup.tokens null + rollup.tools == v1 tools (AC-16); working_ratio from gaps.
 */

const REPO = '/repo';
const TDIR = '/t/transcripts';
const CONV = 'conv-evt';
const HOME = '/home/u';
const T0 = Date.UTC(2026, 5, 24, 9, 0, 0); // user bubble
const T1 = T0 + 30_000; // assistant bubble, +30s

const LINES = [
  {
    role: 'user',
    message: {
      content: [{ type: 'text', text: '<user_query>please build it all now</user_query>' }],
    },
  },
  {
    role: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          name: 'Shell',
          input: { command: 'harness boot && cat /Users/x/secret.env' },
        },
        { type: 'tool_use', name: 'Skill', input: { skill: 'the-flow' } },
      ],
    },
  },
];
const TRANSCRIPT = `${LINES.map((l) => JSON.stringify(l)).join('\n')}\n`;

function db(): FakeDb {
  return new FakeDb([
    { value: JSON.stringify({ createdAt: T0, type: 1 }) },
    { value: JSON.stringify({ createdAt: T1, type: 2, modelInfo: { modelName: 'composer-2.5' } }) },
  ]);
}

function ctx(): HarnessContext {
  const fs = new FakeFs({ [cursorTranscriptPath(TDIR, CONV)]: TRANSCRIPT });
  const env = new FakeEnv({ CURSOR_CONVERSATION_ID: CONV, AGENT_TRANSCRIPTS: TDIR }, HOME);
  return {
    env,
    fs,
    db: db(),
    repoRoot: REPO,
    harness: 'cursor-agent',
    window: { since: 'session-start', from: 0, to: 99 },
  };
}

function kinds(events: Event[], kind: Event['kind']): Event[] {
  return events.filter((e) => e.kind === kind);
}

describe('cursorAdapter — v2 event stream from bubble createdAt (T5.5)', () => {
  const caps = cursorAdapter.extract(ctx());
  const stream = caps.event_stream as Event[];

  it('emits a non-null, time-ordered anchored stream', () => {
    expect(stream).not.toBeNull();
    expect(stream.every((e) => e.t_precision === 'anchored')).toBe(true);
    const ts = stream.map((e) => Date.parse(e.t));
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });

  it('prompt timed to the user bubble; turn timed to the assistant bubble with model + NO tokens', () => {
    const prompt = kinds(stream, 'prompt')[0] as Event & { words: number };
    expect(prompt.words).toBe(5);
    expect(Date.parse(prompt.t)).toBe(T0);
    const turn = kinds(stream, 'turn')[0] as Event & { model?: string; in?: number };
    expect(Date.parse(turn.t)).toBe(T1);
    expect(turn.model).toBe('composer-2.5');
    expect(turn.in).toBeUndefined(); // no tokens — Cursor keeps them server-side
  });

  it('anchors tools / skill / harness beats to the turn', () => {
    expect(kinds(stream, 'skill')).toContainEqual(
      expect.objectContaining({ kind: 'skill', name: 'the-flow', status: 'completed' }),
    );
    expect(kinds(stream, 'harness')).toContainEqual(
      expect.objectContaining({ kind: 'harness', verb: 'boot' }),
    );
    const tools = kinds(stream, 'tools') as Array<Event & { name: string; count: number }>;
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.count]));
    expect(byName.Shell).toBe(1);
    expect(byName.Skill).toBe(1);
  });

  it('AC-16/AC-15 — rollup.tokens null, rollup.tools == v1 tools, no secret/path leaks', () => {
    const seg = serializeSegment(
      {
        command: 'flow',
        harness: 'cursor-agent',
        harness_session_id: CONV,
        timecode: '2026-06-24T09:00:30Z',
        window: { since: 'session-start', from: 0, to: 99 },
        branch: null,
        branch_changed: false,
        tokens: null,
        tools: caps.tools ?? {},
        event_stream: stream,
      },
      REPO,
    );
    expect(seg.rollup?.tokens).toBeNull();
    expect(seg.rollup?.tools).toEqual(seg.tools);
    expect(seg.rollup?.activity.working_ratio).toBe(1); // 30s agent gap, no human time
    const json = JSON.stringify(seg);
    expect(json).not.toContain('/Users/x');
    expect(json).not.toContain('secret.env');
  });

  it('event_stream null when there are no timed bubbles (headless CLI session)', () => {
    const c = ctx();
    const caps2 = cursorAdapter.extract({ ...c, db: new FakeDb([]) });
    expect(caps2.event_stream ?? null).toBeNull(); // honest: no timeline, never fabricated
    expect(caps2.tools).toEqual({ Shell: 1, Skill: 1 }); // v1 counts still captured
  });
});
