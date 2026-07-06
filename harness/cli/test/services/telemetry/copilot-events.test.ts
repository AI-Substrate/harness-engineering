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
const PROCLOG = readFileSync(
  new URL('./fixtures/copilot-process-log.txt', import.meta.url),
  'utf8',
);

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

  it('splits the bash tool calls by (name, signature) + emits model/subagent/harness', () => {
    const tools = kinds(stream, 'tools') as Array<
      Event & { name: string; count: number; signature?: string }
    >;
    // FX001-2: the two bash calls — `git status -s` (signature `git status`) and the
    // harness `flow nav` bash (pure harness → NO signature) — are now DISTINCT
    // (name, signature) bursts, not one `bash ×2` burst. MUTATION: reverting the
    // `call.signature === cur.signature` guard in collapseToolBursts re-collapses
    // them into a single `bash ×2` burst → the length-2 + `git status` checks flip.
    const bashBursts = tools.filter((t) => t.name === 'bash');
    expect(bashBursts).toHaveLength(2);
    expect(bashBursts).toContainEqual(
      expect.objectContaining({ name: 'bash', count: 1, signature: 'git status' }),
    );
    // the harness bash burst carries NO signature (harness verb stays a separate event).
    expect(bashBursts.find((b) => b.signature === undefined)).toMatchObject({ count: 1 });
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
    {
      type: 'user.message',
      timestamp: '2026-06-23T09:00:02Z',
      data: { interactionId: 'i1', content: 'hi there now' },
    },
    {
      type: 'assistant.turn_start',
      timestamp: '2026-06-23T09:00:03Z',
      data: { interactionId: 'i1' },
    },
    {
      type: 'tool.execution_start',
      timestamp: '2026-06-23T09:00:04Z',
      data: { toolCallId: 'tc-1' },
    },
    {
      type: 'tool.execution_complete',
      timestamp: '2026-06-23T09:00:05Z',
      data: { toolCallId: 'tc-1', toolName: 'str_replace_editor', interactionId: 'i1' },
    },
    {
      type: 'assistant.turn_end',
      timestamp: '2026-06-23T09:00:06Z',
      data: { interactionId: 'i1' },
    },
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
    expect(tools).toContainEqual(expect.objectContaining({ name: 'str_replace_editor', count: 1 }));
  });
});

describe('copilotAdapter — command on execution_start, toolName on execution_complete (companion MEDIUM)', () => {
  // `arguments.command` lands on execution_start; the `toolName` (`bash`) lands only
  // on execution_complete. Capturing the command must NOT be gated on the toolName
  // being in the same event, or bash_commands / harness_commands / the `harness`
  // event are silently lost for that split execution.
  const lines = [
    {
      type: 'user.message',
      timestamp: '2026-06-23T09:00:02Z',
      data: { interactionId: 'i1', content: 'go now' },
    },
    {
      type: 'assistant.turn_start',
      timestamp: '2026-06-23T09:00:03Z',
      data: { interactionId: 'i1' },
    },
    {
      type: 'tool.execution_start',
      timestamp: '2026-06-23T09:00:04Z',
      data: { toolCallId: 'tc-1', arguments: { command: 'harness checks --json' } },
    },
    {
      type: 'tool.execution_complete',
      timestamp: '2026-06-23T09:00:05Z',
      data: { toolCallId: 'tc-1', toolName: 'bash', interactionId: 'i1' },
    },
    {
      type: 'assistant.turn_end',
      timestamp: '2026-06-23T09:00:06Z',
      data: { interactionId: 'i1' },
    },
  ];
  const content = `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`;

  function caps() {
    const fs = new FakeFs({ [copilotEventsPath(HOME, 'sy')]: content }, {});
    const env = new FakeEnv({ COPILOT_AGENT_SESSION_ID: 'sy' }, HOME);
    return copilotAdapter.extract({
      env,
      fs,
      repoRoot: REPO,
      harness: 'copilot-cli',
      window: { since: 'session-start', from: 0, to: 99 },
    });
  }

  it('captures the tool despite the split start/complete events', () => {
    const c = caps();
    // (the harness verb itself surfaces as a `harness` event — asserted in the next test)
    expect(c.tools).toEqual({ bash: 1 });
  });

  it('emits the `harness` event for the split execution', () => {
    const stream = caps().event_stream as Event[];
    expect(kinds(stream, 'harness')).toContainEqual(
      expect.objectContaining({ kind: 'harness', verb: 'checks' }),
    );
  });

  it('AC-15 — the raw command never leaks into the serialized segment', () => {
    const c = caps();
    const seg = serializeSegment(
      {
        command: 'flow',
        harness: 'copilot-cli',
        harness_session_id: 'sy',
        timecode: '2026-06-23T09:00:06Z',
        window: { since: 'session-start', from: 0, to: 99 },
        branch: null,
        branch_changed: false,
        harness_commands: c.harness_commands ?? [],
        event_stream: (c.event_stream as Event[]) ?? [],
      },
      REPO,
    );
    expect(JSON.stringify(seg)).not.toContain('--json'); // params stripped
  });
});

