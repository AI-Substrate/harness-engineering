import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import {
  copilotAdapter,
  copilotEventsPath,
} from '../../../src/services/telemetry/adapters/copilot-adapter.js';
import type { HarnessContext } from '../../../src/services/telemetry/adapters/harness-adapter.js';
import type { FileEvent } from '../../../src/services/telemetry/events.js';

/**
 * plan 056 · T006 — the Copilot adapter emits `file` events with a change-delta
 * from the tool payload: `create`→written (full body), `edit`/`str_replace`→
 * edited (old→new), `apply_patch`→per-file +/- counts. Read-only tools (`view`)
 * emit nothing. Body text is measured for counts only, never stored (D5/AC-04).
 */

const HOME = '/home/u';
const SESSION = 'sess-copilot-file';

function line(type: string, ts: string, data: Record<string, unknown>): string {
  return JSON.stringify({ type, timestamp: ts, data });
}

const PATCH = [
  '*** Begin Patch',
  '*** Update File: src/edited.ts',
  '@@',
  ' const keep = 1;',
  '-const gone = 2;',
  '+const added = 3;',
  '+const more = 4;',
  '*** Add File: src/created.ts',
  '+export const created = true;',
  '*** End Patch',
].join('\n');

function eventsJsonl(): string {
  return `${[
    line('tool.execution_start', '2026-06-23T08:00:01Z', {
      toolName: 'create',
      toolCallId: 'c1',
      arguments: { path: 'src/new.ts', file_text: 'const a = 1;\nconst b = 2;\n' },
    }),
    line('tool.execution_complete', '2026-06-23T08:00:02Z', { toolCallId: 'c1', success: true }),
    line('tool.execution_start', '2026-06-23T08:00:03Z', {
      toolName: 'edit',
      toolCallId: 'c2',
      arguments: { path: 'src/mod.ts', old_str: 'x = 1;', new_str: 'x = 2;\ny = 3;' },
    }),
    line('tool.execution_complete', '2026-06-23T08:00:04Z', { toolCallId: 'c2', success: true }),
    line('tool.execution_start', '2026-06-23T08:00:05Z', {
      toolName: 'view',
      toolCallId: 'c3',
      arguments: { path: 'src/readonly.ts' },
    }),
    line('tool.execution_start', '2026-06-23T08:00:06Z', {
      toolName: 'apply_patch',
      toolCallId: 'c4',
      arguments: PATCH,
    }),
    line('tool.execution_complete', '2026-06-23T08:00:07Z', { toolCallId: 'c4', success: true }),
  ].join('\n')}\n`;
}

function ctx(): HarnessContext {
  const fs = new FakeFs({ [copilotEventsPath(HOME, SESSION)]: eventsJsonl() });
  const env = new FakeEnv({ COPILOT_AGENT_SESSION_ID: SESSION }, HOME);
  return {
    env,
    fs,
    repoRoot: '/repo',
    harness: 'copilot-cli',
    window: { since: 'session-start', from: 0, to: 99 },
  };
}

function fileEvents(): FileEvent[] {
  const caps = copilotAdapter.extract(ctx());
  return (caps.event_stream ?? []).filter((e): e is FileEvent => e.kind === 'file');
}

describe('copilotAdapter — file events (T006)', () => {
  it('a create emits change=written with the full body added (removed 0)', () => {
    const e = fileEvents().find((f) => f.path === 'src/new.ts');
    expect(e?.change).toBe('written');
    expect(e?.delta.lines_added).toBe(2);
    expect(e?.delta.lines_removed).toBe(0);
    expect(e?.delta.bytes_added).toBeGreaterThan(0);
  });

  it('an edit emits change=edited with add AND remove counts', () => {
    const e = fileEvents().find((f) => f.path === 'src/mod.ts');
    expect(e?.change).toBe('edited');
    expect(e?.delta.lines_removed).toBe(1);
    expect(e?.delta.lines_added).toBe(2);
  });

  it('apply_patch yields a file event per touched file (Add→written, Update→edited)', () => {
    const evs = fileEvents();
    const updated = evs.find((f) => f.path === 'src/edited.ts');
    const created = evs.find((f) => f.path === 'src/created.ts');
    expect(updated?.change).toBe('edited');
    expect(updated?.delta.lines_added).toBe(2); // +const added, +const more
    expect(updated?.delta.lines_removed).toBe(1); // -const gone
    expect(created?.change).toBe('written');
    expect(created?.delta.lines_added).toBe(1);
  });

  it('AC-07: a read-only view tool emits NO file event', () => {
    expect(fileEvents().some((f) => f.path === 'src/readonly.ts')).toBe(false);
  });

  it('emits one event per distinct touched path', () => {
    const paths = fileEvents().map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(new Set(paths)).toEqual(
      new Set(['src/new.ts', 'src/mod.ts', 'src/edited.ts', 'src/created.ts']),
    );
  });
});
