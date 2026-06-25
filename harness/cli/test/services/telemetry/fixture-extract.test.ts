import { describe, expect, it } from 'vitest';
import {
  filterCopilotProcessLog,
  projectCopilotVscodeRows,
  projectCursorBubbleRows,
  redactCopilotSystemMessage,
} from '../../../src/services/telemetry/fixture-extract.js';

/**
 * T001/T005 (plan 2.1/2.3 · AC-03) — pure projections that shrink a raw capture
 * to a privacy-safe, adapter-faithful fixture.
 *
 * `filterCopilotProcessLog`: a copilot-cli `process-*.log` is a per-PROCESS verbose
 * debug log that interleaves MANY sessions (and 28KB embedded payloads). The adapter
 * reads ONLY `assistant_usage` JSON objects, filtered by inner `session_id`. So the
 * committed fixture must contain ONLY this session's `assistant_usage` records —
 * tiny, and with no other session's data. The filter replicates the adapter's
 * `extractJsonObjects` scan so what we keep is exactly what the adapter consumes.
 */

const SID = 'b67cd3ce-e0ee-4048-831e-7f4591f20a60';

// A realistic log slice: two assistant_usage objects for SID, one for ANOTHER
// session, and non-JSON debug noise — all multi-line, pretty-printed.
const LOG = `2026-06-24T09:29:13 [debug] some noise line that is not json
{
  "kind": "assistant_usage",
  "properties": { "model": "claude-opus-4.8", "interaction_id": "iid-1" },
  "metrics": { "input_tokens_uncached": 2, "output_tokens": 349 },
  "session_id": "${SID}"
}
[info] more noise { not really json }
{
  "kind": "assistant_usage",
  "properties": { "model": "claude-opus-4.8", "interaction_id": "iid-1" },
  "metrics": { "input_tokens_uncached": 2, "output_tokens": 86 },
  "session_id": "${SID}"
}
{
  "kind": "assistant_usage",
  "properties": { "model": "gpt-x", "interaction_id": "other" },
  "metrics": { "input_tokens_uncached": 999, "output_tokens": 999 },
  "session_id": "OTHER-SESSION-should-be-dropped"
}
{
  "kind": "tool_call",
  "session_id": "${SID}",
  "payload": "huge debug blob that must NOT be kept"
}
`;