describe('copilotAdapter — command_exit from the success flag (T5.7, AC-19)', () => {
  // Copilot carries no result envelope (only `success`), so it yields command_exit
  // for a harness command but NOT a checks event.
  function streamFor(success: boolean): Event[] {
    const lines = [
      {
        type: 'user.message',
        timestamp: '2026-06-23T09:00:02Z',
        data: { interactionId: 'i1', content: 'go' },
      },
      {
        type: 'tool.execution_start',
        timestamp: '2026-06-23T09:00:03Z',
        data: { toolCallId: 'tc-1', toolName: 'bash', arguments: { command: 'harness checks' } },
      },
      {
        type: 'tool.execution_complete',
        timestamp: '2026-06-23T09:00:05Z',
        data: { toolCallId: 'tc-1', toolName: 'bash', success },
      },
    ];
    const content = `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`;
    const fs = new FakeFs({ [copilotEventsPath(HOME, 'sz')]: content }, {});
    const env = new FakeEnv({ COPILOT_AGENT_SESSION_ID: 'sz' }, HOME);
    return copilotAdapter.extract({
      env,
      fs,
      repoRoot: REPO,
      harness: 'copilot-cli',
      window: { since: 'session-start', from: 0, to: 99 },
    }).event_stream as Event[];
  }

  it('success:true ⇒ command_exit exit 0, no checks event', () => {
    const stream = streamFor(true);
    expect(kinds(stream, 'command_exit')).toContainEqual(
      expect.objectContaining({ kind: 'command_exit', verb: 'checks', exit: 0 }),
    );
    expect(kinds(stream, 'checks')).toHaveLength(0); // no envelope ⇒ no checks
  });

  it('success:false ⇒ command_exit exit 1', () => {
    expect(kinds(streamFor(false), 'command_exit')).toContainEqual(
      expect.objectContaining({ kind: 'command_exit', verb: 'checks', exit: 1 }),
    );
  });

  it('F004 — a compound command (≥2 harness subs) emits NO command_exit (one success bool)', () => {
    const lines = [
      {
        type: 'tool.execution_start',
        timestamp: '2026-06-23T09:00:03Z',
        data: {
          toolCallId: 'tc-1',
          toolName: 'bash',
          arguments: { command: 'harness checks && harness boot' },
        },
      },
      {
        type: 'tool.execution_complete',
        timestamp: '2026-06-23T09:00:05Z',
        data: { toolCallId: 'tc-1', toolName: 'bash', success: false },
      },
    ];
    const content = `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`;
    const fs = new FakeFs({ [copilotEventsPath(HOME, 'sc')]: content }, {});
    const env = new FakeEnv({ COPILOT_AGENT_SESSION_ID: 'sc' }, HOME);
    const stream = copilotAdapter.extract({
      env,
      fs,
      repoRoot: REPO,
      harness: 'copilot-cli',
      window: { since: 'session-start', from: 0, to: 99 },
    }).event_stream as Event[];
    expect(kinds(stream, 'command_exit')).toHaveLength(0); // can't attribute one success to two verbs
  });

  it('F008 — a harness verb MIXED with a non-harness command emits NO command_exit', () => {
    // `npm test && harness checks`: the single `success` reflects the whole shell
    // execution, not `harness checks` alone — so it must not be attributed.
    const lines = [
      {
        type: 'tool.execution_start',
        timestamp: '2026-06-23T09:00:03Z',
        data: {
          toolCallId: 'tc-1',
          toolName: 'bash',
          arguments: { command: 'npm test && harness checks' },
        },
      },
      {
        type: 'tool.execution_complete',
        timestamp: '2026-06-23T09:00:05Z',
        data: { toolCallId: 'tc-1', toolName: 'bash', success: false },
      },
    ];
    const content = `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`;
    const fs = new FakeFs({ [copilotEventsPath(HOME, 'sm')]: content }, {});
    const env = new FakeEnv({ COPILOT_AGENT_SESSION_ID: 'sm' }, HOME);
    const stream = copilotAdapter.extract({
      env,
      fs,
      repoRoot: REPO,
      harness: 'copilot-cli',
      window: { since: 'session-start', from: 0, to: 99 },
    }).event_stream as Event[];
    expect(kinds(stream, 'command_exit')).toHaveLength(0); // success reflects npm test too
    // the harness event itself is still emitted (the verb DID run)
    expect(kinds(stream, 'harness')).toContainEqual(
      expect.objectContaining({ kind: 'harness', verb: 'checks' }),
    );
  });
});
