import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import type { DbRow } from '../../../src/adapters/db/db-port.js';
import { FakeDb } from '../../../src/adapters/db/fake-db.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../../src/adapters/git/fake-git.js';
import { FakeGitWrite } from '../../../src/adapters/git/fake-git-write.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import { copilotVscodeAdapter } from '../../../src/services/telemetry/adapters/copilot-vscode-adapter.js';
import type {
  HarnessAdapter,
  HarnessCapabilities,
  HarnessSource,
} from '../../../src/services/telemetry/adapters/harness-adapter.js';
import {
  type CaptureDeps,
  captureTelemetry,
  computeWindow,
  detectHarness,
  hasActivity,
  selectCapturedEnv,
  writeSegmentFile,
} from '../../../src/services/telemetry/capture-service.js';
import type { Event } from '../../../src/services/telemetry/events.js';
import {
  parseManifest,
  ROLLED_MANIFEST_NAME,
} from '../../../src/services/telemetry/rolled-shard.js';
import { type Segment, serializeSegment } from '../../../src/services/telemetry/segment.js';
import { syncTelemetry } from '../../../src/services/telemetry/sync-service.js';

/**
 * T005 (plan 1.4 · AC-01 · C3) — innermost-harness detection, cursor windowing,
 * and the DESIGNED edge no-ops (not the T009 catch-all). Tests-first → T006.
 */

const REPO = '/repo';
const TEL = '/repo/.harness/temp/telemetry';

/** A test adapter with a controllable source extent + caps (stands in for Phase 2). */
function testAdapter(
  harness: string,
  position: number | null,
  caps: HarnessCapabilities,
): HarnessAdapter {
  return {
    harness,
    handles: (id) => id === harness,
    currentPosition: () => position,
    extract: () => caps,
  };
}

function deps(
  over: Partial<CaptureDeps> & { files?: Record<string, string>; env?: Record<string, string> },
): { d: CaptureDeps; fs: FakeFs } {
  const fs = new FakeFs(over.files ?? {});
  const d: CaptureDeps = {
    fs,
    env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1', ...(over.env ?? {}) }),
    clock: new FakeClock('2026-06-23T04:58:00.000Z'),
    proc: new FakeProcess({}, REPO),
    git: new FakeGit({ isRepo: true, branch: '034-x', remoteUrl: 'github.com/x/y' }),
    command: 'flow',
    adapters: over.adapters ?? [],
  };
  return { d, fs };
}

/**
 * Read the first segment buffer entry a single capture wrote, or null. (Each
 * test does ONE capture → seq 1; FakeFs.readdir doesn't enumerate written files,
 * so we read the deterministic `1.json` path directly.)
 */
function readWrittenSegment(fs: FakeFs, sessionId: string): Segment | null {
  const raw = fs.readText(`${TEL}/${sessionId}/1.json`);
  return raw === null ? null : (JSON.parse(raw) as Segment);
}

function segmentJson(sessionId: string, seq: number): string {
  return `${JSON.stringify(
    serializeSegment(
      {
        command: 'flow',
        harness: 'claude-code',
        harness_version: 'test',
        harness_session_id: sessionId,
        timecode: '2026-06-23T04:58:00.000Z',
        window: { since: 'last-command', from: seq - 1, to: seq },
        branch: null,
        event_stream: [],
      },
      REPO,
    ),
    null,
    2,
  )}\n`;
}

function latestTreeNames(git: FakeGitWrite): string[] {
  return (git.trees.at(-1) ?? []).map((e) => e.name).sort();
}

function latestBlob(git: FakeGitWrite, name: string): string | undefined {
  const entry = (git.trees.at(-1) ?? []).find((e) => e.name === name);
  return entry ? git.contentOf(entry.sha) : undefined;
}