describe('filterCopilotProcessLog', () => {
  it('keeps ONLY assistant_usage objects whose session_id matches', () => {
    const out = filterCopilotProcessLog(LOG, SID);
    // re-parse the output the way the adapter does
    const objs = JSON.parse(`[${out.trim().replace(/\}\s*\{/g, '},{')}]`);
    expect(objs).toHaveLength(2);
    for (const o of objs) {
      expect(o.kind).toBe('assistant_usage');
      expect(o.session_id).toBe(SID);
    }
    // the OTHER session's record and the tool_call debug blob are gone
    expect(out).not.toContain('OTHER-SESSION');
    expect(out).not.toContain('huge debug blob');
    expect(out).not.toContain('999');
  });

  it('preserves the exact token metrics verbatim', () => {
    const out = filterCopilotProcessLog(LOG, SID);
    expect(out).toContain('"output_tokens": 349');
    expect(out).toContain('"output_tokens": 86');
    expect(out).toContain('"interaction_id": "iid-1"');
  });

  it('output is re-parseable as the adapter would (each block starts { ends })', () => {
    const out = filterCopilotProcessLog(LOG, SID);
    for (const block of out.trim().split(/\n(?=\{)/)) {
      expect(block.trimStart().startsWith('{')).toBe(true);
      expect(block.trimEnd().endsWith('}')).toBe(true);
      expect(() => JSON.parse(block)).not.toThrow();
    }
  });

  it('returns empty string when the session has no usage records', () => {
    expect(filterCopilotProcessLog(LOG, 'no-such-session')).toBe('');
  });
});

describe('redactCopilotSystemMessage', () => {
  // The adapter never reads `system.message`, so replacing the vendor's ~33KB
  // system-prompt body changes nothing in the segment — it only shrinks the fixture
  // and avoids republishing a proprietary prompt. User prompts stay verbatim.
  const EVENTS = [
    JSON.stringify({ type: 'session.start', id: 'a', timestamp: 't0' }),
    JSON.stringify({
      type: 'system.message',
      data: { role: 'system', content: 'You are the GitHub Copilot CLI. '.repeat(500) },
      id: 'b',
      timestamp: 't1',
      parentId: 'a',
    }),
    JSON.stringify({ type: 'user.message', data: { role: 'user', content: 'run harness doctor' }, id: 'c' }),
  ].join('\n');

  it('replaces system.message content with a placeholder, keeps the envelope', () => {
    const out = redactCopilotSystemMessage(EVENTS);
    const lines = out.split('\n').map((l) => JSON.parse(l));
    const sys = lines.find((o) => o.type === 'system.message');
    expect(sys.data.content).toBe('<redacted: vendor system prompt>');
    expect(sys.data.role).toBe('system'); // envelope preserved
    expect(sys.id).toBe('b');
    expect(sys.parentId).toBe('a');
    expect(out).not.toContain('GitHub Copilot CLI'); // the 33KB body is gone
  });

  it('leaves user.message and other events fully verbatim', () => {
    const out = redactCopilotSystemMessage(EVENTS);
    expect(out).toContain('run harness doctor');
    expect(out).toContain('"type":"session.start"');
    // every line stays valid JSON
    for (const l of out.split('\n')) expect(() => JSON.parse(l)).not.toThrow();
  });
});

/**
 * T005 (plan 2.3 · AC-04 · Finding 05) — the copilot-vscode row projection.
 *
 * `projectCopilotVscodeRows` is the PRIVACY BOUNDARY for the copilot-vscode
 * fixture: it takes the raw `sessions` + `turns` rows as read from the live store
 * and emits an extracted-rows shape that carries NO message text — only the
 * structural columns the runtime adapter's SQL projects (`turn_index`, `words`,
 * `has_response`, `timestamp`). The committed `raw.rows.json` lands in a PUBLIC,
 * permanent repo, so the user/assistant message bodies must never reach it.
 *
 * The word count MUST mirror the adapter's `TURNS_SQL` formula EXACTLY —
 * `length(trim) - length(replace(trim, ' ', '')) + 1` for a non-empty trimmed
 * message (i.e. count of single-space chars + 1), `0` otherwise — so that T008's
 * round-trip (reconstruct a writable sqlite from the projected rows, read it back
 * through the adapter's real SQL) reproduces byte-identical numbers. A "smarter"
 * word count that collapses runs of spaces would desync the round-trip.
 */
describe('projectCopilotVscodeRows', () => {
  // Raw rows AS THE STORE HOLDS THEM — with the real message text present. The
  // projection must compute counts from this text then DISCARD it.
  const SECRET_USER = 'please refactor the auth module and add tests'; // 8 words (7 spaces + 1)
  const SECRET_ASSISTANT = 'Here is the refactor you asked for.';
  const rawSessions = [
    { id: 'sess-1', cwd: '/Users/dev/repo', updated_at: 1750000000000 },
  ];
  const rawTurns = [
    {
      session_id: 'sess-1',
      turn_index: 0,
      user_message: SECRET_USER,
      assistant_response: SECRET_ASSISTANT,
      timestamp: 1750000001000,
    },
    {
      session_id: 'sess-1',
      turn_index: 1,
      user_message: '   ', // whitespace-only → 0 words
      assistant_response: null, // no response → has_response 0
      timestamp: 1750000002000,
    },
    {
      session_id: 'sess-1',
      turn_index: 2,
      user_message: 'one  two', // TWO spaces between → SQL counts each → 3 (not 2)
      assistant_response: '',
      timestamp: null,
    },
  ];

  it('drops the message text — no user/assistant body survives the projection', () => {
    const out = projectCopilotVscodeRows(rawSessions, rawTurns);
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain(SECRET_USER);
    expect(serialized).not.toContain(SECRET_ASSISTANT);
    expect(serialized).not.toContain('refactor'); // no fragment of the body either
    for (const t of out.turns) {
      expect(t).not.toHaveProperty('user_message');
      expect(t).not.toHaveProperty('assistant_response');
    }
  });

  it('word count mirrors the adapter TURNS_SQL formula (spaces+1; runs of spaces counted)', () => {
    const out = projectCopilotVscodeRows(rawSessions, rawTurns);
    expect(out.turns[0]?.words).toBe(8); // "please refactor the auth module and add tests" — 7 spaces + 1
    expect(out.turns[1]?.words).toBe(0); // whitespace-only trims to empty
    expect(out.turns[2]?.words).toBe(3); // "one  two" → two single-spaces + 1 (NOT 2)
  });

  it('has_response is 1 only when the assistant_response is non-empty', () => {
    const out = projectCopilotVscodeRows(rawSessions, rawTurns);
    expect(out.turns[0]?.has_response).toBe(1);
    expect(out.turns[1]?.has_response).toBe(0); // null
    expect(out.turns[2]?.has_response).toBe(0); // empty string
  });

  it('passes through the structural columns + preserves turn order', () => {
    const out = projectCopilotVscodeRows(rawSessions, rawTurns);
    expect(out.turns.map((t) => t.turn_index)).toEqual([0, 1, 2]);
    expect(out.turns[0]?.session_id).toBe('sess-1');
    expect(out.turns[0]?.timestamp).toBe(1750000001000);
    expect(out.turns[2]?.timestamp).toBeNull();
  });

  it('mirrors SQLite trim (space-only), NOT JS trim, on whitespace-only values (companion F002)', () => {
    // SQLite `trim()` strips only ASCII space, so a tab/newline-only message is
    // NOT empty: TURNS_SQL returns words=1 / has_response=1. JS `.trim()` would
    // wrongly give 0 — which would desync T008's real-SQL round-trip.
    const out = projectCopilotVscodeRows(rawSessions, [
      { session_id: 's', turn_index: 0, user_message: '\t', assistant_response: '\n', timestamp: 1 },
      { session_id: 's', turn_index: 1, user_message: ' ', assistant_response: ' ', timestamp: 2 },
    ]);
    // '\t' is not a space → not trimmed → length 1 → words 1; '\n' response → has_response 1.
    expect(out.turns[0]).toMatchObject({ words: 1, has_response: 1 });
    // a single real space DOES trim to empty → words 0 / has_response 0.
    expect(out.turns[1]).toMatchObject({ words: 0, has_response: 0 });
  });

  it('projects sessions to exactly {id, cwd, updated_at} — no stray columns', () => {
    const out = projectCopilotVscodeRows(rawSessions, rawTurns);
    expect(out.sessions).toEqual([{ id: 'sess-1', cwd: '/Users/dev/repo', updated_at: 1750000000000 }]);
    // the cwd path stays raw here — scrubText rebases it at the extension boundary,
    // NOT this pure projection (single-source scrub, no double-scrubbing).
    expect(Object.keys(out.sessions[0] ?? {}).sort()).toEqual(['cwd', 'id', 'updated_at']);
  });
});

/**
 * T009 (plan 2.5 · AC-05 · Finding 04) — the cursor `cursorDiskKV` bubble projection.
 *
 * A Cursor IDE-store bubble is enormous: alongside the only fields the runtime
 * adapter reads (`type`, `createdAt`, `modelInfo.modelName` — for the model/timing
 * join) it embeds `gitDiffs`, `consoleLogs`, attached file contents, full message
 * `text`/`richText`, tool args, and more. Committing a raw bubble would republish
 * all of that. `projectCursorBubbleRows` is the cursor PRIVACY BOUNDARY: it keeps
 * each row's `key` + a `value` re-serialized to ONLY `{type, createdAt, modelInfo?}`
 * — exactly what `cursorAdapter`'s `modelHistogram` / `readBubbleTimeline` consume.
 */
describe('projectCursorBubbleRows', () => {
  const SECRET_TEXT = 'my secret prompt about an unreleased product';
  const rawRows = [
    {
      key: 'bubbleId:conv-1:bub-a',
      value: JSON.stringify({
        type: 1,
        createdAt: '2026-06-24T03:53:10.782Z',
        modelInfo: { modelName: 'composer-2.5', apiKey: 'sk-should-not-survive' },
        text: SECRET_TEXT,
        gitDiffs: ['--- a/secret.ts\n+++ b/secret.ts'],
        consoleLogs: ['leaked log line'],
        richText: { root: { children: [{ text: SECRET_TEXT }] } },
      }),
    },
    {
      key: 'bubbleId:conv-1:bub-b',
      value: JSON.stringify({
        type: 2,
        createdAt: '2026-06-24T03:53:15.666Z',
        modelInfo: {}, // assistant bubble with no modelName
        text: 'assistant reply body that must be dropped',
      }),
    },
    { key: 'bubbleId:conv-1:bub-c', value: 'not json — debug noise' },
    { key: 'bubbleId:conv-1:bub-d', value: 42 }, // non-string value
  ];

  it('drops every field except type/createdAt/modelInfo.modelName', () => {
    const out = projectCursorBubbleRows(rawRows);
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain(SECRET_TEXT);
    expect(serialized).not.toContain('gitDiffs');
    expect(serialized).not.toContain('consoleLogs');
    expect(serialized).not.toContain('richText');
    expect(serialized).not.toContain('sk-should-not-survive'); // apiKey beside modelName is gone
    expect(serialized).not.toContain('assistant reply body');
  });

  it('keeps the model/timing fields the adapter joins on', () => {
    const out = projectCursorBubbleRows(rawRows);
    const a = JSON.parse(out[0]?.value as string);
    expect(a).toEqual({
      type: 1,
      createdAt: '2026-06-24T03:53:10.782Z',
      modelInfo: { modelName: 'composer-2.5' },
    });
    expect(out[0]?.key).toBe('bubbleId:conv-1:bub-a'); // key preserved (random ids, not identity)
  });

  it('omits modelInfo when the bubble has no modelName', () => {
    const out = projectCursorBubbleRows(rawRows);
    const b = JSON.parse(out[1]?.value as string);
    expect(b).toEqual({ type: 2, createdAt: '2026-06-24T03:53:15.666Z' });
    expect(b).not.toHaveProperty('modelInfo');
  });

  it('skips non-string / non-JSON values (no throw)', () => {
    const out = projectCursorBubbleRows(rawRows);
    // bub-c (noise) and bub-d (number) are dropped; only the two real bubbles survive.
    expect(out).toHaveLength(2);
    expect(out.every((r) => typeof r.value === 'string')).toBe(true);
  });
});
