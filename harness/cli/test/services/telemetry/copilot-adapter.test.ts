import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import {
  copilotAdapter,
  copilotEventsPath,
  copilotLogsDir,
  parseApplyPatchDeltas,
} from '../../../src/services/telemetry/adapters/copilot-adapter.js';
import type { HarnessSource } from '../../../src/services/telemetry/adapters/harness-adapter.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';
import {
  reduceUsageEvents,
  tokenEvidenceFromObservation,
} from '../../../src/services/telemetry/usage-observation.js';

/**
 * T005 (plan 2.4 · AC-03, AC-04) — the Copilot adapter, proven against sanitized
 * golden fixtures in the LIVE Copilot CLI format (June 2026): tokens from the
 * process-log multi-line `[Telemetry] cli.telemetry:` `assistant_usage` blocks
 * (metrics nested, model under properties, session_id top-level); effort/tools/
 * subagents from `events.jsonl`. Per-command attribution: process-log blocks count
 * only when their `interaction_id` is in the windowed events. Expected totals are
 * HAND-DERIVED. Privacy control deep-scans the serialized segment.
 */

const REPO = '/repo';
const HOME = '/home/u';
const SESSION = 'sess-copilot-1';
const LOG_NAME = 'process-123-456.log';

const EVENTS = readFileSync(new URL('./fixtures/copilot-events.jsonl', import.meta.url), 'utf8');
// Fixture is named `.txt` not `.log` because the repo .gitignore excludes `*.log`.
const PROCLOG = readFileSync(
  new URL('./fixtures/copilot-process-log.txt', import.meta.url),
  'utf8',
);

function env(): FakeEnv {
  return new FakeEnv({ COPILOT_AGENT_SESSION_ID: SESSION }, HOME);
}

/** Full source: both events.jsonl and the matching process log present. */
function fullFs(): FakeFs {
  return new FakeFs(
    {
      [copilotEventsPath(HOME, SESSION)]: EVENTS,
      [`${copilotLogsDir(HOME)}/${LOG_NAME}`]: PROCLOG,
      [`${copilotLogsDir(HOME)}/unrelated.txt`]: 'noise',
    },
    { [copilotLogsDir(HOME)]: [LOG_NAME, 'unrelated.txt'] },
  );
}

function source(fs: FakeFs): HarnessSource {
  return { env: env(), fs, repoRoot: REPO, harness: 'copilot-cli' };
}

/** A window spanning the whole 11-line events fixture (the interactive single-command case). */
const WINDOW = { since: 'session-start' as const, from: 0, to: 99 };

describe('copilotAdapter — identity + paths', () => {
  it('handles only the copilot-cli harness id', () => {
    expect(copilotAdapter.harness).toBe('copilot-cli');
    expect(copilotAdapter.handles('copilot-cli')).toBe(true);
    expect(copilotAdapter.handles('claude-code')).toBe(false);
  });

  it('builds the events + logs paths (hand-derived)', () => {
    expect(copilotEventsPath('/home/u', 'sess-x')).toBe(
      '/home/u/.copilot/session-state/sess-x/events.jsonl',
    );
    expect(copilotLogsDir('/home/u')).toBe('/home/u/.copilot/logs');
  });
});

describe('copilotAdapter.extract — token math from process-log assistant_usage (AC-03, hand-derived)', () => {
  const caps = copilotAdapter.extract({ ...source(fullFs()), window: WINDOW });

  it('sums metrics across blocks (uncached→input, cache_read/write explicit, reasoning folded into output)', () => {
    // block1: in 80 / cache_read 20 / cache_write 0 / out 50+10=60
    // block2: in 40 / cache_read 20 / cache_write 5 / out 30+5=35
    expect(caps.tokens).toEqual({
      input: 120,
      output: 95,
      cache_create: 5,
      cache_read: 40,
      total: 260,
      subagent_tokens: 0,
      grand_total: 260,
    });
  });

  it('derives per-model turns/output from assistant_usage (model under properties)', () => {
    expect(caps.models).toEqual({ 'claude-opus-4-8': { turns: 2, output_tokens: 95 } });
  });

  it('reads effort + tools (deduped per call) and the sans-text prompt signal', () => {
    expect(caps.effort).toBe('high');
    expect(caps.tools).toEqual({ bash: 2 });
    expect(caps.user_prompts).toEqual([6]); // 6-word prompt; the text (incl. its secret) is never kept
    // bash/harness commands were dropped from the contract — the harness verb now
    // surfaces only as a `harness` event (asserted via the event stream below).
  });

  it('extracts subagent identity from events subagent.completed; tokens null (not correlatable)', () => {
    expect(caps.subagents).toEqual([
      {
        type: null,
        agent_name: 'explorer',
        model: 'gpt-5-mini',
        status: 'completed',
        tokens: null,
        tool_uses: null,
      },
    ]);
  });

  it('ignores assistant_usage from OTHER sessions in the same log even on a matching interaction (F002)', () => {
    // The fixture's process log carries a sess-OTHER-9 assistant_usage with 999999
    // tokens AND interaction_id int-1 (same as ours). The session_id gate must keep
    // totals at 260 — the hard filter is session_id, not interaction_id.
    expect(caps.tokens?.total).toBe(260);
  });

  it('leaves files/compactions/thinking null (Phase 2 scope)', () => {
    expect(caps.files ?? null).toBeNull();
    expect(caps.compactions ?? null).toBeNull();
    expect(caps.thinking ?? null).toBeNull();
  });
});

