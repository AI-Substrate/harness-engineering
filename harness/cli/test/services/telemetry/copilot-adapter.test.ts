import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import {
  copilotAdapter,
  copilotEventsPath,
  copilotLogsDir,
} from '../../../src/services/telemetry/adapters/copilot-adapter.js';
import type { HarnessSource } from '../../../src/services/telemetry/adapters/harness-adapter.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';

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

  it('reads effort + tools (deduped per call) and the sans-params command/prompt signals', () => {
    expect(caps.effort).toBe('high');
    expect(caps.tools).toEqual({ bash: 2 });
    expect(caps.bash_commands).toEqual(['git status']); // `git status -s` → `-s` dropped
    expect(caps.harness_commands).toEqual(['flow nav']); // `harness flow nav --to …` → path dropped
    expect(caps.user_prompts).toEqual([6]); // 6-word prompt; the text (incl. its secret) is never kept
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
    expect(caps.bash_commands).toEqual(['git status']);
    expect(caps.harness_commands).toEqual(['flow nav']);
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
