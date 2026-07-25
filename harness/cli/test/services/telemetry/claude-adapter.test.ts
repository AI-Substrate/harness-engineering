import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import {
  claudeAdapter,
  claudeTranscriptPath,
  locateClaudeTranscript,
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

describe('claudeAdapter — bounded selected-root locator (P063 T004)', () => {
  const selectedRoot = '/selected/standard-claude';
  const candidateRoots = [
    ['current', '/repo/current'],
    ['main', '/repo/main'],
    ['common-repository', '/repo/common'],
    ['known-worktree', '/repo/worktrees/feature'],
  ] as const;
  const allRoots = candidateRoots.map(([, root]) => root);
  const validTranscript = '{"type":"summary"}\n';

  function candidatePath(configRoot: string, projectRoot: string): string {
    const projectKey = projectRoot.replace(/[^A-Za-z0-9]/g, '-');
    return `${configRoot}/projects/${projectKey}/${SESSION}.jsonl`;
  }

  function locatorSource(
    fs: FakeFs,
    projectRoots: readonly string[] = allRoots,
    configRoot = selectedRoot,
  ): HarnessSource {
    return {
      env: new FakeEnv({ CLAUDE_CODE_SESSION_ID: 'mutated-after-detection' }, HOME),
      fs,
      repoRoot: projectRoots[0] ?? REPO,
      harness: 'claude-code',
      sessionId: SESSION,
      standardClaude: { configRoot, projectRoots },
    };
  }

  it.each(
    candidateRoots,
  )('finds the exactly-one %s candidate under a generic selected standard root', (_label, selectedProjectRoot) => {
    const path = candidatePath(selectedRoot, selectedProjectRoot);
    const fs = new FakeFs({ [path]: validTranscript });

    expect(locateClaudeTranscript(locatorSource(fs))).toEqual({
      status: 'found',
      path,
      content: validTranscript,
    });
    expect(fs.noFollowOps.map(({ op, path: probed }) => ({ op, path: probed }))).toEqual([
      ...allRoots.map((root) => ({ op: 'probe', path: candidatePath(selectedRoot, root) })),
      { op: 'probe', path },
      { op: 'read', path },
    ]);
    expect(
      fs.noFollowOps.every(({ maxBytes }) => Number.isSafeInteger(maxBytes) && maxBytes > 0),
    ).toBe(true);
  });

  it('supports the default standard root without hard-coding it inside the locator', () => {
    const defaultRoot = `${HOME}/.claude`;
    const path = candidatePath(defaultRoot, REPO);
    const fs = new FakeFs({ [path]: validTranscript });

    expect(locateClaudeTranscript(locatorSource(fs, [REPO], defaultRoot))).toEqual({
      status: 'found',
      path,
      content: validTranscript,
    });
  });

  it('probes only explicit candidates: an unlisted transcript is zero, never a global scan', () => {
    const explicit = '/repo/current';
    const expectedProbe = candidatePath(selectedRoot, explicit);
    const unlisted = candidatePath(selectedRoot, '/repo/unlisted');
    const fs = new FakeFs({ [unlisted]: validTranscript });

    const result = locateClaudeTranscript(locatorSource(fs, [explicit]));
    expect(result).toEqual({ status: 'unavailable', reason: 'zero' });
    expect(fs.noFollowOps).toEqual([
      { op: 'probe', path: expectedProbe, maxBytes: fs.noFollowOps[0]?.maxBytes },
    ]);
    expect(JSON.stringify(result)).not.toContain(unlisted);
  });

  it('fails closed on multiple matches without reading or arbitrarily picking either one', () => {
    const roots = ['/repo/current', '/repo/main'];
    const fs = new FakeFs(
      Object.fromEntries(roots.map((root) => [candidatePath(selectedRoot, root), validTranscript])),
    );

    const result = locateClaudeTranscript(locatorSource(fs, roots));
    expect(result).toEqual({ status: 'unavailable', reason: 'multiple' });
    expect(fs.noFollowOps.map(({ op }) => op)).toEqual(['probe', 'probe']);
    expect(Object.keys(result).sort()).toEqual(['reason', 'status']);
  });

  it('returns typed unresolved and traversal failures without probing or exposing raw paths', () => {
    const unresolvedFs = new FakeFs();
    expect(locateClaudeTranscript(locatorSource(unresolvedFs, []))).toEqual({
      status: 'unavailable',
      reason: 'unresolved',
    });
    expect(unresolvedFs.noFollowOps).toEqual([]);

    const traversingRoot = '/repo/../private-secret';
    const traversalFs = new FakeFs();
    const traversal = locateClaudeTranscript(locatorSource(traversalFs, [traversingRoot]));
    expect(traversal).toEqual({ status: 'unavailable', reason: 'traversal' });
    expect(JSON.stringify(traversal)).not.toContain(traversingRoot);
    expect(traversalFs.noFollowOps).toEqual([]);
  });

  it.each([
    {
      reason: 'symlink',
      arrange: (fs: FakeFs, path: string) => fs.symlinkPaths.add(path),
    },
    {
      reason: 'non-file',
      arrange: (fs: FakeFs, path: string) => fs.nonRegularPaths.add(path),
    },
    {
      reason: 'oversize',
      arrange: (fs: FakeFs, path: string) => fs.reportedSizes.set(path, Number.MAX_SAFE_INTEGER),
    },
  ] as const)('returns one closed $reason failure before content read', ({ reason, arrange }) => {
    const path = candidatePath(selectedRoot, REPO);
    const fs = new FakeFs({ [path]: validTranscript });
    arrange(fs, path);

    const result = locateClaudeTranscript(locatorSource(fs, [REPO]));
    expect(result).toEqual({ status: 'unavailable', reason });
    expect(fs.noFollowOps.map(({ op }) => op)).toEqual(['probe']);
    expect(Object.keys(result).sort()).toEqual(['reason', 'status']);
  });

  it('returns a closed malformed failure when the exactly-one file has no valid JSONL record', () => {
    const path = candidatePath(selectedRoot, REPO);
    const plantedFreeText = 'PRIVATE FREE TEXT MUST NOT ESCAPE\n';
    const fs = new FakeFs({ [path]: plantedFreeText });

    const result = locateClaudeTranscript(locatorSource(fs, [REPO]));
    expect(result).toEqual({ status: 'unavailable', reason: 'malformed' });
    expect(JSON.stringify(result)).not.toContain(path);
    expect(JSON.stringify(result)).not.toContain('PRIVATE FREE TEXT');
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

  it('keeps a Bash run as a tool-count only — the command and its secret flag never appear', () => {
    // fixture: `curl -H Authorization:Bearer-SUPER_SECRET… https://…` → counted as a tool,
    // args dropped entirely (bash_commands was removed from the contract — v2).
    expect(caps.tools?.Bash).toBe(1);
    expect(JSON.stringify(caps)).not.toContain('SUPER_SECRET');
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

// ── finding 10: two roots that mangle to the SAME path are one candidate ──────────
describe('locateClaudeTranscript — mangle collision is not ambiguity', () => {
  it('dedupes roots whose mangled candidate path is byte-identical', () => {
    // `/repo/wt-a_x` and `/repo/wt-a-x` both mangle to `-repo-wt-a-x`, so they name
    // ONE transcript. Erroring `ambiguity` converted a perfectly resolvable single
    // candidate into a loss.
    const rootA = '/repo/wt-a_x';
    const rootB = '/repo/wt-a-x';
    const path = claudeTranscriptPath(HOME, rootA, SESSION);
    expect(claudeTranscriptPath(HOME, rootB, SESSION)).toBe(path);

    const fs = new FakeFs({ [path]: TRANSCRIPT });
    const env = new FakeEnv({ CLAUDE_CODE_SESSION_ID: SESSION }, HOME);
    const resolution = locateClaudeTranscript({
      env,
      fs,
      repoRoot: rootA,
      harness: 'claude-code',
      standardClaude: { configRoot: `${HOME}/.claude`, projectRoots: [rootA, rootB] },
    });

    expect(resolution).toMatchObject({ status: 'found', path });
  });

  it('still reports ambiguity when two DIFFERENT candidate paths both exist', () => {
    const rootA = '/repo/one';
    const rootB = '/repo/two';
    const fs = new FakeFs({
      [claudeTranscriptPath(HOME, rootA, SESSION)]: TRANSCRIPT,
      [claudeTranscriptPath(HOME, rootB, SESSION)]: TRANSCRIPT,
    });
    const env = new FakeEnv({ CLAUDE_CODE_SESSION_ID: SESSION }, HOME);
    const resolution = locateClaudeTranscript({
      env,
      fs,
      repoRoot: rootA,
      harness: 'claude-code',
      standardClaude: { configRoot: `${HOME}/.claude`, projectRoots: [rootA, rootB] },
    });

    expect(resolution).toMatchObject({ status: 'unavailable', reason: 'multiple' });
  });
});

// ── finding 07: the typed unavailable reason must reach a reader ──────────────────
describe('claudeAdapter — the locator reason survives into the segment', () => {
  function sourceWith(fs: FakeFs, roots: string[]): HarnessSource {
    return {
      env: new FakeEnv({ CLAUDE_CODE_SESSION_ID: SESSION }, HOME),
      fs,
      repoRoot: REPO,
      harness: 'claude-code',
      standardClaude: { configRoot: `${HOME}/.claude`, projectRoots: roots },
    };
  }

  it('reports WHY a session is token-blind instead of a bare null', () => {
    // Two different roots, two transcripts that both exist → `multiple`. Previously the
    // adapter returned bare nullCaps and every downstream surface rendered the generic
    // `no_observation`, so diagnosing a token-blind Claude session meant source-diving.
    const fs = new FakeFs({
      [claudeTranscriptPath(HOME, '/repo/one', SESSION)]: TRANSCRIPT,
      [claudeTranscriptPath(HOME, '/repo/two', SESSION)]: TRANSCRIPT,
    });
    const caps = claudeAdapter.extract({
      ...sourceWith(fs, ['/repo/one', '/repo/two']),
      window: wholeWindow(),
    });

    expect(caps.tokens ?? null).toBeNull();
    expect(caps.token_unavailable_reason).toBe('multiple');
  });

  it('carries no reason when the transcript resolved fine', () => {
    const caps = claudeAdapter.extract({
      ...sourceWith(seededFs(), [REPO]),
      window: wholeWindow(),
    });
    expect(caps.token_unavailable_reason ?? null).toBeNull();
  });

  it('surfaces the reason on the serialized segment', () => {
    const fs = new FakeFs({
      [claudeTranscriptPath(HOME, '/repo/one', SESSION)]: TRANSCRIPT,
      [claudeTranscriptPath(HOME, '/repo/two', SESSION)]: TRANSCRIPT,
    });
    const caps = claudeAdapter.extract({
      ...sourceWith(fs, ['/repo/one', '/repo/two']),
      window: wholeWindow(),
    });
    const segment = serializeSegment(
      {
        command: 'flow',
        harness: 'claude-code',
        harness_session_id: SESSION,
        timecode: '2026-07-23T00:00:00Z',
        window: wholeWindow(),
        branch: null,
        tokens: caps.tokens ?? null,
        event_stream: caps.event_stream ?? [],
        token_unavailable_reason: caps.token_unavailable_reason ?? null,
      } as SegmentInput,
      REPO,
    );

    expect(segment.token_unavailable_reason).toBe('multiple');
  });
});

// ── finding 07 (cont): the reason must be visible to a READER, not just the segment ─
describe('session evidence surfaces the locator reason', () => {
  it('reports transcript_multiple instead of the generic no_observation', async () => {
    const { FakeProcess } = await import('../../../src/adapters/process/fake-process.js');
    const { getSessionEvidence } = await import(
      '../../../src/services/telemetry/session-evidence.js'
    );
    const segment = serializeSegment(
      {
        command: 'flow',
        harness: 'claude-code',
        harness_session_id: SESSION,
        timecode: '2026-07-23T00:00:00Z',
        window: wholeWindow(),
        branch: null,
        tokens: null,
        token_unavailable_reason: 'multiple',
        event_stream: [],
        captured_env: { PIJ_SESSION_ID: 'pij-blind', PIJ_HARNESS: 'claude' },
      } as SegmentInput,
      REPO,
    );
    const tel = `${REPO}/.harness/temp/telemetry`;
    const fs = new FakeFs(
      { [`${tel}/s/0.json`]: JSON.stringify(segment) },
      { [tel]: ['s'], [`${tel}/s`]: ['0.json'] },
    );

    const evidence = await getSessionEvidence('pij-blind', {
      fs,
      env: new FakeEnv({}, HOME),
      proc: new FakeProcess({}, REPO),
    });

    expect(evidence?.token_evidence.coverage).toBe('unavailable');
    expect(evidence?.token_evidence.reason).toBe('transcript_multiple');
  });
});