describe('copilotAdapter.extract — per-command window attribution', () => {
  it('attributes process-log tokens only when the interaction is in the window slice', () => {
    // A window over just the first event line (session.start) — no interaction, no
    // model_change, no tools: a harness command that bracketed no Copilot LLM work.
    const narrow = copilotAdapter.extract({
      ...source(fullFs()),
      window: { since: 'last-command', from: 0, to: 1 },
    });
    expect(narrow.tokens).toBeNull(); // no in-window interaction → nothing attributed
    expect(narrow.effort).toBeNull(); // session.model_change is outside [0,1)
    expect(narrow.tools ?? null).toBeNull();
  });
});

describe('copilotAdapter.extract — PRIVACY (AC-04 adapter boundary, deep-scan)', () => {
  it('no planted secret / absolute path / tool-arg survives into the serialized segment', () => {
    const caps = copilotAdapter.extract({ ...source(fullFs()), window: WINDOW });
    const input: SegmentInput = {
      command: 'flow',
      harness: 'copilot-cli',
      harness_session_id: SESSION,
      timecode: '2026-06-23T00:00:00Z',
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
    expect(json).not.toContain('keys.env');
  });
});

describe('copilotAdapter.extract — null-on-absence (AC-03)', () => {
  it('missing process log → tokens/models null, but events-derived effort/tools/subagents survive', () => {
    const fs = new FakeFs(
      { [copilotEventsPath(HOME, SESSION)]: EVENTS },
      { [copilotLogsDir(HOME)]: [] },
    );
    const caps = copilotAdapter.extract({ ...source(fs), window: WINDOW });
    expect(caps.tokens).toBeNull();
    expect(caps.models ?? null).toBeNull();
    expect(caps.effort).toBe('high');
    expect(caps.tools).toEqual({ bash: 2 });
    expect(caps.user_prompts).toEqual([6]);
    expect(caps.subagents?.[0]?.agent_name).toBe('explorer');
  });

  it('missing everything → all-null (no throw)', () => {
    const caps = copilotAdapter.extract({ ...source(new FakeFs({})), window: WINDOW });
    expect(caps.tokens).toBeNull();
    expect(caps.tools ?? {}).toEqual({});
    expect(caps.effort ?? null).toBeNull();
  });

  it('currentPosition returns the events line count, null when absent', () => {
    expect(copilotAdapter.currentPosition?.(source(fullFs()))).toBe(11);
    expect(copilotAdapter.currentPosition?.(source(new FakeFs({})))).toBeNull();
  });
});

describe('copilotAdapter.extract — files from editor tools (F-07 / plan 052 T001)', () => {
  // Real copilot-cli shape: `create`/`edit`/`view` tool calls carry a clean
  // `arguments.path`. `create` → written, `edit` → edited, `view` (read-only) → nothing.
  const FILE_EVENTS = [
    { type: 'session.start', timestamp: '2026-07-04T00:00:00Z', data: {} },
    {
      type: 'tool.execution_start',
      timestamp: '2026-07-04T00:00:01Z',
      data: {
        toolCallId: 'c1',
        toolName: 'create',
        arguments: { path: 'src/new.ts', file_text: 'x' },
      },
    },
    {
      type: 'tool.execution_start',
      timestamp: '2026-07-04T00:00:02Z',
      data: {
        toolCallId: 'c2',
        toolName: 'edit',
        arguments: { path: 'src/old.ts', old_str: 'a', new_str: 'b' },
      },
    },
    {
      type: 'tool.execution_start',
      timestamp: '2026-07-04T00:00:03Z',
      data: { toolCallId: 'c3', toolName: 'view', arguments: { path: 'src/read-only.ts' } },
    },
  ]
    .map((e) => JSON.stringify(e))
    .join('\n');

  function filesFs(): FakeFs {
    return new FakeFs(
      { [copilotEventsPath(HOME, SESSION)]: FILE_EVENTS },
      { [copilotLogsDir(HOME)]: [] },
    );
  }

  it('classifies create→written, edit→edited, and skips read-only view', () => {
    const caps = copilotAdapter.extract({ ...source(filesFs()), window: WINDOW });
    expect(caps.files).toEqual({ written: ['src/new.ts'], edited: ['src/old.ts'] });
  });

  it('files is null when no editor tool ran (regression: bash-only session)', () => {
    const caps = copilotAdapter.extract({ ...source(fullFs()), window: WINDOW });
    expect(caps.files).toBeNull();
  });

  it('serializes the paths into the segment files field (relativized, so artifact-semantics fires)', () => {
    const caps = copilotAdapter.extract({ ...source(filesFs()), window: WINDOW });
    const input: SegmentInput = {
      command: 'checks',
      harness: 'copilot-cli',
      harness_session_id: SESSION,
      timecode: '2026-07-04T00:00:05Z',
      window: WINDOW,
      branch: null,
      tokens: caps.tokens,
      files: caps.files,
      event_stream: caps.event_stream,
    };
    const seg = serializeSegment(input, REPO);
    expect(seg.files).toEqual({ written: ['src/new.ts'], edited: ['src/old.ts'] });
  });
});

describe('copilotAdapter.extract — apply_patch file capture (copilot v1.x file-edit tool)', () => {
  // Real copilot v1.0.69 shape (captured live 2026-07-05): `apply_patch`'s `arguments`
  // is the raw patch STRING — the path lives in the *** Add/Update/Delete File: headers,
  // NOT `arguments.path`. One patch can touch several files. `Add`→written, `Update`/
  // `Delete`→edited. The +/- body lines are free text and are never read (AC-04).
  const APPLY_PATCH_EVENTS = [
    { type: 'session.start', timestamp: '2026-07-05T00:00:00Z', data: {} },
    {
      type: 'tool.execution_start',
      timestamp: '2026-07-05T00:00:01Z',
      data: {
        toolCallId: 'p1',
        toolName: 'apply_patch',
        arguments:
          '*** Begin Patch\n*** Add File: reviews/review.phase-1.md\n+# Review\n+**Verdict**: FIX_REQUIRED\n*** Update File: src/existing.ts\n@@\n-old\n+new\n*** End Patch\n',
      },
    },
  ]
    .map((e) => JSON.stringify(e))
    .join('\n');

  function patchFs(): FakeFs {
    return new FakeFs(
      { [copilotEventsPath(HOME, SESSION)]: APPLY_PATCH_EVENTS },
      { [copilotLogsDir(HOME)]: [] },
    );
  }

  it('extracts header paths: Add→written, Update→edited (multi-file, from the patch body)', () => {
    const caps = copilotAdapter.extract({ ...source(patchFs()), window: WINDOW });
    expect(caps.files).toEqual({
      written: ['reviews/review.phase-1.md'],
      edited: ['src/existing.ts'],
    });
  });
});

function currentTokenDetails(
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
): Record<string, { tokenCount: number }> {
  return {
    input: { tokenCount: input },
    output: { tokenCount: output },
    cache_read: { tokenCount: cacheRead },
    cache_write: { tokenCount: cacheWrite },
  };
}

const CURRENT_USAGE_EVENTS = [
  { type: 'session.start', timestamp: '2026-07-20T10:00:00Z', data: {} },
  {
    type: 'assistant.message',
    timestamp: '2026-07-20T10:00:01Z',
    data: {
      outputTokens: 11,
      content: 'PRIVATE_MESSAGE_TEXT',
      identity: 'person@example.test',
    },
  },
  {
    type: 'session.usage_checkpoint',
    timestamp: '2026-07-20T10:00:02Z',
    data: { totalNanoAiu: 200, tokenDetails: currentTokenDetails(20, 30, 4, 5) },
  },
  {
    type: 'session.compaction',
    timestamp: '2026-07-20T10:00:03Z',
    data: { tokenDetails: currentTokenDetails(6, 7, 8, 9), summary: 'PRIVATE_SUMMARY' },
  },
  {
    type: 'session.shutdown',
    timestamp: '2026-07-20T10:00:04Z',
    data: {
      totalNanoAiu: 500,
      tokenDetails: currentTokenDetails(40, 50, 60, 70),
      cwd: '/Users/private/repository',
      sessionOwner: 'PRIVATE_IDENTITY',
    },
  },
]
  .map((event) => JSON.stringify(event))
  .join('\n');

function currentUsageFs(withProcessLog = false): FakeFs {
  const files: Record<string, string> = {
    [copilotEventsPath(HOME, SESSION)]: CURRENT_USAGE_EVENTS,
  };
  const entries: string[] = [];
  if (withProcessLog) {
    files[`${copilotLogsDir(HOME)}/${LOG_NAME}`] = PROCLOG;
    entries.push(LOG_NAME);
  }
  return new FakeFs(files, { [copilotLogsDir(HOME)]: entries });
}

describe('P063 T007 — current typed usage beats obsolete process-log-only extraction', () => {
  it('extracts final-authoritative tokens when no process log exists', () => {
    const caps = copilotAdapter.extract({ ...source(currentUsageFs()), window: WINDOW });
    expect(caps.tokens).toEqual({
      input: 40,
      output: 50,
      cache_create: 70,
      cache_read: 60,
      total: 220,
      subagent_tokens: 0,
      grand_total: 220,
    });
  });

  it('does not add or prefer process-log compatibility when typed final evidence exists', () => {
    const caps = copilotAdapter.extract({ ...source(currentUsageFs(true)), window: WINDOW });
    expect(caps.tokens).toMatchObject({
      input: 40,
      output: 50,
      cache_create: 70,
      cache_read: 60,
      total: 220,
    });
  });

  it('emits every typed observation distinctly and in source order', () => {
    const caps = copilotAdapter.extract({ ...source(currentUsageFs()), window: WINDOW });
    const usage = (caps.event_stream ?? []).filter(
      (event) => (event as { kind: string }).kind === 'usage',
    ) as Array<Record<string, unknown>>;

    expect(usage).toEqual([
      {
        t: '2026-07-20T10:00:01Z',
        kind: 'usage',
        observation_kind: 'message_output',
        out: 11,
      },
      {
        t: '2026-07-20T10:00:02Z',
        kind: 'usage',
        observation_kind: 'cumulative_checkpoint',
        in: 20,
        out: 30,
        cache_read: 4,
        cache_create: 5,
        nano_aiu: 200,
      },
      {
        t: '2026-07-20T10:00:03Z',
        kind: 'usage',
        observation_kind: 'partial_compaction',
        in: 6,
        out: 7,
        cache_read: 8,
        cache_create: 9,
      },
      {
        t: '2026-07-20T10:00:04Z',
        kind: 'usage',
        observation_kind: 'final_shutdown',
        in: 40,
        out: 50,
        cache_read: 60,
        cache_create: 70,
        nano_aiu: 500,
      },
    ]);
  });

  it('publishes only numeric usage fields, never source prose, paths, or identity', () => {
    const caps = copilotAdapter.extract({ ...source(currentUsageFs()), window: WINDOW });
    const segment = serializeSegment(
      {
        command: 'capture',
        harness: 'copilot-cli',
        harness_session_id: SESSION,
        timecode: '2026-07-20T10:00:05Z',
        window: WINDOW,
        branch: null,
        tokens: caps.tokens,
        event_stream: caps.event_stream ?? [],
      },
      REPO,
    );
    const json = JSON.stringify(segment);
    expect(json).not.toContain('PRIVATE_MESSAGE_TEXT');
    expect(json).not.toContain('PRIVATE_SUMMARY');
    expect(json).not.toContain('/Users/private');
    expect(json).not.toContain('person@example.test');
    expect(json).not.toContain('PRIVATE_IDENTITY');
  });
});

// ── finding 06: an output-only typed observation must not bury measured buckets ────
describe('P063 finding 06 — typed usage suppression must not discard process-log buckets', () => {
  /**
   * The killed-copilot-lane shape. The window's events.jsonl holds ONE
   * `assistant.message` (output only), so `hasTypedUsage` was true and the four-bucket
   * `assistant_usage` sums were gated off entirely: `tokens` went null and
   * input/cache_read/cache_create became `field_absent` until a graceful
   * `final_shutdown` — which a killed lane never gets, making the loss permanent.
   */
  const OUTPUT_ONLY_EVENTS = [
    { type: 'session.start', timestamp: '2026-07-20T10:00:00Z', data: {} },
    {
      type: 'assistant.message',
      timestamp: '2026-07-20T10:00:01Z',
      data: { outputTokens: 95, content: 'PRIVATE', identity: 'person@example.test' },
    },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n');

  function fs(): FakeFs {
    return new FakeFs(
      {
        [copilotEventsPath(HOME, SESSION)]: OUTPUT_ONLY_EVENTS,
        [`${copilotLogsDir(HOME)}/${LOG_NAME}`]: PROCLOG,
      },
      { [copilotLogsDir(HOME)]: [LOG_NAME] },
    );
  }

  it('recovers input/cache from the process log while the typed output stays authoritative', () => {
    const caps = copilotAdapter.extract({ ...source(fs()), window: WINDOW });
    const evidence = tokenEvidenceFromObservation(
      reduceUsageEvents(caps.event_stream ?? []),
      'live',
    );

    // The process log measured input 120 / cache_read 40 / cache_create 5 for this
    // session. Those are real numbers; reporting them absent was a false `unavailable`.
    expect(evidence.fields.input).toMatchObject({ value: 120, coverage: 'measured' });
    expect(evidence.fields.cache_read).toMatchObject({ value: 40, coverage: 'measured' });
    expect(evidence.fields.cache_create).toMatchObject({ value: 5, coverage: 'measured' });
    // NOT 95 + 95: the typed observation owns `output`; the process log counts the SAME
    // messages, so its output is a second view and must never be added to it.
    expect(evidence.fields.output).toMatchObject({ value: 95, coverage: 'measured' });
  });

  it('adds nothing when the typed observations already carry every bucket', () => {
    const caps = copilotAdapter.extract({ ...source(currentUsageFs(true)), window: WINDOW });
    const evidence = tokenEvidenceFromObservation(
      reduceUsageEvents(caps.event_stream ?? []),
      'live',
    );
    // The graceful final still wins outright — the process log does not perturb it.
    expect(evidence.fields.input).toMatchObject({ value: 40 });
    expect(evidence.fields.output).toMatchObject({ value: 50 });
  });
});

/**
 * FX009 — `parseApplyPatchDeltas` header hardening.
 *
 * This is the V4A parser CURSOR's `ApplyPatch` branch calls, so it sits on Cursor's
 * own path; Copilot benefits as a side effect. Two defects, both found while fixing
 * the Cursor extraction gate:
 *
 *  1. the header regex ran against `raw.trim()`, so an INDENTED line that merely
 *     looks like a header parsed as a real one and published BODY TEXT as a file
 *     PATH — a privacy-shaped failure, not just a counting one;
 *  2. `(.+)` meant a blank-path header could not match at all, so the empty-path
 *     reset below it was unreachable and the malformed header's orphaned body was
 *     counted against whatever file was patched BEFORE it.
 */
describe('FX009 — parseApplyPatchDeltas: only a COLUMN-0 header is a header', () => {
  it('does not treat an INDENTED header-shaped line as a header (no body text as a path)', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: docs/how/patching.md',
      '+Here is how V4A patches look:',
      '+    *** Add File: not/a/real/path.ts',
      '+ …end of example',
      '*** End Patch',
    ].join('\n');
    const out = parseApplyPatchDeltas(patch);
    expect(out.map((f) => f.path)).toEqual(['docs/how/patching.md']);
    expect(JSON.stringify(out)).not.toContain('not/a/real/path.ts');
    // the quoted example line is COUNTED as an addition to the real file, not split off
    expect(out[0].delta.lines_added).toBe(3);
  });

  it('tolerates CRLF — a `\\r`-terminated header still parses, and its path has no `\\r`', () => {
    const out = parseApplyPatchDeltas('*** Add File: src/a.ts\r\n+one\r\n');
    expect(out.map((f) => f.path)).toEqual(['src/a.ts']);
    expect(out[0].delta.lines_added).toBe(1);
  });

  it('RESETS on an empty-path header so its orphaned body is not billed to the previous file', () => {
    // Pre-fix, `(.+)` could not match `*** Add File:` at all, so `cur` still pointed
    // at `real.ts` and the malformed section's body inflated it.
    const patch = [
      '*** Begin Patch',
      '*** Add File: real.ts',
      '+kept',
      '*** Add File: ',
      '+orphaned body line',
      '+another orphan',
      '*** End Patch',
    ].join('\n');
    const out = parseApplyPatchDeltas(patch);
    expect(out.map((f) => f.path)).toEqual(['real.ts']);
    expect(out[0].delta.lines_added).toBe(1); // 1, not 3
  });
});
