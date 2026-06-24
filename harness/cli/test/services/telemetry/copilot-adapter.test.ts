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
 * T005 (plan 2.4 · AC-03, AC-04) — the Copilot process-log adapter, proven
 * against sanitized golden fixtures. Tokens come from the process-log
 * `assistant_usage` events ONLY (never `session.shutdown` — not live). Expected
 * totals are HAND-DERIVED. Privacy control deep-scans the serialized segment.
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

const WINDOW = { since: 'session-start' as const, from: 0, to: 5 };

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

  it('sums assistant_usage (uncached→input, cached→cache_read, reasoning folded into output); never session.shutdown', () => {
    // ev1: uncached 80 / cached 100-80=20 / out 50+10=60 ; ev2: 40 / 20 / 30+5=35
    expect(caps.tokens).toEqual({
      input: 120,
      output: 95,
      cache_create: 0,
      cache_read: 40,
      total: 255,
      subagent_tokens: 0,
      grand_total: 255,
    });
  });

  it('derives per-model turns/output from assistant_usage', () => {
    expect(caps.models).toEqual({ 'claude-opus-4-8': { turns: 2, output_tokens: 95 } });
  });

  it('reads effort from session.model_change and tools from tool.execution (name only)', () => {
    expect(caps.effort).toBe('high');
    expect(caps.tools).toEqual({ bash: 1, str_replace: 1 });
  });

  it('extracts subagent identity from the process log; tokens null (not correlatable)', () => {
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

  it('ignores assistant_usage + subagents from OTHER sessions in the same log (F002)', () => {
    // The fixture's process log also carries a sess-OTHER-9 assistant_usage with
    // 999999 tokens and an "intruder" subagent. The per-record session_id filter
    // must keep totals at 255 / one subagent — never the contaminated numbers.
    expect(caps.tokens?.total).toBe(255);
    expect(caps.subagents).toHaveLength(1);
    expect(caps.subagents?.[0]?.agent_name).toBe('explorer');
  });

  it('leaves files/compactions/thinking null (Phase 2 scope — codeChanges only in non-live shutdown)', () => {
    expect(caps.files ?? null).toBeNull();
    expect(caps.compactions ?? null).toBeNull();
    expect(caps.thinking ?? null).toBeNull();
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
  it('missing process log → tokens/models null, but events-derived effort/tools survive', () => {
    const fs = new FakeFs(
      { [copilotEventsPath(HOME, SESSION)]: EVENTS },
      { [copilotLogsDir(HOME)]: [] },
    );
    const caps = copilotAdapter.extract({ ...source(fs), window: WINDOW });
    expect(caps.tokens).toBeNull();
    expect(caps.models ?? null).toBeNull();
    expect(caps.subagents ?? null).toBeNull();
    expect(caps.effort).toBe('high');
    expect(caps.tools).toEqual({ bash: 1, str_replace: 1 });
  });

  it('missing everything → all-null (no throw)', () => {
    const caps = copilotAdapter.extract({ ...source(new FakeFs({})), window: WINDOW });
    expect(caps.tokens).toBeNull();
    expect(caps.tools ?? {}).toEqual({});
    expect(caps.effort ?? null).toBeNull();
  });

  it('currentPosition returns the events line count, null when absent', () => {
    expect(copilotAdapter.currentPosition?.(source(fullFs()))).toBe(5);
    expect(copilotAdapter.currentPosition?.(source(new FakeFs({})))).toBeNull();
  });
});
