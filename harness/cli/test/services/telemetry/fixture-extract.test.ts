import { describe, expect, it } from 'vitest';
import {
  filterCopilotProcessLog,
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