describe('T005 — detectHarness (innermost wins)', () => {
  it('Copilot beats Claude when both env vars are set (nested)', () => {
    const env = new FakeEnv({
      HARNESS_TELEMETRY_CAPTURE: '1',
      COPILOT_AGENT_SESSION_ID: 'cop-1',
      CLAUDE_CODE_SESSION_ID: 'cl-1',
    });
    expect(detectHarness(env)).toEqual({ harness: 'copilot-cli', sessionId: 'cop-1' });
  });

  it('detects Claude when only its var is set', () => {
    const env = new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1', CLAUDE_CODE_SESSION_ID: 'cl-1' });
    expect(detectHarness(env)).toEqual({ harness: 'claude-code', sessionId: 'cl-1' });
  });

  it('Cursor beats Claude when both are set (cursor-agent embeds a Claude runtime)', () => {
    const env = new FakeEnv({
      HARNESS_TELEMETRY_CAPTURE: '1',
      CURSOR_CONVERSATION_ID: 'cur-1',
      CLAUDE_CODE_SESSION_ID: 'cl-1',
    });
    expect(detectHarness(env)).toEqual({ harness: 'cursor-agent', sessionId: 'cur-1' });
  });

  it('returns null when no harness env is present (zero-harness)', () => {
    expect(detectHarness(new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1' }))).toBeNull();
  });
});

describe('P063 T004 — standard Claude locator inputs are composed once', () => {
  function emptyCapabilities(): HarnessCapabilities {
    return {
      harness_session_id: null,
      tokens: null,
      models: null,
      effort: null,
      skills: null,
      tools: null,
      user_prompts: null,
      subagents: null,
      files: null,
      compactions: null,
      api_errors: null,
      local_commands: null,
      thinking: null,
      event_stream: null,
    };
  }

  function recordingClaudeAdapter(seen: HarnessSource[]): HarnessAdapter {
    return {
      harness: 'claude-code',
      handles: (id) => id === 'claude-code',
      currentPosition(source) {
        seen.push(source);
        return 0;
      },
      extract(context) {
        seen.push(context);
        return emptyCapabilities();
      },
    };
  }

  it('passes one shared generic selected-root/current/main/common/worktree input to both adapter calls', () => {
    const seen: HarnessSource[] = [];
    const git = new FakeGit({
      isRepo: true,
      branch: null,
      worktreeRoots: [REPO, '/repo/main', '/repo/common', '/repo/worktrees/feature', REPO],
    });
    const { d } = deps({
      env: {
        CLAUDE_CODE_SESSION_ID: 'claude-session',
        CLAUDE_CONFIG_DIR: '/selected/standard-claude',
      },
      adapters: [recordingClaudeAdapter(seen)],
    });
    d.git = git;

    captureTelemetry(d);

    expect(seen).toHaveLength(2);
    expect(seen[0]?.standardClaude).toBe(seen[1]?.standardClaude);
    expect(seen[0]?.standardClaude).toEqual({
      configRoot: '/selected/standard-claude',
      projectRoots: [REPO, '/repo/main', '/repo/common', '/repo/worktrees/feature'],
    });
    expect(seen[0]?.sessionId).toBe('claude-session');
    expect(git.calls.filter((call) => call.startsWith('knownWorktreeRoots:'))).toEqual([
      'knownWorktreeRoots:32',
    ]);
  });

  it('derives the default standard root from the injected home and still bounds Git discovery', () => {
    const seen: HarnessSource[] = [];
    const git = new FakeGit({ isRepo: true, branch: null, worktreeRoots: [] });
    const { d } = deps({
      env: { CLAUDE_CODE_SESSION_ID: 'claude-session' },
      adapters: [recordingClaudeAdapter(seen)],
    });
    d.env = new FakeEnv(
      { HARNESS_TELEMETRY_CAPTURE: '1', CLAUDE_CODE_SESSION_ID: 'claude-session' },
      '/home/standard-user',
    );
    d.git = git;

    captureTelemetry(d);

    expect(seen[0]?.standardClaude).toEqual({
      configRoot: '/home/standard-user/.claude',
      projectRoots: [REPO],
    });
    expect(git.calls.filter((call) => call.startsWith('knownWorktreeRoots:'))).toEqual([
      'knownWorktreeRoots:32',
    ]);
  });

  // ── finding 05: failed discovery must not take `cwd` down with it ───────────────
  for (const failure of ['not-a-repository', 'malformed', 'too-many'] as const) {
    it(`keeps cwd as a candidate when worktree discovery fails (${failure})`, () => {
      const seen: HarnessSource[] = [];
      const { d } = deps({
        env: { CLAUDE_CODE_SESSION_ID: 'claude-session' },
        adapters: [recordingClaudeAdapter(seen)],
      });
      d.git = new FakeGit({ isRepo: true, branch: null, worktreeFailure: failure });

      captureTelemetry(d);

      // `cwd` needs no discovery to be known and is exactly where Claude Code keys the
      // project dir. Dropping it turned a readable transcript into a false
      // `unavailable` and zeroed a real session's tokens for that capture.
      expect(seen[0]?.standardClaude?.projectRoots).toEqual([REPO]);
    });
  }

  it('keeps cwd as a candidate when there is no Git port at all', () => {
    const seen: HarnessSource[] = [];
    const { d } = deps({
      env: { CLAUDE_CODE_SESSION_ID: 'claude-session' },
      adapters: [recordingClaudeAdapter(seen)],
    });
    d.git = undefined;

    captureTelemetry(d);

    expect(seen[0]?.standardClaude?.projectRoots).toEqual([REPO]);
  });
});

describe('v2.5 — selectCapturedEnv finite pij contract', () => {
  const CURRENT_ENV = {
    PIJ_SESSION_ID: 'pij-static-mockingbird',
    PIJ_PARENT_ID: 'pij-thirsty-panda',
    PIJ_HARNESS: 'pi',
    PIJ_ROLE: 'coder',
    PIJ_ANNOUNCE_TO: 'pij-thirsty-panda',
    PIJ_SPAWN_ID: 'spawn-0007',
    PIJ_SPAWN_MODEL: 'github-copilot/gpt-5.6-sol:xhigh',
    PIJ_SPAWN_EFFORT: 'xhigh',
  };

  it('captures exactly the eight current keys with their per-key safe grammars', () => {
    expect(
      selectCapturedEnv(
        new FakeEnv({
          HARNESS_TELEMETRY_CAPTURE: '1',
          ...CURRENT_ENV,
          HOME: '/home/u',
          PIJ_ID: 'legacy-id',
          PIJ_STATUS_KEY: 'status/9',
          PIJ_PANE_ID: '%7',
          PIJ_UNKNOWN: 'safe-looking',
          PIJ_SPAWN_TASK: 'fix the bug then run tests',
        }),
      ),
    ).toEqual(CURRENT_ENV);
  });

  it('drops wrong per-key values rather than serializing arbitrary PIJ content', () => {
    const env = new FakeEnv({
      HARNESS_TELEMETRY_CAPTURE: '1',
      PIJ_SESSION_ID: 'session-not-a-current-pij-id',
      PIJ_PARENT_ID: 'parent-not-a-current-pij-id',
      PIJ_HARNESS: 'not-a-harness',
      PIJ_ROLE: 'not-a-role',
      PIJ_ANNOUNCE_TO: 'line one\nline two',
      PIJ_SPAWN_ID: 'correlation-not-a-spawn-id',
      PIJ_SPAWN_MODEL: 'model-without-provider',
      PIJ_SPAWN_EFFORT: 'ultra',
    });
    expect(selectCapturedEnv(env)).toEqual({});
  });

  it.each([
    `ghp_${'a'.repeat(36)}`,
    `github_pat_${'a'.repeat(48)}`,
    `AKIA${'A'.repeat(16)}`,
    `ASIA${'B'.repeat(16)}`,
    `sk-proj-${'c'.repeat(32)}`,
    `sk_live_${'c'.repeat(32)}`,
    `AIza${'d'.repeat(35)}`,
    'q'.repeat(64),
    'Bearer abcdefghijklmnopqrstuvwxyz',
    'password=hunter2',
    '-----BEGIN PRIVATE KEY-----',
  ])('drops credential-shaped values from an otherwise allowed key', (credential) => {
    const { PIJ_SPAWN_ID: _omitted, ...expected } = CURRENT_ENV;
    expect(
      selectCapturedEnv(
        new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1', ...CURRENT_ENV, PIJ_SPAWN_ID: credential }),
      ),
    ).toEqual(expected);
  });

  it('returns empty when nothing matches (the dominant host case → field omitted)', () => {
    expect(
      selectCapturedEnv(
        new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1', HOME: '/home/u', PATH: '/usr/bin' }),
      ),
    ).toEqual({});
  });
});

describe('Phase 6 — copilot-vscode detection + cwd session resolution (AC-20/AC-21)', () => {
  const VSCODE_ENV = { HARNESS_TELEMETRY_CAPTURE: '1', AI_AGENT: 'github_copilot_vscode_agent' };

  it('AC-20 — the AI_AGENT marker detects copilot-vscode with an empty (db-resolved) session id', () => {
    expect(detectHarness(new FakeEnv(VSCODE_ENV))).toEqual({
      harness: 'copilot-vscode',
      sessionId: '',
    });
  });

  it('AC-20 negative control — TERM_PROGRAM=vscode alone does NOT trigger copilot-vscode', () => {
    // a copilot-cli run inside VS Code's integrated terminal must not false-match
    expect(
      detectHarness(new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1', TERM_PROGRAM: 'vscode' })),
    ).toBeNull();
  });

  it('AC-20 — copilot-cli (its own session-id var) is unaffected by the AI_AGENT path', () => {
    expect(
      detectHarness(
        new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1', COPILOT_AGENT_SESSION_ID: 'cop-9' }),
      ),
    ).toEqual({
      harness: 'copilot-cli',
      sessionId: 'cop-9',
    });
  });

  it('AC-20 precedence — both COPILOT_AGENT_SESSION_ID and AI_AGENT set → copilot-cli wins', () => {
    // A copilot-CLI session running under a VS Code shell that also leaked the
    // vscode AI_AGENT marker: the CLI is the INNERMOST harness and carries a real
    // session id, so the env chain is consulted (and wins) before the AI_AGENT
    // branch. Pins the documented precedence against a future reorder.
    expect(
      detectHarness(
        new FakeEnv({
          HARNESS_TELEMETRY_CAPTURE: '1',
          COPILOT_AGENT_SESSION_ID: 'cop-7',
          AI_AGENT: 'github_copilot_vscode_agent',
        }),
      ),
    ).toEqual({ harness: 'copilot-cli', sessionId: 'cop-7' });
  });

  /** copilot-vscode deps: env carries the AI_AGENT marker + a home; the store is a query-aware FakeDb. */
  function vscodeDeps(resolve: (sql: string) => DbRow[]): { d: CaptureDeps; fs: FakeFs } {
    const fs = new FakeFs({});
    const d: CaptureDeps = {
      fs,
      env: new FakeEnv(VSCODE_ENV, '/home/u'),
      clock: new FakeClock('2026-06-25T02:00:00.000Z'),
      proc: new FakeProcess({}, REPO),
      git: new FakeGit({
        isRepo: true,
        branch: '036-copilot-vscode-telemetry',
        remoteUrl: 'github.com/x/y',
      }),
      command: 'doctor',
      db: new FakeDb(resolve),
      adapters: [copilotVscodeAdapter],
    };
    return { d, fs };
  }

  it('AC-21 — resolves the session id from session-store.db by cwd, then writes the segment under it', () => {
    const { d, fs } = vscodeDeps((sql) =>
      sql.includes('FROM sessions')
        ? [{ id: 'vsc-cwd-1' }]
        : // one turn → non-empty window so the capture has activity to spool (FIX-1)
          sql.includes('FROM turns')
          ? [{ turn_index: 0, words: 5, has_response: 1, timestamp: '2026-06-25T02:00:00Z' }]
          : [],
    );
    captureTelemetry(d);

    const seg = readWrittenSegment(fs, 'vsc-cwd-1');
    expect(seg).not.toBeNull();
    expect(seg?.harness).toBe('copilot-vscode');
    expect(seg?.harness_session_id).toBe('vsc-cwd-1');
    // the sessions read is parameterized by cwd and takes the latest updated_at
    const sessQuery = (d.db as FakeDb).calls.find((c) => c.sql.includes('FROM sessions'));
    expect(sessQuery?.params).toEqual([REPO]);
    expect(sessQuery?.sql).toContain('ORDER BY updated_at DESC');
  });

  it('AC-21 — no matching session row → clean no-op (no forced segment)', () => {
    const { d, fs } = vscodeDeps(() => []); // store has no row for this cwd
    captureTelemetry(d);
    expect(fs.writes.filter((p) => p.includes('/telemetry/'))).toEqual([]);
  });

  it('AC-21 — no db wired → clean no-op (best-effort resolution, never forced)', () => {
    const { d, fs } = vscodeDeps((sql) => (sql.includes('FROM sessions') ? [{ id: 'x' }] : []));
    d.db = undefined;
    captureTelemetry(d);
    expect(fs.writes.filter((p) => p.includes('/telemetry/'))).toEqual([]);
  });
});

describe('T005 — computeWindow', () => {
  it('first run (no prior cursor) = session-start from 0', () => {
    expect(computeWindow(null, 240)).toEqual({ since: 'session-start', from: 0, to: 240 });
  });
  it('subsequent run = last-command delta', () => {
    expect(computeWindow(100, 240)).toEqual({ since: 'last-command', from: 100, to: 240 });
  });
  it('source shrank (rotation/truncation) → reset to session-start', () => {
    expect(computeWindow(100, 50)).toEqual({ since: 'session-start', from: 0, to: 50 });
  });
  it('no current position (missing source) → empty window at the watermark', () => {
    expect(computeWindow(100, null)).toEqual({ since: 'last-command', from: 100, to: 100 });
  });
});

describe('T005 — captureTelemetry happy path', () => {
  it('writes a buffer segment for the since-last window and advances the cursor', () => {
    const { d, fs } = deps({
      env: { CLAUDE_CODE_SESSION_ID: 'sess1' },
      files: { [`${TEL}/sess1.cursor`]: '100' },
      adapters: [
        testAdapter('claude-code', 240, { tools: { Bash: 3 }, skills: { 'the-flow': 1 } }),
      ],
    });

    captureTelemetry(d);

    const seg = readWrittenSegment(fs, 'sess1');
    expect(seg).not.toBeNull();
    expect(seg?.harness).toBe('claude-code');
    expect(seg?.harness_session_id).toBe('sess1');
    expect(seg?.window).toEqual({ since: 'last-command', from: 100, to: 240 });
    expect(seg?.tools.Bash).toBe(3);
    expect(seg?.command).toBe('flow');
    // cursor advanced to the new high-water mark
    expect(fs.readText(`${TEL}/sess1.cursor`)).toBe('240');

    // T015: the OTLP spool PAIR (T010) is written beside the buffer segment —
    // both valid OTLP/JSON, one signal per file.
    const logs = fs.readText(`${TEL}/sess1/1.logs.jsonl`);
    const metrics = fs.readText(`${TEL}/sess1/1.metrics.jsonl`);
    expect(logs).not.toBeNull();
    expect(metrics).not.toBeNull();
    expect(JSON.parse(logs as string)).toHaveProperty('resourceLogs');
    expect(JSON.parse(metrics as string)).toHaveProperty('resourceMetrics');
  });

  it('resolves product HEAD only after activity is known and carries it into both OTLP sidecars', () => {
    const { d, fs } = deps({
      env: { CLAUDE_CODE_SESSION_ID: 'sessProduct' },
      adapters: [testAdapter('claude-code', 1, { tools: { Bash: 1 } })],
    });
    const git = new FakeGit({
      isRepo: true,
      branch: 'main',
      remoteUrl: 'github.com/x/y',
      currentCommit: 'A'.repeat(40),
    });
    d.git = git;
    captureTelemetry(d);

    expect(readWrittenSegment(fs, 'sessProduct')?.product_commit).toBe('a'.repeat(40));
    expect(git.calls.indexOf('currentCommit')).toBeGreaterThan(git.calls.indexOf('currentBranch'));
    for (const name of ['1.logs.jsonl', '1.metrics.jsonl']) {
      expect(fs.readText(`${TEL}/sessProduct/${name}`)).toContain('harness.product.commit');
    }
  });

  it('no real adapter (null-default) + a branch switch (activity) → schema-valid all-null segment is written', () => {
    // Keeps exercising the nullDefaultAdapter fallback (adapters: []). A seeded prior
    // branch differs from FakeGit's '034-x', so the branch switch surfaces a branch
    // event → non-empty stream → FIX-1 keeps it; the empty caps exercise the all-null
    // serialization path (null tokens, omitted v1-compat collections).
    const { d, fs } = deps({
      env: { CLAUDE_CODE_SESSION_ID: 'sessN' },
      files: { [`${TEL}/sessN.branch`]: 'prev-branch' },
      adapters: [], // null-default fallback — the path under test
    });
    captureTelemetry(d);
    const seg = readWrittenSegment(fs, 'sessN');
    expect(seg).not.toBeNull();
    expect(seg?.tokens).toBeNull();
    expect(seg?.skills).toBeUndefined(); // empty v1-compat collections are omitted (v2)
    expect(seg?.harness).toBe('claude-code');
    expect(seg?.event_stream.some((e) => e.kind === 'branch')).toBe(true); // the activity that kept it
  });
});

describe('plan 054 — telemetry buffer wipe resumes above flushed watermark', () => {
  it('writes the next segment above .flushed and syncs it without clobbering the rolled ref', () => {
    const session = 'sessWipe';
    const sessionDir = `${TEL}/${session}`;
    const dirs: Record<string, string[]> = { [TEL]: [session], [sessionDir]: ['19431.json'] };
    const fs = new FakeFs({ [`${sessionDir}/19431.json`]: segmentJson(session, 19431) }, dirs);
    const git = new FakeGitWrite();
    const syncDeps = {
      fs,
      env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1' }),
      proc: new FakeProcess({}, REPO),
      git,
    };

    const first = syncTelemetry(syncDeps);
    expect(first.ok).toBe(true);
    expect(first.segments).toBe(1);
    expect(fs.readText(`${TEL}/${session}.flushed`)?.trim()).toBe('19431');
    expect(latestTreeNames(git)).toContain('19431.json');

    const nextPath = writeSegmentFile(
      { fs, proc: new FakeProcess({}, REPO) },
      REPO,
      session,
      JSON.parse(segmentJson(session, 19432)) as Segment,
    );
    expect(nextPath).toBe(`${sessionDir}/19432.json`);
    dirs[sessionDir].push('19432.json');

    const second = syncTelemetry(syncDeps);
    expect(second.ok).toBe(true);
    expect(second.segments).toBe(1);
    expect(latestTreeNames(git)).toEqual(['19431.json', '19432.json', ROLLED_MANIFEST_NAME]);
    expect(parseManifest(latestBlob(git, ROLLED_MANIFEST_NAME))?.max_seq).toBe(19432);
    expect(fs.readText(`${TEL}/${session}.flushed`)?.trim()).toBe('19432');
  });
});

describe('T005 — designed edge no-ops (C3)', () => {
  it('zero-harness env → clean no-op (no buffer, no writes at all)', () => {
    const { d, fs } = deps({ env: {}, adapters: [] });
    captureTelemetry(d);
    expect(fs.writes.filter((p) => p.includes('/telemetry/'))).toEqual([]);
  });

  it('missing/truncated source → empty window → NOT spooled (FIX-1 no-activity guard), cursor unchanged', () => {
    const { d, fs } = deps({
      env: { CLAUDE_CODE_SESSION_ID: 'sessE' },
      files: { [`${TEL}/sessE.cursor`]: '100' },
      adapters: [testAdapter('claude-code', null, {})], // source unreadable → null position → window [100,100]
    });
    captureTelemetry(d);
    // FIX-1: an empty window + empty event stream is read-only plumbing — write nothing.
    expect(readWrittenSegment(fs, 'sessE')).toBeNull();
    expect(fs.readText(`${TEL}/sessE.cursor`)).toBe('100'); // cursor already at the watermark — safe
    expect((d.git as FakeGit).calls).not.toContain('currentCommit');
  });

  it('corrupt cursor → reset to session-start', () => {
    const { d, fs } = deps({
      env: { CLAUDE_CODE_SESSION_ID: 'sessC' },
      files: { [`${TEL}/sessC.cursor`]: 'not-a-number' },
      adapters: [testAdapter('claude-code', 240, {})],
    });
    captureTelemetry(d);
    const seg = readWrittenSegment(fs, 'sessC');
    expect(seg?.window).toEqual({ since: 'session-start', from: 0, to: 240 });
  });
});

describe('T5.8 — session-end flush (the tail is captured by a follow-up capture)', () => {
  it('a second capture records the TAIL delta + advances the cursor (no new path)', () => {
    // The SessionEnd hook runs `harness telemetry sync`; its capture preamble is
    // just another captureTelemetry call. Model that: the source grows after the
    // first command's capture, and a second capture records the tail window.
    let position = 120;
    const adapter: HarnessAdapter = {
      harness: 'claude-code',
      handles: (id) => id === 'claude-code',
      currentPosition: () => position,
      extract: () => ({ tools: { Bash: 1 } }),
    };
    const { d, fs } = deps({ env: { CLAUDE_CODE_SESSION_ID: 'sessTail' }, adapters: [adapter] });

    captureTelemetry(d); // first command → session-start [0,120]
    expect(readWrittenSegment(fs, 'sessTail')?.window).toEqual({
      since: 'session-start',
      from: 0,
      to: 120,
    });
    expect(fs.readText(`${TEL}/sessTail.cursor`)).toBe('120');

    // work continues; the session-end flush captures the tail [120,170].
    position = 170;
    captureTelemetry(d);
    // (real FS increments <seq> via readdir; FakeFs lists dirs not files, so the
    // tail overwrites 1.json — the WINDOW + cursor are what prove the flush.)
    expect(readWrittenSegment(fs, 'sessTail')?.window).toEqual({
      since: 'last-command',
      from: 120,
      to: 170,
    });
    expect(fs.readText(`${TEL}/sessTail.cursor`)).toBe('170');
  });

  it('session ends with no tail (source unchanged) → nothing spooled (FIX-1), cursor safe', () => {
    const { d, fs } = deps({
      env: { CLAUDE_CODE_SESSION_ID: 'sessNoTail' },
      files: { [`${TEL}/sessNoTail.cursor`]: '90' },
      adapters: [testAdapter('claude-code', 90, {})], // position == cursor → empty window, no caps
    });
    captureTelemetry(d);
    // No tail = no activity = no segment; the real tail-flush (above) writes because
    // its window genuinely advances. The cursor stays put — nothing is lost.
    expect(readWrittenSegment(fs, 'sessNoTail')).toBeNull();
    expect(fs.readText(`${TEL}/sessNoTail.cursor`)).toBe('90');
  });
});

describe('FIX-1 — no-activity captures are not spooled (empty-window plumbing guard)', () => {
  it('hasActivity: empty window + empty stream → false; advanced window OR non-empty stream → true', () => {
    const empty = {
      window: { since: 'last-command', from: 100, to: 100 },
      event_stream: [] as Event[],
    } as Segment;
    expect(hasActivity(empty)).toBe(false);
    // window advanced → activity
    expect(hasActivity({ ...empty, window: { since: 'last-command', from: 100, to: 240 } })).toBe(
      true,
    );
    // FLOW-REPLAY SAFETY: empty transcript window but the stream carries flight-plan
    // events → still activity, must NOT be skipped.
    expect(
      hasActivity({
        ...empty,
        event_stream: [{ t: '2026-06-26T00:00:00Z', kind: 'flow', flow: 'x', stage: 'plan' }],
      } as unknown as Segment),
    ).toBe(true);
  });

  it('empty-window + empty-stream capture writes NOTHING (no .json, no OTLP pair) and leaves the cursor', () => {
    const { d, fs } = deps({
      env: { CLAUDE_CODE_SESSION_ID: 'sessZero' },
      files: { [`${TEL}/sessZero.cursor`]: '100' },
      adapters: [testAdapter('claude-code', 100, {})], // position == cursor → empty window
    });
    captureTelemetry(d);
    expect(readWrittenSegment(fs, 'sessZero')).toBeNull();
    expect(fs.readText(`${TEL}/sessZero/1.logs.jsonl`)).toBeNull();
    expect(fs.readText(`${TEL}/sessZero/1.metrics.jsonl`)).toBeNull();
    expect(fs.writes.filter((p) => p.includes('/sessZero/'))).toEqual([]);
    expect(fs.readText(`${TEL}/sessZero.cursor`)).toBe('100');
  });

  it('a real-activity capture (window advances) is still written — no regression', () => {
    const { d, fs } = deps({
      env: { CLAUDE_CODE_SESSION_ID: 'sessAct' },
      files: { [`${TEL}/sessAct.cursor`]: '100' },
      adapters: [testAdapter('claude-code', 240, { tools: { Bash: 2 } })],
    });
    captureTelemetry(d);
    expect(readWrittenSegment(fs, 'sessAct')).not.toBeNull();
    expect(fs.readText(`${TEL}/sessAct.cursor`)).toBe('240');
  });

  it('branch-watermark safe: an empty first capture still records the baseline so a later switch is detected', () => {
    // Review finding (capture-service:456): skipping the empty segment must NOT skip
    // the branch baseline, else the switch below is silently lost.
    const fs = new FakeFs({});
    const onBranch = (branch: string, position: number | null): CaptureDeps => ({
      fs,
      env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1', CLAUDE_CODE_SESSION_ID: 'sw' }),
      clock: new FakeClock('2026-06-24T09:02:00.000Z'),
      proc: new FakeProcess({}, REPO),
      git: new FakeGit({ isRepo: true, branch, remoteUrl: 'github.com/x/y' }),
      command: 'flow',
      adapters: [testAdapter('claude-code', position, {})],
    });

    // 1) empty capture on `main` (null position → empty window) → segment SKIPPED…
    captureTelemetry(onBranch('main', null));
    expect(readWrittenSegment(fs, 'sw')).toBeNull();
    // …but the branch baseline IS persisted (the fix), so the switch is detectable.
    expect(fs.readText(`${TEL}/sw.branch`)).toBe('main');

    // 2) switch to `feature` with activity → the switch surfaces a branch event.
    captureTelemetry(onBranch('feature', 5));
    const seg = readWrittenSegment(fs, 'sw');
    expect(seg?.branch).toBe('feature');
    expect(seg?.event_stream.some((e) => e.kind === 'branch')).toBe(true);
  });
});

describe('FIX-2 — nested harness invocations self-suppress capture (re-entrancy guard)', () => {
  it('HARNESS_TELEMETRY_DEPTH>0 → no capture even with real activity (a checks sub-verb / drift gate)', () => {
    const { d, fs } = deps({
      env: { CLAUDE_CODE_SESSION_ID: 'sessNest', HARNESS_TELEMETRY_DEPTH: '1' },
      files: { [`${TEL}/sessNest.cursor`]: '100' },
      adapters: [testAdapter('claude-code', 240, { tools: { Bash: 5 } })], // real activity…
    });
    captureTelemetry(d);
    // …but the parent (depth 0) already captured this session — the child must not.
    expect(fs.writes.filter((p) => p.includes('/telemetry/'))).toEqual([]);
  });

  it('depth unset (top-level, depth 0) → captures normally', () => {
    const { d, fs } = deps({
      env: { CLAUDE_CODE_SESSION_ID: 'sessTop' },
      files: { [`${TEL}/sessTop.cursor`]: '100' },
      adapters: [testAdapter('claude-code', 240, { tools: { Bash: 5 } })],
    });
    captureTelemetry(d);
    expect(readWrittenSegment(fs, 'sessTop')).not.toBeNull();
  });
});

describe('branch-change detection + branch event', () => {
  const STREAM: Event[] = [
    { t: '2026-06-24T09:00:00Z', kind: 'prompt', words: 3 },
    { t: '2026-06-24T09:01:00Z', kind: 'turn', dur_s: 50 },
  ];

  function depsOn(fs: FakeFs, branch: string): CaptureDeps {
    return {
      fs,
      env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1', CLAUDE_CODE_SESSION_ID: 'sbr' }),
      clock: new FakeClock('2026-06-24T09:02:00.000Z'),
      proc: new FakeProcess({}, REPO),
      git: new FakeGit({ isRepo: true, branch, remoteUrl: 'github.com/x/y' }),
      command: 'flow',
      adapters: [testAdapter('claude-code', 240, { event_stream: STREAM })],
    };
  }

  function branchEvent(fs: FakeFs): (Event & { to?: string; from?: string }) | undefined {
    return readWrittenSegment(fs, 'sbr')?.event_stream.find((e) => e.kind === 'branch') as
      | (Event & { to?: string; from?: string })
      | undefined;
  }

  it('records the branch; first capture is NOT a change and emits no branch event', () => {
    const fs = new FakeFs({});
    captureTelemetry(depsOn(fs, 'main'));
    const seg = readWrittenSegment(fs, 'sbr');
    expect(seg?.branch).toBe('main');
    // no `branch_changed` boolean exists — the branch event is the single signal
    expect((seg as unknown as Record<string, unknown>).branch_changed).toBeUndefined();
    expect(branchEvent(fs)).toBeUndefined();
    expect(fs.readText(`${TEL}/sbr.branch`)).toBe('main'); // persisted for next capture
  });

  it('a branch switch → a branch event (to/from), anchored to the window start, is the only signal', () => {
    const fs = new FakeFs({});
    captureTelemetry(depsOn(fs, 'main')); // 1st: records `main`
    captureTelemetry(depsOn(fs, 'feature-x')); // 2nd: now on a different branch

    const seg = readWrittenSegment(fs, 'sbr');
    expect(seg?.branch).toBe('feature-x');
    expect((seg as unknown as Record<string, unknown>).branch_changed).toBeUndefined();
    const be = branchEvent(fs);
    expect(be).toMatchObject({
      kind: 'branch',
      to: 'feature-x',
      from: 'main',
      t_precision: 'anchored',
    });
    expect(be?.t).toBe(STREAM[0].t); // anchored to the window start (non-empty stream)
    expect(seg?.event_stream[0].kind).toBe('branch'); // prepended
  });

  it('no switch (same branch) → no branch event', () => {
    const fs = new FakeFs({});
    captureTelemetry(depsOn(fs, 'main'));
    captureTelemetry(depsOn(fs, 'main'));
    expect(branchEvent(fs)).toBeUndefined();
  });

  it('a switch on an EMPTY window still emits the branch event (anchored to timecode)', () => {
    // adapter yields NO event_stream → the switch would have nothing to anchor to;
    // it now anchors to the window-end timecode and becomes the sole event.
    function emptyDeps(fs: FakeFs, branch: string): CaptureDeps {
      return {
        fs,
        env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1', CLAUDE_CODE_SESSION_ID: 'sbr' }),
        clock: new FakeClock('2026-06-24T09:02:00.000Z'),
        proc: new FakeProcess({}, REPO),
        git: new FakeGit({ isRepo: true, branch, remoteUrl: 'github.com/x/y' }),
        command: 'boot',
        adapters: [testAdapter('claude-code', 240, {})], // no event_stream
      };
    }
    const fs = new FakeFs({});
    captureTelemetry(emptyDeps(fs, 'main'));
    captureTelemetry(emptyDeps(fs, 'feature-x'));
    const be = branchEvent(fs);
    expect(be).toMatchObject({
      kind: 'branch',
      to: 'feature-x',
      from: 'main',
      t_precision: 'anchored',
    });
    expect(be?.t).toBe('2026-06-24T09:02:00.000Z'); // the capture clock (no stream to anchor to)
  });
});

describe('triggering-command harness event (timeline visibility)', () => {
  const STREAM: Event[] = [
    { t: '2026-06-24T09:00:00Z', kind: 'prompt', words: 3 },
    { t: '2026-06-24T09:01:00Z', kind: 'turn', dur_s: 50 },
  ];

  function depsWith(fs: FakeFs, stream: Event[]): CaptureDeps {
    return {
      fs,
      env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1', CLAUDE_CODE_SESSION_ID: 'shc' }),
      clock: new FakeClock('2026-06-24T09:02:00.000Z'),
      proc: new FakeProcess({}, REPO),
      git: new FakeGit({ isRepo: true, branch: 'main', remoteUrl: 'github.com/x/y' }),
      command: 'boot',
      adapters: [testAdapter('claude-code', 240, { event_stream: stream })],
    };
  }

  it('appends the triggering command as a zero-gap `harness` event at the window end', () => {
    const fs = new FakeFs({});
    captureTelemetry(depsWith(fs, STREAM));
    const stream = readWrittenSegment(fs, 'shc')?.event_stream ?? [];
    const last = stream[stream.length - 1];
    expect(last).toMatchObject({ kind: 'harness', verb: 'boot', t_precision: 'anchored' });
    // anchored to the LAST work event's t (zero gap) — never the capture clock, so
    // the trailing span isn't mis-attributed as working time.
    expect(last.t).toBe(STREAM[STREAM.length - 1].t);
    expect(last.t).not.toBe('2026-06-24T09:02:00Z'); // not the timecode
  });

  it('does NOT append to an empty window (stays empty, rollup null preserved)', () => {
    const fs = new FakeFs({});
    captureTelemetry(depsWith(fs, []));
    const seg = readWrittenSegment(fs, 'shc');
    expect(seg?.event_stream).toEqual([]);
    expect(seg?.rollup).toBeNull();
  });
});

describe('artifact-semantics pass (plan 050) — changed artifacts → `artifact` events', () => {
  const REVIEW = [
    '**Verdict**: ✅ **APPROVE** (clean)',
    '- **F1 · HIGH · x**: thing. **Fix**: done.',
  ].join('\n');

  /** A capture whose adapter reports `files` for the window, over a seeded FakeFs. */
  function artifactDeps(
    fs: FakeFs,
    files: { written?: string[]; edited?: string[] },
    clock: FakeClock,
  ): CaptureDeps {
    return {
      fs,
      env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1', CLAUDE_CODE_SESSION_ID: 'art' }),
      clock,
      proc: new FakeProcess({}, REPO),
      git: new FakeGit({ isRepo: true, branch: 'main', remoteUrl: 'github.com/x/y' }),
      command: 'flow',
      adapters: [testAdapter('claude-code', 240, { files })],
    };
  }

  it('an edited review in the window emits one counts-only `artifact` event (AC-01)', () => {
    const fs = new FakeFs({ [`${REPO}/docs/plans/050-x/reviews/r.md`]: REVIEW });
    captureTelemetry(
      artifactDeps(
        fs,
        { edited: ['docs/plans/050-x/reviews/r.md'] },
        new FakeClock('2026-07-04T00:00:00.000Z'),
      ),
    );
    const stream = readWrittenSegment(fs, 'art')?.event_stream ?? [];
    const artifacts = stream.filter((e) => e.kind === 'artifact');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      kind: 'artifact',
      artifact_type: 'review',
      path: 'docs/plans/050-x/reviews/r.md',
      plan_id: '050-x',
      change: 'edited',
      counts: { findings_high: 1, fixes: 1 },
      enums: { verdict: 'APPROVE' },
    });
    // The capture-time snapshot is rollup-EXCLUDED (like flow_log) — it must not
    // fabricate wall/gap time from its single stamp.
    expect(readWrittenSegment(fs, 'art')?.rollup?.activity.wall_s).toBe(0);
  });

  it('a missing / oversized artifact never fails capture (AC-04)', () => {
    const huge = `# big\n${'x'.repeat(600 * 1024)}`;
    // cursor == position ⇒ empty transcript window, so ONLY an artifact event could
    // spool a segment; with both files skipped, nothing is written and nothing throws.
    const fs = new FakeFs({
      [`${REPO}/docs/plans/050-x/reviews/big.md`]: huge,
      [`${TEL}/art.cursor`]: '240',
    });
    captureTelemetry(
      artifactDeps(
        fs,
        { edited: ['docs/plans/050-x/reviews/gone.md', 'docs/plans/050-x/reviews/big.md'] },
        new FakeClock('2026-07-04T00:00:00.000Z'),
      ),
    );
    expect(readWrittenSegment(fs, 'art')).toBeNull();
  });

  it('editing the same artifact across two windows yields two snapshots (AC-03)', () => {
    const path = `${REPO}/docs/plans/050-x/reviews/r.md`;
    const clock = new FakeClock('2026-07-04T00:00:00.000Z');
    const fs = new FakeFs({ [path]: '**Verdict**: ⚠️ **FIX_REQUIRED**' });
    const d = artifactDeps(fs, { edited: ['docs/plans/050-x/reviews/r.md'] }, clock);

    captureTelemetry(d);
    const first = (readWrittenSegment(fs, 'art')?.event_stream ?? []).find(
      (e) => e.kind === 'artifact',
    );
    expect(first).toMatchObject({
      enums: { verdict: 'FIX_REQUIRED' },
      t: '2026-07-04T00:00:00.000Z',
    });

    // The review is updated + a later capture window touches it again.
    fs.writeText(path, REVIEW);
    clock.set('2026-07-04T01:00:00.000Z');
    captureTelemetry(d);
    const second = (readWrittenSegment(fs, 'art')?.event_stream ?? []).find(
      (e) => e.kind === 'artifact',
    );
    // A distinct snapshot: new verdict + fixes, stamped at the second capture time.
    expect(second).toMatchObject({
      enums: { verdict: 'APPROVE' },
      counts: { findings_high: 1, fixes: 1 },
      t: '2026-07-04T01:00:00.000Z',
    });
  });
});
