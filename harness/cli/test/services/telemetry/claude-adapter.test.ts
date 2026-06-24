import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import {
  claudeAdapter,
  claudeTranscriptPath,
} from '../../../src/services/telemetry/adapters/claude-adapter.js';
import type { HarnessSource } from '../../../src/services/telemetry/adapters/harness-adapter.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';

/**
 * T002 (plan 2.2 · AC-02, AC-04) — the Claude transcript adapter, proven against
 * the sanitized golden fixture with all four negative controls. Expected totals
 * are HAND-DERIVED here (never lifted from a run); the privacy control runs the
 * extracted caps through `serializeSegment` and deep-scans the whole segment
 * (the adapter boundary — Done Contract's second AC-04 boundary).
 */

const REPO = '/repo';
const HOME = '/home/u';
const SESSION = 'sess-claude-1';
const TRANSCRIPT = readFileSync(
  new URL('./fixtures/claude-transcript.jsonl', import.meta.url),
  'utf8',
);
// The fixture file has 8 newline-terminated lines (header + 7 transcript lines).
const LINE_COUNT = 8;

function source(fs: FakeFs, env: FakeEnv): HarnessSource {
  return { env, fs, repoRoot: REPO, harness: 'claude-code' };
}

function seededFs(): FakeFs {
  return new FakeFs({ [claudeTranscriptPath(HOME, REPO, SESSION)]: TRANSCRIPT });
}

function seededEnv(): FakeEnv {
  return new FakeEnv({ CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_EFFORT: 'high' }, HOME);
}

function wholeWindow(): { since: 'session-start'; from: number; to: number } {
  return { since: 'session-start', from: 0, to: LINE_COUNT };
}

describe('claudeAdapter — identity + path', () => {
  it('handles only the claude-code harness id', () => {
    expect(claudeAdapter.harness).toBe('claude-code');
    expect(claudeAdapter.handles('claude-code')).toBe(true);
    expect(claudeAdapter.handles('copilot-cli')).toBe(false);
  });

  it('builds the transcript path with the leading-dash project mangle (hand-derived)', () => {
    expect(claudeTranscriptPath('/home/u', '/repo', 'sess')).toBe(
      '/home/u/.claude/projects/-repo/sess.jsonl',
    );
    // a deeper repo root, leading dash + every non-alnum → '-'
    expect(claudeTranscriptPath('/h', '/Users/x/proj.dir', 's')).toBe(
      '/h/.claude/projects/-Users-x-proj-dir/s.jsonl',
    );
  });

  it('currentPosition returns the transcript line count; null when missing', () => {
    expect(claudeAdapter.currentPosition?.(source(seededFs(), seededEnv()))).toBe(LINE_COUNT);
    const empty = new FakeFs({});
    expect(claudeAdapter.currentPosition?.(source(empty, seededEnv()))).toBeNull();
  });
});

describe('claudeAdapter.extract — token math (AC-02, hand-derived)', () => {
  const caps = claudeAdapter.extract({ ...source(seededFs(), seededEnv()), window: wholeWindow() });

  it('dedupes usage by message.id and sums all 4 buckets', () => {
    // msg_A {5,40,100,2000} once + msg_B {3,20,0,1500} once — the dup lines drop.
    expect(caps.tokens).toEqual({
      input: 8,
      output: 60,
      cache_create: 100,
      cache_read: 3500,
      total: 3668,
      subagent_tokens: 1234,
      grand_total: 4902,
    });
  });

  it('counts subagent cost once from the inline Agent tool_result <usage> block', () => {
    expect(caps.subagents).toEqual([
      { type: 'Explore', agent_name: null, model: null, status: null, tokens: 1234, tool_uses: 7 },
    ]);
  });

  it('builds per-model turns/output_tokens deduped by message.id', () => {
    expect(caps.models).toEqual({ 'claude-opus-4-8': { turns: 2, output_tokens: 60 } });
  });
});

