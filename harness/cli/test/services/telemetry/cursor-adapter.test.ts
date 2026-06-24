import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import {
  cursorAdapter,
  cursorTranscriptPath,
} from '../../../src/services/telemetry/adapters/cursor-adapter.js';
import type { HarnessSource } from '../../../src/services/telemetry/adapters/harness-adapter.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';

/**
 * The Cursor (`cursor-agent`) adapter (plan 034 follow-on), proven against a
 * sanitized golden transcript in cursor's real Claude-shaped JSONL format. Cursor
 * has no token usage in the transcript (sqlite) → tokens/models null; what it does
 * give — user prompts, tools, Shell→command signatures, skills — is hand-derived.
 * Privacy deep-scan confirms no secret/path/arg survives into the segment.
 */

const REPO = '/repo';
const TDIR = '/t/transcripts';
const CONV = 'conv-1';
const TRANSCRIPT = readFileSync(
  new URL('./fixtures/cursor-transcript.jsonl', import.meta.url),
  'utf8',
);
const LINE_COUNT = 5;

function env(): FakeEnv {
  return new FakeEnv({ CURSOR_CONVERSATION_ID: CONV, AGENT_TRANSCRIPTS: TDIR });
}

function seededFs(): FakeFs {
  return new FakeFs({ [cursorTranscriptPath(TDIR, CONV)]: TRANSCRIPT });
}

function source(fs: FakeFs): HarnessSource {
  return { env: env(), fs, repoRoot: REPO, harness: 'cursor-agent' };
}

const WINDOW = { since: 'session-start' as const, from: 0, to: 99 };

describe('cursorAdapter — identity + path', () => {
  it('handles only the cursor-agent harness id', () => {
    expect(cursorAdapter.harness).toBe('cursor-agent');
    expect(cursorAdapter.handles('cursor-agent')).toBe(true);
    expect(cursorAdapter.handles('claude-code')).toBe(false);
  });

  it('builds the transcript path under $AGENT_TRANSCRIPTS/<conv>/<conv>.jsonl', () => {
    expect(cursorTranscriptPath('/t/x', 'abc')).toBe('/t/x/abc/abc.jsonl');
  });

  it('currentPosition returns the transcript line count; null when missing', () => {
    expect(cursorAdapter.currentPosition?.(source(seededFs()))).toBe(LINE_COUNT);
    expect(cursorAdapter.currentPosition?.(source(new FakeFs({})))).toBeNull();
  });
});

describe('cursorAdapter.extract — transcript capabilities (hand-derived)', () => {
  const caps = cursorAdapter.extract({ ...source(seededFs()), window: WINDOW });

  it('counts user prompts as words (the <user_query> wrapper stripped)', () => {
    expect(caps.user_prompts).toEqual([7]); // "please run the build and check status"
  });

  it('counts tools and splits Shell commands into bash/harness signatures (sans params)', () => {
    expect(caps.tools).toEqual({ Shell: 2, Skill: 1 });
    // `git status -s && harness boot` → bash `git status` + harness `boot`; `cat …secret.env` → `cat`
    expect(caps.bash_commands).toEqual(['git status', 'cat']);
    expect(caps.harness_commands).toEqual(['boot']);
  });

  it('extracts skills from Skill tool_use; leaves tokens/models null (sqlite, not in transcript)', () => {
    expect(caps.skills).toEqual({ 'the-flow': 1 });
    expect(caps.tokens).toBeNull();
    expect(caps.models ?? null).toBeNull();
  });
});

describe('cursorAdapter.extract — PRIVACY (AC-04 deep-scan via serializeSegment)', () => {
  it('no secret / absolute path / tool-arg survives into the serialized segment', () => {
    const caps = cursorAdapter.extract({ ...source(seededFs()), window: WINDOW });
    const input: SegmentInput = {
      command: 'flow',
      harness: 'cursor-agent',
      harness_session_id: CONV,
      timecode: '2026-06-24T00:00:00Z',
      window: WINDOW,
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
    const json = JSON.stringify(serializeSegment(input, REPO));
    expect(json).not.toContain('SUPER_SECRET');
    expect(json).not.toContain('/Users/');
    expect(json).not.toContain('secret.env');
  });
});

describe('cursorAdapter.extract — null-on-absence', () => {
  it('no cursor env → all-null (no throw)', () => {
    const caps = cursorAdapter.extract({
      env: new FakeEnv({}),
      fs: seededFs(),
      repoRoot: REPO,
      harness: 'cursor-agent',
      window: WINDOW,
    });
    expect(caps.tools ?? null).toBeNull();
    expect(caps.user_prompts ?? null).toBeNull();
  });

  it('empty window (from==to) → all-null/empty', () => {
    const caps = cursorAdapter.extract({
      ...source(seededFs()),
      window: { since: 'last-command', from: LINE_COUNT, to: LINE_COUNT },
    });
    expect(caps.tools ?? null).toBeNull();
    expect(caps.user_prompts ?? null).toBeNull();
    expect(caps.bash_commands ?? null).toBeNull();
  });
});
