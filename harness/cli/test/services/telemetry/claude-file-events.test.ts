import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import {
  claudeAdapter,
  claudeTranscriptPath,
} from '../../../src/services/telemetry/adapters/claude-adapter.js';
import type { HarnessContext } from '../../../src/services/telemetry/adapters/harness-adapter.js';
import type { FileEvent } from '../../../src/services/telemetry/events.js';

/**
 * plan 056 · T005 — the Claude adapter emits `file` events with a change-delta
 * computed from the tool payload (Write → written/full content; Edit →
 * edited/old→new), one per path, at capture-time `t`. No file read (D5).
 */

const REPO = '/repo';
const HOME = '/home/u';
const SESSION = 'sess-file-1';

function assistantToolUse(ts: string, name: string, input: Record<string, unknown>): string {
  return JSON.stringify({
    timestamp: ts,
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: `id-${name}-${ts}`, name, input }],
    },
  });
}

function transcript(): string {
  return `${[
    JSON.stringify({ harness: 'claude-code' }),
    assistantToolUse('2026-07-07T09:00:00Z', 'Write', {
      file_path: 'src/new.ts',
      content: 'export const a = 1;\nexport const b = 2;\n',
    }),
    assistantToolUse('2026-07-07T09:00:05Z', 'Edit', {
      file_path: 'src/old.ts',
      old_string: 'const x = 1;',
      new_string: 'const x = 2;\nconst y = 3;',
    }),
    // out-of-repo Write → confined to <external> at serialize time (checked elsewhere);
    // here the adapter still emits with the raw path (confinement is downstream).
    assistantToolUse('2026-07-07T09:00:10Z', 'Write', {
      file_path: '/etc/passwd',
      content: 'root:x:0:0\n',
    }),
  ].join('\n')}\n`;
}

function ctx(): HarnessContext {
  const fs = new FakeFs({ [claudeTranscriptPath(HOME, REPO, SESSION)]: transcript() });
  const env = new FakeEnv({ CLAUDE_CODE_SESSION_ID: SESSION }, HOME);
  return {
    env,
    fs,
    repoRoot: REPO,
    harness: 'claude-code',
    window: { since: 'session-start', from: 0, to: 4 },
  };
}

function fileEvents(): FileEvent[] {
  const caps = claudeAdapter.extract(ctx());
  return (caps.event_stream ?? []).filter((e): e is FileEvent => e.kind === 'file');
}

describe('claudeAdapter — file events (T005)', () => {
  it('AC-01: a Write emits change=written with the full content as added (removed 0)', () => {
    const write = fileEvents().find((e) => e.path === 'src/new.ts');
    expect(write).toBeDefined();
    expect(write?.change).toBe('written');
    expect(write?.delta.lines_added).toBe(2);
    expect(write?.delta.lines_removed).toBe(0);
    expect(write?.delta.bytes_added).toBeGreaterThan(0);
    expect(write?.delta.bytes_removed).toBe(0);
  });

  it('AC-02: an Edit emits change=edited with add AND remove counts (not total)', () => {
    const edit = fileEvents().find((e) => e.path === 'src/old.ts');
    expect(edit?.change).toBe('edited');
    // old: 1 line replaced by 2 → 1 removed, 2 added.
    expect(edit?.delta.lines_removed).toBe(1);
    expect(edit?.delta.lines_added).toBe(2);
  });

  it('emits one file event per touched path, stamped with the tool-use time', () => {
    const evs = fileEvents();
    expect(evs.length).toBe(3);
    expect(new Set(evs.map((e) => e.path)).size).toBe(3);
    expect(evs.find((e) => e.path === 'src/new.ts')?.t).toBe('2026-07-07T09:00:00Z');
  });
});