describe('claudeAdapter.extract — non-token capabilities', () => {
  const caps = claudeAdapter.extract({ ...source(seededFs(), seededEnv()), window: wholeWindow() });

  it('extracts skills from Skill tool_use input.skill', () => {
    expect(caps.skills).toEqual({ 'the-flow': 1, 'eng-harness-flow': 1 });
  });

  it('counts every tool_use across all (incl. duplicate) lines', () => {
    expect(caps.tools).toEqual({ Skill: 2, Bash: 1, Read: 2, Edit: 1, Write: 1, Agent: 1 });
  });

  it('counts thinking blocks and reads effort from env', () => {
    expect(caps.thinking).toEqual({ blocks: 2 });
    expect(caps.effort).toBe('high');
  });

  it('extracts compaction events', () => {
    expect(caps.compactions).toEqual([{ trigger: 'auto', pre_tokens: 50000, post_tokens: 8000 }]);
  });

  it('leaves api_errors/local_commands/branch_changed/harness_session_id null (Phase 2 scope)', () => {
    expect(caps.api_errors ?? null).toBeNull();
    expect(caps.local_commands ?? null).toBeNull();
    expect(caps.branch_changed ?? null).toBeNull();
    expect(caps.harness_session_id ?? null).toBeNull();
  });
});

describe('claudeAdapter.extract — commands + user prompts (schema 1.1)', () => {
  const caps = claudeAdapter.extract({ ...source(seededFs(), seededEnv()), window: wholeWindow() });

  it('reduces a Bash command to a sans-params signature — the secret in the flag is dropped', () => {
    // fixture: `curl -H Authorization:Bearer-SUPER_SECRET… https://…` → just `curl`
    expect(caps.bash_commands).toEqual(['curl']);
    expect(caps.harness_commands ?? null).toBeNull(); // no harness invocation in the fixture
  });

  it('records each user prompt as a WORD COUNT only — never the text (which here holds a secret)', () => {
    // the 11-word prompt is counted; the tool_result user turn is NOT a prompt
    expect(caps.user_prompts).toEqual([11]);
  });
});

describe('claudeAdapter.extract — PRIVACY (AC-04 adapter boundary, deep-scan via serializeSegment)', () => {
  it('no planted secret / absolute path survives into the serialized segment; files are repo-relative', () => {
    const caps = claudeAdapter.extract({
      ...source(seededFs(), seededEnv()),
      window: wholeWindow(),
    });
    const input: SegmentInput = {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: SESSION,
      timecode: '2026-06-23T00:00:00Z',
      window: wholeWindow(),
      branch: null,
      branch_changed: false,
      tokens: caps.tokens,
      models: caps.models ?? {},
      effort: caps.effort,
      skills: caps.skills ?? {},
      tools: caps.tools ?? {},
      bash_commands: caps.bash_commands ?? [],
      harness_commands: caps.harness_commands ?? [],
      user_prompts: caps.user_prompts ?? [],
      subagents: caps.subagents ?? [],
      files: caps.files ?? { written: [], edited: [] },
      plans_touched: [],
      events: {
        compactions: caps.compactions ?? [],
        api_errors: caps.api_errors ?? 0,
        local_commands: caps.local_commands ?? 0,
      },
      thinking: caps.thinking,
    };
    const seg = serializeSegment(input, REPO);
    const json = JSON.stringify(seg);

    expect(json).not.toContain('SUPER_SECRET');
    expect(json).not.toContain('/Users/');
    expect(json).not.toContain('Authorization');
    expect(json).not.toContain('keys.env');
    // the signal we DO keep — repo-relative file paths
    expect(seg.files.edited).toContain(
      'harness/cli/src/services/telemetry/adapters/claude-adapter.ts',
    );
    expect(seg.files.written).toContain(
      'harness/cli/test/services/telemetry/claude-adapter.test.ts',
    );
  });
});

describe('claudeAdapter.extract — edge cases (M6)', () => {
  it('empty window (from==to) yields all-null/empty without re-counting', () => {
    const caps = claudeAdapter.extract({
      ...source(seededFs(), seededEnv()),
      window: { since: 'last-command', from: LINE_COUNT, to: LINE_COUNT },
    });
    expect(caps.tokens).toBeNull();
    expect(caps.tools ?? {}).toEqual({});
    expect(caps.skills ?? {}).toEqual({});
    expect(caps.subagents ?? []).toEqual([]);
    expect(caps.effort ?? null).toBeNull(); // F001: effort must NOT leak with no windowed data
  });

  it('missing transcript yields all-null (no throw), incl. effort (F001)', () => {
    const caps = claudeAdapter.extract({
      ...source(new FakeFs({}), seededEnv()),
      window: wholeWindow(),
    });
    expect(caps.tokens).toBeNull();
    expect(caps.tools ?? {}).toEqual({});
    expect(caps.effort ?? null).toBeNull();
  });
});
